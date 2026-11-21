#!/usr/bin/env python3
"""Stage the editor bridge beside an existing multiagent checkout without overwrites.

This copies components, not a working transport integration. Dry-run is the
 default; --apply modifies only the supplied checkout's working tree.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ('redot-bridge', 'redot-web', 'redot-android', 'redot-linux-arm64',
              'redot-windows-x64', 'redot-audit', 'build-patches', '.github/workflows')
MANUAL_ON = re.compile(r'(?m)^on:\n(?:  push:\n(?:    .*\n|      .*\n)*)?  workflow_dispatch:\n')
GUIDE = '''# Redot editor components alongside the multiagent bridge

These files were staged from DadyToyBear/game_ai. Existing dashboard, chat and
WebFTP components were not replaced. `redot-bridge/multiagent_mcp.py` exposes
chat and editor tools in one MCP stdio connection. The opt-in signed WebFTP
worker handles a separate task namespace for the new bridge; it does NOT process
legacy task files or chat_assign. The existing system uses its own WebSocket
bridge. The actual WebFTP server and original worker were not tested.

The .github/workflows/redot-*.yml workflows have manual triggers in this overlay
so they do not refer to the source repository's session branch or automatically
start costly builds. Run the Web or Android bundle workflow before tests that
need those artifacts, on the same branch. Existing CI links in the copied
README files describe the original game_ai repository, not this checkout.

Read redot-bridge/README.md and the platform READMEs. Web and Android are
standard builds, not confirmed Mono. Game frames and snapshots can contain
private project data. Do not expose the localhost bridge publicly or connect
it to a public writable task share. Network drives must already be mounted;
project snapshots are copies, not automatic file synchronization. Web Stop
and real video streaming are not established by this staging step. See the
combined MCP section of redot-bridge/README.md before enabling chat; never
connect it to an untrusted or publicly writable task share.
'''


def tracked_files():
    result = subprocess.run(['git', '-C', str(ROOT), 'ls-files', '-z', '--', *COMPONENTS],
                            check=True, stdout=subprocess.PIPE)
    return [Path(os.fsdecode(part)) for part in result.stdout.split(b'\0') if part]


def manual_workflow(data: bytes, path: Path) -> bytes:
    text = data.decode('utf-8')
    result, count = MANUAL_ON.subn('on:\n  workflow_dispatch:\n', text, count=1)
    if count != 1:
        raise ValueError(f'Unexpected workflow trigger layout: {path}')
    return result.encode('utf-8')


def payload():
    files = {}
    for relative in tracked_files():
        source = ROOT / relative
        if source.is_symlink() or not source.is_file():
            raise ValueError(f'Unsafe or missing source file: {relative}')
        data = source.read_bytes()
        if relative.parts[:2] == ('.github', 'workflows'):
            data = manual_workflow(data, relative)
        files[relative] = data
    # This is a documented copy of the bundle workflow; keep it consistent.
    files[Path('redot-bridge/bundle-workflow.yml')] = files[Path('.github/workflows/redot-bundle.yml')]
    files[Path('REDOT-EDITOR-INTEGRATION.md')] = GUIDE.encode('utf-8')
    return files


def check_target(target, files):
    if target.is_symlink() or not target.is_dir():
        raise ValueError('Target must be an existing non-symlink directory')
    target = target.resolve()
    if target == ROOT or ROOT in target.parents or target in ROOT.parents:
        raise ValueError('Target must be separate from the game_ai checkout')
    for marker in ('multiagent-mcp.py', 'dashboard.html'):
        p = target / marker
        if p.is_symlink() or not p.is_file():
            raise ValueError(f'Target does not look like the multiagent checkout: missing {marker}')
    conflicts = []
    for relative in files:
        p = target
        for part in relative.parts:
            p = p / part
            if p.is_symlink():
                conflicts.append(str(p.relative_to(target))); break
            if p == target / relative:
                if p.exists():
                    conflicts.append(str(relative))
            elif p.exists() and not p.is_dir():
                conflicts.append(str(p.relative_to(target))); break
    if conflicts:
        raise ValueError('Refusing to overwrite existing paths or follow symlinks: ' + ', '.join(sorted(set(conflicts))[:15]))
    return target


def apply(target, files):
    written = []
    made_dirs = []
    try:
        for relative, data in sorted(files.items()):
            dest = target / relative
            missing = []
            parent = dest.parent
            while not parent.exists():
                missing.append(parent); parent = parent.parent
            for directory in reversed(missing):
                directory.mkdir(); made_dirs.append(directory)
            # Exclusive create; any concurrent conflict aborts instead of overwriting.
            with dest.open('xb') as out:
                written.append(dest)
                out.write(data)
            src = ROOT / relative
            if src.exists() and os.access(src, os.X_OK):
                dest.chmod(dest.stat().st_mode | 0o111)
    except Exception:
        for path in reversed(written):
            path.unlink(missing_ok=True)
        for directory in reversed(made_dirs):
            try:
                directory.rmdir()
            except OSError:
                pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', type=Path)
    parser.add_argument('--apply', action='store_true', help='copy after checking for conflicts (default: preview only)')
    args = parser.parse_args()
    try:
        files = payload()
        target = check_target(args.target, files)
        print(f'{len(files)} files would be added to {target}; existing files will not be replaced.')
        if args.apply:
            apply(target, files)
            print('Copied. No transport integration or deployment was performed; read REDOT-EDITOR-INTEGRATION.md.')
        else:
            print('Preview only; no files written. This does not integrate the transports.')
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f'Cannot prepare overlay: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
