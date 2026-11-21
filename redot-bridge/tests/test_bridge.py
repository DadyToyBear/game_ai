import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('bridge', ROOT / 'bridge.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=')
TOKEN = 'abc0123456789' * 4


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        editor = Path(self.tmp.name)
        (editor / 'godot.editor.html').write_text('<html><body>editor</body></html>')
        (editor / 'godot.editor.wasm').write_bytes(b'\x00asm')
        (editor / 'service.worker.js').write_bytes(b"self.addEventListener('fetch',\n\t(event) => {\n\t\tconst isNavigate = event.request.mode === 'navigate';\n});")
        self.store = bridge.FrameStore()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.handler_for(self.store, TOKEN, editor))
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join()
        self.tmp.cleanup()

    def request(self, path='/api/frame', method='GET', data=None, token=TOKEN, mime='image/png', source=None):
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': mime}
        if source is not None:
            headers['X-Redot-Source'] = source
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=headers)
        return urllib.request.urlopen(req, timeout=3)

    def test_workspace_allows_external_dashboard_without_disabling_editor_isolation(self):
        with urllib.request.urlopen(self.url + '/workspace.html') as response:
            html = response.read()
            self.assertIn(b'/workspace.js', html)
            self.assertIn(b'src="/native.html"', html)
            self.assertIsNone(response.headers.get('Cross-Origin-Embedder-Policy'))
            self.assertIn('frame-src', response.headers['Content-Security-Policy'])
            self.assertEqual(response.headers['Referrer-Policy'], 'no-referrer')
        with urllib.request.urlopen(self.url + '/workspace.js') as response:
            self.assertIn(b'safeDashboard', response.read())
        with urllib.request.urlopen(self.url + '/editor/godot.editor.html') as response:
            self.assertEqual(response.headers['Cross-Origin-Embedder-Policy'], 'require-corp')
            self.assertEqual(response.headers['Cross-Origin-Opener-Policy'], 'same-origin')

    def test_project_open_pages_are_served_and_injected(self):
        with urllib.request.urlopen(self.url + '/editor/godot.editor.html') as response:
            self.assertIn(b'<script src="/project-open.js"></script>', response.read())
        with urllib.request.urlopen(self.url + '/project-open.html') as response:
            self.assertIn(b'/project-open.js', response.read())
        with urllib.request.urlopen(self.url + '/project-open.js') as response:
            self.assertIn(b'folderZip', response.read())
        with urllib.request.urlopen(self.url + '/editor/service.worker.js') as response:
            self.assertIn(b'new URL(event.request.url).origin !== self.location.origin', response.read())

    def test_authorization_validation_deletion(self):
        with self.assertRaises(urllib.error.HTTPError) as err:
            self.request(token='wrong')
        self.assertEqual(err.exception.code, 401)
        with self.assertRaises(urllib.error.HTTPError) as err:
            self.request(method='POST', data=b'not png')
        self.assertEqual(err.exception.code, 400)
        self.assertEqual(self.request(method='POST', data=PNG).status, 204)
        with self.request() as response:
            self.assertEqual(response.read(), PNG)
            self.assertEqual(response.headers.get_content_type(), 'image/png')
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
        req = urllib.request.Request(self.url + '/api/frame', data=PNG, method='POST', headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'image/png', 'X-Redot-Source': 'native-game'})
        with urllib.request.urlopen(req, timeout=3) as response:
            self.assertEqual(response.status, 204)
        with self.request('/api/status') as response:
            self.assertEqual(json.load(response)['frame_source'], 'native-game')
        self.assertEqual(self.request(method='DELETE').status, 204)
        with self.assertRaises(urllib.error.HTTPError) as err:
            self.request()
        self.assertEqual(err.exception.code, 404)

    def test_mcp_stdio_end_to_end(self):
        self.request(method='POST', data=PNG, source='native-game').close()
        messages = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}}},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'game_screenshot', 'arguments': {}}},
            {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call', 'params': {'name': 'delete_game_screenshot', 'arguments': {}}},
            {'jsonrpc': '2.0', 'id': 5, 'method': 'tools/call', 'params': {'name': 'game_screenshot', 'arguments': {}}},
        ]
        env = dict(os.environ, REDOT_BRIDGE_TOKEN=TOKEN)
        run = subprocess.run([sys.executable, str(ROOT / 'bridge.py'), 'mcp', '--port', str(self.server.server_port)], input=''.join(json.dumps(x) + '\n' for x in messages), capture_output=True, text=True, env=env, timeout=10, check=True)
        replies = [json.loads(line) for line in run.stdout.splitlines()]
        self.assertEqual([r['id'] for r in replies], [1, 2, 3, 4, 5])
        self.assertEqual(replies[0]['result']['protocolVersion'], '2025-03-26')
        self.assertEqual(len(replies[1]['result']['tools']), 10)
        image = replies[2]['result']['content'][0]
        self.assertEqual(image['mimeType'], 'image/png')
        self.assertEqual(base64.b64decode(image['data']), PNG)
        self.assertTrue(replies[4]['result']['isError'])

    def test_malformed_json_is_rejected_without_stopping_bridge(self):
        deep = b'[' * 2000 + b'0' + b']' * 2000
        for path in ('/api/logs', '/api/projects/add'):
            with self.subTest(path=path):
                with self.assertRaises(urllib.error.HTTPError) as err:
                    self.request(path, 'POST', deep, mime='application/json')
                self.assertEqual(err.exception.code, 400)
        self.assertEqual(self.request('/api/status').status, 200)
        msg = {'jsonrpc':'2.0','id':1,'method':'tools/call','params':[]}
        self.assertEqual(bridge.mcp_response(msg,self.url,TOKEN)['error']['code'], -32602)
        deep_line = '[' * 2000 + '0' + ']' * 2000 + '\n'
        good = json.dumps({'jsonrpc':'2.0','id':2,'method':'tools/list'}) + '\n'
        process = subprocess.run([sys.executable, str(ROOT / 'bridge.py'), 'mcp'], input=deep_line + good,
                                 capture_output=True, text=True, env=dict(os.environ,REDOT_BRIDGE_TOKEN=TOKEN), timeout=10)
        self.assertEqual(process.returncode,0,process.stderr)
        replies = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(replies[0]['error']['code'],-32700)
        self.assertEqual(replies[1]['id'],2)

    def test_game_screenshot_requires_source_on_same_frame_response(self):
        def screenshot():
            return bridge.mcp_response({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'game_screenshot'}}, self.url, TOKEN)['result']
        for source in (None, 'demo', 'editor', 'unknown'):
            with self.subTest(source=source):
                self.request(method='POST', data=PNG, source=source).close()
                with self.request() as response:
                    self.assertEqual(response.headers['X-Redot-Source'], 'unspecified')
                self.assertTrue(screenshot()['isError'])
        for source in ('native-game', 'web-game'):
            with self.subTest(source=source):
                self.request(method='POST', data=PNG, source=source).close()
                with self.store.lock:
                    data, mime, timestamp, label = self.store.frame
                    self.store.frame = (data, mime, timestamp - 12, label)
                with self.request() as response:
                    self.assertEqual(response.headers['X-Redot-Source'], source)
                    self.assertGreaterEqual(float(response.headers['X-Redot-Frame-Age']), 12.0)
                    self.assertEqual(response.read(), PNG)
                result = screenshot()
                self.assertFalse(result.get('isError', False))
                self.assertEqual(base64.b64decode(result['content'][0]['data']), PNG)
                self.assertIn(source, result['content'][1]['text'])
                self.assertIn('not independently verified', result['content'][1]['text'])
                self.assertIn('Time since bridge received this frame:', result['content'][1]['text'])
                self.assertNotIn('received this frame: unknown', result['content'][1]['text'])

    def test_old_or_invalid_frame_age_is_unknown(self):
        class FrameServer(BaseHTTPRequestHandler):
            age = None
            def do_GET(self):
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('X-Redot-Source', 'native-game')
                if self.age is not None:
                    self.send_header('X-Redot-Frame-Age', self.age)
                self.end_headers()
                self.wfile.write(PNG)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), FrameServer)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        try:
            origin = f'http://127.0.0.1:{server.server_port}'
            for age in (None, 'NaN', '-1', '1e999', '99999999999999999999'):
                with self.subTest(age=age):
                    FrameServer.age = age
                    result = bridge.mcp_response({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'game_screenshot'}}, origin, TOKEN)
                    self.assertIn('received this frame: unknown', result['result']['content'][1]['text'])
        finally:
            server.shutdown(); server.server_close(); worker.join()

    def test_native_editor_poll_and_mcp_control(self):
        def post(path, obj, token=TOKEN):
            return self.request(path, 'POST', json.dumps(obj).encode(), token, 'application/json')

        with self.assertRaises(urllib.error.HTTPError) as err:
            post('/api/command', {'command': 'play'})
        self.assertEqual(err.exception.code, 503)
        with self.assertRaises(urllib.error.HTTPError) as err:
            post('/api/editor/poll', {'playing': False}, 'wrong')
        self.assertEqual(err.exception.code, 401)
        with post('/api/editor/poll', {'playing': False}) as response:
            self.assertEqual(json.load(response), {'command': None})
        with self.request('/api/status') as response:
            status = json.load(response)
            self.assertTrue(status['editor_connected'])
            self.assertFalse(status['playing'])
        message = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'game_play', 'arguments': {}}}
        reply = bridge.mcp_response(message, self.url, TOKEN)
        self.assertFalse(reply['result'].get('isError', False))
        with self.assertRaises(urllib.error.HTTPError) as err:
            post('/api/command', {'command': 'stop'})
        self.assertEqual(err.exception.code, 409)
        with post('/api/editor/poll', {'playing': False}) as response:
            self.assertEqual(json.load(response), {'command': 'play'})
        with post('/api/editor/poll', {'playing': True}) as response:
            self.assertEqual(json.load(response), {'command': None})
        reply = bridge.mcp_response({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'game_status'}}, self.url, TOKEN)
        status = json.loads(reply['result']['content'][0]['text'])
        self.assertTrue(status['playing'])
        reply = bridge.mcp_response({'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'game_stop'}}, self.url, TOKEN)
        self.assertFalse(reply['result'].get('isError', False))
        with post('/api/editor/poll', {'playing': True}) as response:
            self.assertEqual(json.load(response), {'command': 'stop'})
        with self.assertRaises(urllib.error.HTTPError) as err:
            post('/api/command', {'command': 'delete_project'})
        self.assertEqual(err.exception.code, 400)
        with self.assertRaises(urllib.error.HTTPError) as err:
            self.request('/api/command')  # Side effects require POST.
        self.assertEqual(err.exception.code, 404)
        with self.request('/native.html') as response:
            self.assertIn(b'/native.js', response.read())
        post('/api/command', {'command': 'play'}).close()
        # Never execute an old command when an editor reconnects later.
        with self.store.lock:
            self.store.editor_seen -= 6
        with post('/api/editor/poll', {'playing': False}) as response:
            self.assertEqual(json.load(response), {'command': None})

    def test_editor_overlay_isolation_and_demo(self):
        with self.request('/editor/godot.editor.html') as response:
            html = response.read()
            self.assertIn(b'/redot-overlay.js', html)
            self.assertEqual(response.headers['Cross-Origin-Opener-Policy'], 'same-origin')
            self.assertEqual(response.headers['Cross-Origin-Embedder-Policy'], 'require-corp')
        with self.request('/editor/godot.editor.wasm') as response:
            self.assertEqual(response.headers.get_content_type(), 'application/wasm')
        with self.request('/') as response:
            self.assertIn(b'game-canvas', response.read())
        with self.assertRaises(urllib.error.HTTPError) as err:
            self.request('/editor/../bridge.py')
        self.assertEqual(err.exception.code, 404)

    def test_logs_permissions_limits_and_mcp(self):
        batch = {'source': 'game', 'entries': [{'level': 'info', 'message': 'Hello <script>'}]}
        def post(obj, token=TOKEN):
            return self.request('/api/logs', 'POST', json.dumps(obj).encode(), token, 'application/json')
        with self.assertRaises(urllib.error.HTTPError) as err:
            post(batch, 'wrong')
        self.assertEqual(err.exception.code, 401)
        with post(batch) as response:
            self.assertEqual(response.status, 204)
        for bad in ({'source': 'game', 'entries': []}, {'source': 'bad', 'entries': batch['entries']},
                    {'source': 'game', 'entries': [{'level': 'info', 'message': 'x' * 513}]},
                    {'source': 'game', 'entries': [{'level': 'info', 'message': '\ud800'}]},
                    {'source': 'game', 'entries': batch['entries'] * 6}, {'source': 'game', 'entries': batch['entries'], 'extra': True}):
            with self.subTest(bad=repr(bad)), self.assertRaises(urllib.error.HTTPError):
                post(bad)
        reply = bridge.mcp_response({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'read_logs'}}, self.url, TOKEN)
        entries = json.loads(reply['result']['content'][0]['text'])['entries']
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['message'], 'Hello <script>')
        self.assertEqual(entries[0]['source'], 'game')
        for _ in range(41):
            post({'source': 'editor', 'entries': batch['entries'] * 5}).close()
        with self.request('/api/logs') as response:
            entries = json.load(response)['entries']
        self.assertEqual(len(entries), 200)
        self.assertEqual(entries[-1]['seq'], 206)
        reply = bridge.mcp_response({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'delete_logs'}}, self.url, TOKEN)
        self.assertFalse(reply['result'].get('isError', False))
        with self.request('/api/logs') as response:
            self.assertEqual(json.load(response)['entries'], [])
        post(batch).close()
        with self.request('/api/logs') as response:
            self.assertEqual(json.load(response)['entries'][0]['seq'], 207)

    def test_remote_origin_and_redirects(self):
        self.assertEqual(bridge.remote_origin('https://relay.example.org/'), 'https://relay.example.org')
        for value in ('http://example.org', 'https://user@example.org', 'https://example.org/path', 'https://example.org?x=1', 'https://example.org:99999', 'https://example.org\n'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                bridge.remote_origin(value)
        received = []
        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.path)
                self.send_response(302)
                self.send_header('Location', '/target')
                self.end_headers()
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Redirect)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with self.assertRaises(ValueError):
                bridge.call_frame(f'http://127.0.0.1:{server.server_port}', TOKEN, 'GET')
            self.assertEqual(received, ['/api/frame'])
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_token_required(self):
        env = dict(os.environ, REDOT_BRIDGE_TOKEN='weak')
        run = subprocess.run([sys.executable, str(ROOT / 'bridge.py'), 'mcp'], env=env, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(run.returncode, 0)


if __name__ == '__main__':
    unittest.main()
