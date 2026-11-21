import asyncio
import base64
import os
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    from aiohttp import ClientSession, web
    from aiohttp.test_utils import TestClient, TestServer
    import bridge
    import relay
except ImportError:
    TestClient = None

DEVICE = 'device-' + 'a' * 40
CONTROL = 'controller-' + 'b' * 40
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=')


@unittest.skipUnless(TestClient, 'install requirements-relay.txt to test relay')
class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = relay.create_app('https://relay.example.org', DEVICE, CONTROL)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.host = {'Host': 'relay.example.org'}

    async def asyncTearDown(self):
        await self.client.close()

    def headers(self, token, **extra):
        return {**self.host, 'Authorization': 'Bearer ' + token, **extra}

    async def test_separate_permissions_and_mcp_flow(self):
        r = await self.client.post('/api/editor/poll', headers=self.headers(DEVICE), json={'playing': False})
        self.assertEqual(await r.json(), {'command': None})
        r = await self.client.post('/api/command', headers=self.headers(DEVICE), json={'command': 'play'})
        self.assertEqual(r.status, 401)
        r = await self.client.post('/api/editor/poll', headers=self.headers(CONTROL), json={'playing': False})
        self.assertEqual(r.status, 401)
        r = await self.client.post('/api/command', headers=self.headers(CONTROL), json={'command': 'play'})
        self.assertEqual(r.status, 202)
        r = await self.client.post('/api/editor/poll', headers=self.headers(DEVICE), json={'playing': False})
        self.assertEqual((await r.json())['command'], 'play')
        r = await self.client.post('/api/frame', headers=self.headers(DEVICE, **{'Content-Type': 'image/png'}), data=PNG)
        self.assertEqual(r.status, 204)
        r = await self.client.get('/api/frame', headers=self.headers(DEVICE))
        self.assertEqual(r.status, 401)
        r = await self.client.get('/api/frame', headers=self.headers(CONTROL))
        self.assertEqual(await r.read(), PNG)
        self.assertEqual(r.headers['Cache-Control'], 'no-store')
        r = await self.client.delete('/api/frame', headers=self.headers(CONTROL))
        self.assertEqual(r.status, 204)
        r = await self.client.get('/api/frame', headers=self.headers(CONTROL))
        self.assertEqual(r.status, 404)
        r = await self.client.get('/api/project/export', headers=self.headers(CONTROL))
        self.assertEqual(r.status, 404)

    async def test_bad_requests_and_origin(self):
        r = await self.client.get('/native.html', headers={'Host': 'evil.example'})
        self.assertEqual(r.status, 400)
        r = await self.client.get('/native.html', headers={**self.host, 'Origin': 'https://evil.example'})
        self.assertEqual(r.status, 403)
        r = await self.client.get('/native.html', headers={**self.host, 'Origin': 'https://relay.example.org'})
        self.assertEqual(r.status, 200)
        self.assertIn('frame-ancestors', r.headers['Content-Security-Policy'])
        r = await self.client.post('/api/editor/poll', headers=self.headers(DEVICE), json={'playing': 1})
        self.assertEqual(r.status, 400)
        r = await self.client.post('/api/command', headers=self.headers(CONTROL), json={'command': ['play']})
        self.assertEqual(r.status, 400)
        r = await self.client.post('/api/frame', headers=self.headers(DEVICE, **{'Content-Type': 'image/png'}), data=b'bad')
        self.assertEqual(r.status, 400)
        r = await self.client.post('/api/frame', headers=self.headers(DEVICE, **{'Content-Type': 'image/png'}), data=b'x' * (relay.MAX_FRAME + 1))
        self.assertEqual(r.status, 413)
        r = await self.client.put('/api/frame', headers=self.headers(CONTROL), data=b'')
        self.assertEqual(r.status, 405)

    @unittest.skipUnless(shutil.which('openssl'), 'openssl required for TLS integration test')
    async def test_https_relay_mcp_integration(self):
        # A loopback TLS listener stands in for nginx; the real client verifies
        # the test CA, and does not rely on disabling certificate validation.
        with tempfile.TemporaryDirectory() as tmp:
            cert, key = str(Path(tmp) / 'cert.pem'), str(Path(tmp) / 'key.pem')
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-keyout', key, '-out', cert, '-subj', '/CN=localhost',
                            '-addext', 'subjectAltName=DNS:localhost'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sock = socket.socket()
            sock.bind(('127.0.0.1', 0))
            sock.listen(20)
            port = sock.getsockname()[1]
            origin = f'https://localhost:{port}'
            app = relay.create_app(origin, DEVICE, CONTROL)
            runner = web.AppRunner(app, access_log=None)
            await runner.setup()
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(cert, key)
            site = web.SockSite(runner, sock, ssl_context=tls)
            await site.start()
            old_ca = os.environ.get('SSL_CERT_FILE')
            os.environ['SSL_CERT_FILE'] = cert
            try:
                async with ClientSession() as session:
                    trust = ssl.create_default_context(cafile=cert)
                    async def poll():
                        return await session.post(origin + '/api/editor/poll', headers={'Authorization': 'Bearer ' + DEVICE}, json={'playing': False}, ssl=trust)
                    response = await poll()
                    self.assertEqual(await response.json(), {'command': None})
                    reply = await asyncio.to_thread(bridge.mcp_response, {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'game_play'}}, origin, CONTROL)
                    self.assertFalse(reply['result'].get('isError', False))
                    response = await poll()
                    self.assertEqual((await response.json())['command'], 'play')
                    response = await session.post(origin + '/api/frame', headers={'Authorization': 'Bearer ' + DEVICE, 'Content-Type': 'image/png'}, data=PNG, ssl=trust)
                    self.assertEqual(response.status, 204)
                    reply = await asyncio.to_thread(bridge.mcp_response, {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'game_screenshot'}}, origin, CONTROL)
                    self.assertEqual(base64.b64decode(reply['result']['content'][0]['data']), PNG)
            finally:
                if old_ca is None:
                    os.environ.pop('SSL_CERT_FILE', None)
                else:
                    os.environ['SSL_CERT_FILE'] = old_ca
                await runner.cleanup()

    def test_configuration_validation(self):
        for origin in ('http://relay.example.org', 'https://u:p@relay.example.org', 'https://relay.example.org/path', 'https://relay.example.org?x=1', 'https://relay.example.org:99999'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                relay.create_app(origin, DEVICE, CONTROL)
        with self.assertRaises(ValueError):
            relay.create_app('https://relay.example.org', CONTROL, CONTROL)


if __name__ == '__main__':
    unittest.main()
