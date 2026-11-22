#!/usr/bin/env bash
# Устанавливает локальный Android-тулчейн без Android SDK, Maven Central и dl.google.com.
#
# Что скачивается:
#   • JDK (Temurin)          — PyPI-колесо jdk4py            → tools/jdk
#   • aapt2 / zipalign       — git-блобы из публичного репозитория → tools/build-tools
#   • android.jar (API 34)   — codeload.github.com (Sable/android-platforms) → tools/platforms
#   • apktool + smali/dexlib2 — PyPI не нужен, jar берётся из npm-пакета apktool-jar → tools/lib
#   • apk_sign_ts (подпись)  — npm                              → tools/signer
#
# Идемпотентен: повторный запуск ничего не перекачивает.
# В конце печатает export-строки для текущей сессии.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="${MS_TOOLS:-$ROOT/tools}"
mkdir -p "$TOOLS"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !\033[0m %s\n' "$*"; }

need() { command -v "$1" >/dev/null 2>&1 || { warn "не найден $1 — установите его (python3, node, gh, curl, unzip)"; exit 1; }; }
need python3
need node
need curl

# ─────────────────────────────────────────────────────────── 1. JDK
if [ -x "$TOOLS/jdk/bin/java" ]; then
  ok "JDK уже на месте: $("$TOOLS/jdk/bin/java" -version 2>&1 | head -1)"
else
  say "JDK (Temurin, PyPI jdk4py)"
  python3 -m pip download jdk4py --no-deps -d "$TOOLS/wheels" --quiet
  WHEEL=$(ls -t "$TOOLS"/wheels/jdk4py-*.whl | head -1)
  rm -rf "$TOOLS/unpacked-jdk"
  python3 -m zipfile -e "$WHEEL" "$TOOLS/unpacked-jdk"
  JDK_SRC=$(find "$TOOLS/unpacked-jdk" -maxdepth 3 -type d -name "java-runtime" | head -1)
  rm -rf "$TOOLS/jdk"
  mv "$JDK_SRC" "$TOOLS/jdk"
  chmod -R +x "$TOOLS/jdk/bin"
  ok "JDK: $("$TOOLS/jdk/bin/java" -version 2>&1 | head -1)"
fi
JAVA="$TOOLS/jdk/bin/java"

# ─────────────────────────────────────────────────── 2. build-tools
# aapt2 и zipalign лежат в git обычными файлами (не LFS) в публичном репозитории.
BT_REPO="${MS_BT_REPO:-altaga/Txt2App}"
BT_PATH="txt2app-ai-workbench/DevTools/Android/build-tools/34.0.0"
BT_DIR="$TOOLS/build-tools"
mkdir -p "$BT_DIR"

fetch_blob() { # $1 = имя файла в BT_PATH, $2 = путь назначения
  python3 - "$BT_REPO" "$BT_PATH" "$1" "$2" <<'PY'
import base64, json, subprocess, sys
repo, base, name, dest = sys.argv[1:5]
tree = json.loads(subprocess.check_output(["gh", "api", f"repos/{repo}/git/trees/HEAD?recursive=1"]))["tree"]
entry = next(t for t in tree if t["path"] == f"{base}/{name}")
blob = json.loads(subprocess.check_output(["gh", "api", f"repos/{repo}/git/blobs/{entry['sha']}"]))
open(dest, "wb").write(base64.b64decode(blob["content"]))
PY
  chmod +x "$2"
}

download_bt() {
  command -v gh >/dev/null 2>&1 || { warn "нужен gh (GitHub CLI) для скачивания build-tools"; return 1; }
  say "build-tools: aapt2, zipalign"
  fetch_blob aapt2 "$BT_DIR/aapt2"
  fetch_blob zipalign "$BT_DIR/zipalign"
  # zipalign собран под libc++ из NDK — без библиотеки он не стартует.
  gh api "repos/LineageOS/android_prebuilts_clang_kernel_linux-x86_clang-r416183b/contents/lib64/libc++.so" \
    --jq '.content' 2>/dev/null | base64 -d > "$BT_DIR/libc++.so" || warn "libc++.so не скачался"
  ok "aapt2: $("$BT_DIR/aapt2" version 2>&1 | head -1)"
  # zipalign без аргументов печатает справку и выходит с кодом 1 — pipefail тут мешает
  if { LD_LIBRARY_PATH="$BT_DIR" "$BT_DIR/zipalign" 2>&1 || true; } | grep -q "Zip alignment utility"; then
    ok "zipalign работает"
  else
    warn "zipalign не запускается (нет libc++) — этап выравнивания будет пропущен"
  fi
}

if [ -x "$BT_DIR/aapt2" ]; then
  ok "build-tools уже на месте: $("$BT_DIR/aapt2" version 2>&1 | head -1)"
else
  download_bt || true
fi

# ──────────────────────────────────────────────── 3. android.jar (API 34)
PLATFORM="$TOOLS/platforms/android-34/android.jar"
mkdir -p "$(dirname "$PLATFORM")"
if [ -f "$PLATFORM" ]; then
  ok "android.jar API 34 уже на месте ($(du -h "$PLATFORM" | cut -f1))"
else
  say "android.jar (API 34) — Sable/android-platforms"
  curl -sL --retry 3 -o "$TOOLS/platforms.tar.gz" \
    "https://codeload.github.com/Sable/android-platforms/tar.gz/refs/heads/master"
  tar xzf "$TOOLS/platforms.tar.gz" -C "$TOOLS" \
    "android-platforms-master/android-34/android.jar"
  mkdir -p "$(dirname "$PLATFORM")"
  mv "$TOOLS/android-platforms-master/android-34/android.jar" "$PLATFORM"
  rm -rf "$TOOLS/android-platforms-master" "$TOOLS/platforms.tar.gz"
  [ -f "$PLATFORM" ] || { warn "android.jar не скачался"; exit 1; }
  ok "android.jar: $(du -h "$PLATFORM" | cut -f1)"
fi

# ─────────────────────────────────────── 4. apktool (smali + dexlib2)
APKTOOL="$TOOLS/lib/apktool.jar"
mkdir -p "$TOOLS/lib"
if [ -f "$APKTOOL" ]; then
  ok "apktool уже на месте"
else
  say "apktool (сборка classes.dex из smali, dexlib2)"
  ( cd "$TOOLS/lib" && npm pack apktool-jar --silent >/dev/null 2>&1 && \
    tar xzf apktool-jar-*.tgz && \
    cp package/bin/apktool_*.jar apktool.jar && \
    rm -rf package apktool-jar-*.tgz )
  ok "apktool: $("$JAVA" -jar "$APKTOOL" --version 2>&1 | head -1)"
fi

# ──────────────────────────── 4b. компилятор Java (javac) для драйвера dex
# JDK из PyPI — это JRE без javac. tools.jar от OpenJDK 8 умеет компилировать
# на новом JVM, если указать bootclasspath (android.jar).
JAVAC_TOOLS="$TOOLS/lib/javac-tools.jar"
if [ -f "$JAVAC_TOOLS" ]; then
  ok "javac (tools.jar) уже на месте"
else
  say "javac для драйвера dex (OpenJDK 8 tools.jar из npm)"
  ( cd "$TOOLS/lib" && npm pack dataslope-tools-jar --silent >/dev/null 2>&1 && \
    tar xzf dataslope-tools-jar-*.tgz && \
    cp package/tools.jar javac-tools.jar && \
    rm -rf package dataslope-tools-jar-*.tgz )
  ok "javac: $("$JAVA" -cp "$JAVAC_TOOLS" com.sun.tools.javac.Main -version 2>&1 | head -1)"
fi

# ─────────────────────────────────────────── 5. подпись APK (чистый JS)
if [ -d "$TOOLS/signer/node_modules/apk_sign_ts" ]; then
  ok "подписчик apk_sign_ts уже на месте"
else
  say "подписчик APK: apk_sign_ts + node-forge + jks-js"
  mkdir -p "$TOOLS/signer"
  ( cd "$TOOLS/signer" && npm init -y >/dev/null 2>&1 && npm i apk_sign_ts --silent >/dev/null 2>&1 )
  ok "подписчик установлен"
fi

cat <<EOF

──────────────────────────────────────────────────────────────
Тулчейн готов: $TOOLS

Подключить в текущую сессию:
  export MS_TOOLS="$TOOLS"
  export JAVA_HOME="$TOOLS/jdk"
  export PATH="\$JAVA_HOME/bin:$TOOLS/build-tools:\$PATH"
  export LD_LIBRARY_PATH="$TOOLS/build-tools:\${LD_LIBRARY_PATH:-}"

Проверка:
  java -version
  $TOOLS/build-tools/aapt2 version

Собрать проверочный APK без Gradle:
  bash scripts/build-apk-local.sh
──────────────────────────────────────────────────────────────
EOF
