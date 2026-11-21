#!/usr/bin/env python3
"""Verify the shipped Windows launcher on a disposable CI machine."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryFile(mode='w+', encoding='utf-8', errors='replace') as log:
    proc = subprocess.Popen(['cmd', '/c', 'start.cmd'], cwd=root, stdout=log, stderr=subprocess.STDOUT,
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    try:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f'Launcher exited early ({proc.returncode}); check prerequisites and port')
            log.flush(); log.seek(0); output = log.read()
            match = re.search(r'Editor process ID: (\d+)', output)
            try:
                with urllib.request.urlopen('http://127.0.0.1:8765/project-open.html', timeout=2) as r:
                    project_page = r.read()
                with urllib.request.urlopen('http://127.0.0.1:8765/editor/godot.editor.html', timeout=2) as r:
                    editor_page = r.read()
                if match and re.search(r'\b[0-9a-f]{64}\b', output) and b'project-open' in project_page and b'godot.editor' in editor_page:
                    pid = int(match.group(1))
                    running = subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/NH'], capture_output=True, text=True, check=True).stdout
                    if str(pid) not in running:
                        raise RuntimeError('Launched editor process exited early')
                    break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(1)
        else:
            raise TimeoutError('Launcher did not start both pages and an editor process')
        print('::notice title=Windows bundle launcher::Launcher started an editor, generated a secret, and served both pages.')
    finally:
        # This runs only in a disposable CI environment; normal users close the editor themselves.
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True, timeout=20, check=False)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.wait(timeout=10)
