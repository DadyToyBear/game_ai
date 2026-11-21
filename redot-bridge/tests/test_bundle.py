import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('make_bundle', ROOT / 'make_bundle.py')
make_bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_bundle)


class BundleTests(unittest.TestCase):
    def test_add_bridge_without_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name in ('godot.editor.html', 'godot.editor.js', 'godot.editor.wasm'):
                (root / name).write_bytes(b'test editor')
            result = make_bundle.bundle_into(root)
            self.assertEqual(result, root / 'redot-bridge')
            self.assertTrue((result / 'bridge.py').is_file())
            self.assertTrue((result / 'project_sync.py').is_file())
            self.assertTrue((result / 'relay.py').is_file())
            self.assertTrue((result / 'requirements-relay.txt').is_file())
            self.assertTrue((result / 'relay-deploy/README.md').is_file())
            self.assertTrue((result / 'make_bundle.py').is_file())
            self.assertTrue((result / 'multiagent_mcp.py').is_file())
            self.assertTrue((result / 'task_transport.py').is_file())
            self.assertTrue((result / 'agent_presence.py').is_file())
            self.assertTrue((result / 'dashboard_presence_patch.js').is_file())
            self.assertTrue((result / 'prepare_dashboard.py').is_file())
            self.assertTrue((result / 'dashboard_chat_patch.js').is_file())
            self.assertTrue((result / 'multiagent_chat.py').is_file())
            self.assertTrue((result / 'opencode.multiagent.example.json').is_file())
            self.assertTrue((result / 'web/sync.html').is_file())
            self.assertTrue((result / 'addons/redot_local_bridge/plugin.cfg').is_file())
            self.assertIn('--editor-dir', (root / 'BRIDGE-START.md').read_text())
            run = subprocess.run([sys.executable, str(result / 'bridge.py'), '--help'], capture_output=True, text=True, timeout=10)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertIn('--project-dir', run.stdout)
            with self.assertRaises(ValueError):
                make_bundle.bundle_into(root)
            self.assertEqual((root / 'godot.editor.wasm').read_bytes(), b'test editor')

    def test_copy_multiagent_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d)
            (target / 'multiagent_chat.py').write_text('existing')
            with self.assertRaises(ValueError):
                make_bundle.copy_multiagent(target)
            self.assertEqual((target / 'multiagent_chat.py').read_text(), 'existing')
            self.assertFalse((target / 'multiagent_mcp.py').exists())

    def test_wrong_directory_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                make_bundle.bundle_into(d)
            self.assertFalse((Path(d) / 'redot-bridge').exists())


if __name__ == '__main__':
    unittest.main()
