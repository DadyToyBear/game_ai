import base64
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bridge
import project_sync

TOKEN = 'abc0123456789' * 4


def make_zip(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            z.writestr(name, data)
    return out.getvalue()


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'game'
        self.root.mkdir()
        (self.root / 'project.godot').write_text('[application]\nconfig/name="Original"\n')
        (self.root / 'player.gd').write_text('extends Node\n')
        (self.root / '.godot').mkdir()
        (self.root / '.godot' / 'cache').write_text('cache')
        (self.root / '.git').mkdir()
        (self.root / '.git' / 'secret').write_text('do not export')
        self.store = bridge.FrameStore()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.handler_for(self.store, TOKEN, project_dir=self.root))
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.worker.join(); self.tmp.cleanup()

    def request(self, path, data=None, token=TOKEN):
        headers = {'Authorization': 'Bearer ' + token}
        if data is not None:
            headers['Content-Type'] = 'application/zip'
        return urllib.request.urlopen(urllib.request.Request(self.url + path, data=data, headers=headers), timeout=5)

    def test_export_and_import_never_overwrites_project(self):
        with self.request('/api/project/export') as response:
            self.assertEqual(response.headers.get_content_type(), 'application/zip')
            packed = response.read()
        with zipfile.ZipFile(io.BytesIO(packed)) as z:
            self.assertEqual(set(z.namelist()), {'project.godot', 'player.gd'})
        new_zip = make_zip([('WebProject/project.godot', 'web version'), ('WebProject/player.gd', 'extends Sprite2D\n'), ('WebProject/.godot/cache', 'skip')])
        with self.request('/api/project/import', new_zip) as response:
            self.assertEqual(response.status, 201)
            dest = Path(json.load(response)['imported_to'])
        self.assertNotEqual(dest, self.root)
        self.assertEqual(dest.parent, self.root.parent)
        self.assertEqual((dest / 'project.godot').read_text(), 'web version')
        self.assertEqual((self.root / 'project.godot').read_text(), '[application]\nconfig/name="Original"\n')
        self.assertFalse((dest / '.godot').exists())

    def test_mcp_export_import_and_auth(self):
        with self.assertRaises(urllib.error.HTTPError) as exc:
            self.request('/api/project/export', token='wrong')
        self.assertEqual(exc.exception.code, 401)
        export = bridge.mcp_response({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'project_snapshot_export'}}, self.url, TOKEN)
        resource = export['result']['content'][0]['resource']
        self.assertEqual(resource['mimeType'], 'application/zip')
        raw = base64.b64decode(resource['blob'])
        self.assertTrue(zipfile.is_zipfile(io.BytesIO(raw)))
        request = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'project_snapshot_import', 'arguments': {'zip_base64': resource['blob']}}}
        imported = bridge.mcp_response(request, self.url, TOKEN)
        dest = Path(json.loads(imported['result']['content'][0]['text'])['imported_to'])
        self.assertTrue((dest / 'project.godot').exists())
        request['params']['arguments']['zip_base64'] = 'not+valid%%%'
        self.assertTrue(bridge.mcp_response(request, self.url, TOKEN)['result']['isError'])

    def test_malicious_archives_do_not_create_any_project(self):
        bad = [
            [('project.godot', 'x'), ('../escaped', 'bad')],
            [('project.godot', 'x'), ('C:/evil', 'bad')],
            [('project.godot', 'x'), ('../project.godot', 'bad')],
            [('project.godot', 'x'), ('same.gd', 'a'), ('SAME.GD', 'b')],
            [('root/project.godot', 'x'), ('elsewhere/data', 'bad')],
            [('project.godot', 'x'), ('a\\b', 'bad')],
        ]
        for entries in bad:
            with self.subTest(entries=entries), self.assertRaises(project_sync.SnapshotError):
                project_sync.import_snapshot(make_zip(entries), self.root)
        self.assertEqual(sorted(p.name for p in self.root.parent.iterdir()), ['game'])
        self.assertFalse((self.root.parent / 'escaped').exists())

    def test_folder_registry_deduplicates_and_exports_without_writing(self):
        def post(endpoint, obj, token=TOKEN):
            headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
            request = urllib.request.Request(self.url + endpoint, data=json.dumps(obj).encode(), headers=headers)
            return urllib.request.urlopen(request, timeout=5)

        with self.assertRaises(urllib.error.HTTPError) as denied:
            self.request('/api/projects', token='wrong')
        self.assertEqual(denied.exception.code, 401)
        with self.assertRaises(urllib.error.HTTPError) as denied:
            post('/api/projects/add', {'path': str(self.root)}, token='wrong')
        self.assertEqual(denied.exception.code, 401)
        with self.request('/api/projects') as response:
            projects = json.load(response)['projects']
        self.assertEqual(len(projects), 1)  # --project-dir is registered once
        first = projects[0]['id']
        with post('/api/projects/add', {'path': str(self.root / '.' )}) as response:
            result = json.load(response)
            self.assertFalse(result['created'])
            self.assertEqual(result['project']['id'], first)
        alias = self.root.parent / 'alias'
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except (OSError, NotImplementedError):
            pass
        else:
            with post('/api/projects/add', {'path': str(alias)}) as response:
                result = json.load(response)
                self.assertFalse(result['created'])
                self.assertEqual(result['project']['id'], first)
        other = self.root.parent / 'mounted share' / 'game'
        other.mkdir(parents=True)
        (other / 'project.godot').write_text('network test')
        with post('/api/projects/add', {'path': str(other)}) as response:
            self.assertTrue((info := json.load(response))['created'])
            second = info['project']['id']
        with post('/api/projects/export', {'id': second}) as response:
            with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                self.assertEqual(archive.read('project.godot'), b'network test')
        with post('/api/projects/remove', {'id': second}) as response:
            self.assertEqual(response.status, 204)
        self.assertEqual((other / 'project.godot').read_text(), 'network test')
        with self.assertRaises(urllib.error.HTTPError):
            post('/api/projects/export', {'id': second})
        for path in ('relative/path', str(self.root.parent / 'missing'), '', 'https://example.com/project'):
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError):
                post('/api/projects/add', {'path': path})
        with self.request('/api/projects') as response:
            self.assertEqual(len(json.load(response)['projects']), 1)

    def test_registry_rejects_replaced_directory(self):
        registry = project_sync.ProjectRegistry()
        info, created = registry.add(str(self.root))
        self.assertTrue(created)
        self.root.rename(self.root.parent / 'old')
        self.root.mkdir()
        (self.root / 'project.godot').write_text('replacement')
        with self.assertRaises(project_sync.RegistryError):
            registry.get(info['id'])
        with self.assertRaises(project_sync.RegistryError):
            registry.add(str(self.root))

    def test_symlinks_and_overlarge_entries_rejected(self):
        symlink = zipfile.ZipInfo('link')
        symlink.create_system = 3
        symlink.external_attr = 0o120777 << 16
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            z.writestr('project.godot', 'x'); z.writestr(symlink, '../outside')
        with self.assertRaises(project_sync.SnapshotError):
            project_sync.import_snapshot(out.getvalue(), self.root)
        with mock.patch.object(project_sync, 'MAX_FILE', 5):
            with self.assertRaises(project_sync.SnapshotError):
                project_sync.import_snapshot(make_zip([('project.godot', 'toolong')]), self.root)
            with self.assertRaises(project_sync.SnapshotError):
                project_sync.pack_project(self.root)
        link = self.root / 'link'
        try:
            link.symlink_to(self.root / 'player.gd')
        except (OSError, NotImplementedError):
            return
        with self.assertRaises(project_sync.SnapshotError):
            project_sync.pack_project(self.root)


if __name__ == '__main__':
    unittest.main()
