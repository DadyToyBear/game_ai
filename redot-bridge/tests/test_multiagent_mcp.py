import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'redot-bridge'))
import bridge

TOKEN = 'a' * 48
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=')


class Share(BaseHTTPRequestHandler):
    files = {}
    redirect = False
    redirected = 0
    def log_message(self, *args):
        pass
    def do_PUT(self):
        if urlsplit(self.path).path == '/redirected':
            Share.redirected += 1
        if self.redirect:
            self.send_response(307); self.send_header('Location', '/redirected'); self.end_headers(); return
        name = parse_qs(urlsplit(self.path).query).get('name', [''])[0]
        self.files[name] = self.rfile.read(int(self.headers['Content-Length']))
        self.send_response(200); self.end_headers()
    def do_GET(self):
        if urlsplit(self.path).path == '/redirected':
            Share.redirected += 1
        name = urlsplit(self.path).path.rsplit('/', 1)[-1]
        data = self.files.get(name)
        if data is None:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)


class CombinedMcpTest(unittest.TestCase):
    def setUp(self):
        Share.files = {}; Share.redirect = False; Share.redirected = 0
        self.share = ThreadingHTTPServer(('127.0.0.1', 0), Share)
        self.store = bridge.FrameStore()
        self.editor = ThreadingHTTPServer(('127.0.0.1', 0), bridge.handler_for(self.store, TOKEN))
        self.threads = []
        for server in (self.share, self.editor):
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start(); self.threads.append(thread)
        self.env = dict(os.environ, REDOT_BRIDGE_TOKEN=TOKEN, WEBFTP_SHARE=f'http://127.0.0.1:{self.share.server_port}/s/test')

    def tearDown(self):
        for server in (self.share, self.editor):
            server.shutdown(); server.server_close()
        for thread in self.threads:
            thread.join()

    def run_mcp(self, messages, env=None):
        return subprocess.run([sys.executable, str(ROOT / 'redot-bridge/multiagent_mcp.py'), '--port', str(self.editor.server_port)],
                              input=''.join(json.dumps(m) + '\n' for m in messages), text=True, capture_output=True,
                              env=env or self.env, timeout=15)

    def test_real_upstream_chat_and_editor_tools_same_connection(self):
        self.store.editor_poll(False)
        self.store.put(PNG, 'image/png', 'native-game')
        def call(i, name, args=None):
            return {'jsonrpc': '2.0', 'id': i, 'method': 'tools/call', 'params': {'name': name, 'arguments': args or {}}}
        messages = [{'jsonrpc':'2.0', 'id': 1, 'method':'initialize'},
                    {'jsonrpc':'2.0', 'method':'notifications/initialized'},
                    {'jsonrpc':'2.0', 'id':2, 'method':'tools/list'},
                    call(3, 'chat_agents'), call(4, 'chat_post', {'from':'test-agent','text':'hello'}),
                    call(5, 'game_screenshot'), call(6, 'game_play'), call(7, 'delete_game_screenshot'),
                    call(8, 'game_screenshot')]
        process = self.run_mcp(messages)
        self.assertEqual(process.returncode, 0, process.stderr)
        replies = [json.loads(x) for x in process.stdout.splitlines()]
        self.assertEqual([r['id'] for r in replies], [1, 2, 3, 4, 5, 6, 7, 8])
        tools = {t['name'] for t in replies[1]['result']['tools']}
        self.assertIn('chat_assign', tools); self.assertIn('game_screenshot', tools)
        self.assertTrue(json.loads(replies[2]['result']['content'][0]['text'])['agents'])
        posted = json.loads(replies[3]['result']['content'][0]['text'])
        self.assertTrue(posted['ok']); self.assertEqual(json.loads(Share.files[posted['file']])['text'], 'hello')
        self.assertEqual(base64.b64decode(replies[4]['result']['content'][0]['data']), PNG)
        self.assertEqual(self.store.editor_poll(False), 'play')
        self.assertTrue(replies[-1]['result']['isError'])

    def test_invalid_tool_names_and_deep_json_do_not_kill_stdio(self):
        requests = [{'jsonrpc':'2.0','id':n,'method':'tools/call','params':{'name':value}} for n,value in enumerate(([], {}, None), 1)]
        requests.append({'jsonrpc':'2.0','id':4,'method':'tools/list'})
        process = self.run_mcp(requests, dict(self.env, REDOT_TASK_SECRET='s' * 48, REDOT_PRESENCE_ENABLED='1'))
        self.assertEqual(process.returncode, 0, process.stderr)
        replies = [json.loads(x) for x in process.stdout.splitlines()]
        self.assertEqual([r['error']['code'] for r in replies[:3]], [-32602] * 3)
        self.assertIn('tools', replies[3]['result'])
        deep = '[' * 2000 + '0' + ']' * 2000 + '\n'
        good = json.dumps({'jsonrpc':'2.0','id':5,'method':'tools/list'}) + '\n'
        process = subprocess.run([sys.executable, str(ROOT / 'redot-bridge/multiagent_mcp.py')],
                                 input=deep + good, capture_output=True, text=True, env=self.env, timeout=15)
        self.assertEqual(process.returncode, 0, process.stderr)
        replies = [json.loads(x) for x in process.stdout.splitlines()]
        self.assertEqual(replies[0]['error']['code'], -32700)
        self.assertEqual(replies[1]['id'], 5)
        self.assertIn('tools', replies[1]['result'])

    def test_insecure_share_is_rejected_without_request(self):
        env = dict(self.env, WEBFTP_SHARE='http://example.com/s/private')
        process = self.run_mcp([], env)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn('must be HTTPS', process.stderr)
        self.assertNotIn('private', process.stderr)
        self.assertEqual(Share.files, {})

    def test_chat_refuses_http_redirects(self):
        Share.redirect = True
        request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                   'params': {'name': 'chat_post', 'arguments': {'from': 'test', 'text': 'hello'}}}
        process = self.run_mcp([request])
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertTrue(json.loads(process.stdout)['result']['isError'])
        self.assertEqual(Share.redirected, 0)
        self.assertEqual(Share.files, {})

    def test_missing_token_or_share_fails_closed(self):
        for change in ({'REDOT_BRIDGE_TOKEN': 'short'}, {'WEBFTP_SHARE': ''}):
            process = self.run_mcp([], dict(self.env, **change))
            self.assertNotEqual(process.returncode, 0)
            self.assertEqual(Share.files, {})


if __name__ == '__main__':
    unittest.main()
