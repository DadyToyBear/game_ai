import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'redot-bridge'))
import bridge
import task_transport as tt

TOKEN = 'b' * 48
SECRET = 's' * 48
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a3sAAAAASUVORK5CYII=')


class Share(BaseHTTPRequestHandler):
    files = {}
    fail_put = False
    def log_message(self, *args):
        pass
    def do_GET(self):
        url = urlsplit(self.path)
        if parse_qs(url.query).get('json') == ['1']:
            data = json.dumps({'items': [{'name': name, 'type': 'file'} for name in self.files]}).encode()
        else:
            name = url.path.rsplit('/', 1)[-1]
            data = self.files.get(name)
            if data is None:
                self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_PUT(self):
        if self.fail_put:
            self.send_response(500); self.end_headers(); return
        name = parse_qs(urlsplit(self.path).query).get('name', [''])[0]
        self.files[name] = self.rfile.read(int(self.headers['Content-Length']))
        self.send_response(200); self.end_headers()


class SignedTransportTest(unittest.TestCase):
    def setUp(self):
        Share.files = {}; Share.fail_put = False
        self.share = ThreadingHTTPServer(('127.0.0.1', 0), Share)
        self.store = bridge.FrameStore()
        self.editor = ThreadingHTTPServer(('127.0.0.1', 0), bridge.handler_for(self.store, TOKEN))
        self.threads = []
        for s in (self.share, self.editor):
            t = threading.Thread(target=s.serve_forever, daemon=True); t.start(); self.threads.append(t)
        self.client = tt.WebFTP(f'http://127.0.0.1:{self.share.server_port}/s/test')
        self.editor_url = f'http://127.0.0.1:{self.editor.server_port}'
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / 'state.sqlite3'
        self.claims = tt.Claims(self.state)
        self.env = dict(os.environ, REDOT_BRIDGE_TOKEN=TOKEN, REDOT_TASK_SECRET=SECRET,
                        WEBFTP_SHARE=self.client.share, WEBFTP_BEARER='')

    def tearDown(self):
        self.claims.close()
        for s in (self.share, self.editor):
            s.shutdown(); s.server_close()
        for t in self.threads: t.join()

    def put_task(self, identifier, envelope):
        Share.files[tt.TASK_PREFIX + identifier + '.json'] = tt.canonical(envelope)

    def test_queue_run_signed_result_and_persistent_replay_protection(self):
        self.store.editor_poll(False)
        identifier = tt.submit(self.client, SECRET, 'game_play')
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN), 1)
        reply = tt.get_result(self.client, SECRET, identifier)
        self.assertFalse(reply['result'].get('isError', False))
        self.assertEqual(self.store.editor_poll(False), 'play')
        self.claims.close(); self.claims = tt.Claims(self.state)
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN), 0)
        self.assertIsNone(self.store.editor_poll(False))
        name = tt.RESULT_PREFIX + identifier + '.json'
        altered = json.loads(Share.files[name]); altered['payload']['reply']['result']['content'][0]['text'] = 'forged'
        Share.files[name] = tt.canonical(altered)
        with self.assertRaises(ValueError): tt.get_result(self.client, SECRET, identifier)

    def test_untrusted_expired_and_legacy_tasks_never_run(self):
        self.store.editor_poll(False)
        identifier, signed = tt.make_task('game_play', SECRET)
        altered = json.loads(json.dumps(signed)); altered['payload']['method'] = 'game_stop'
        self.put_task(identifier, altered)
        expired_id, expired = tt.make_task('game_play', SECRET, now=time.time() - 1000)
        self.put_task(expired_id, expired)
        Share.files['task-attacker.json'] = json.dumps({'method':'game_play'}).encode()
        Share.files[tt.TASK_PREFIX + 'f' * 32 + '.json'] = b'{broken'
        Share.files[tt.TASK_PREFIX + 'e' * 32 + '.json'] = b'[' * 2000 + b']' * 2000
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN), 0)
        self.assertIsNone(self.store.editor_poll(False))
        self.assertFalse(any(x.startswith(tt.RESULT_PREFIX) for x in Share.files))

    def test_sensitive_content_is_explicitly_opt_in(self):
        self.store.put(PNG, 'image/png', 'native-game')
        denied = tt.submit(self.client, SECRET, 'game_screenshot')
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN), 1)
        self.assertTrue(tt.get_result(self.client, SECRET, denied)['result']['isError'])
        permitted = tt.submit(self.client, SECRET, 'game_screenshot')
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN, allow_sensitive=True), 1)
        image = tt.get_result(self.client, SECRET, permitted)['result']['content'][0]
        self.assertEqual(base64.b64decode(image['data']), PNG)
        deletion = tt.submit(self.client, SECRET, 'delete_game_screenshot')
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN), 1)
        self.assertFalse(tt.get_result(self.client, SECRET, deletion)['result'].get('isError', False))
        self.assertIsNone(self.store.get())

    def test_failed_result_upload_never_reexecutes(self):
        self.store.editor_poll(False)
        identifier = tt.submit(self.client, SECRET, 'game_play')
        Share.fail_put = True
        with self.assertRaises(ValueError): tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN)
        self.assertEqual(self.store.editor_poll(False), 'play')
        Share.fail_put = False
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN), 0)
        self.assertIsNone(self.store.editor_poll(False))
        with self.assertRaises(ValueError): tt.get_result(self.client, SECRET, identifier)

    def test_combined_mcp_produces_and_verifies_task_results(self):
        self.store.editor_poll(False)
        def mcp(request):
            proc = subprocess.run([sys.executable, str(ROOT / 'redot-bridge/multiagent_mcp.py'), '--port', str(self.editor.server_port)],
                                  input=json.dumps(request) + '\n', capture_output=True, text=True, env=self.env, timeout=15)
            self.assertEqual(proc.returncode, 0, proc.stderr); return json.loads(proc.stdout)['result']
        def request(name, arguments):
            return {'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':arguments}}
        queued = json.loads(mcp(request('webftp_task_submit', {'method':'game_play'}))['content'][0]['text'])
        self.assertIn('not confirmed', queued['status'])
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN), 1)
        result = mcp(request('webftp_task_result', {'id':queued['id']}))
        self.assertFalse(result.get('isError', False))
        self.assertEqual(self.store.editor_poll(False), 'play')
        self.store.put(PNG, 'image/png', 'native-game')
        queued = json.loads(mcp(request('webftp_task_submit', {'method':'game_screenshot'}))['content'][0]['text'])
        self.assertEqual(tt.work_once(self.client, SECRET, self.claims, self.editor_url, TOKEN, allow_sensitive=True), 1)
        result = mcp(request('webftp_task_result', {'id':queued['id']}))
        self.assertEqual(base64.b64decode(result['content'][0]['data']), PNG)

    def test_worker_cli_and_optional_mcp_tool_discovery(self):
        self.store.editor_poll(False)
        identifier = tt.submit(self.client, SECRET, 'game_stop')
        process = subprocess.run([sys.executable, str(ROOT / 'redot-bridge/task_transport.py'), 'worker',
                                  '--state', str(self.state), '--port', str(self.editor.server_port), '--once'],
                                 env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(self.store.editor_poll(False), 'stop')
        self.assertFalse(tt.get_result(self.client, SECRET, identifier)['result'].get('isError', False))
        process = subprocess.run([sys.executable, str(ROOT / 'redot-bridge/multiagent_mcp.py'), '--port', str(self.editor.server_port)],
                                 input='{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
                                 env=self.env, capture_output=True, text=True, timeout=15)
        self.assertEqual(process.returncode, 0, process.stderr)
        names = {tool['name'] for tool in json.loads(process.stdout)['result']['tools']}
        self.assertIn('webftp_task_submit', names)
        self.assertIn('webftp_task_result', names)
        env = dict(self.env, REDOT_TASK_SECRET='')
        process = subprocess.run([sys.executable, str(ROOT / 'redot-bridge/multiagent_mcp.py')],
                                 input='{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
                                 env=env, capture_output=True, text=True, timeout=15)
        names = {tool['name'] for tool in json.loads(process.stdout)['result']['tools']}
        self.assertNotIn('webftp_task_submit', names)

    def test_insecure_share_and_same_secret_rejected(self):
        with self.assertRaises(ValueError): tt.WebFTP('http://example.com/s/test')
        with self.assertRaises(ValueError): tt.work_once(self.client, TOKEN, self.claims, self.editor_url, TOKEN)
        with self.assertRaises(ValueError): tt.submit(self.client, SECRET, 'project_snapshot_import')
        with self.assertRaises(ValueError): tt.get_result(self.client, SECRET, '../bad')


if __name__ == '__main__':
    unittest.main()
