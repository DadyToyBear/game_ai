#!/usr/bin/env python3
"""Exercise the current Android EditorPlugin and bridge over adb reverse.

The helper plugin fills the real add-on's in-memory dialog and invokes its
connect handler only in this disposable test project; it does not test UI input.
"""
import base64
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer

from PIL import Image

PACKAGE = Path(sys.argv[1]).resolve()
SOURCE = Path(__file__).resolve().parents[1] / 'redot-bridge'
sys.path.insert(0, str(SOURCE))
import bridge

TOKEN = 'android-ci-only-0123456789abcdef0123456789abcdef0123456789'
PKG = 'org.godotengine.editor.v4.debug'
DID_INSTALL = False
DID_REVERSE = False
PROJECT = '''config_version=5
[application]
config/name="Android MCP Audit"
run/main_scene="res://main.tscn"
[autoload]
GameCapture="*res://addons/redot_android_mcp/game_capture.gd"
[editor_plugins]
enabled=PackedStringArray("res://addons/redot_android_mcp/plugin.cfg", "res://addons/audit/plugin.cfg")
[rendering]
renderer/rendering_method="gl_compatibility"
renderer/rendering_method.mobile="gl_compatibility"
'''
AUDIT_PLUGIN = '''@tool
extends EditorPlugin
var elapsed := 1.0
var announced := false
func _process(delta: float) -> void:
    if not announced:
        print("ANDROID_MCP_EDITOR_TEST_WAITING")
        announced = true
    if not FileAccess.file_exists("res://ci_allow_connect.txt"):
        return
    elapsed += delta
    if elapsed < 1.0:
        return
    elapsed = 0.0
    var queue: Array[Node] = [get_tree().root]
    while not queue.is_empty():
        var item: Node = queue.pop_back()
        var script: Script = item.get_script()
        if script != null and script.resource_path == "res://addons/redot_android_mcp/android_mcp.gd":
            var secret_field: LineEdit = item.get("_token_input")
            if secret_field != null:
                secret_field.text = "%s"
                item.call("_connect_bridge")
                print("ANDROID_MCP_TEST_REQUESTED")
                set_process(false)
                return
        queue.append_array(item.get_children())
''' % TOKEN
GAME_SCRIPT = '''extends ColorRect
var announced := false
func _ready() -> void:
    print("ANDROID_MCP_GAME_STARTED")
func _process(_delta: float) -> void:
    var capture := get_node_or_null("/root/GameCapture")
    if capture == null:
        return
    var dialog: ConfirmationDialog = capture.get("_dialog")
    var secret_field: LineEdit = capture.get("_token_input")
    if dialog == null or secret_field == null:
        return
    if not announced:
        print("ANDROID_MCP_CAPTURE_TEST_WAITING")
        announced = true
    if not FileAccess.file_exists("res://ci_allow_capture.txt"):
        return
    secret_field.text = "%s"
    dialog.hide()
    capture.call("_start_capture")
    print("ANDROID_MCP_CAPTURE_TEST_REQUESTED")
    set_process(false)
''' % TOKEN


def adb(*args, check=True, timeout=90):
    return subprocess.run(['adb', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check, timeout=timeout)


def notice(title, value):
    print(f'::notice title={title}::{value.replace("%", "%25").replace(chr(10), " ")}', flush=True)


def wait(label, predicate, seconds=150):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(1)
    raise TimeoutError('Timed out waiting for ' + label)


def mcp(name):
    request = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': {}}}) + '\n'
    env = dict(os.environ, REDOT_BRIDGE_TOKEN=TOKEN)
    result = subprocess.run([sys.executable, str(SOURCE / 'bridge.py'), 'mcp'], input=request, text=True, capture_output=True, timeout=15, env=env, check=True)
    response = json.loads(result.stdout)['result']
    if response.get('isError'):
        raise RuntimeError('MCP call failed: ' + response['content'][0]['text'])
    return response


def logs():
    return adb('logcat', '-d', '-s', 'redot:V', 'godot:V', 'Godot:V', '*:S', check=False).stdout.decode(errors='replace')


def main(store):
    global DID_INSTALL, DID_REVERSE
    apks = list(PACKAGE.rglob('android_editor-android-debug.apk'))
    if len(apks) != 1:
        raise RuntimeError('Expected one debug editor APK')
    abi = adb('shell', 'getprop', 'ro.product.cpu.abilist').stdout.decode().strip()
    emulator = adb('shell', 'getprop', 'ro.kernel.qemu').stdout.decode().strip()
    if emulator != '1' or 'x86_64' not in abi or 'arm64-v8a' not in abi:
        raise RuntimeError('This destructive CI probe requires an x86_64 emulator with ARM64 translation')
    notice('Android MCP emulator', 'API 35 x86_64 emulator with ARM64 translation and swangle; not a physical device.')
    if adb('shell', 'pm', 'path', PKG, check=False).stdout.strip():
        raise RuntimeError('Editor is already installed; refusing to replace it')
    adb('install', '--abi', 'arm64-v8a', str(apks[0]), timeout=180)
    DID_INSTALL = True
    adb('shell', 'wm', 'size', '1280x800')
    adb('shell', 'wm', 'density', '160')
    adb('shell', 'appops', 'set', PKG, 'MANAGE_EXTERNAL_STORAGE', 'allow', check=False)
    existing_reverses = adb('reverse', '--list').stdout.decode(errors='replace')
    if re.search(r'\btcp:8765\b', existing_reverses):
        raise RuntimeError('An adb reverse mapping already uses port 8765; refusing to replace it')
    adb('reverse', 'tcp:8765', 'tcp:8765')
    DID_REVERSE = True
    adb('logcat', '-G', '16M', check=False)
    adb('logcat', '-c')
    if adb('shell', 'test', '-e', '/sdcard/RedotMCPAudit', check=False).returncode == 0:
        raise RuntimeError('Test project path already exists; refusing to overwrite it')
    with tempfile.TemporaryDirectory() as directory:
        project = Path(directory) / 'RedotMCPAudit'
        project.mkdir()
        (project / 'project.godot').write_text(PROJECT)
        (project / 'main.tscn').write_text('[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://game.gd" id="1"]\n[node name="Game" type="ColorRect"]\noffset_right = 320.0\noffset_bottom = 240.0\ncolor = Color(0.95, 0.05, 0.08, 1)\nscript = ExtResource("1")\n')
        (project / 'game.gd').write_text(GAME_SCRIPT)
        shutil.copytree(SOURCE / 'addons/redot_android_mcp', project / 'addons/redot_android_mcp')
        (project / 'addons/audit').mkdir()
        (project / 'addons/audit/plugin.cfg').write_text('[plugin]\nname="Android MCP Audit"\ndescription="CI only"\nauthor="test"\nversion="1"\nscript="plugin.gd"\n')
        (project / 'addons/audit/plugin.gd').write_text(AUDIT_PLUGIN)
        adb('push', str(project), '/sdcard/', timeout=90)
    launched = adb('shell', 'am', 'start', '-n', PKG + '/org.godotengine.editor.GodotEditor', '--esa', 'command_line_params', '--path,/storage/emulated/0/RedotMCPAudit,--editor')
    notice('Android editor launch', launched.stdout.decode(errors='replace'))
    wait('test editor plugin ready', lambda: 'ANDROID_MCP_EDITOR_TEST_WAITING' in logs(), 180)
    time.sleep(4)
    if store.status()['editor_connected'] or store.get_logs()['entries']:
        raise RuntimeError('Editor connected or shared logs without the opt-in test trigger')
    adb('shell', 'touch', '/sdcard/RedotMCPAudit/ci_allow_connect.txt')
    wait('test plugin requesting connect', lambda: 'ANDROID_MCP_TEST_REQUESTED' in logs(), 90)
    notice('Android MCP connection request', 'Disposable test helper invoked the real add-on connect handler; UI input was not tested.')
    wait('Android editor heartbeat at local bridge', lambda: store.status()['editor_connected'], 120)
    if store.status()['playing']:
        raise RuntimeError('Unexpected game running at test start')
    notice('Android MCP heartbeat', 'Real Android EditorPlugin reached the bridge through adb reverse.')
    mcp('game_play')
    wait('Android test game process', lambda: 'ANDROID_MCP_GAME_STARTED' in logs(), 180)
    notice('Android MCP Play', 'The test game reported its own ready marker after MCP Play.')
    wait('editor Play state', lambda: store.status()['playing'] is True, 90)
    wait('test game awaiting capture permission', lambda: 'ANDROID_MCP_CAPTURE_TEST_WAITING' in logs(), 90)
    time.sleep(4)
    if store.get() is not None or store.get_logs()['entries']:
        raise RuntimeError('Game sent a frame or logs before the opt-in test trigger')
    adb('shell', 'touch', '/sdcard/RedotMCPAudit/ci_allow_capture.txt')
    wait('test game requesting capture', lambda: 'ANDROID_MCP_CAPTURE_TEST_REQUESTED' in logs(), 90)
    def valid_frame():
        if not store.status()['frame_available']:
            return False
        result = mcp('game_screenshot')
        if result['content'][0].get('mimeType') != 'image/jpeg' or 'native-game' not in result['content'][1]['text']:
            raise RuntimeError('Unexpected screenshot type or source')
        data = base64.b64decode(result['content'][0]['data'], validate=True)
        image = Image.open(io.BytesIO(data)).convert('RGB')
        return sum(1 for r, g, b in image.getdata() if r > 140 and g < 100 and b < 100) > 1000
    wait('Android game screenshot with red test pixels', valid_frame, 150)
    notice('Android MCP game capture', 'Game autoload sent a JPEG containing the red test scene to MCP; test helper invoked Share, not the actual dialog UI.')
    mcp('game_stop')
    wait('editor Stop state', lambda: store.status()['playing'] is False, 90)
    time.sleep(3)
    mcp('delete_game_screenshot')
    if store.get() is not None:
        raise RuntimeError('Game screenshot was not deleted')
    time.sleep(2)
    if store.get() is not None:
        raise RuntimeError('A new screenshot arrived after Stop and deletion')
    notice('Android MCP Stop and delete', 'Editor reported the game stopped, and the last game screenshot was deleted.')


def failure_diagnostics(exc):
    try:
        raw = adb('logcat', '-d', check=False).stdout.decode(errors='replace')
        lines = [line for line in raw.splitlines() if re.search(r'ANDROID_MCP_|\bredot\b|BaseGodotEditor|GodotActivity|FATAL EXCEPTION|Cleartext|Exception|denied', line, re.I) and 'app_time_stats' not in line]
        notice('Android MCP logs', ' | '.join(lines[-25:])[-3800:])
        image = Image.open(io.BytesIO(adb('exec-out', 'screencap', '-p').stdout)).convert('RGB')
        image.thumbnail((960, 600)); buf = io.BytesIO(); image.save(buf, format='JPEG', quality=15)
        data = base64.b64encode(buf.getvalue()).decode('ascii')
        for i in range(0, min(len(data), 35000), 3500):
            print(f'::warning title=ANDROID_MCP_FAILURE_{i//3500:02d}::{data[i:i+3500]}', flush=True)
    except Exception as diagnostic_error:
        notice('Android MCP diagnostics error', str(diagnostic_error))
    print('::error title=Android MCP probe::' + str(exc).replace('%', '%25'), file=sys.stderr, flush=True)


if __name__ == '__main__':
    store = bridge.FrameStore()
    server = ThreadingHTTPServer(('127.0.0.1', 8765), bridge.handler_for(store, TOKEN))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        main(store)
    except Exception as exc:
        if DID_INSTALL:
            failure_diagnostics(exc)
        else:
            print('::error title=Android MCP probe::' + str(exc).replace('%', '%25'), file=sys.stderr, flush=True)
        raise
    finally:
        if DID_REVERSE:
            adb('reverse', '--remove', 'tcp:8765', check=False)
        if DID_INSTALL:
            adb('shell', 'am', 'force-stop', PKG, check=False)
        server.shutdown(); server.server_close(); worker.join()
