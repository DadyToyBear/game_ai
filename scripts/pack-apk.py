#!/usr/bin/env python3
"""Дописывает classes.dex в APK, собранный aapt2.

Использование:
    python3 scripts/pack-apk.py base.apk classes.dex out.apk [--assets ПАПКА]

aapt2 link уже уложил манифест, resources.arsc и (если задан -A) ассеты.
Здесь базовый APK переупаковывается заново и в него добавляется classes.dex,
без которого Android не установит приложение.
"""
import sys
import zipfile


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    base, dex, out = argv[1], argv[2], argv[3]

    with zipfile.ZipFile(base) as src:
        entries = [(item, src.read(item.filename)) for item in src.infolist()]

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for item, data in entries:
            dst.writestr(item, data)
        dst.write(dex, "classes.dex")

    names = zipfile.ZipFile(out).namelist()
    missing = [n for n in ("AndroidManifest.xml", "resources.arsc", "classes.dex") if n not in names]
    if missing:
        print(f"в APK не хватает: {', '.join(missing)}", file=sys.stderr)
        return 1
    if not any(n.startswith("assets/public/index.html") for n in names):
        print("в APK нет assets/public/index.html", file=sys.stderr)
        return 1

    print(f"    файлов в APK: {len(names)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
