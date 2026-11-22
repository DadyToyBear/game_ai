import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('prepare_dashboard', ROOT / 'redot-bridge/prepare_dashboard.py')
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
SOURCE = ROOT / 'multiagent-upstream/dashboard.html'
if not SOURCE.is_file():
    SOURCE = ROOT / 'dashboard.html'


class DashboardPatchTests(unittest.TestCase):
    def test_copy_and_guard_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'dashboard-enhanced.html'
            before = SOURCE.read_bytes()
            self.assertEqual(hashlib.sha256(before).hexdigest(), patch.EXPECTED)
            patch.generate(SOURCE, output)
            self.assertEqual(SOURCE.read_bytes(), before)
            content = output.read_text(encoding='utf8')
            self.assertIn("replace(/\\/dashboard-enhanced\\.html$/, '')", content)
            self.assertIn('id="chat-show-mcp"', content)
            self.assertIn("const AGENT_PREFIXES = ['chat-', 'dm-', 'assign-']", content)
            self.assertIn("document.getElementById('lv-play').onclick", content)
            for marker in ('id="task-allow-empty"', 'id="call-allow-empty"', 'Clear pending (disabled)',
                           'matched responses', "obj.error ? 'err' : 'received'", 'completion not verified'):
                self.assertIn(marker, content)
            with self.assertRaises(ValueError): patch.generate(SOURCE, output)
            self.assertEqual(output.read_text(encoding='utf8'), content)

    def test_changed_or_symlink_sources_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            modified = path / 'dashboard.html'; modified.write_text('new dashboard')
            output = path / 'dashboard-enhanced.html'
            with self.assertRaises(ValueError): patch.generate(modified, output)
            self.assertFalse(output.exists())
            with self.assertRaises(ValueError): patch.generate(SOURCE, path / 'dashboard.html')


if __name__ == '__main__':
    unittest.main()
