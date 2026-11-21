#!/usr/bin/env python3
"""Inspect generated APKs without installing them or claiming device compatibility."""
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path


def inspect(apk, aapt, apksigner):
    badging = subprocess.check_output([aapt, 'dump', 'badging', str(apk)], text=True)
    signatures = subprocess.run([apksigner, 'verify', '--print-certs', str(apk)], text=True, capture_output=True)
    with zipfile.ZipFile(apk) as archive:
        native = sorted({x.split('/')[1] for x in archive.namelist() if x.startswith('lib/') and x.endswith('.so') and len(x.split('/')) >= 3})
    package = re.search(r"^package: name='([^']+)'", badging, re.M)
    minimum = re.search(r"^sdkVersion:'([^']+)'", badging, re.M)
    target = re.search(r"^targetSdkVersion:'([^']+)'", badging, re.M)
    return {'file': apk.name, 'package': package.group(1) if package else None,
            'min_sdk': minimum.group(1) if minimum else None, 'target_sdk': target.group(1) if target else None,
            'native_abis': native, 'internet_permission': "name='android.permission.INTERNET'" in badging,
            'launchable_activity': 'launchable-activity:' in badging,
            'signature_verified': signatures.returncode == 0}


def main():
    root, aapt, signer = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    apks = sorted(root.glob('android_editor-android-*.apk'))
    if not apks:
        raise SystemExit('No APKs found')
    results = [inspect(apk, aapt, signer) for apk in apks]
    print(json.dumps(results, ensure_ascii=False, indent=2))
    for item in results:
        print('::notice title=Android APK inspection::' + json.dumps(item, ensure_ascii=True))
    if not any(x['signature_verified'] and x['internet_permission'] and x['launchable_activity'] and 'arm64-v8a' in x['native_abis'] for x in results):
        raise SystemExit('No signed, launchable ARM64 APK with INTERNET permission found')


if __name__ == '__main__':
    main()
