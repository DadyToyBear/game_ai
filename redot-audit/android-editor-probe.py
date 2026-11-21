#!/usr/bin/env python3
"""Diagnostic probe: start the bundled ARM editor on an Android emulator.

A running process alone is not a project-import, Play or device test.
"""
import base64
import io
import re
import subprocess
import sys
import time
from pathlib import Path
from PIL import Image


def adb(*args, check=True, timeout=90):
    return subprocess.run(['adb', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check, timeout=timeout)


def notice(title, value):
    print(f'::notice title={title}::{value.replace(chr(10), " ")}', flush=True)


def main():
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
    adb('logcat', '-c')
    adb('shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1')
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if adb('shell', 'pidof', pkg, check=False).stdout.strip():
            break
        time.sleep(1)
    else:
        raise RuntimeError('Editor process did not start')
    # Process presence is not enough: wait for visible rendering, not the solid
    # startup surface. This still cannot identify a particular UI without OCR.
    deadline = time.monotonic() + 180
    image = None; colors = 0
    while time.monotonic() < deadline:
        time.sleep(5)
        if not adb('shell', 'pidof', pkg, check=False).stdout.strip():
            raise RuntimeError('Editor process exited during initialization')
        image = Image.open(io.BytesIO(adb('exec-out', 'screencap', '-p').stdout)).convert('RGB')
        sample = image.crop((0, 0, image.width, int(image.height * 0.93))).resize((160, 100))
        colors = len({(r >> 4, g >> 4, b >> 4) for r, g, b in sample.getdata()})
        if colors >= 24:
            break
    if colors < 24:
        raise RuntimeError(f'Editor remained blank after initialization ({colors} color buckets)')
    focus = adb('shell', 'dumpsys', 'activity', 'activities').stdout.decode(errors='replace')
    lines = [line.strip() for line in focus.splitlines() if 'mResumedActivity' in line or 'topResumedActivity' in line]
    if not any(pkg in line for line in lines):
        raise RuntimeError('Editor activity was not foreground when image was captured')
    notice('Android editor foreground', ' | '.join(lines)[:900])
    image.thumbnail((960, 600))
    buf = io.BytesIO(); image.save(buf, format='JPEG', quality=18)
    data = base64.b64encode(buf.getvalue()).decode('ascii')
    for i in range(0, min(len(data), 35000), 3500):
        print(f'::notice title=ANDROID_PROBE_{i//3500:02d}::{data[i:i+3500]}')
    notice('Android runtime probe', 'Process remained alive on an ARM-translating emulator. A process/screenshot alone does not prove project import, editor functionality, or real-device behavior.')


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
        logs = adb('logcat', '-d', '-t', '5000', check=False).stdout.decode(errors='replace')
        relevant = [line for line in logs.splitlines() if re.search(r'godot|redot|fatal|crash|linker|libc|ndk_translation', line, re.I)]
        for i, line in enumerate(relevant[-20:]):
            notice(f'Android diagnostic {i:02d}', line[:1000].replace('%', '%25'))
        print(f'::error title=Android runtime probe::{str(exc).replace("%", "%25")}', file=sys.stderr, flush=True)
        raise
