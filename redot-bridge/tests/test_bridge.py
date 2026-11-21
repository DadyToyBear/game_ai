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
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
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

    def request(self, path='/api/frame', method='GET', data=None, token=TOKEN, mime='image/png'):
        req = urllib.request.Request(self.url + path, data=data, method=method, headers={'Authorization': 'Bearer ' + token, 'Content-Type': mime})
        return urllib.request.urlopen(req, timeout=3)

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
        self.request(method='POST', data=PNG)
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
        self.assertEqual(len(replies[1]['result']['tools']), 5)
        image = replies[2]['result']['content'][0]
        self.assertEqual(image['mimeType'], 'image/png')
        self.assertEqual(base64.b64decode(image['data']), PNG)
        self.assertTrue(replies[4]['result']['isError'])

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

    def test_token_required(self):
        env = dict(os.environ, REDOT_BRIDGE_TOKEN='weak')
        run = subprocess.run([sys.executable, str(ROOT / 'bridge.py'), 'mcp'], env=env, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(run.returncode, 0)


if __name__ == '__main__':
    unittest.main()
