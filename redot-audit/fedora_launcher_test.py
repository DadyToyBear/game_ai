#!/usr/bin/env python3
"""Exercise the shipped launcher and both browser routes on disposable Xvfb."""
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryFile(mode='w+', encoding='utf-8') as log:
    process = subprocess.Popen(['bash', 'start.sh'], cwd=root, stdout=log, stderr=subprocess.STDOUT,
                               env={**os.environ, 'LIBGL_ALWAYS_SOFTWARE': '1'}, start_new_session=True)
    try:
        end = time.monotonic() + 90
        text = ''
        while time.monotonic() < end:
            if process.poll() is not None:
                raise RuntimeError(f'Launcher exited early: {process.returncode}')
            log.flush(); log.seek(0); text = log.read()
            try:
                with urllib.request.urlopen('http://127.0.0.1:8765/project-open.html', timeout=2) as response:
                    project_html = response.read()
                with urllib.request.urlopen('http://127.0.0.1:8765/editor/godot.editor.html', timeout=2) as response:
                    editor_html = response.read()
                if re.search(r'\b[0-9a-f]{64}\b', text) and 'v26.3.rc.2.mono.official' in text and b'project-open' in project_html and b'godot.editor' in editor_html:
                    break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(1)
        else:
            raise TimeoutError('Launcher did not start the bridge and serve both browser pages')
        print('::notice title=Fedora ARM64 bundle launcher::Launcher generated a secret and served project and Web editor pages.')
    except Exception:
        log.flush(); log.seek(0)
        # Never print the launcher log: it contains the live secret.
        raise
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
