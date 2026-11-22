#!/usr/bin/env python3
"""Launch the local bridge and a bundled native Redot without modifying projects."""
import argparse
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def launch(project=None):
    dotnet = shutil.which('dotnet')
    if not dotnet:
        raise RuntimeError('Redot Mono requires .NET 8; install the .NET 8 SDK first.')
    runtimes = subprocess.run([dotnet, '--list-runtimes'], capture_output=True, text=True, check=True).stdout
    if not any(line.startswith('Microsoft.NETCore.App 8.') for line in runtimes.splitlines()):
        raise RuntimeError('Redot Mono requires the .NET 8 runtime; install the .NET 8 SDK first.')
    editor_root = (ROOT / 'editor').resolve()
    editor = (ROOT / (ROOT / 'editor-path.txt').read_text(encoding='utf-8').strip()).resolve()
    if not editor.is_relative_to(editor_root) or not editor.is_file():
        raise RuntimeError('Bundled editor path is invalid or missing.')
    if project is not None:
        project = Path(project).resolve(strict=True)
        if not project.is_dir() or not (project / 'project.godot').is_file():
            raise RuntimeError('Project directory must contain project.godot.')
    env = os.environ.copy()
    env['REDOT_BRIDGE_ENABLED'] = '1'
    env['REDOT_BRIDGE_TOKEN'] = secrets.token_hex(32)
    args = [sys.executable, str(ROOT / 'redot-bridge/bridge.py'), 'serve', '--editor-dir', str(ROOT / 'web-editor')]
    if project is not None:
        args += ['--project-dir', str(project)]
    server = subprocess.Popen(args, env=env, cwd=ROOT)
    try:
        request = urllib.request.Request('http://127.0.0.1:8765/api/status', headers={'Authorization': 'Bearer ' + env['REDOT_BRIDGE_TOKEN']})
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if server.poll() is not None:
                raise RuntimeError('Bridge failed to start; port 8765 may already be in use.')
            try:
                with urllib.request.urlopen(request, timeout=1) as response:
                    if response.status == 200:
                        break
            except (OSError, urllib.error.URLError):
                time.sleep(0.1)
        else:
            raise RuntimeError('Bridge did not become ready on 127.0.0.1:8765.')
        # A distinct process group prevents Ctrl+C in this console from killing
        # an editor that may contain unsaved work. The user closes it normally.
        options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == 'nt' else {'start_new_session': True}
        editor_args = [str(editor)] + (['--editor', '--path', str(project)] if project else [])
        child = subprocess.Popen(editor_args, env=env, cwd=ROOT, **options)
        print('\nSecret for this local session (do not share):\n' + env['REDOT_BRIDGE_TOKEN'], flush=True)
        print('Editor process ID: ' + str(child.pid), flush=True)
        print('Game and chat: http://127.0.0.1:8765/workspace.html\nGame: http://127.0.0.1:8765/native.html\nWeb editor: http://127.0.0.1:8765/editor/godot.editor.html\nProjects: http://127.0.0.1:8765/project-open.html\nCtrl+C stops the bridge only. Save and close the editor normally.', flush=True)
        while server.poll() is None:
            time.sleep(0.5)
        raise RuntimeError('Bridge stopped unexpectedly; save your work in the editor.')
    except KeyboardInterrupt:
        print('\nStopping bridge. The editor remains open; save and close it normally.', flush=True)
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', nargs='?', help='optional path to a project folder')
    args = parser.parse_args()
    try:
        launch(args.project)
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as exc:
        print('Launch failed: ' + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
