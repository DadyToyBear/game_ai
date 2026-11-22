#!/usr/bin/env bash
# Локальная проверка APK/AAB: подпись, package, версия, содержимое.
#   bash scripts/check-release.sh [путь к apk или aab]
set -euo pipefail
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  TARGET=$(find android/app/build/outputs -name "*.apk" 2>/dev/null | head -1 || true)
fi
if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
  echo "Файл не найден. Соберите: (cd android && ./gradlew assembleRelease)"
  exit 1
fi

echo "Файл: $TARGET ($(du -h "$TARGET" | cut -f1))"
echo

case "$TARGET" in
  *.apk)
    echo "=== Метаданные ==="
    aapt dump badging "$TARGET" 2>/dev/null | grep -E "^package|application-label|sdkVersion|targetSdk" || true
    echo
    echo "=== Подпись ==="
    if apksigner verify --print-certs "$TARGET" >/dev/null 2>&1; then
      apksigner verify --print-certs "$TARGET" | head -6
      echo "→ подпись валидна"
    else
      echo "→ APK НЕ ПОДПИСАН (или подпись не проверяется)"
    fi
    echo
    echo "=== Содержимое (web-часть) ==="
    unzip -l "$TARGET" | grep -E "assets/public/(index.html|js/app.js|vendor/lame.min.js)" || true
    ;;
  *.aab)
    echo "=== Подпись AAB ==="
    jarsigner -verify "$TARGET" 2>&1 | tail -2 || true
    echo
    echo "=== Содержимое ==="
    unzip -l "$TARGET" | grep -E "BundleConfig|base/manifest|base/assets/public/index.html" || true
    ;;
esac

echo
echo "Готово."
