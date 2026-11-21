#!/usr/bin/env python3
"""Offline smoke test for the combined MCP files inside any editor bundle."""
import json
import os
from pathlib import Path
import subprocess
import sys

folder = Path(sys.argv[1]).resolve()
request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'}
agents = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'chat_agents'}}
env = dict(os.environ, REDOT_BRIDGE_TOKEN='x' * 48, WEBFTP_SHARE='http://127.0.0.1:1/s/test')
run = subprocess.run([sys.executable, str(folder / 'multiagent_mcp.py')],
                     input=json.dumps(request) + '\n' + json.dumps(agents) + '\n',
                     env=env, text=True, capture_output=True, timeout=15)
if run.returncode:
    raise SystemExit('Combined MCP startup failed: ' + run.stderr)
responses = [json.loads(line) for line in run.stdout.splitlines()]
if len(responses) != 2:
    raise SystemExit('Unexpected combined MCP responses')
names = {item['name'] for item in responses[0]['result']['tools']}
if not {'chat_agents', 'chat_assign', 'game_play', 'game_stop', 'game_screenshot', 'delete_game_screenshot'} <= names:
    raise SystemExit('Combined MCP tools missing')
if not json.loads(responses[1]['result']['content'][0]['text'])['agents']:
    raise SystemExit('Upstream chat roster missing')
print('Offline combined MCP bundle test passed; no real WebFTP or editor connection was made.')
