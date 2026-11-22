#!/usr/bin/env bash
# Собирает проверочный APK локально — без Android SDK, Gradle и Maven Central.
#
#   bash scripts/build-apk-local.sh [версия]
#
# Как это работает:
#   1. www/        ← scripts/build-www.sh (те же файлы, что уходят в CI-сборку)
#   2. ресурсы     ← aapt2 compile + link (android.jar API 34)
#   3. classes.dex ← smali из android/standalone/smali через dexlib2 (apktool)
#   4. APK         ← resources.arsc + манифест + assets + classes.dex
#   5. выравнивание← zipalign -p 4
#   6. подпись     ← scripts/sign-apk-js.mjs (JAR v1 + APK Signature Scheme v2)
#
# Ключ берётся из android/keystore.properties или из переменных
# MS_KEYSTORE / MS_KEYSTORE_PASSWORD / MS_KEY_ALIAS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="${MS_TOOLS:-$ROOT/tools}"
VERSION="${1:-1.0.18-local}"
STANDALONE="$ROOT/android/standalone"
OUT="$STANDALONE/build"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m  ✗\033[0m %s\n' "$*" >&2; exit 1; }

JAVA="$TOOLS/jdk/bin/java"
JAVAC_TOOLS="$TOOLS/lib/javac-tools.jar"
AAPT2="$TOOLS/build-tools/aapt2"
ANDROID_JAR="$TOOLS/platforms/android-34/android.jar"
APKTOOL="$TOOLS/lib/apktool.jar"
ZIPALIGN="$TOOLS/build-tools/zipalign"

for f in "$JAVA" "$JAVAC_TOOLS" "$AAPT2" "$ANDROID_JAR" "$APKTOOL"; do
  [ -f "$f" ] || die "нет $f — сначала: bash scripts/install-toolchain.sh"
done
command -v node >/dev/null || die "нужен node"

# ── 1. веб-часть
say "1/6 веб-часть → www/"
bash "$ROOT/scripts/build-www.sh"

# ── 2. подготовка проекта
say "2/6 проект: манифест, smali, ресурсы, www"
rm -rf "$OUT"
PROJ="$OUT/project"
mkdir -p "$PROJ/assets/public"
cp "$STANDALONE/AndroidManifest.xml" "$PROJ/"
cp -r "$STANDALONE/smali" "$PROJ/"
cp -r "$STANDALONE/res" "$PROJ/"
cp -r "$ROOT/www/." "$PROJ/assets/public/"
sed -i.bak "s/android:versionName=\"[^\"]*\"/android:versionName=\"$VERSION\"/" "$PROJ/AndroidManifest.xml"
rm -f "$PROJ"/*.bak

# ── 3. ресурсы
say "3/6 ресурсы → aapt2"
"$AAPT2" compile --dir "$PROJ/res" -o "$OUT/res.zip" 2>&1 | sed 's/^/    /'
"$AAPT2" link -o "$OUT/base.apk" -I "$ANDROID_JAR" \
  --manifest "$PROJ/AndroidManifest.xml" -A "$PROJ/assets" "$OUT/res.zip" 2>&1 | sed 's/^/    /'
ok "resources.arsc и манифест упакованы"

# ── 4. dex из smali
say "4/6 classes.dex из smali (dexlib2)"
# «apktool b» пересобирает ресурсы и требует framework-res, поэтому берём из apktool
# только dexlib2: маленький Java-драйвер зовёт SmaliBuilder напрямую.
DRIVER="$OUT/smali-driver"
mkdir -p "$DRIVER"
cp "$STANDALONE/tools/smali-driver/SmaliToDex.java" "$DRIVER/"
"$JAVA" -cp "$JAVAC_TOOLS" com.sun.tools.javac.Main \
  -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
  -cp "$APKTOOL" -d "$DRIVER" "$DRIVER/SmaliToDex.java" 2>&1 | sed 's/^/    /'
"$JAVA" -cp "$APKTOOL:$DRIVER" SmaliToDex "$PROJ/smali" "$OUT/classes.dex" 2>&1 | sed 's/^/    /'
[ -f "$OUT/classes.dex" ] || die "dex не собрался"

python3 "$ROOT/scripts/pack-apk.py" "$OUT/base.apk" "$OUT/classes.dex" "$OUT/with-dex.apk"
ok "classes.dex вложен в APK"

# ── 5. выравнивание
say "5/6 выравнивание (zipalign -p 4)"
ALIGNED="$OUT/mini-studio-standalone-unsigned.apk"
if [ -f "$ZIPALIGN" ] && LD_LIBRARY_PATH="$TOOLS/build-tools:${LD_LIBRARY_PATH:-}" \
     "$ZIPALIGN" -f -p 4 "$OUT/with-dex.apk" "$ALIGNED" 2>/dev/null; then
  ok "выровнено по 4 байта"
else
  cp "$OUT/with-dex.apk" "$ALIGNED"
  echo "    ! zipalign недоступен — продолжаем без выравнивания"
fi

# ── 6. подпись
say "6/6 подпись (v1 + v2)"
KEYSTORE="${MS_KEYSTORE:-}"
STOREPASS="${MS_KEYSTORE_PASSWORD:-}"
ALIAS="${MS_KEY_ALIAS:-ministudio}"
PROPS="$ROOT/android/keystore.properties"
if [ -z "$KEYSTORE" ] && [ -f "$PROPS" ]; then
  KEYSTORE=$(grep -E '^storeFile=' "$PROPS" | cut -d= -f2- || true)
  STOREPASS=$(grep -E '^storePassword=' "$PROPS" | cut -d= -f2- || true)
  ALIAS=$(grep -E '^keyAlias=' "$PROPS" | cut -d= -f2- || echo "$ALIAS")
  case "$KEYSTORE" in /*) ;; *) KEYSTORE="$ROOT/android/$KEYSTORE" ;; esac
fi

FINAL="$OUT/mini-studio-standalone-$VERSION.apk"
if [ -n "$KEYSTORE" ] && [ -n "$STOREPASS" ] && [ -f "$KEYSTORE" ]; then
  MS_SIGNER_DIR="$TOOLS/signer" node "$ROOT/scripts/sign-apk-js.mjs" --in "$ALIGNED" --out "$FINAL" \
    --keystore "$KEYSTORE" --password "$STOREPASS" --alias "$ALIAS"
else
  echo "    ! ключа нет: выпускаем неподписанный APK (установить его нельзя)"
  echo "      создайте ключ: bash scripts/gen-keystore.sh"
  cp "$ALIGNED" "$FINAL"
fi

# ── итог
say "готово"
"$AAPT2" dump badging "$FINAL" 2>/dev/null | head -4 | sed 's/^/    /'
python3 - "$FINAL" <<'PY'
import sys, zipfile
p = sys.argv[1]
data = open(p, 'rb').read()
names = zipfile.ZipFile(p).namelist()
print(f"    размер:      {len(data)/1024:.0f} КБ")
print(f"    файлов:      {len(names)}")
print(f"    classes.dex: {'да' if 'classes.dex' in names else 'нет'}")
print(f"    подпись v2:  {'да' if b'APK Sig Block 42' in data else 'нет'}")
meta = [n for n in names if n.startswith('META-INF')]
print(f"    META-INF:    {', '.join(meta) if meta else 'нет'}")
PY
echo
echo "APK: $FINAL"
