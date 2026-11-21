#!/usr/bin/env python3
"""Add the local bridge and snapshot tools to an unpacked Redot web-editor artifact."""
from pathlib import Path
import shutil
import sys
import tempfile

SOURCE = Path(__file__).resolve().parent
START = '''# Redot Web Editor + local bridge (experimental)

This bundle contains the Redot Web editor and an optional local bridge. Remote access requires a separately deployed experimental HTTPS relay; it is not enabled automatically. Live file synchronization and guaranteed add-on compatibility are not provided.

## Start on Windows

1. Close Redot, save and back up your project. In PowerShell, enter the unpacked bundle directory.
2. Run the commands below. Replace the example project path with your own directory containing project.godot. Do not share the generated secret.

```powershell
$env:REDOT_BRIDGE_ENABLED = '1'
$env:REDOT_BRIDGE_TOKEN = python -c "import secrets; print(secrets.token_hex(32))"
$env:REDOT_BRIDGE_TOKEN
python redot-bridge/bridge.py serve --editor-dir . --project-dir 'C:\\path\\to\\your\\project'
```

3. Open http://127.0.0.1:8765/sync.html and enter the secret locally. Export an explicit ZIP snapshot for Web Editor's Preload project ZIP. In Web Editor, save and use Project → Tools → Download Project Source, then import that ZIP in the sync page. Import creates a new sibling folder; it never merges into or overwrites the current project.
4. Open http://127.0.0.1:8765/editor/godot.editor.html for the local Web Editor. The project panel can prepare a ZIP copy from a browser-selected folder, a direct HTTPS ZIP URL, or a registered local/OS-mounted network directory on the bridge computer. After starting, confirm the automatically displayed Install Project: Preload dialog and choose a new destination. Browser data is not automatically synchronized. Use explicit snapshots; see the README for limits, CORS and trusted-archive warnings.
5. For native Redot game viewing and MCP instructions see redot-bridge/README.md. Those features require additional configuration. An automated Linux/Xvfb test passed; Windows, Android devices and your projects are not verified.

Snapshots may contain private files. Only .git and .godot directories are excluded. Do not upload snapshots without reviewing their contents.
'''


def copy_multiagent(destination):
    """Copy the combined MCP entry point and one upstream chat implementation."""
    destination = Path(destination)
    if not destination.is_dir() or destination.is_symlink():
        raise ValueError('Multiagent destination must be an existing non-symlink directory')
    candidates = (SOURCE / 'multiagent_chat.py', SOURCE.parent / 'multiagent-mcp.py',
                  SOURCE.parent / 'multiagent-upstream/multiagent-mcp.py')
    chat = next((path for path in candidates if path.is_file()), None)
    if chat is None:
        raise ValueError('Multiagent chat source not found')
    pairs = ((SOURCE / 'multiagent_mcp.py', destination / 'multiagent_mcp.py'),
             (SOURCE / 'task_transport.py', destination / 'task_transport.py'),
             (chat, destination / 'multiagent_chat.py'),
             (SOURCE / 'opencode.multiagent.example.json', destination / 'opencode.multiagent.example.json'))
    if any(target.exists() or target.is_symlink() for _, target in pairs):
        raise ValueError('Multiagent files already exist; refusing to overwrite')
    written = []
    try:
        for source, target in pairs:
            with source.open('rb') as src, target.open('xb') as out:
                written.append(target)
                shutil.copyfileobj(src, out)
    except Exception:
        for target in written:
            target.unlink(missing_ok=True)
        raise


def bundle_into(editor_dir):
    root = Path(editor_dir)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('The editor directory must be an existing, non-symlink directory')
    for filename in ('godot.editor.html', 'godot.editor.js', 'godot.editor.wasm'):
        if not (root / filename).is_file():
            raise ValueError(f'Missing editor file: {filename}')
    destination = root / 'redot-bridge'
    guide = root / 'BRIDGE-START.md'
    if destination.exists() or destination.is_symlink() or guide.exists() or guide.is_symlink():
        raise ValueError('Bridge or BRIDGE-START.md already exists; refusing to overwrite')
    stage = Path(tempfile.mkdtemp(prefix='.bridge-bundle-', dir=root))
    try:
        for name in ('bridge.py', 'project_sync.py', 'relay.py', 'requirements-relay.txt', 'make_bundle.py', 'README.md'):
            shutil.copy2(SOURCE / name, stage / name)
        for name in ('web', 'addons', 'relay-deploy'):
            shutil.copytree(SOURCE / name, stage / name)
        copy_multiagent(stage)
        stage.rename(destination)
        try:
            with guide.open('x', encoding='utf-8') as f:
                f.write(START)
        except Exception:
            shutil.rmtree(destination, ignore_errors=True)
            raise
    finally:
        if stage.exists():
            shutil.rmtree(stage, ignore_errors=True)
    return destination


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--copy-multiagent':
        try:
            copy_multiagent(sys.argv[2])
        except (ValueError, OSError) as exc:
            raise SystemExit(str(exc)) from exc
        return
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python make_bundle.py <unpacked-editor-directory> | --copy-multiagent <destination>')
    try:
        result = bundle_into(sys.argv[1])
    except (ValueError, OSError) as exc:
        raise SystemExit(str(exc)) from exc
    print(f'Bridge added: {result}. Read BRIDGE-START.md in the editor directory.')


if __name__ == '__main__':
    main()
