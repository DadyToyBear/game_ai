#!/usr/bin/env python3
"""Exercise the Godot logger and HTTP uploader with a loopback test receiver."""
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SECRET = 'fake-secret-012345678901234567890123456789'
PROJECT = Path(__file__).resolve().parent
received = []


class Receiver(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length)
        if self.path != '/api/logs' or self.headers.get('Authorization') != 'Bearer ' + SECRET:
            self.send_response(401)
            self.end_headers()
            return
        received.append(json.loads(body))
        self.send_response(204)
        self.end_headers()


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        command = [sys.argv[1], '--headless', '--path', str(PROJECT), '--script', 'res://upload_smoke.gd', '--', f'--test-port={server.server_port}']
        result = subprocess.run(command, text=True, capture_output=True, timeout=20)
        if result.returncode:
            raise RuntimeError('Redot upload smoke test failed: ' + result.stdout + result.stderr)
        entries = [entry for payload in received if payload.get('source') == 'game' for entry in payload.get('entries', [])]
        if not any('upload-smoke-marker' in entry.get('message', '') and '[bridge secret]' in entry.get('message', '') for entry in entries):
            raise AssertionError('No redacted test log received')
        if any(SECRET in entry.get('message', '') for entry in entries):
            raise AssertionError('The bridge token leaked into an uploaded log')
        print('Redot logger uploaded a redacted test log over HTTP')
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


if __name__ == '__main__':
    main()
