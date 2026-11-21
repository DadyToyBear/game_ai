#!/usr/bin/env python3
"""Expose the existing multiagent chat and the local Redot bridge via MCP stdio.

With REDOT_TASK_SECRET configured, optional tools submit authenticated tasks
for the separately started worker. Legacy chat_assign remains unchanged.
"""
from __future__ import annotations

import argparse
import hmac
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import urllib.parse
import urllib.request

import bridge
import task_transport
from task_transport import chat_share


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


TASK_TOOLS = [
    {'name': 'webftp_task_submit', 'description': 'Submit a signed task for an opt-in WebFTP worker. A queued task is not confirmation of execution.',
     'inputSchema': {'type': 'object', 'properties': {'method': {'type': 'string', 'enum': list(task_transport.METHODS)}}, 'required': ['method'], 'additionalProperties': False}},
    {'name': 'webftp_task_result', 'description': 'Read and verify a signed task result. Missing or invalid results do not prove a task was not executed.',
     'inputSchema': {'type': 'object', 'properties': {'id': {'type': 'string', 'pattern': '^[0-9a-f]{32}$'}}, 'required': ['id'], 'additionalProperties': False}},
]


def response(message, url, token, chat, task_client=None, task_secret=''):
    if not isinstance(message, dict) or message.get('jsonrpc') != '2.0':
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Invalid Request'}}
    if 'id' not in message:
        return None
    rid, method = message['id'], message.get('method')
    if method == 'initialize':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'protocolVersion': '2025-03-26', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'redot-multiagent-editor', 'version': '0.1.0'}}}
    if method == 'tools/list':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'tools': bridge.tools() + chat.TOOLS + (TASK_TOOLS if task_client else [])}}
    if method == 'tools/call':
        params = message.get('params')
        if task_client and isinstance(params, dict) and params.get('name') in ('webftp_task_submit', 'webftp_task_result'):
            arguments = params.get('arguments', {})
            name = params['name']
            if not isinstance(arguments, dict) or set(arguments) != ({'method'} if name == 'webftp_task_submit' else {'id'}):
                return {'jsonrpc': '2.0', 'id': rid, 'error': {'code': -32602, 'message': 'Invalid tool arguments'}}
            try:
                if name == 'webftp_task_submit':
                    result = {'id': task_transport.submit(task_client, task_secret, arguments['method']), 'status': 'queued; execution not confirmed'}
                    payload = {'content': [{'type': 'text', 'text': json.dumps(result, ensure_ascii=True)}]}
                else:
                    reply = task_transport.get_result(task_client, task_secret, arguments['id'])
                    payload = reply.get('result')
                    if not isinstance(payload, dict) or not isinstance(payload.get('content'), list):
                        raise ValueError('Invalid result content')
            except (ValueError, OSError, TypeError, RecursionError):
                payload = {'content': [{'type': 'text', 'text': 'Signed task or result unavailable or invalid; execution is unknown.'}], 'isError': True}
            return {'jsonrpc': '2.0', 'id': rid, 'result': payload}
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
        task_secret = os.environ.get('REDOT_TASK_SECRET', '')
        task_client = None
        if task_secret:
            if not task_transport.valid_secret(task_secret) or hmac.compare_digest(task_secret, token):
                raise ValueError('REDOT_TASK_SECRET must be random and distinct from REDOT_BRIDGE_TOKEN')
            task_client = task_transport.WebFTP(share, os.environ.get('WEBFTP_BEARER', ''))
    except (ValueError, OSError, ImportError, KeyError) as exc:
        parser.error(str(exc))
    for line in sys.stdin:
        try:
            reply = response(json.loads(line), url, token, chat, task_client, task_secret)
        except json.JSONDecodeError:
            reply = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}}
        if reply is not None:
            # ASCII JSON remains valid UTF-8 while also working with Windows
            # stdio pipes whose default encoding cannot represent Cyrillic.
            print(json.dumps(reply, ensure_ascii=True, separators=(',', ':')), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
