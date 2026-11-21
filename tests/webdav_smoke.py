"""Opt-in destructive WebDAV smoke test; only use a disposable test folder.

AURORA_DAV_URL=http://192.168.1.10:8080/dav/ AURORA_DAV_USER=... \
AURORA_DAV_PASSWORD=... python3 tests/webdav_smoke.py
"""
import base64
import os
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET


class WebDavSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = os.environ.get("AURORA_DAV_URL", "").rstrip("/") + "/"
        user, password = os.environ.get("AURORA_DAV_USER"), os.environ.get("AURORA_DAV_PASSWORD")
        if cls.base == "/" or not user or not password:
            raise unittest.SkipTest("Set AURORA_DAV_URL, AURORA_DAV_USER, AURORA_DAV_PASSWORD")
        auth = base64.b64encode((user + ":" + password).encode()).decode()
        cls.authorization = "Basic " + auth

    def request(self, method, path="", data=None, **headers):
        url = self.base + urllib.parse.quote(path, safe="/")
        req = urllib.request.Request(url, data=data, method=method,
                                     headers={"Authorization": self.authorization, **headers})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def test_file_and_directory_operations(self):
        folder = "aurora-test-" + uuid.uuid4().hex
        path = folder + "/"
        status, _ = self.request("MKCOL", path)
        self.assertEqual(status, 201)
        try:
            self.assertEqual(self.request("PUT", path + "one.txt", b"hello")[0], 201)
            self.assertEqual(self.request("GET", path + "one.txt"), (200, b"hello"))
            listing = self.request("PROPFIND", path, Depth="1")
            self.assertEqual(listing[0], 207)
            ET.fromstring(listing[1])
            dest = self.base + path + "two.txt"
            self.assertEqual(self.request("COPY", path + "one.txt", Destination=dest)[0], 201)
            self.assertEqual(self.request("COPY", path + "one.txt", Destination=dest, Overwrite="F")[0], 412)
            self.assertEqual(self.request("GET", path + "two.txt"), (200, b"hello"))
            target = self.base + path + "three.txt"
            self.assertEqual(self.request("MOVE", path + "two.txt", Destination=target)[0], 201)
            self.assertEqual(self.request("GET", path + "two.txt")[0], 404)
            self.assertEqual(self.request("GET", path + "three.txt"), (200, b"hello"))
            inside = self.base + path + "nested/"
            self.assertEqual(self.request("COPY", path, Destination=inside)[0], 403)
            other_host = "http://example.invalid/dav/escape"
            self.assertEqual(self.request("MOVE", path + "one.txt", Destination=other_host)[0], 400)
            self.assertEqual(self.request("PUT", path + "one.txt", b"new", **{"If-None-Match": "*"})[0], 412)
            self.assertEqual(self.request("GET", path + "one.txt"), (200, b"hello"))
        finally:
            self.request("DELETE", path)


if __name__ == "__main__":
    unittest.main()
