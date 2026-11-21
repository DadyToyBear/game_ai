#!/usr/bin/env python3
"""Opt-in, local-only frame mailbox and MCP stdio adapter (experimental)."""
import argparse
import base64
import hmac
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sys
import threading
import time
from collections import deque
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import project_sync

MAX_MCP_SNAPSHOT = 8 * 1024 * 1024
MAX_FRAME = 8 * 1024 * 1024
MAX_LOG_REQUEST = 16 * 1024
MAX_LOG_RESPONSE = 512 * 1024
GAME_SOURCES = frozenset(('native-game', 'web-game'))
WEB = Path(__file__).resolve().parent / 'web'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward bearer credentials to a redirect target.
        return None


HTTP = urllib.request.build_opener(NoRedirect())


def remote_origin(value):
    try:
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None or
                parsed.password is not None or parsed.path not in ('', '/') or parsed.query or parsed.fragment or
                any(ord(c) < 33 or ord(c) > 126 for c in value) or
                (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError
    except ValueError as exc:
        raise ValueError('Remote bridge must be an HTTPS origin without credentials, path, query or fragment') from exc
    return value.rstrip('/')


class FrameStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame = None
        self.editor_seen = None
        self.editor_playing = False
        self.pending_command = None
        self.command_queued = None
        self.logs = deque(maxlen=200)
        self.next_log_seq = 1

    def add_logs(self, payload):
        if (not isinstance(payload, dict) or set(payload) != {'source', 'entries'} or
                payload['source'] not in ('editor', 'game') or not isinstance(payload['entries'], list) or
                not 1 <= len(payload['entries']) <= 5):
            raise ValueError('Invalid log batch')
        for item in payload['entries']:
            if (not isinstance(item, dict) or set(item) != {'level', 'message'} or
                    item['level'] not in ('info', 'error', 'warning') or
                    not isinstance(item['message'], str) or len(item['message']) > 512):
                raise ValueError('Invalid log entry')
            try:
                item['message'].encode('utf-8')
            except UnicodeEncodeError as exc:
                raise ValueError('Invalid log text') from exc
        with self.lock:
            for item in payload['entries']:
                self.logs.append({'seq': self.next_log_seq, 'source': payload['source'],
                                  'level': item['level'], 'message': item['message'], 'received_at': time.time()})
                self.next_log_seq += 1

    def get_logs(self):
        with self.lock:
            return {'entries': list(self.logs)}

    def clear_logs(self):
        with self.lock:
            self.logs.clear()

    def editor_poll(self, playing):
        with self.lock:
            now = time.monotonic()
            was_connected = self.editor_seen is not None and now - self.editor_seen < 5
            command = self.pending_command if was_connected else None
            if self.command_queued is not None and now - self.command_queued >= 5:
                command = None
            self.editor_seen = now
            self.editor_playing = playing
            self.pending_command = None
            self.command_queued = None
            return command

    def status(self):
        with self.lock:
            online = self.editor_seen is not None and time.monotonic() - self.editor_seen < 5
            return {'editor_connected': online, 'playing': self.editor_playing if online else None,
                    'pending': self.pending_command if online else None,
                    'frame_available': self.frame is not None,
                    'frame_source': self.frame[3] if self.frame else None,
                    'frame_age_seconds': round(time.monotonic() - self.frame[2], 1) if self.frame else None}

    def enqueue(self, command):
        with self.lock:
            if self.editor_seen is None or time.monotonic() - self.editor_seen >= 5:
                return 'editor_offline'
            if self.pending_command is not None:
                return 'busy'
            self.pending_command = command
            self.command_queued = time.monotonic()
            return None

    def put(self, data, mime, source='unspecified'):
        with self.lock:
            self.frame = (data, mime, time.monotonic(), source)

    def get(self):
        with self.lock:
            return self.frame

    def clear(self):
        with self.lock:
            existed = self.frame is not None
            self.frame = None
            return existed


def handler_for(store, token, editor_dir=None, project_dir=None):
    registry = project_sync.ProjectRegistry()
    if project_dir is not None:
        registry.add(str(Path(project_dir).absolute()))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            # Do not log paths, authorization headers or payloads.
            pass

        def send_bytes(self, code, body=b'', content_type='text/plain; charset=utf-8', extra_headers=None):
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            for name, value in (extra_headers or {}).items():
                self.send_header(name, value)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
            self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def authorized(self):
            actual = self.headers.get('Authorization', '')
            return hmac.compare_digest(actual.encode('utf-8'), ('Bearer ' + token).encode('utf-8'))

        def check_auth(self):
            if not self.authorized():
                self.send_bytes(401, b'Unauthorized')
                return False
            return True

        def do_GET(self):
            if self.path in ('/', '/demo.html', '/capture.js', '/redot-overlay.js', '/native.html', '/native.js', '/sync.html', '/sync.js', '/project-open.html', '/project-open.js'):
                name = 'demo.html' if self.path in ('/', '/demo.html') else self.path[1:]
                kind = 'text/html; charset=utf-8' if name.endswith('.html') else 'text/javascript; charset=utf-8'
                self.send_bytes(200, (WEB / name).read_bytes(), kind)
                return
            if self.path == '/api/status':
                if self.check_auth():
                    self.send_bytes(200, json.dumps(store.status()).encode('utf-8'), 'application/json')
                return
            if self.path == '/api/logs':
                if self.check_auth():
                    self.send_bytes(200, json.dumps(store.get_logs(), ensure_ascii=False).encode('utf-8'), 'application/json')
                return
            if self.path == '/api/projects':
                if self.check_auth():
                    self.send_bytes(200, json.dumps({'projects': registry.list()}, ensure_ascii=False).encode('utf-8'), 'application/json')
                return
            if self.path == '/api/project/status':
                if self.check_auth():
                    info = {'configured': project_dir is not None, 'name': Path(project_dir).name if project_dir else None}
                    self.send_bytes(200, json.dumps(info).encode('utf-8'), 'application/json')
                return
            if self.path == '/api/project/export':
                if not self.check_auth():
                    return
                if project_dir is None:
                    self.send_bytes(503, b'No project configured')
                    return
                try:
                    data = project_sync.pack_project(project_dir)
                except (project_sync.SnapshotError, OSError, ValueError) as exc:
                    self.send_bytes(400, str(exc).encode('utf-8'))
                    return
                self.send_bytes(200, data, 'application/zip')
                return
            if self.path.startswith('/editor/') and editor_dir is not None:
                # Only files under the configured editor directory are served; no listings or traversal.
                root = Path(editor_dir).resolve()
                target = (root / self.path[len('/editor/'):]).resolve()
                if not target.is_relative_to(root) or not target.is_file():
                    self.send_bytes(404, b'Not found')
                    return
                data = target.read_bytes()
                if target == root / 'godot.editor.html':
                    marker = b'</body>'
                    if marker not in data:
                        self.send_bytes(500, b'Editor HTML missing body closing tag')
                        return
                    data = data.replace(marker, b'<script src="/capture.js"></script><script src="/redot-overlay.js"></script><script src="/project-open.js"></script></body>', 1)
                if target == root / 'service.worker.js':
                    # RC2's worker may rebuild cross-origin responses as same-origin,
                    # breaking CORS fetches. Let the browser handle those requests.
                    marker = b"\t(event) => {\n\t\tconst isNavigate = event.request.mode === 'navigate';"
                    if marker not in data:
                        self.send_bytes(500, b'Unsupported editor service worker; expected RC2 fetch handler')
                        return
                    data = data.replace(marker, b"\t(event) => {\n\t\tif (new URL(event.request.url).origin !== self.location.origin) return;\n\t\tconst isNavigate = event.request.mode === 'navigate';", 1)
                kind = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                if target.suffix == '.wasm':
                    kind = 'application/wasm'
                self.send_bytes(200, data, kind)
                return
            if self.path != '/api/frame':
                self.send_bytes(404, b'Not found')
                return
            if not self.check_auth():
                return
            frame = store.get()
            if frame is None:
                self.send_bytes(404, b'No frame available')
                return
            self.send_bytes(200, frame[0], frame[1], {'X-Redot-Source': frame[3]})

        def do_POST(self):
            if self.path not in ('/api/frame', '/api/command', '/api/editor/poll', '/api/project/import', '/api/logs', '/api/projects/add', '/api/projects/remove', '/api/projects/export'):
                self.send_bytes(404, b'Not found')
                return
            if not self.check_auth():
                self.close_connection = True
                return
            try:
                length = int(self.headers.get('Content-Length', ''))
            except ValueError:
                self.close_connection = True
                self.send_bytes(411, b'Content-Length required')
                return
            mime = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
            if self.path == '/api/logs':
                if mime != 'application/json' or not 2 <= length <= MAX_LOG_REQUEST:
                    self.close_connection = True
                    self.send_bytes(400, b'Invalid log batch')
                    return
                try:
                    data = self.rfile.read(length)
                    if len(data) != length:
                        raise ValueError('Truncated log batch')
                    store.add_logs(json.loads(data))
                except (ValueError, UnicodeDecodeError):
                    self.send_bytes(400, b'Invalid log batch')
                    return
                self.send_bytes(204)
                return
            if self.path in ('/api/projects/add', '/api/projects/remove', '/api/projects/export'):
                if mime != 'application/json' or not 2 <= length <= 8192:
                    self.close_connection = True
                    self.send_bytes(400, b'Invalid project request')
                    return
                try:
                    raw = self.rfile.read(length)
                    if len(raw) != length:
                        raise ValueError('Truncated request')
                    payload = json.loads(raw)
                    if not isinstance(payload, dict):
                        raise ValueError('Invalid request')
                    if self.path == '/api/projects/add':
                        if set(payload) != {'path'}:
                            raise ValueError('Expected path')
                        info, created = registry.add(payload['path'])
                        self.send_bytes(201 if created else 200, json.dumps({'project': info, 'created': created}, ensure_ascii=False).encode('utf-8'), 'application/json')
                    else:
                        if set(payload) != {'id'} or not isinstance(payload['id'], str) or len(payload['id']) != 32:
                            raise ValueError('Invalid project id')
                        if self.path == '/api/projects/remove':
                            if not registry.remove(payload['id']):
                                self.send_bytes(404, b'Project is not connected')
                            else:
                                self.send_bytes(204)
                        else:
                            data = project_sync.pack_project(registry.get(payload['id']))
                            self.send_bytes(200, data, 'application/zip')
                except (project_sync.RegistryError, project_sync.SnapshotError, OSError, ValueError, TypeError) as exc:
                    self.send_bytes(400, str(exc).encode('utf-8'))
                return
            if self.path == '/api/project/import':
                if project_dir is None:
                    self.close_connection = True
                    self.send_bytes(503, b'No project configured')
                    return
                if mime != 'application/zip' or length < 1 or length > project_sync.MAX_ARCHIVE:
                    self.close_connection = True
                    self.send_bytes(400, b'ZIP missing or exceeds 128 MiB')
                    return
                try:
                    data = self.rfile.read(length)
                    if len(data) != length:
                        raise project_sync.SnapshotError('Truncated upload')
                    destination = project_sync.import_snapshot(data, project_dir)
                    self.send_bytes(201, json.dumps({'imported_to': str(destination)}).encode('utf-8'), 'application/json')
                except (project_sync.SnapshotError, OSError, ValueError) as exc:
                    self.send_bytes(400, str(exc).encode('utf-8'))
                return
            if self.path != '/api/frame':
                if mime != 'application/json' or length < 2 or length > 1024:
                    self.close_connection = True
                    self.send_bytes(400, b'Invalid request')
                    return
                try:
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict):
                        raise ValueError('Expected object')
                except (ValueError, UnicodeDecodeError):
                    self.send_bytes(400, b'Invalid JSON')
                    return
                if self.path == '/api/editor/poll':
                    if set(payload) != {'playing'} or type(payload['playing']) is not bool:
                        self.send_bytes(400, b'Invalid editor status')
                        return
                    command = store.editor_poll(payload['playing'])
                    self.send_bytes(200, json.dumps({'command': command}).encode('utf-8'), 'application/json')
                    return
                if set(payload) != {'command'} or payload['command'] not in ('play', 'stop'):
                    self.send_bytes(400, b'Invalid command')
                    return
                error = store.enqueue(payload['command'])
                if error:
                    self.send_bytes(503 if error == 'editor_offline' else 409, error.encode('ascii'))
                    return
                self.send_bytes(202, b'Command queued')
                return
            if length <= 0 or length > MAX_FRAME:
                self.close_connection = True
                self.send_bytes(413, b'Invalid frame size')
                return
            if mime not in ('image/png', 'image/jpeg'):
                self.close_connection = True
                self.send_bytes(415, b'PNG or JPEG required')
                return
            data = self.rfile.read(length)
            signature = b'\x89PNG\r\n\x1a\n' if mime == 'image/png' else b'\xff\xd8\xff'
            if len(data) != length or not data.startswith(signature):
                self.send_bytes(400, b'Invalid image')
                return
            claimed_source = self.headers.get('X-Redot-Source', '')
            source = claimed_source if claimed_source in GAME_SOURCES else 'unspecified'
            store.put(data, mime, source)
            self.send_bytes(204)

        def do_DELETE(self):
            if self.path not in ('/api/frame', '/api/logs'):
                self.send_bytes(404, b'Not found')
                return
            if not self.check_auth():
                return
            if self.path == '/api/logs':
                store.clear_logs()
            else:
                store.clear()
            self.send_bytes(204)

    return Handler


def tools():
    return [
        {'name': 'game_screenshot', 'description': 'Read the latest frame labeled as a game by its trusted sender. Labels are not proof of origin; no frame is captured on demand.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'delete_game_screenshot', 'description': 'Delete the latest shared game frame from bridge memory.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'game_play', 'description': 'Queue play-main-scene for the connected native editor. Check game_status for actual state.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'game_stop', 'description': 'Queue stop for the connected native editor. Check game_status for actual state.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'game_status', 'description': 'Read native editor connectivity, playing state and frame availability.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'read_logs', 'description': 'Read up to 200 recent explicitly shared editor/game log entries. They may contain sensitive information.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'delete_logs', 'description': 'Clear shared log entries from bridge memory. New entries can arrive if sharing continues.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'project_status', 'description': 'Check whether a local project is configured for explicit snapshot exchange.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'project_snapshot_export', 'description': 'Export configured local project as an embedded ZIP resource, at most 8 MiB compressed. It may contain private project files; call only with permission.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}},
        {'name': 'project_snapshot_import', 'description': 'Import a base64 ZIP into a NEW sibling directory, never overwrite the configured project. At most 8 MiB compressed. This is not a live merge.', 'inputSchema': {'type': 'object', 'properties': {'zip_base64': {'type': 'string', 'maxLength': 11184816}}, 'required': ['zip_base64'], 'additionalProperties': False}},
    ]


def call_frame(url, token, method):
    request = urllib.request.Request(url.rstrip('/') + '/api/frame', method=method, headers={'Authorization': 'Bearer ' + token})
    try:
        with HTTP.open(request, timeout=5) as response:
            body = response.read(MAX_FRAME + 1)
            if len(body) > MAX_FRAME:
                raise ValueError('Frame exceeds size limit')
            mime = response.headers.get_content_type()
            source = response.headers.get('X-Redot-Source', '')
            if method == 'GET':
                if mime not in ('image/png', 'image/jpeg'):
                    raise ValueError('Unexpected frame MIME type')
                if source not in GAME_SOURCES:
                    raise ValueError('Frame has no recognized game source label; refusing game_screenshot')
            return body, mime, source
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError('No game frame has been shared yet') from exc
        raise ValueError(f'Bridge HTTP error: {exc.code}') from exc
    except urllib.error.URLError as exc:
        raise ValueError('Bridge unavailable; start the local server first') from exc


def call_editor(url, token, command=None):
    headers = {'Authorization': 'Bearer ' + token}
    data = None
    path = '/api/status'
    if command is not None:
        path = '/api/command'
        data = json.dumps({'command': command}).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url.rstrip('/') + path, data=data, headers=headers)
    try:
        with HTTP.open(request, timeout=5) as response:
            return response.read(4096).decode('utf-8')
    except urllib.error.HTTPError as exc:
        if exc.code == 503:
            raise ValueError('Native editor is not connected') from exc
        if exc.code == 409:
            raise ValueError('A command is already pending') from exc
        raise ValueError(f'Bridge HTTP error: {exc.code}') from exc
    except urllib.error.URLError as exc:
        raise ValueError('Bridge unavailable; start the local server first') from exc


def call_logs(url, token, method):
    request = urllib.request.Request(url.rstrip('/') + '/api/logs', method=method, headers={'Authorization': 'Bearer ' + token})
    try:
        with HTTP.open(request, timeout=5) as response:
            data = response.read(MAX_LOG_RESPONSE + 1)
            if len(data) > MAX_LOG_RESPONSE:
                raise ValueError('Log response exceeds size limit')
            return data.decode('utf-8')
    except urllib.error.HTTPError as exc:
        raise ValueError(f'Bridge HTTP error: {exc.code}') from exc
    except (urllib.error.URLError, UnicodeDecodeError) as exc:
        raise ValueError('Bridge unavailable or returned invalid logs') from exc


def call_project(url, token, path, data=None, limit=MAX_MCP_SNAPSHOT):
    headers = {'Authorization': 'Bearer ' + token}
    if data is not None:
        headers['Content-Type'] = 'application/zip'
    request = urllib.request.Request(url.rstrip('/') + path, data=data, headers=headers)
    try:
        with HTTP.open(request, timeout=60) as response:
            length = response.headers.get('Content-Length')
            if length and int(length) > limit:
                raise ValueError('Snapshot is too large for MCP; use the local browser instead')
            body = response.read(limit + 1)
            if len(body) > limit:
                raise ValueError('Snapshot is too large for MCP; use the local browser instead')
            return body
    except urllib.error.HTTPError as exc:
        detail = exc.read(2048).decode('utf-8', errors='replace')
        raise ValueError(f'Project bridge error {exc.code}: {detail}') from exc
    except urllib.error.URLError as exc:
        raise ValueError('Bridge unavailable; start the local server first') from exc


def mcp_response(message, url, token):
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid Request'}}
    method = message.get('method')
    if 'id' not in message:  # Notifications do not receive a response.
        return None
    request_id = message['id']
    result = None
    if method == 'initialize':
        result = {'protocolVersion': '2025-03-26', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'redot-frame-bridge', 'version': '0.1.0'}}
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = {'tools': tools()}
    elif method == 'tools/call':
        params = message.get('params') or {}
        if not isinstance(params, dict):
            return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': -32602, 'message': 'Invalid params'}}
        name = params.get('name')
        if name not in ('game_screenshot', 'delete_game_screenshot', 'game_play', 'game_stop', 'game_status', 'read_logs', 'delete_logs', 'project_status', 'project_snapshot_export', 'project_snapshot_import'):
            return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': -32602, 'message': 'Unknown tool'}}
        arguments = params.get('arguments', {})
        if name == 'project_snapshot_import':
            valid_arguments = isinstance(arguments, dict) and set(arguments) == {'zip_base64'} and isinstance(arguments['zip_base64'], str) and len(arguments['zip_base64']) <= 11184816
        else:
            valid_arguments = arguments == {}
        if not valid_arguments:
            return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': -32602, 'message': 'Invalid tool arguments'}}
        try:
            if name == 'game_screenshot':
                body, mime, source = call_frame(url, token, 'GET')
                result = {'content': [{'type': 'image', 'data': base64.b64encode(body).decode('ascii'), 'mimeType': mime},
                                      {'type': 'text', 'text': f'Sender-reported source: {source}; source label is not independently verified.'}]}
            elif name == 'delete_game_screenshot':
                call_frame(url, token, 'DELETE')
                result = {'content': [{'type': 'text', 'text': 'Frame deleted from bridge memory.'}]}
            elif name in ('game_play', 'game_stop'):
                call_editor(url, token, 'play' if name == 'game_play' else 'stop')
                result = {'content': [{'type': 'text', 'text': 'Command queued; check game_status to confirm.'}]}
            elif name == 'game_status':
                result = {'content': [{'type': 'text', 'text': call_editor(url, token)}]}
            elif name == 'read_logs':
                result = {'content': [{'type': 'text', 'text': call_logs(url, token, 'GET')}]}
            elif name == 'delete_logs':
                call_logs(url, token, 'DELETE')
                result = {'content': [{'type': 'text', 'text': 'Logs deleted from bridge memory.'}]}
            elif name == 'project_status':
                body = call_project(url, token, '/api/project/status', limit=4096)
                result = {'content': [{'type': 'text', 'text': body.decode('utf-8')}]}
            elif name == 'project_snapshot_export':
                body = call_project(url, token, '/api/project/export')
                digest = hashlib.sha256(body).hexdigest()
                result = {'content': [{'type': 'resource', 'resource': {'uri': 'redot-project://snapshot/' + digest, 'mimeType': 'application/zip', 'blob': base64.b64encode(body).decode('ascii')}}]}
            else:
                data = base64.b64decode(arguments['zip_base64'], validate=True)
                if len(data) > MAX_MCP_SNAPSHOT:
                    raise ValueError('Snapshot exceeds 8 MiB MCP limit')
                body = call_project(url, token, '/api/project/import', data, limit=4096)
                result = {'content': [{'type': 'text', 'text': body.decode('utf-8')}]}
        except (ValueError, OSError) as exc:
            result = {'content': [{'type': 'text', 'text': str(exc)}], 'isError': True}
    else:
        return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': -32601, 'message': 'Method not found'}}
    return {'jsonrpc': '2.0', 'id': request_id, 'result': result}


def mcp_stdio(url, token):
    for line in sys.stdin:
        try:
            response = mcp_response(json.loads(line), url, token)
        except json.JSONDecodeError:
            response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}}
        if response is not None:
            print(json.dumps(response, separators=(',', ':')), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('serve', 'mcp'))
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--url', help='HTTPS relay origin for MCP mode only; no paths or credentials')
    parser.add_argument('--editor-dir', type=Path, help='Unpacked web editor directory (serve mode only)')
    parser.add_argument('--project-dir', type=Path, help='Local project for explicit snapshot exchange (serve mode only)')
    args = parser.parse_args()
    token = os.environ.get('REDOT_BRIDGE_TOKEN', '')
    if len(token) < 32 or not token.isascii() or any(c.isspace() or ord(c) < 33 or ord(c) > 126 for c in token):
        parser.error('Set REDOT_BRIDGE_TOKEN to a random ASCII secret of at least 32 characters')
    if not 1 <= args.port <= 65535:
        parser.error('Invalid port')
    if args.mode == 'serve':
        if args.url is not None:
            parser.error('--url is for MCP mode only')
        if args.editor_dir is not None and not (args.editor_dir / 'godot.editor.html').is_file():
            parser.error('Editor directory must contain godot.editor.html')
        if args.project_dir is not None:
            if args.project_dir.is_symlink() or not args.project_dir.is_dir() or not (args.project_dir / 'project.godot').is_file():
                parser.error('Project directory must be a non-symlink folder containing project.godot')
            args.project_dir = args.project_dir.resolve()
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(FrameStore(), token, args.editor_dir, args.project_dir))
        print(f'Local demo: http://127.0.0.1:{args.port}/', file=sys.stderr, flush=True)
        if args.project_dir is not None:
            print(f'Snapshot exchange: http://127.0.0.1:{args.port}/sync.html', file=sys.stderr, flush=True)
        print(f'Native Redot viewer: http://127.0.0.1:{args.port}/native.html', file=sys.stderr, flush=True)
        if args.editor_dir is not None:
            print(f'Local editor: http://127.0.0.1:{args.port}/editor/godot.editor.html', file=sys.stderr, flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    else:
        if args.url is not None:
            try:
                url = remote_origin(args.url)
            except ValueError as exc:
                parser.error(str(exc))
        else:
            url = f'http://127.0.0.1:{args.port}'
        mcp_stdio(url, token)


if __name__ == '__main__':
    main()
