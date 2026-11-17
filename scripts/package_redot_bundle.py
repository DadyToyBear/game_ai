#!/usr/bin/env python3
"""Create a Redot/Godot migration ZIP without fishing or generated model assets.

Images are downscaled only inside the package, never in the repository; paths and
file extensions stay intact so the browser prototype remains usable. Animation
sprite sheets and the world-map background retain their original dimensions.

Usage:
  .venv/bin/python scripts/package_redot_bundle.py --output /tmp/redot_game_migration_pack.zip
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
BUNDLE_ROOT = "redot_game_migration_pack"
FISH_PATTERN = re.compile(r"fish|fisher|fishing|burbot|рыб|рыбал", re.IGNORECASE)
EXCLUDED_DIRS = {
    ".git", ".cache", ".venv", "node_modules", "__pycache__", "output",
    "coverage", "dist", "target", "build",
}
MODEL_EXTENSIONS = {".glb", ".gltf", ".fbx", ".obj", ".mtl", ".blend", ".dae"}


def is_fishing(path: Path) -> bool:
    return any(FISH_PATTERN.search(part) for part in path.parts)


def add_tree(files: set[Path], base: Path, *, omit_gifs: bool = True) -> None:
    if not base.exists():
        return
    for current, dirs, filenames in os.walk(base):
        current_path = Path(current)
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDED_DIRS and not FISH_PATTERN.search(d))
        for name in sorted(filenames):
            path = current_path / name
            rel = path.relative_to(ROOT)
            if is_fishing(rel) or path.suffix.lower() in MODEL_EXTENSIONS:
                continue
            if omit_gifs and path.suffix.lower() == ".gif" and path.name != "combat.gif":
                continue  # Keep tactical combat clips; omit redundant previews for other animation states.
            if path.is_file() and not path.is_symlink():
                files.add(path)


def sync_browser_runtime() -> Path:
    """Refresh the standalone runtime from the authoritative inline game script."""
    source = (ROOT / "viewer/game.html").read_text(encoding="utf-8")
    match = re.search(r"<script>([\s\S]*?)</script>", source)
    if not match:
        raise RuntimeError("Could not find the inline game runtime in viewer/game.html")
    target = ROOT / "build/_game_runtime.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(match.group(1).strip() + "\n", encoding="utf-8")
    return target


def collect_files(omit_gifs: bool = True) -> list[Path]:
    runtime = sync_browser_runtime()
    files: set[Path] = {runtime}
    for directory in ("assets", "data", "src", "viewer", "docs", "scripts", "tests"):
        add_tree(files, ROOT / directory, omit_gifs=omit_gifs)
    for relative in (
        "README.md", "package.json", "package-lock.json", "server.mjs",
        "build/_game_runtime.js", "scripts/package_redot_bundle.py",
    ):
        path = ROOT / relative
        if path.is_file() and not is_fishing(Path(relative)):
            files.add(path)
    return sorted(files, key=lambda p: p.relative_to(ROOT).as_posix().lower())


def payload_for(path: Path, max_dimension: int) -> tuple[bytes, bool]:
    """Return packaged bytes and whether image pixels were resized."""
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        return path.read_bytes(), False
    # Preserve world coordinates and sprite-sheet frame geometry exactly.
    if path.name == "overland_map.png" or "assets/animations/" in path.as_posix():
        return path.read_bytes(), False
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required to make the GitHub-friendly optimized archive. "
            "Run with .venv/bin/python or install Pillow in this environment."
        ) from exc

    with Image.open(path) as source:
        if max(source.size) <= max_dimension:
            return path.read_bytes(), False
        image = source.copy()
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        from io import BytesIO
        stream = BytesIO()
        suffix = path.suffix.lower()
        if suffix == ".png":
            image.save(stream, format="PNG", optimize=True, compress_level=9)
        else:
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            image.save(stream, format="JPEG", quality=88, optimize=True, progressive=True)
        return stream.getvalue(), True


def build_manifest(entries: list[tuple[Path, bytes, bool]], max_dimension: int) -> bytes:
    lines = [
        "Redot migration bundle file manifest",
        "Source: DadyToyBear/game_ai working tree",
        "Purpose: browser game source, data and non-fishing art for a staged Redot/Godot port.",
        f"Image optimization: longest edge <= {max_dimension}px where needed; world map and animation sprite sheets retain original dimensions.",
        "Tactical combat GIF clips are included; other redundant GIF previews are omitted in favor of sprite-sheet PNG and JSON data.",
        "Archive encryption: WinZip AES-256; obtain the password separately from the project owner.",
        "Original repository files are not modified by image optimization.",
        "",
        f"Files: {len(entries)}",
        "",
        "SHA-256  Size (bytes)  Resized  Path",
    ]
    for path, payload, resized in entries:
        digest = hashlib.sha256(payload).hexdigest()
        lines.append(f"{digest}  {len(payload):>12}  {'yes' if resized else 'no ':>7}  {path.relative_to(ROOT).as_posix()}")
    lines += [
        "",
        "Excluded: Git metadata, node_modules, virtual environments, caches, generated build output, non-combat GIF previews, model-file extensions, and every path matching the fishing-asset exclusion filter.",
        "The migration guide and prompt are under docs/.",
    ]
    return ("\n".join(lines) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Output AES-256 encrypted ZIP path")
    parser.add_argument("--max-image-dimension", type=int, default=384, help="Maximum long edge for packaged PNG/JPEG art (default: 384)")
    parser.add_argument("--keep-gif-previews", action="store_true", help="Also include non-combat GIF preview animations")
    args = parser.parse_args()
    if args.max_image_dimension < 128:
        parser.error("--max-image-dimension must be at least 128")

    password = os.environ.get("REDOT_BUNDLE_PASSWORD")
    if password is None:
        password = getpass.getpass("Set archive password (minimum 12 characters): ")
        confirmation = getpass.getpass("Confirm archive password: ")
        if password != confirmation:
            print("Passwords do not match.", file=sys.stderr)
            return 2
    if len(password) < 12:
        print("Archive password must be at least 12 characters.", file=sys.stderr)
        return 2
    try:
        import pyzipper
    except ImportError:
        print("AES-256 ZIP support requires pyzipper: python -m pip install pyzipper", file=sys.stderr)
        return 2

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    files = collect_files(omit_gifs=not args.keep_gif_previews)
    if not files:
        print("No files selected; refusing to create an empty bundle.", file=sys.stderr)
        return 2

    unsafe = [p for p in files if is_fishing(p.relative_to(ROOT))]
    unsafe_models = [p for p in files if p.suffix.lower() in MODEL_EXTENSIONS]
    if unsafe or unsafe_models:
        print("Excluded assets found; refusing to package:", file=sys.stderr)
        for path in unsafe + unsafe_models:
            print(path.relative_to(ROOT), file=sys.stderr)
        return 3

    try:
        entries: list[tuple[Path, bytes, bool]] = []
        for path in files:
            payload, resized = payload_for(path, args.max_image_dimension)
            entries.append((path, payload, resized))
    except (OSError, RuntimeError) as exc:
        print(f"Could not prepare bundle: {exc}", file=sys.stderr)
        return 4

    manifest = build_manifest(entries, args.max_image_dimension)
    password_bytes = password.encode("utf-8")
    with pyzipper.AESZipFile(
        output,
        "w",
        compression=pyzipper.ZIP_DEFLATED,
        compresslevel=6,
        encryption=pyzipper.WZ_AES,
        allowZip64=True,
    ) as archive:
        archive.setpassword(password_bytes)
        archive.setencryption(pyzipper.WZ_AES, nbits=256)
        for path, payload, _resized in entries:
            name = f"{BUNDLE_ROOT}/{path.relative_to(ROOT).as_posix()}"
            archive.writestr(name, payload)
        archive.writestr(f"{BUNDLE_ROOT}/BUNDLE_CONTENTS_SHA256.txt", manifest)

    with pyzipper.AESZipFile(output, "r") as archive:
        archive.setpassword(password_bytes)
        names = archive.namelist()
        unsafe_names = [
            name for name in names
            if is_fishing(Path(name)) or Path(name).suffix.lower() in MODEL_EXTENSIONS
        ]
        bad_zip = archive.testzip()
    if unsafe_names:
        output.unlink(missing_ok=True)
        print("Archive validation failed: excluded asset found.", file=sys.stderr)
        for name in unsafe_names:
            print(name, file=sys.stderr)
        return 5
    if bad_zip:
        output.unlink(missing_ok=True)
        print(f"Archive CRC check failed: {bad_zip}", file=sys.stderr)
        return 6

    size = output.stat().st_size
    resized_count = sum(resized for _, _, resized in entries)
    print(f"Created and validated (WinZip AES-256): {output}")
    print(f"Files: {len(entries)} + manifest; resized images: {resized_count}; size: {size:,} bytes ({size / (1024 * 1024):.1f} MiB)")
    print("Fishing/model asset scan: clean")
    print("Encrypted ZIP CRC test: passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
