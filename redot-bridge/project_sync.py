"""Explicit local project snapshots, never an automatic two-way merge."""
import io
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import threading
import uuid
import zipfile
import zlib

MAX_ARCHIVE = 128 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_ENTRIES = 10000
EXCLUDED = {'.git', '.godot'}
WINDOWS_RESERVED = {'con', 'prn', 'aux', 'nul', *(f'com{i}' for i in range(1, 10)), *(f'lpt{i}' for i in range(1, 10))}


class SnapshotError(ValueError):
    pass


def valid_path(name):
    if not name or name.startswith('/') or '\\' in name or '\x00' in name:
        raise SnapshotError('Unsafe archive path')
    if name.endswith('/'):
        name = name[:-1]
    if not name:
        raise SnapshotError('Empty archive path')
    parts = name.split('/')
    for part in parts:
        if (not part or part in ('.', '..') or any(c in part for c in ':<>"|?*') or part[-1:] in ('.', ' ')
                or any(ord(c) < 32 for c in part) or part.split('.')[0].casefold() in WINDOWS_RESERVED):
            raise SnapshotError('Unsafe or non-portable archive path')
    return PurePosixPath(*parts)


def ignored(path):
    return any(part.casefold() in EXCLUDED for part in path.parts)


def pack_project(project):
    root = Path(project)
    if root.is_symlink() or not root.is_dir() or not (root / 'project.godot').is_file():
        raise SnapshotError('Directory must be a non-symlink Redot project')
    root = root.resolve()
    out = io.BytesIO()
    total = count = 0
    seen = set()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, allowZip64=False) as archive:
        for current, dirs, files in os.walk(root, followlinks=False):
            current = Path(current)
            dirs.sort(); files.sort()
            for dirname in dirs[:]:
                child = current / dirname
                rel = PurePosixPath(child.relative_to(root).as_posix())
                if ignored(rel):
                    dirs.remove(dirname)
                elif child.is_symlink():
                    raise SnapshotError('Symlinks are not supported in project snapshots')
                else:
                    # Redot's project installer creates directories only for ZIP
                    # directory entries; file entries alone do not create parents.
                    valid_path(str(rel))
                    key = str(rel).casefold()
                    if key in seen:
                        raise SnapshotError('Duplicate or case-conflicting paths')
                    seen.add(key)
                    count += 1
                    if count > MAX_ENTRIES:
                        raise SnapshotError('Project exceeds snapshot size or file limit')
                    archive.writestr(str(rel) + '/', b'')
                    if out.tell() > MAX_ARCHIVE:
                        raise SnapshotError('Compressed snapshot exceeds 128 MiB')
            for name in files:
                src = current / name
                rel = valid_path(src.relative_to(root).as_posix())
                if ignored(rel):
                    continue
                if src.is_symlink() or not src.is_file():
                    raise SnapshotError('Symlinks and special files are not supported')
                key = str(rel).casefold()
                if key in seen:
                    raise SnapshotError('Duplicate or case-conflicting paths')
                seen.add(key)
                before = src.stat()
                if before.st_size > MAX_FILE:
                    raise SnapshotError('Project contains a file larger than 64 MiB')
                total += before.st_size; count += 1
                if total > MAX_TOTAL or count > MAX_ENTRIES:
                    raise SnapshotError('Project exceeds snapshot size or file limit')
                data = src.read_bytes()
                after = src.stat()
                if len(data) != before.st_size or (after.st_size, after.st_mtime_ns) != (before.st_size, before.st_mtime_ns):
                    raise SnapshotError('A project file changed during snapshot; save and try again')
                archive.writestr(str(rel), data)
                if out.tell() > MAX_ARCHIVE:
                    raise SnapshotError('Compressed snapshot exceeds 128 MiB')
    result = out.getvalue()
    if len(result) > MAX_ARCHIVE:
        raise SnapshotError('Compressed snapshot exceeds 128 MiB')
    return result


def import_snapshot(data, project):
    if len(data) > MAX_ARCHIVE:
        raise SnapshotError('Compressed snapshot exceeds 128 MiB')
    root = Path(project)
    if root.is_symlink() or not root.is_dir() or not (root / 'project.godot').is_file():
        raise SnapshotError('Target project is not configured')
    root = root.resolve()
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, OSError) as exc:
        raise SnapshotError('Invalid ZIP file') from exc
    with archive:
        entries = archive.infolist()
        if len(entries) > MAX_ENTRIES:
            raise SnapshotError('Too many archive entries')
        paths = []
        total = 0
        seen = set()
        for info in entries:
            # ZipInfo.filename is normalized by Python: on Windows backslashes
            # become slashes, and on every platform NUL truncates the name.
            # Validate the original central-directory name before that happens.
            p = valid_path(info.orig_filename)
            mode = info.external_attr >> 16
            if stat.S_ISLNK(mode) or (mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise SnapshotError('Links and special files are not supported')
            if info.flag_bits & 1:
                raise SnapshotError('Encrypted ZIP files are not supported')
            key = str(p).casefold()
            if key in seen:
                raise SnapshotError('Duplicate or case-conflicting paths')
            seen.add(key)
            if info.file_size > MAX_FILE:
                raise SnapshotError('A file exceeds 64 MiB')
            total += info.file_size
            if total > MAX_TOTAL:
                raise SnapshotError('Unpacked snapshot exceeds 256 MiB')
            paths.append((info, p))
        # Godot's Download Project Source typically wraps files in one folder.
        if any(str(p) == 'project.godot' and not info.is_dir() for info, p in paths):
            prefix = ()
        else:
            candidates = [p for info, p in paths if len(p.parts) == 2 and p.name == 'project.godot' and not info.is_dir()]
            if len(candidates) != 1:
                raise SnapshotError('ZIP must contain one project.godot at root or in a single top-level folder')
            prefix = (candidates[0].parts[0],)
        imported = []
        relative_seen = set()
        for info, p in paths:
            if prefix and p.parts[:1] != prefix:
                raise SnapshotError('ZIP contains files outside the project folder')
            parts = p.parts[len(prefix):]
            if not parts:
                continue
            rel = PurePosixPath(*parts)
            if ignored(rel):
                continue
            key = str(rel).casefold()
            if key in relative_seen:
                raise SnapshotError('Duplicate or case-conflicting paths')
            relative_seen.add(key)
            imported.append((info, rel))
        if not any(str(rel) == 'project.godot' and not info.is_dir() for info, rel in imported):
            raise SnapshotError('ZIP has no project.godot')
        parent = root.parent
        stage = Path(tempfile.mkdtemp(prefix='.redot-import-', dir=parent))
        destination = parent / (root.name + '-web-import-' + uuid.uuid4().hex[:12])
        try:
            for info, rel in imported:
                target = stage.joinpath(*rel.parts)
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info) as src, target.open('xb') as dst:
                    copied = 0
                    while True:
                        chunk = src.read(1024 * 1024)
                        if not chunk:
                            break
                        copied += len(chunk)
                        if copied > info.file_size or copied > MAX_FILE:
                            raise SnapshotError('Archive entry exceeds declared size')
                        dst.write(chunk)
                    if copied != info.file_size:
                        raise SnapshotError('Truncated archive entry')
            if destination.exists():
                raise SnapshotError('Import destination already exists')
            os.rename(stage, destination)
        except (zipfile.BadZipFile, zlib.error, EOFError, NotImplementedError, RuntimeError) as exc:
            shutil.rmtree(stage, ignore_errors=True)
            raise SnapshotError('Invalid or unsupported ZIP entry') from exc
        except (Exception, KeyboardInterrupt):
            shutil.rmtree(stage, ignore_errors=True)
            raise
    return destination


class RegistryError(ValueError):
    pass


def _inspect(path):
    if not isinstance(path, str) or not path or len(path) > 4096 or any(ord(c) < 32 for c in path):
        raise RegistryError('Enter an absolute directory path')
    root = Path(path)
    if not root.is_absolute():
        raise RegistryError('Enter an absolute directory path')
    try:
        root = root.resolve(strict=True)
        stat = root.stat()
        if not root.is_dir() or not (root / 'project.godot').is_file():
            raise RegistryError('Directory must contain project.godot')
    except (OSError, RuntimeError) as exc:
        raise RegistryError('Directory is unavailable or inaccessible') from exc
    return root, (stat.st_dev, stat.st_ino)


class ProjectRegistry:
    def __init__(self):
        self.lock = threading.RLock()
        self.projects = {}

    def add(self, path):
        root, identity = _inspect(path)
        with self.lock:
            for key, (existing, old_identity) in self.projects.items():
                # A samefile check recognizes aliases where the OS exposes the
                # same identity. Never trust zero inode values from a filesystem.
                same_path = os.path.normcase(str(root)) == os.path.normcase(str(existing))
                same_identity = bool(identity[1] and old_identity[1] and identity == old_identity)
                if same_path or same_identity:
                    if identity != old_identity:
                        raise RegistryError('Directory changed since registration; remove and add it again')
                    return self._info(key, existing), False
            if len(self.projects) >= 100:
                raise RegistryError('Project list is full')
            key = uuid.uuid4().hex
            self.projects[key] = (root, identity)
            return self._info(key, root), True

    @staticmethod
    def _info(key, root):
        return {'id': key, 'name': root.name or str(root), 'path': str(root)}

    def list(self):
        with self.lock:
            return [self._info(key, root) for key, (root, _) in self.projects.items()]

    def remove(self, key):
        with self.lock:
            return self.projects.pop(key, None) is not None

    def get(self, key):
        with self.lock:
            entry = self.projects.get(key)
            if entry is None:
                raise RegistryError('Project is not connected')
            root, old_identity = entry
            current, identity = _inspect(str(root))
            if current != root or identity != old_identity:
                raise RegistryError('Directory changed since registration; remove and add it again')
            return root
