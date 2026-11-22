#!/usr/bin/env bash
# Генерирует release-ключ подписи и сохраняет его вне репозитория.
#
#   bash scripts/gen-keystore.sh [пароль] [dname]
#
# Файлы (по умолчанию в ~/.mini-studio-keys, права 600):
#   release.jks           — сам ключ (РКОВОДИТЕЛЬ: потеряете — обновления в Play невозможны)
#   keystore.properties   — пароли и алиас для gradle
#   certificate.pem       — сертификат (публичный, его можно показывать)
#
# Дальше:
#   cp ~/.mini-studio-keys/keystore.properties android/keystore.properties
#   # или в CI: секреты ANDROID_KEYSTORE_BASE64 / _PASSWORD / KEY_ALIAS / KEY_PASSWORD
set -euo pipefail

OUT_DIR="${MS_KEY_DIR:-$HOME/.mini-studio-keys}"
PASS="${1:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)}"
ALIAS="${MS_KEY_ALIAS:-ministudio}"
DNAME="${2:-CN=Mini Studio, OU=Audio, O=Mini Studio, L=Prague, C=CZ}"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
KS="$OUT_DIR/release.jks"

if [ -f "$KS" ]; then
  echo "Ключ уже существует: $KS"
  echo "Удалите его вручную, если действительно хотите пересоздать (смена ключа ломает обновления в Play!)."
  exit 1
fi

keytool -genkeypair -v \
  -keystore "$KS" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storetype PKCS12 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "$DNAME"

keytool -exportcert -alias "$ALIAS" -keystore "$KS" -storepass "$PASS" \
  -file "$OUT_DIR/certificate.pem" -rfc >/dev/null

cat > "$OUT_DIR/keystore.properties" <<EOF
storeFile=$KS
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
EOF

chmod 600 "$KS" "$OUT_DIR/keystore.properties"

echo
echo "Готово:"
echo "  ключ:        $KS"
echo "  пароль:      $PASS   (сохраните в менеджере паролей!)"
echo "  алиас:       $ALIAS"
echo "  настройки:   $OUT_DIR/keystore.properties"
echo
echo "Отпечаток SHA-256 (для Play App Signing / Digital Asset Links):"
keytool -list -v -keystore "$KS" -alias "$ALIAS" -storepass "$PASS" 2>/dev/null | grep -E "SHA256:|SHA1:|MD5:" | sed 's/^ */  /'
echo
echo "Base64 ключа для GitHub Secrets (ANDROID_KEYSTORE_BASE64):"
echo "  base64 -w0 $KS"
