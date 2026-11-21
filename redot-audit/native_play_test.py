#!/usr/bin/env python3
"""End-to-end test with an actual native Redot editor on a virtual display.

Uses only a generated temporary project and a fixed test secret. Checks the
real bridge, MCP stdio, editor plugin, game autoload, and image pixels.
"""
import base64
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'redot-bridge'))
import bridge

TOKEN = 'integration-test-secret-012345678901234567890123456789'
PROJECT = '''config_version=5

[application]
config/name="MCP Real Editor Test"
run/main_scene="res://main.tscn"

[autoload]
GameBridge="*res://addons/redot_local_bridge/game_bridge.gd"

[editor_plugins]
enabled=PackedStringArray("res://addons/redot_local_bridge/plugin.cfg")

[display]
window/size/viewport_width=320
window/size/viewport_height=240

[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
'''
SCENE = '''[gd_scene format=3]

[node name="Game" type="ColorRect"]
offset_right = 320.0
offset_bottom = 240.0
color = Color(0.95, 0.05, 0.08, 1)
'''


def wait_until(predicate, timeout, editor, label):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        if editor.poll() is not None:
            raise RuntimeError(f'Editor exited early ({editor.returncode}) while waiting for {label}')
        try:
            value = predicate()
            if value:
                return value
        except (OSError, ValueError, urllib.error.URLError) as exc:
            last_error = str(exc)
        time.sleep(0.5)
    raise TimeoutError('Timed out waiting for ' + label + (f'; last error: {last_error}' if last_error else ''))


def mcp(name, env):
    message = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': {}}}) + '\n'
    run = subprocess.run([sys.executable, str(ROOT / 'redot-bridge/bridge.py'), 'mcp'], input=message, text=True, capture_output=True, timeout=12, env=env)
    if run.returncode:
        raise RuntimeError('MCP process failed: ' + run.stderr)
    result = json.loads(run.stdout)['result']
    if result.get('isError'):
        raise ValueError(result['content'][0]['text'])
    return result


def red_pixel_count(image):
    rgb = Image.open(io.BytesIO(image)).convert('RGB')
    return sum(1 for r, g, b in rgb.getdata() if r > 140 and g < 100 and b < 100)


def terminate_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=8)


def main():
    executable = str(Path(sys.argv[1]).resolve())
    with tempfile.TemporaryDirectory(prefix='redot-native-test-') as tmp:
        root = Path(tmp)
        project = root / 'project'
        project.mkdir()
        shutil.copytree(ROOT / 'redot-bridge/addons/redot_local_bridge', project / 'addons/redot_local_bridge')
        (project / 'project.godot').write_text(PROJECT, encoding='utf-8')
        (project / 'main.tscn').write_text(SCENE, encoding='utf-8')
        env = dict(os.environ, REDOT_BRIDGE_ENABLED='1', REDOT_BRIDGE_TOKEN=TOKEN,
                   XDG_CONFIG_HOME=str(root / 'config'), XDG_DATA_HOME=str(root / 'data'),
                   XDG_CACHE_HOME=str(root / 'cache'), LIBGL_ALWAYS_SOFTWARE='1')
        store = bridge.FrameStore()
        server = ThreadingHTTPServer(('127.0.0.1', 8765), bridge.handler_for(store, TOKEN))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        with (root / 'editor.log').open('w+', encoding='utf-8') as log:
            process = subprocess.Popen([executable, '--editor', '--path', str(project), '--rendering-method', 'gl_compatibility', '--audio-driver', 'Dummy'],
                                       stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
            try:
                wait_until(lambda: store.status()['editor_connected'], 120, process, 'editor heartbeat')
                if store.status()['playing']:
                    raise RuntimeError('Unexpected game running at test start')
                mcp('game_play', env)
                wait_until(lambda: store.status()['playing'] is True, 60, process, 'editor Play state')

                def valid_frame():
                    result = mcp('game_screenshot', env)
                    data = base64.b64decode(result['content'][0]['data'], validate=True)
                    if result['content'][0]['mimeType'] != 'image/jpeg':
                        raise RuntimeError('Unexpected game frame MIME')
                    if 'native-game' not in result['content'][1]['text']:
                        raise RuntimeError('Unexpected frame source')
                    pixels = red_pixel_count(data)
                    return pixels if pixels > 1000 else None
                pixels = wait_until(valid_frame, 75, process, 'game screenshot with red scene')
                mcp('game_stop', env)
                wait_until(lambda: store.status()['playing'] is False, 60, process, 'editor Stop state')
                # Stop the game before deletion so the autoload cannot upload again.
                time.sleep(1)
                mcp('delete_game_screenshot', env)
                if store.get() is not None:
                    raise RuntimeError('Frame was not deleted')
                time.sleep(1)
                if store.get() is not None:
                    raise RuntimeError('New frame appeared after Stop and deletion')
                browser = subprocess.run(['node', str(ROOT / 'redot-audit/native_viewer_test.cjs')], text=True,
                                         capture_output=True, timeout=150, env=env)
                if browser.returncode:
                    raise RuntimeError('Browser viewer test failed: ' + browser.stdout + browser.stderr)
                print(browser.stdout.strip())
                print(f'::notice title=Native Redot editor integration::MCP and browser Play/Stop worked; {pixels} red pixels reached MCP and the browser; deletion succeeded (Linux Xvfb, software GL).')
            except Exception:
                log.flush()
                log.seek(0)
                print('Editor output tail:\n' + log.read()[-10000:], file=sys.stderr)
                raise
            finally:
                terminate_group(process)
                server.shutdown()
                server.server_close()
                worker.join()


if __name__ == '__main__':
    main()
