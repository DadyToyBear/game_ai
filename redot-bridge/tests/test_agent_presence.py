from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'redot-bridge'))
import agent_presence as presence
import task_transport as transport


def iso(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


class Share(BaseHTTPRequestHandler):
    files = {}
    auth = []
    def log_message(self, *args): pass
    def do_PUT(self):
        Share.auth.append(self.headers.get('Authorization'))
        name = parse_qs(urlsplit(self.path).query).get('name', [''])[0]
        Share.files[name] = self.rfile.read(int(self.headers['Content-Length']))
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
    def do_GET(self):
        Share.auth.append(self.headers.get('Authorization'))
        name = urlsplit(self.path).path.rsplit('/', 1)[-1]
        data = Share.files.get(name)
        if data is None: self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)


class PresenceTests(unittest.TestCase):
    def setUp(self):
        Share.files = {}; Share.auth = []
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Share)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.share = f'http://127.0.0.1:{self.server.server_port}/s/test'
        self.client = transport.WebFTP(self.share, 'z' * 40)
        self.env = dict(os.environ, WEBFTP_SHARE=self.share, WEBFTP_BEARER='z' * 40,
                        REDOT_BRIDGE_TOKEN='b' * 48, REDOT_TASK_SECRET='', REDOT_PRESENCE_ENABLED='1')

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def test_age_and_invalid_timestamps(self):
        now = 1780000000
        def data(age, **kwargs):
            return {'agent':'opencode-1', 'ts':iso(now-age), 'status':'работаю', 'alive':True, **kwargs}
        for age, expected in [(0,'recent'),(299,'recent'),(300,'stale'),(899,'stale'),(900,'expired')]:
            self.assertEqual(presence.classify('opencode-1',data(age),now)['state'], expected)
        self.assertEqual(presence.classify('opencode-1',data(1,alive=False),now)['state'],'declared_offline')
        for invalid in [data(-61), data(1,agent='other'), data(1,ts='bad'), data(1,ts='2026-01-01'), data(1,status='\n')]:
            self.assertEqual(presence.classify('opencode-1',invalid,now)['state'],'unknown')

    def test_write_read_and_invalid_data(self):
        self.assertEqual(presence.read(self.client,'or-ling')['state'],'unknown')
        self.assertTrue(presence.write(self.client,'or-ling','Проверка')['sent'])
        result = presence.read(self.client,'or-ling')
        self.assertEqual(result['state'],'recent'); self.assertEqual(result['status'],'Проверка')
        self.assertTrue(all(x == 'Bearer ' + 'z' * 40 for x in Share.auth))
        Share.files['agent-or-ling-heartbeat.json'] = b'['*2000+b']'*2000
        self.assertEqual(presence.read(self.client,'or-ling')['state'],'unknown')
        for agent in ('../bad','UPPER','', 'a'*65, 'a/b'):
            with self.assertRaises(ValueError): presence.write(self.client,agent)
        with self.assertRaises(ValueError): presence.write(self.client,'valid','a'*201)
        self.assertFalse(any('../' in x for x in Share.files))

    def test_cli_and_optional_mcp(self):
        script = ROOT / 'redot-bridge/agent_presence.py'
        proc = subprocess.run([sys.executable,str(script),'--agent','opencode-1','--status','test'],env=self.env,capture_output=True,text=True,timeout=15)
        self.assertEqual(proc.returncode,0,proc.stderr)
        self.assertEqual(presence.read(self.client,'opencode-1')['state'],'recent')
        mcp = ROOT / 'redot-bridge/multiagent_mcp.py'
        def run(messages, env):
            p = subprocess.run([sys.executable,str(mcp)],input=''.join(json.dumps(m)+'\n' for m in messages),env=env,capture_output=True,text=True,timeout=15)
            self.assertEqual(p.returncode,0,p.stderr)
            return [json.loads(line) for line in p.stdout.splitlines()]
        def call(rid,name,args): return {'jsonrpc':'2.0','id':rid,'method':'tools/call','params':{'name':name,'arguments':args}}
        replies = run([{'jsonrpc':'2.0','id':1,'method':'tools/list'},call(2,'chat_presence_update',{'agent':'or-ling','status':'busy'}),call(3,'chat_presence_read',{'agent':'or-ling'}),call(4,'chat_presence_read',{'agent':'no-agent'}),call(5,'chat_presence_update',{'agent':'../escape'})],self.env)
        names = {tool['name'] for tool in replies[0]['result']['tools']}
        self.assertTrue({'chat_presence_update','chat_presence_read'} <= names)
        self.assertEqual(json.loads(replies[2]['result']['content'][0]['text'])['state'],'recent')
        self.assertEqual(json.loads(replies[3]['result']['content'][0]['text'])['state'],'unknown')
        self.assertTrue(replies[4]['result']['isError'])
        names = {tool['name'] for tool in run([{'jsonrpc':'2.0','id':1,'method':'tools/list'}],dict(self.env,REDOT_PRESENCE_ENABLED=''))[0]['result']['tools']}
        self.assertNotIn('chat_presence_update',names)
        self.assertNotIn('chat_presence_read',names)


if __name__ == '__main__': unittest.main()
