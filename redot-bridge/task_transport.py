#!/usr/bin/env python3
"""Opt-in, signed WebFTP tasks for a single Redot bridge.

The legacy task-*.json protocol is deliberately untouched. This transport
uses a separate namespace and verifies a fresh HMAC before any editor action.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

import bridge

TASK_PREFIX = 'redot-secure-task-'
RESULT_PREFIX = 'redot-secure-result-'
IDENT = re.compile(r'^[0-9a-f]{32}$')
MAC = re.compile(r'^[0-9a-f]{64}$')
MAX_TASK = 32 * 1024
MAX_LIST = 2 * 1024 * 1024
MAX_RESULT = 12 * 1024 * 1024
MAX_AGE = 120
FUTURE_SKEW = 15
METHODS = ('game_status', 'game_play', 'game_stop', 'delete_game_screenshot', 'delete_logs', 'game_screenshot', 'read_logs')
SENSITIVE = frozenset(('game_screenshot', 'read_logs'))


def chat_share(value):
    try:
        parsed = urllib.parse.urlsplit(value)
        if (not parsed.hostname or parsed.username is not None or parsed.password is not None or
                parsed.query or parsed.fragment or any(ord(c) < 33 or ord(c) > 126 for c in value) or
                parsed.scheme not in ('http', 'https') or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError
        if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError
    except ValueError as exc:
        raise ValueError('WEBFTP_SHARE must be HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment') from exc
    return value.rstrip('/')


def valid_secret(secret):
    return isinstance(secret, str) and len(secret) >= 32 and secret.isascii() and all(33 <= ord(c) <= 126 for c in secret)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('ascii')


def sign(payload, secret, kind):
    if kind not in ('task', 'result') or not valid_secret(secret):
        raise ValueError('Invalid signing configuration')
    mac = hmac.new(secret.encode('ascii'), ('redot-secure-' + kind + '-v1\0').encode('ascii') + canonical(payload), hashlib.sha256).hexdigest()
    return {'payload': payload, 'mac': mac}


def verify(envelope, secret, kind):
    if (not isinstance(envelope, dict) or set(envelope) != {'payload', 'mac'} or
            not isinstance(envelope['payload'], dict) or not isinstance(envelope['mac'], str) or not MAC.fullmatch(envelope['mac'])):
        raise ValueError('Invalid signed envelope')
    expected = sign(envelope['payload'], secret, kind)['mac']
    if not hmac.compare_digest(expected, envelope['mac']):
        raise ValueError('Invalid signature')
    return envelope['payload']


class WebFTP:
    def __init__(self, share, bearer=''):
        self.share = chat_share(share)
        if bearer and not valid_secret(bearer):
            raise ValueError('WEBFTP_BEARER must be printable ASCII and at least 32 characters')
        self.bearer = bearer

    def request(self, url, method='GET', data=None, limit=MAX_LIST):
        headers = {'Accept': 'application/json'}
        if self.bearer:
            headers['Authorization'] = 'Bearer ' + self.bearer
        if data is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with bridge.HTTP.open(request, timeout=20) as response:
                if response.status not in (200, 201, 204):
                    raise ValueError('WebFTP request failed')
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise ValueError('WebFTP response too large')
                return data
        except (OSError, ValueError) as exc:
            # Do not expose the share URL or authorization value in diagnostics.
            raise ValueError('WebFTP request failed or exceeded its size limit') from exc

    def list_tasks(self):
        data = json.loads(self.request(self.share + '/?json=1', limit=MAX_LIST))
        if not isinstance(data, dict) or not isinstance(data.get('items'), list) or len(data['items']) > 10000:
            raise ValueError('Invalid or oversized WebFTP listing')
        names = []
        for item in data['items']:
            if not isinstance(item, dict) or item.get('type') != 'file':
                continue
            name = item.get('name')
            if isinstance(name, str) and name.startswith(TASK_PREFIX) and name.endswith('.json') and IDENT.fullmatch(name[len(TASK_PREFIX):-5]):
                names.append(name)
        return sorted(set(names))

    def get(self, name, limit):
        return self.request(self.share + '/' + urllib.parse.quote(name, safe='') + '?view=1', limit=limit)

    def put(self, name, value):
        data = canonical(value)
        if len(data) > MAX_RESULT:
            raise ValueError('Response exceeds size limit')
        self.request(self.share + '/?name=' + urllib.parse.quote(name, safe=''), 'PUT', data, limit=4096)


def make_task(method, secret, now=None):
    if method not in METHODS:
        raise ValueError('Unsupported task method')
    identifier = secrets.token_hex(16)
    payload = {'version': 1, 'id': identifier, 'issued_at': int(time.time() if now is None else now), 'method': method, 'arguments': {}}
    return identifier, sign(payload, secret, 'task')


def validate_task(envelope, secret, identifier, now=None):
    payload = verify(envelope, secret, 'task')
    now = time.time() if now is None else now
    if (set(payload) != {'version', 'id', 'issued_at', 'method', 'arguments'} or type(payload['version']) is not int or
            payload['version'] != 1 or payload['id'] != identifier or not IDENT.fullmatch(identifier) or
            type(payload['issued_at']) is not int or payload['issued_at'] < now - MAX_AGE or payload['issued_at'] > now + FUTURE_SKEW or
            payload['method'] not in METHODS or payload['arguments'] != {}):
        raise ValueError('Invalid or expired task')
    return payload


class Claims:
    """Persist claims before execution; a crash can lose a result, never retry it."""
    def __init__(self, path):
        path = Path(path)
        if path.is_symlink() or not path.parent.is_dir() or (path.exists() and not path.is_file()):
            raise ValueError('State database must be a non-symlink file in a trusted directory')
        if not path.exists():
            fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
        self.connection = sqlite3.connect(str(path), timeout=10)
        self.connection.execute('PRAGMA synchronous=FULL')
        self.connection.execute('CREATE TABLE IF NOT EXISTS claimed (id TEXT PRIMARY KEY, issued_at INTEGER NOT NULL)')
        self.connection.commit()

    def contains(self, identifier):
        return self.connection.execute('SELECT 1 FROM claimed WHERE id = ?', (identifier,)).fetchone() is not None

    def claim(self, identifier, issued_at):
        cursor = self.connection.execute('INSERT OR IGNORE INTO claimed (id, issued_at) VALUES (?, ?)', (identifier, issued_at))
        self.connection.commit()
        return cursor.rowcount == 1

    def close(self):
        self.connection.close()


def submit(client, secret, method):
    identifier, envelope = make_task(method, secret)
    client.put(TASK_PREFIX + identifier + '.json', envelope)
    return identifier


def get_result(client, secret, identifier):
    if not isinstance(identifier, str) or not IDENT.fullmatch(identifier):
        raise ValueError('Invalid task id')
    envelope = json.loads(client.get(RESULT_PREFIX + identifier + '.json', MAX_RESULT))
    payload = verify(envelope, secret, 'result')
    if (set(payload) != {'version', 'id', 'reply'} or type(payload['version']) is not int or payload['version'] != 1 or
            payload['id'] != identifier or not isinstance(payload['reply'], dict) or payload['reply'].get('id') != identifier or
            payload['reply'].get('jsonrpc') != '2.0'):
        raise ValueError('Invalid task result')
    return payload['reply']


def work_once(client, secret, claims, editor_url, editor_token, allow_sensitive=False):
    if not valid_secret(secret) or not valid_secret(editor_token) or hmac.compare_digest(secret, editor_token):
        raise ValueError('Use distinct random task and bridge secrets')
    count = 0
    for filename in client.list_tasks():
        identifier = filename[len(TASK_PREFIX):-5]
        if claims.contains(identifier):
            continue
        try:
            envelope = json.loads(client.get(filename, MAX_TASK))
            task = validate_task(envelope, secret, identifier)
        except (ValueError, UnicodeError, TypeError, RecursionError):
            continue
        if not claims.claim(identifier, task['issued_at']):
            continue
        # A claimed task is never run twice even if the process or upload fails.
        if task['method'] in SENSITIVE and not allow_sensitive:
            reply = {'jsonrpc': '2.0', 'id': identifier, 'result': {'content': [{'type': 'text', 'text': 'Sending game images or logs to WebFTP was not explicitly enabled.'}], 'isError': True}}
        else:
            message = {'jsonrpc': '2.0', 'id': identifier, 'method': 'tools/call', 'params': {'name': task['method'], 'arguments': {}}}
            reply = bridge.mcp_response(message, editor_url, editor_token)
        client.put(RESULT_PREFIX + identifier + '.json', sign({'version': 1, 'id': identifier, 'reply': reply}, secret, 'result'))
        count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    send = sub.add_parser('send'); send.add_argument('method', choices=METHODS)
    result = sub.add_parser('result'); result.add_argument('id')
    worker = sub.add_parser('worker')
    worker.add_argument('--state', type=Path, required=True, help='persistent SQLite file in a trusted private directory')
    worker.add_argument('--port', type=int, default=8765)
    worker.add_argument('--url', help='HTTPS relay origin instead of local bridge')
    worker.add_argument('--allow-sensitive', action='store_true', help='allow sending screenshots and logs to the share')
    worker.add_argument('--once', action='store_true', help='poll once and exit')
    args = parser.parse_args()
    secret = os.environ.get('REDOT_TASK_SECRET', '')
    try:
        if not valid_secret(secret):
            raise ValueError('Set REDOT_TASK_SECRET to a random ASCII secret of at least 32 characters')
        client = WebFTP(os.environ.get('WEBFTP_SHARE', ''), os.environ.get('WEBFTP_BEARER', ''))
        if args.action == 'send':
            print(submit(client, secret, args.method))
        elif args.action == 'result':
            print(json.dumps(get_result(client, secret, args.id), ensure_ascii=True))
        else:
            token = os.environ.get('REDOT_BRIDGE_TOKEN', '')
            if not valid_secret(token) or hmac.compare_digest(secret, token) or not 1 <= args.port <= 65535:
                raise ValueError('Set a distinct REDOT_BRIDGE_TOKEN and a valid port')
            url = bridge.remote_origin(args.url) if args.url else f'http://127.0.0.1:{args.port}'
            claims = Claims(args.state)
            try:
                while True:
                    try:
                        work_once(client, secret, claims, url, token, args.allow_sensitive)
                    except (ValueError, RecursionError):
                        if args.once:
                            raise
                        # A claimed task is not retried: its result may be lost.
                        print('WebFTP temporarily unavailable; a claimed result may be missing.', file=sys.stderr, flush=True)
                    if args.once:
                        break
                    time.sleep(1.5)
            finally:
                claims.close()
    except (ValueError, OSError, sqlite3.Error, RecursionError):
        print('Signed task transport failed; check configuration, share and state directory.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
