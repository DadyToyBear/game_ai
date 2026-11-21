#!/usr/bin/env python3
"""Expose the existing multiagent chat and the local Redot bridge via MCP stdio.

This does not forward WebFTP task files to the local editor bridge. The legacy
chat_assign tool continues to target the separately running WebFTP bridge.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import urllib.parse
import urllib.request
from urllib.parse import urlsplit

import bridge


def chat_share(value):
    """Require encrypted share access except on the local machine for tests."""
    try:
        parsed = urlsplit(value)
        if (not parsed.hostname or parsed.username is not None or parsed.password is not None or
                parsed.query or parsed.fragment or any(ord(c) < 33 or ord(c) > 126 for c in value) or
                parsed.scheme not in ('http', 'https') or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError
        if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError
    except ValueError as exc:
        raise ValueError('WEBFTP_SHARE must be HTTPS (HTTP is allowed only on loopback), without credentials, query or fragment') from exc
    return value.rstrip('/')


class LimitedResponse:
    """Limit legacy chat HTTP responses without changing its file protocol."""
    MAX_BYTES = 1024 * 1024

    def __init__(self, response):
        self.response = response
        self.status = response.status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.response.close()

    def read(self):
        data = self.response.read(self.MAX_BYTES + 1)
        if len(data) > self.MAX_BYTES:
            raise ValueError('WebFTP response too large')
        return data


def chat_open(request, timeout):
    # The upstream client uses urlopen's redirect-following default. The common
    # MCP refuses redirects, so an HTTPS share cannot redirect requests to HTTP.
    return LimitedResponse(bridge.HTTP.open(request, timeout=timeout))


def load_chat(script):
    # Explicitly retain the upstream implementation and its wire format.
    spec = importlib.util.spec_from_file_location('redot_multiagent_chat', script)
    if spec is None or spec.loader is None:
        raise ValueError('Cannot load multiagent MCP script')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Only this module's HTTP adapter is replaced; other clients and the
    # original standalone chat script keep their own urllib configuration.
    module.urllib = SimpleNamespace(parse=urllib.parse,
                                    request=SimpleNamespace(Request=urllib.request.Request, urlopen=chat_open))
    names = [entry['name'] for entry in module.TOOLS]
    editor_names = [entry['name'] for entry in bridge.tools()]
    if len(set(names)) != len(names) or set(names).intersection(editor_names):
        raise ValueError('Chat and editor tool names conflict')
    return module


def response(message, url, token, chat):
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid Request'}}
    if 'id' not in message:
        return None
    rid, method = message['id'], message.get('method')
    if method == 'initialize':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'protocolVersion': '2025-03-26', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'redot-multiagent-editor', 'version': '0.1.0'}}}
    if method == 'tools/list':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'tools': bridge.tools() + chat.TOOLS}}
    if method == 'tools/call':
        params = message.get('params')
        if isinstance(params, dict) and params.get('name') in {item['name'] for item in chat.TOOLS}:
            arguments = params.get('arguments', {})
            if not isinstance(arguments, dict):
                return {'jsonrpc': '2.0', 'id': rid, 'error': {'code': -32602, 'message': 'Invalid tool arguments'}}
            try:
                result = chat.call(params['name'], arguments)
                is_error = isinstance(result, dict) and result.get('ok') is False
                payload = {'content': [{'type': 'text', 'text': json.dumps(result, ensure_ascii=False)}]}
                if is_error:
                    payload['isError'] = True
            except Exception:
                # Legacy errors can include URLs or other private inputs.
                payload = {'content': [{'type': 'text', 'text': 'Multiagent chat operation failed.'}], 'isError': True}
            return {'jsonrpc': '2.0', 'id': rid, 'result': payload}
    return bridge.mcp_response(message, url, token)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--url', help='HTTPS relay origin; default uses localhost')
    parser.add_argument('--chat-script', type=Path, help='Path to the existing multiagent-mcp.py')
    args = parser.parse_args()
    token = os.environ.get('REDOT_BRIDGE_TOKEN', '')
    if len(token) < 32 or not token.isascii() or any(c.isspace() or ord(c) < 33 or ord(c) > 126 for c in token):
        parser.error('Set REDOT_BRIDGE_TOKEN to a random ASCII secret of at least 32 characters')
    if not 1 <= args.port <= 65535:
        parser.error('Invalid port')
    try:
        share = chat_share(os.environ.get('WEBFTP_SHARE', ''))
        url = bridge.remote_origin(args.url) if args.url else f'http://127.0.0.1:{args.port}'
        directory = Path(__file__).resolve().parent
        root = directory.parent
        candidates = [directory / 'multiagent_chat.py', root / 'multiagent-mcp.py', root / 'multiagent-upstream/multiagent-mcp.py']
        script = args.chat_script or next((p for p in candidates if p.is_file()), None)
        if script is None or not script.is_file():
            raise ValueError('multiagent-mcp.py not found; specify --chat-script')
        # The upstream module reads the environment at import time.
        os.environ['WEBFTP_SHARE'] = share
        chat = load_chat(script)
    except (ValueError, OSError, ImportError, KeyError) as exc:
        parser.error(str(exc))
    for line in sys.stdin:
        try:
            reply = response(json.loads(line), url, token, chat)
        except json.JSONDecodeError:
            reply = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}}
        if reply is not None:
            # ASCII JSON remains valid UTF-8 while also working with Windows
            # stdio pipes whose default encoding cannot represent Cyrillic.
            print(json.dumps(reply, ensure_ascii=True, separators=(',', ':')), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
