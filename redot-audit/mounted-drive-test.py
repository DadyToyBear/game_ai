#!/usr/bin/env python3
"""Test the shared bridge registry against an already-mounted SMB test share."""
import io
import json
from pathlib import Path
import sys
import threading
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'redot-bridge'))
import bridge

TOKEN = 'test-only-secret-012345678901234567890123456789'


def main():
    mounted = Path(sys.argv[1]).absolute()
    server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.handler_for(bridge.FrameStore(), TOKEN))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    url = f'http://127.0.0.1:{server.server_port}'
    try:
        def post(endpoint, data):
            req = urllib.request.Request(url + endpoint, json.dumps(data).encode(), headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
            return urllib.request.urlopen(req, timeout=10)
        with post('/api/projects/add', {'path': str(mounted)}) as response:
            first = json.load(response)
        assert first['created'] is True
        with post('/api/projects/add', {'path': str(mounted) + '/.'}) as response:
            duplicate = json.load(response)
        assert duplicate['created'] is False
        assert duplicate['project']['id'] == first['project']['id']
        with post('/api/projects/export', {'id': first['project']['id']}) as response:
            with zipfile.ZipFile(io.BytesIO(response.read())) as z:
                assert set(z.namelist()) == {'project.godot', 'scene.gd'}
                assert z.read('scene.gd') == b'extends Node\n'
        with post('/api/projects/remove', {'id': first['project']['id']}) as response:
            assert response.status == 204
        assert (mounted / 'scene.gd').read_bytes() == b'extends Node\n'
        print('::notice title=SMB mounted project::Authenticated bridge registered and deduplicated a loopback CIFS mount, exported a snapshot and removed only the registry entry (Linux, read-only share).')
    finally:
        server.shutdown(); server.server_close(); worker.join()


if __name__ == '__main__':
    main()
