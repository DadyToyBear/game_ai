import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('prepare_multiagent_port', ROOT / 'redot-audit/prepare_multiagent_port.py')
port = importlib.util.module_from_spec(spec)
spec.loader.exec_module(port)


class MultiagentPortTests(unittest.TestCase):
    def target(self, root):
        target = Path(root) / 'multiagent'
        target.mkdir()
        (target / 'multiagent-mcp.py').write_text('# existing MCP\n')
        (target / 'dashboard.html').write_text('existing dashboard\n')
        return target

    def test_overlay_keeps_existing_files_and_manual_workflows(self):
        files = port.payload()
        self.assertIn(Path('redot-bridge/bridge.py'), files)
        self.assertIn(Path('redot-bridge/addons/redot_android_mcp/android_mcp.gd'), files)
        self.assertIn(Path('redot-windows-x64/start.cmd'), files)
        self.assertIn(Path('redot-linux-arm64/start.sh'), files)
        self.assertIn(Path('build-patches/fix_web_editor_stop.py'), files)
        self.assertEqual(files[Path('redot-bridge/bundle-workflow.yml')], files[Path('.github/workflows/redot-bundle.yml')])
        for path, data in files.items():
            if path.parts[:2] == ('.github', 'workflows'):
                self.assertNotIn(b'arena/b84b9c4f-game-ai', data, str(path))
                self.assertIn(b'on:\n  workflow_dispatch:\n', data, str(path))
        with tempfile.TemporaryDirectory() as tmp:
            target = self.target(tmp)
            checked = port.check_target(target, files)
            self.assertEqual(sorted(p.name for p in target.iterdir()), ['dashboard.html', 'multiagent-mcp.py'])
            port.apply(checked, files)
            self.assertEqual((target / 'dashboard.html').read_text(), 'existing dashboard\n')
            self.assertEqual((target / 'multiagent-mcp.py').read_text(), '# existing MCP\n')
            self.assertEqual((target / 'redot-bridge/bridge.py').read_bytes(), files[Path('redot-bridge/bridge.py')])
            self.assertIn('does NOT process', (target / 'REDOT-EDITOR-INTEGRATION.md').read_text())
            self.assertIn(Path('redot-bridge/task_transport.py'), files)
            with self.assertRaisesRegex(ValueError, 'overwrite'):
                port.check_target(target, files)

    def test_existing_file_or_symlink_fails_before_copy(self):
        files = port.payload()
        with tempfile.TemporaryDirectory() as tmp:
            target = self.target(tmp)
            (target / 'redot-bridge').mkdir()
            (target / 'redot-bridge/bridge.py').write_text('keep me')
            with self.assertRaisesRegex(ValueError, 'overwrite'):
                port.check_target(target, files)
            self.assertEqual((target / 'redot-bridge/bridge.py').read_text(), 'keep me')
            self.assertFalse((target / 'REDOT-EDITOR-INTEGRATION.md').exists())
        with tempfile.TemporaryDirectory() as tmp:
            target = self.target(tmp)
            (target / 'redot-bridge').symlink_to(Path(tmp), target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'symlinks'):
                port.check_target(target, files)

    def test_invalid_workflow_fails_closed(self):
        with self.assertRaises(ValueError):
            port.manual_workflow(b'on: push\n', Path('bad.yml'))


if __name__ == '__main__':
    unittest.main()
