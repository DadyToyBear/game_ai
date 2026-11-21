import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipIf(os.name == 'nt', 'POSIX fixture; real Windows launcher is checked in Windows CI')
class DesktopLauncherTests(unittest.TestCase):
    def setUp(self):
        # Never interact with a real bridge already running on the developer's
        # machine; these fixtures intentionally exercise the default port.
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('127.0.0.1', 8765))
            except OSError:
                self.skipTest('Local bridge port is already in use')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bridge = self.root / 'redot-bridge'; self.bridge.mkdir()
        for name in ('bridge.py', 'project_sync.py', 'desktop_launcher.py'):
            shutil.copy(ROOT / name, self.bridge / name)
        shutil.copytree(ROOT / 'web', self.bridge / 'web')
        (self.root / 'web-editor').mkdir()
        (self.root / 'web-editor/godot.editor.html').write_text('<body></body>')
        (self.root / 'editor').mkdir()
        editor = self.root / 'editor/redot'
        editor.write_text('#!/bin/sh\nsleep 120\n')
        editor.chmod(0o755)
        (self.root / 'editor-path.txt').write_text('editor/redot\n')
        bindir = self.root / 'bin'; bindir.mkdir()
        dotnet = bindir / 'dotnet'
        dotnet.write_text('#!/bin/sh\necho "Microsoft.NETCore.App 8.0.0 [/tmp]"\n')
        dotnet.chmod(0o755)
        self.env = dict(os.environ, PATH=str(bindir) + os.pathsep + os.environ['PATH'])

    def launch(self, log):
        return subprocess.Popen([sys.executable, str(self.bridge / 'desktop_launcher.py')],
                                stdout=log, stderr=subprocess.STDOUT, env=self.env)

    def test_bridge_collision_does_not_open_editor(self):
        with socket.socket() as busy:
            busy.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            busy.bind(('127.0.0.1', 8765)); busy.listen()
            with tempfile.TemporaryFile(mode='w+') as log:
                process = self.launch(log)
                process.wait(timeout=20)
                log.seek(0); text = log.read()
                self.assertNotEqual(process.returncode, 0)
                self.assertNotIn('Editor process ID:', text)
                self.assertNotRegex(text, r'\b[0-9a-f]{64}\b')

    def test_ctrl_c_keeps_editor_running(self):
        editor_pid = None
        with tempfile.TemporaryFile(mode='w+') as log:
            process = self.launch(log)
            try:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    log.seek(0); text = log.read()
                    match = re.search(r'Editor process ID: (\d+)', text)
                    if match:
                        editor_pid = int(match.group(1)); break
                    if process.poll() is not None:
                        self.fail('Launcher exited before starting editor')
                    time.sleep(.1)
                self.assertIsNotNone(editor_pid)
                process.send_signal(signal.SIGINT)
                process.wait(timeout=10)
                self.assertEqual(process.returncode, 0)
                os.kill(editor_pid, 0)
            finally:
                if editor_pid is not None:
                    try:
                        os.killpg(editor_pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                if process.poll() is None:
                    process.kill(); process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
