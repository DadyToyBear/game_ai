#!/usr/bin/env bash
# Собирает папку www/ для Capacitor (и для APK): копирует только то, что нужно приложению.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf www
mkdir -p www
cp index.html manifest.webmanifest sw.js www/
cp -r css js assets vendor www/
# офлайн-артефакты и исходники в APK не нужны
rm -f www/sw.js.bak
echo "www/ готов: $(du -sh www | cut -f1)"
find www -type f | wc -l | xargs echo "файлов:"
