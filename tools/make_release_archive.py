#!/usr/bin/env python3
"""Собирает зашифрованный архив с ассетами для выкладки в GitHub Releases.

Пароль НЕ хранится в репозитории: он передаётся аргументом (или берётся из
переменной окружения CROWN_ARCHIVE_PASSWORD) и нигде не сохраняется.

Используется AES-256 (pyzipper), а не классический ZipCrypto: старый
«zip -e» ломается подбором тривиально.

Запуск:
  CROWN_ARCHIVE_PASSWORD='...' python3 tools/make_release_archive.py
  python3 tools/make_release_archive.py --password '...' --out dist
"""
import argparse
import os
import sys

import pyzipper

DEFAULT_PATHS = [
    "assets",
    "preview_walk",
    "index.html",
    "preview_units_cards.jpg",
    "preview_ui_battle.jpg",
    "preview_battle_backgrounds.jpg",
    "preview_walk_sheets.jpg",
    "preview_events.jpg",
    "tools",
    "README.md",
]
SKIP_DIRS = {"__pycache__", ".git", "_raw", "dist"}
SKIP_NAMES = {".DS_Store"}


def iter_files(root):
    if os.path.isfile(root):
        yield root
        return
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in sorted(filenames):
            if f in SKIP_NAMES:
                continue
            yield os.path.join(dirpath, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password", default=os.environ.get("CROWN_ARCHIVE_PASSWORD", ""))
    ap.add_argument("--out", default="dist")
    ap.add_argument("--name", default="crown_and_banner_assets.zip")
    args = ap.parse_args()

    if not args.password:
        print("Нужен пароль: --password или CROWN_ARCHIVE_PASSWORD", file=sys.stderr)
        return 2

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, args.name)

    files = []
    for p in DEFAULT_PATHS:
        if not os.path.exists(p):
            print(f"  ! нет {p}, пропуск")
            continue
        files.extend(iter_files(p))

    with pyzipper.AESZipFile(path, "w", compression=pyzipper.ZIP_DEFLATED,
                             encryption=pyzipper.WZ_AES) as zf:
        zf.setpassword(args.password.encode("utf-8"))
        zf.setencryption(pyzipper.WZ_AES, nbits=256)
        for f in files:
            zf.write(f, arcname=f)

    size = os.path.getsize(path)
    print(f"ok {path}: {len(files)} файлов, {size / 1024 / 1024:.1f} МБ "
          f"(AES-256, пароль не сохранён)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
