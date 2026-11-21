#!/usr/bin/env python3
"""Diagnostic probe: start the bundled ARM editor on an Android emulator.

A running process alone is not a project-import, Play or device test.
"""
import base64
import io
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

EDITOR_PID = None


def adb(*args, check=True, timeout=90):
    return subprocess.run(['adb', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check, timeout=timeout)


def notice(title, value):
    print(f'::notice title={title}::{value.replace(chr(10), " ")}', flush=True)


def dismiss_unrelated_anr():
    # Background emulator services occasionally show system ANR dialogs.
    adb('shell', 'uiautomator', 'dump', '/sdcard/window.xml', check=False, timeout=30)
    raw = adb('shell', 'cat', '/sdcard/window.xml', check=False).stdout
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return
    texts = [node.get('text', '') for node in root.iter('node')]
    dialogs = [text for text in texts if "isn't responding" in text]
    if not dialogs:
        return
    if any(re.search(r'godot|redot', text, re.I) for text in dialogs):
        raise RuntimeError('The editor is not responding')
    for node in root.iter('node'):
        if node.get('text') == 'Close app':
            coords = [int(n) for n in re.findall(r'\d+', node.get('bounds', ''))]
            if len(coords) == 4:
                adb('shell', 'input', 'tap', str((coords[0]+coords[2])//2), str((coords[1]+coords[3])//2))
                time.sleep(2)
                return


def main():
    global EDITOR_PID
    apks = list(Path(sys.argv[1]).rglob('android_editor-android-debug.apk'))
    if len(apks) != 1:
        raise RuntimeError(f'Expected one debug editor APK, found {len(apks)}')
    abi = adb('shell', 'getprop', 'ro.product.cpu.abilist').stdout.decode().strip()
    native_bridge = adb('shell', 'getprop', 'ro.dalvik.vm.native.bridge').stdout.decode().strip()
    notice('Android emulator ABI', f'ABIs: {abi}; native bridge: {native_bridge}')
    if 'arm64-v8a' not in abi:
        raise RuntimeError('Emulator does not advertise ARM64 translation; the bundled engine is ARM64-only')
    adb('install', '--abi', 'arm64-v8a', '-r', str(apks[0]), timeout=180)
    pkg = 'org.godotengine.editor.v4.debug'
    adb('shell', 'wm', 'size', '1280x800')
    adb('shell', 'wm', 'density', '160')
    adb('shell', 'appops', 'set', pkg, 'MANAGE_EXTERNAL_STORAGE', 'allow', check=False)
    adb('logcat', '-G', '16M', check=False)
    adb('logcat', '-c')
    adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1')
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        pid = adb('shell', 'pidof', pkg, check=False).stdout.decode().strip()
        if pid:
            EDITOR_PID = pid.split()[0]
            break
        time.sleep(1)
    else:
        raise RuntimeError('Editor process did not start')
    # Process presence is not enough: wait for visible rendering, not the solid
    # startup surface. This still cannot identify a particular UI without OCR.
    deadline = time.monotonic() + 180
    image = None; colors = 0; top_colors = 0
    while time.monotonic() < deadline:
        time.sleep(5)
        if not adb('shell', 'pidof', pkg, check=False).stdout.strip():
            raise RuntimeError('Editor process exited during initialization')
        image = Image.open(io.BytesIO(adb('exec-out', 'screencap', '-p').stdout)).convert('RGB')
        sample = image.crop((0, 0, image.width, int(image.height * 0.93))).resize((160, 100))
        colors = len({(r >> 4, g >> 4, b >> 4) for r, g, b in sample.getdata()})
        top = sample.crop((0, 0, sample.width, 20))
        top_colors = len({(r >> 4, g >> 4, b >> 4) for r, g, b in top.getdata()})
        if colors >= 24 and top_colors >= 8:
            break
    if colors < 24 or top_colors < 8:
        raise RuntimeError(f'Editor did not render beyond its startup screen ({colors} overall, {top_colors} top color buckets)')
    focus = adb('shell', 'dumpsys', 'activity', 'activities').stdout.decode(errors='replace')
    lines = [line.strip() for line in focus.splitlines() if 'mResumedActivity' in line or 'topResumedActivity' in line]
    if not any(pkg in line for line in lines):
        raise RuntimeError('Editor activity was not foreground when image was captured')
    notice('Android editor foreground', ' | '.join(lines)[:900])
    # A disposable local project on the emulator; do not alter user files.
    with tempfile.TemporaryDirectory() as folder:
        project = Path(folder) / 'RedotImport'; project.mkdir()
        (project / 'project.godot').write_text('config_version=5\n[application]\nconfig/name="Android Import Audit"\nrun/main_scene="res://scenes/main.tscn"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/audit/plugin.cfg")\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n')
        (project / 'scenes').mkdir(); (project / 'scenes/main.tscn').write_text('[gd_scene format=3]\n[node name="Main" type="Node2D"]\n')
        (project / 'addons/audit').mkdir(parents=True)
        (project / 'addons/audit/plugin.cfg').write_text('[plugin]\nname="Android Import Audit"\ndescription="test only"\nauthor="test"\nversion="1"\nscript="plugin.gd"\n')
        (project / 'addons/audit/plugin.gd').write_text('@tool\nextends EditorPlugin\nfunc _enter_tree() -> void:\n\tprint("ANDROID_IMPORT_EDITOR_READY " + ProjectSettings.globalize_path("res://"))\n')
        adb('push', str(project), '/sdcard/', timeout=90)
    # Open Import in the project manager to investigate the local-folder flow.
    dismiss_unrelated_anr()
    adb('shell', 'input', 'tap', '130', '68')
    time.sleep(5)
    # File dialog path field, then Select Current Folder.
    adb('shell', 'input', 'tap', '400', '100')
    adb('shell', 'input', 'keycombination', '113', '29')
    adb('shell', 'input', 'text', '/storage/emulated/0/RedotImport')
    adb('shell', 'input', 'keyevent', '66')
    time.sleep(3)
    adb('shell', 'input', 'tap', '816', '672')
    time.sleep(5)
    # Import Existing Project, with Edit Now checked. The plugin can only
    # report success once the editor opens this specific source directory.
    adb('shell', 'input', 'tap', '739', '507')
    deadline = time.monotonic() + 180
    logs = ''
    while time.monotonic() < deadline:
        time.sleep(3)
        logs = adb('logcat', '-d', '-s', 'redot:V', 'godot:V', 'Godot:V', '*:S', check=False).stdout.decode(errors='replace')
        if 'ANDROID_IMPORT_EDITOR_READY /storage/emulated/0/RedotImport/' in logs:
            break
    else:
        raise RuntimeError('Imported Android project did not open and report its source path')
    scene = adb('shell', 'cat', '/sdcard/RedotImport/scenes/main.tscn').stdout.decode()
    if scene != '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n':
        raise RuntimeError('Source project scene changed or is missing')
    image = Image.open(io.BytesIO(adb('exec-out', 'screencap', '-p').stdout)).convert('RGB')
    image.thumbnail((960, 600))
    buf = io.BytesIO(); image.save(buf, format='JPEG', quality=18)
    data = base64.b64encode(buf.getvalue()).decode('ascii')
    for i in range(0, min(len(data), 35000), 3500):
        print(f'::notice title=ANDROID_PROBE_{i//3500:02d}::{data[i:i+3500]}')
    notice('Android local project import', 'The real Android editor imported a local folder and its test EditorPlugin reported the original project path; a nested scene remained intact. Android 15 x86 emulator, ARM translation, software graphics; not a physical-device, MCP or network-drive test.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        try:
            image = Image.open(io.BytesIO(adb('exec-out', 'screencap', '-p').stdout)).convert('RGB')
            image.thumbnail((960, 600))
            buf = io.BytesIO(); image.save(buf, format='JPEG', quality=15)
            data = base64.b64encode(buf.getvalue()).decode('ascii')
            for i in range(0, min(len(data), 35000), 3500):
                print(f'::warning title=ANDROID_FAILURE_{i//3500:02d}::{data[i:i+3500]}', flush=True)
        except Exception:
            pass
        if EDITOR_PID:
            logs = adb('logcat', '-d', '--pid', EDITOR_PID, check=False).stdout.decode(errors='replace')
            relevant = [line for line in logs.splitlines() if re.search(r'godot|redot|vulkan|opengl|egl|error|fatal|crash|render|denied', line, re.I)]
            notice('Android editor logs', ' | '.join(relevant[-25:])[-3800:].replace('%', '%25'))
        logs = adb('logcat', '-b', 'crash', '-d', check=False).stdout.decode(errors='replace')
        if logs.strip():
            notice('Android crash logs', logs[-3600:].replace('%', '%25'))
        print(f'::error title=Android runtime probe::{str(exc).replace("%", "%25")}', file=sys.stderr, flush=True)
        raise
