#!/usr/bin/env python3
"""Experimental single-session relay. Bind to loopback behind a dedicated HTTPS proxy."""
import argparse
import hmac
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web
from bridge import FrameStore, MAX_FRAME, MAX_LOG_REQUEST

WEB = Path(__file__).resolve().parent / 'web'


def valid_secret(value):
    return len(value) >= 32 and value.isascii() and all(33 <= ord(c) <= 126 for c in value)


def validate_origin(origin):
    try:
        parsed = urlsplit(origin)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None or
                parsed.password is not None or parsed.path or parsed.query or parsed.fragment or
                not parsed.netloc.isascii() or parsed.netloc != parsed.netloc.lower() or
                not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?', parsed.netloc) or
                any(not label or len(label) > 63 or label.startswith('-') or label.endswith('-') for label in parsed.hostname.split('.')) or
                len(parsed.hostname) > 253 or
                any(c.isspace() or ord(c) < 33 or ord(c) > 126 for c in origin) or
                (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError
        return parsed.netloc
    except ValueError as exc:
        raise ValueError('Expected a lowercase HTTPS origin without path, query, fragment or credentials') from exc


def create_app(origin, device_token, controller_token):
    expected_host = validate_origin(origin)
    if not valid_secret(device_token) or not valid_secret(controller_token) or hmac.compare_digest(device_token, controller_token):
        raise ValueError('Two distinct random ASCII secrets of at least 32 characters are required')
    store = FrameStore()

    @web.middleware
    async def security(request, handler):
        # Only a dedicated, correctly configured reverse proxy should reach this
        # loopback-only app. Reject mismatched hosts and cross-origin browsers.
        if request.headers.get('Host', '').lower() != expected_host:
            return web.Response(status=400, text='Invalid host')
        incoming_origin = request.headers.get('Origin')
        if incoming_origin is not None and incoming_origin != origin:
            return web.Response(status=403, text='Invalid origin')
        response = await handler(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
        return response

    app = web.Application(middlewares=[security], client_max_size=MAX_FRAME)

    def authorize(request, secret):
        supplied = request.headers.get('Authorization', '')
        return hmac.compare_digest(supplied.encode('utf-8'), ('Bearer ' + secret).encode('utf-8'))

    def unauthorized():
        return web.Response(status=401, text='Unauthorized')

    async def page(request):
        name = 'native.html' if request.path in ('/', '/native.html') else 'native.js'
        return web.Response(body=(WEB / name).read_bytes(), content_type='text/html' if name.endswith('.html') else 'text/javascript', charset='utf-8')

    async def status(request):
        if not authorize(request, controller_token):
            return unauthorized()
        return web.json_response(store.status())

    async def command(request):
        if not authorize(request, controller_token):
            return unauthorized()
        payload = await read_json(request)
        if not isinstance(payload, dict) or set(payload) != {'command'} or payload['command'] not in ('play', 'stop'):
            return web.Response(status=400, text='Invalid command')
        error = store.enqueue(payload['command'])
        if error:
            return web.Response(status=503 if error == 'editor_offline' else 409, text=error)
        return web.Response(status=202, text='Command queued')

    async def poll(request):
        if not authorize(request, device_token):
            return unauthorized()
        payload = await read_json(request)
        if not isinstance(payload, dict) or set(payload) != {'playing'} or type(payload['playing']) is not bool:
            return web.Response(status=400, text='Invalid editor status')
        return web.json_response({'command': store.editor_poll(payload['playing'])})

    async def logs(request):
        if request.method == 'POST':
            if not authorize(request, device_token):
                return unauthorized()
            payload = await read_json(request, MAX_LOG_REQUEST)
            try:
                store.add_logs(payload)
            except ValueError:
                return web.Response(status=400, text='Invalid log batch')
            return web.Response(status=204)
        if not authorize(request, controller_token):
            return unauthorized()
        if request.method == 'DELETE':
            store.clear_logs()
            return web.Response(status=204)
        return web.Response(text=json.dumps(store.get_logs(), ensure_ascii=False), content_type='application/json', charset='utf-8')

    async def frame(request):
        if request.method == 'POST':
            if not authorize(request, device_token):
                return unauthorized()
            if request.content_type not in ('image/png', 'image/jpeg'):
                return web.Response(status=415, text='PNG or JPEG required')
            data = await request.read()
            signature = b'\x89PNG\r\n\x1a\n' if request.content_type == 'image/png' else b'\xff\xd8\xff'
            if not data.startswith(signature):
                return web.Response(status=400, text='Invalid image')
            store.put(data, request.content_type, 'native-game')
            return web.Response(status=204)
        if not authorize(request, controller_token):
            return unauthorized()
        if request.method == 'DELETE':
            store.clear()
            return web.Response(status=204)
        current = store.get()
        if current is None:
            return web.Response(status=404, text='No frame available')
        return web.Response(body=current[0], content_type=current[1])

    for path in ('/', '/native.html', '/native.js'):
        app.router.add_get(path, page, allow_head=False)
    app.router.add_get('/api/status', status, allow_head=False)
    app.router.add_post('/api/command', command)
    app.router.add_post('/api/editor/poll', poll)
    app.router.add_get('/api/logs', logs, allow_head=False)
    app.router.add_post('/api/logs', logs)
    app.router.add_delete('/api/logs', logs)
    app.router.add_get('/api/frame', frame, allow_head=False)
    app.router.add_post('/api/frame', frame)
    app.router.add_delete('/api/frame', frame)
    return app


async def read_json(request, limit=1024):
    if request.content_type != 'application/json' or request.content_length is None or not 2 <= request.content_length <= limit:
        return None
    try:
        data = await request.read()
        return json.loads(data)
    except (ValueError, UnicodeDecodeError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', required=True, help='Public HTTPS origin, for example https://relay.example.org')
    parser.add_argument('--port', type=int, default=8766, help='Loopback port behind HTTPS proxy')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Invalid port')
    try:
        app = create_app(args.origin, os.environ.get('REDOT_RELAY_DEVICE_TOKEN', ''), os.environ.get('REDOT_RELAY_CONTROLLER_TOKEN', ''))
    except ValueError as exc:
        parser.error(str(exc))
    print('Relay listening on 127.0.0.1 only; configure a dedicated HTTPS proxy before use.', file=sys.stderr, flush=True)
    web.run_app(app, host='127.0.0.1', port=args.port, print=None, access_log=None)


if __name__ == '__main__':
    main()
