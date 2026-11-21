#!/usr/bin/env python3
"""Проверяет APK, собранный без Gradle (scripts/build-apk-local.sh).

Использование:
    python3 scripts/check-standalone-apk.py путь/к/app.apk

Что проверяется:
  • внутри zip есть AndroidManifest.xml, resources.arsc и classes.dex;
  • classes.dex действительно начинается с магии dex;
  • веб-часть лежит в assets/public/index.html;
  • есть блок подписи APK Signature Scheme v2;
  • в META-INF есть JAR-подпись (v1);
  • zip не повреждён.
Код возврата 0 — всё в порядке.
"""
import sys
import zipfile

FAILS = []


def check(condition, message):
    if condition:
        print(f"  ✓ {message}")
    else:
        print(f"  ✗ {message}")
        FAILS.append(message)


def main(path):
    print(f"проверяем {path}")
    data = open(path, "rb").read()
    check(len(data) > 100_000, f"размер {len(data)/1024:.0f} КБ (>100 КБ)")

    with zipfile.ZipFile(path) as z:
        check(z.testzip() is None, "zip целый")
        names = z.namelist()
        for required in ("AndroidManifest.xml", "resources.arsc", "classes.dex"):
            check(required in names, f"есть {required}")
        check(any(n.startswith("assets/public/index.html") for n in names),
              "есть assets/public/index.html")
        assets = [n for n in names if n.startswith("assets/public/")]
        check(len(assets) >= 20, f"веб-часть целиком ({len(assets)} файлов)")
        if "classes.dex" in names:
            check(z.read("classes.dex")[:4] == b"dex\n", "classes.dex с верной магией")

    check(b"APK Sig Block 42" in data, "подпись APK Signature Scheme v2")
    meta = [n for n in names if n.startswith("META-INF/")]
    check(any(n.endswith(".SF") for n in meta) and any(n.endswith(".RSA") for n in meta),
          "JAR-подпись (v1): .SF и .RSA")

    print()
    if FAILS:
        print(f"ПРОВАЛЕНО: {len(FAILS)} проверок")
        return 1
    print("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
