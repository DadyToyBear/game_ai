# Mini Studio → APK и AAB (Google Play)

Студия упакована в нативное Android-приложение (Capacitor 6 + WebView). Всё считается на
телефоне: Web Audio, MP3 (LAME), ZIP, сохранения. Интернет не нужен.

| Что | Куда | Зачем |
|---|---|---|
| `app-debug.apk` | релиз [`apk-latest`](https://github.com/DadyToyBear/game_ai/releases/tag/apk-latest) | просто установить и играть |
| `proof-signed.apk` | релиз [`apk-proof-signed`](https://github.com/DadyToyBear/game_ai/releases/tag/apk-proof-signed) | доказательство, что подпись в CI работает (временный ключ) |
| `mini-studio-release-*.apk` | релиз [`release-latest`](https://github.com/DadyToyBear/game_ai/releases/tag/release-latest) | подписанный release, обновляется поверх |
| `mini-studio-release-*.aab` | Google Play Console | загрузка в магазин |

## 1. Быстрая установка (уже работает)

```bash
gh release download apk-latest --pattern "*.apk"
```

или откройте страницу релиза в браузере. На телефоне: разрешить «Установка из неизвестных
источников» → открыть файл → «Установить».

APK собирается автоматически на каждый пуш (`.github/workflows/android.yml`, job `debug-apk`).

## 2. Создать свой ключ подписи

Ключ подписи — это личность приложения. **Потеряете ключ — не сможете обновлять приложение
в Google Play.** Храните его в менеджере паролей и в надёжном месте.

Нужен JDK 17:

```bash
bash scripts/gen-keystore.sh
# → ~/.mini-studio-keys/release.jks + keystore.properties + certificate.pem
#   печатает пароль и отпечатки SHA-256 / SHA-1
```

JDK нет — тот же результат на Python + OpenSSL (PKCS#12, его понимает и Gradle, и apksigner):

```bash
python3 scripts/make-signing-key.py --out ~/.mini-studio-keys \
        --alias ministudio --dname 'CN=Mini Studio, O=Mini Studio, C=CZ'
```

Скрипт выдаёт пароль, отпечатки и готовые строки для секретов.

## 3. Подключить ключ к CI (GitHub Secrets)

Settings → Secrets and variables → Actions → **New repository secret**:

| Имя секрета | Значение |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 ~/.mini-studio-keys/release.p12` (или `.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | пароль хранилища |
| `ANDROID_KEY_ALIAS` | `ministudio` |
| `ANDROID_KEY_PASSWORD` | пароль ключа (обычно тот же) |

После этого Actions → **Build APK** → Run workflow (или просто пуш): job `release` соберёт
**подписанные** APK и AAB, проверит подпись через `apksigner verify --print-certs` и
опубликует их в релизе `release-latest`.

Пока секретов нет, тот же job:
1. собирает release APK и AAB **без подписи** (только проверка, что сборка проходит);
2. генерирует временный ключ и подписывает им APK → `apksigner verify` должен сказать
   «Verifies» (этот файл выложен в релизе `apk-proof-signed`);
3. проверяет, что AAB читается `jarsigner`.

Так видно, что конвейер подписи рабочий ещё до появления вашего ключа.

## 4. Локальная сборка

Нужно: **JDK 17**, **Android SDK** (platform 34, build-tools 34.0.0), Node 20.

```bash
bash scripts/build-www.sh                       # index.html, js/, css/, assets/, vendor/ → www/
npm install
npx cap sync android
cd android
./gradlew assembleDebug                         # debug APK
./gradlew assembleRelease bundleRelease \
  -PmsVersionName=1.0.2 -PmsVersionCode=2       # release APK + AAB
```

Подпись локально: положите `android/keystore.properties` (см. пример ниже) или задайте
переменные окружения `MS_KEYSTORE`, `MS_KEYSTORE_PASSWORD`, `MS_KEY_ALIAS`, `MS_KEY_PASSWORD`.

```properties
# android/keystore.properties  (в git не попадает)
storeFile=/home/you/.mini-studio-keys/release.p12
storePassword=…
keyAlias=ministudio
keyPassword=…
```

Готовые файлы:

```
android/app/build/outputs/apk/release/mini-studio-release-1.0.2.apk
android/app/build/outputs/bundle/release/app-release.aab
```

### 4а. Сборка вообще без Android SDK

Если Android SDK, Gradle или Maven Central недоступны, APK всё равно можно
собрать и подписать: `aapt2` для ресурсов, `dexlib2` для `classes.dex`,
`apk_sign_ts` для подписи v1+v2. Нужны только git, node и python.

```bash
bash scripts/install-toolchain.sh     # JDK, aapt2, android.jar API 34, apktool, подписчик → tools/
bash scripts/build-apk-local.sh       # → android/standalone/build/mini-studio-standalone-<версия>.apk
python3 scripts/check-standalone-apk.py android/standalone/build/mini-studio-standalone-*.apk
```

Ключ берётся из `android/keystore.properties` или из `MS_KEYSTORE`,
`MS_KEYSTORE_PASSWORD`, `MS_KEY_ALIAS`. Такой APK — упрощённая обвязка (один
`WebView` без плагинов Capacitor), AAB им не собирается; для Google Play
по-прежнему нужен раздел выше. Подробности: [`android/standalone/README.md`](standalone/README.md).
Ту же сборку выполняет job `standalone-apk` в CI, его APK лежит в артефакте
`mini-studio-standalone`.

## 5. Google Play

1. **Play Console** → Create app (имя, язык, категория «Музыка и аудио»).
2. **Setup → App signing**: включите *Play App Signing* (Google хранит ключ подписи,
   вы подписываете загрузочным ключом — это надёжнее, чем один ключ на всё).
3. **Testing → Internal testing → Create release** → загрузите `app-release.aab`.
4. Заполните обязательное: политика конфиденциальности (данные не собираются — всё локально),
   Data safety («No data collected»), скриншоты, иконка 512×512 (есть: `assets/icon-512.png`).
5. Промоут в Production после проверки.

Важно: `versionCode` в каждой загрузке должен быть **больше** предыдущего. В CI он
подставляется автоматически (`-PmsVersionCode`), локально задайте явно.

## 6. Что внутри APK

- `assets/public/` — вся студия (`index.html`, `js/`, `css/`, `assets/`, `vendor/lame.min.js`).
- `MainActivity.java` (наследник `BridgeActivity`): иммерсивный полный экран, экран не гаснет,
  зум отключён, системный масштаб шрифта игнорируется, звук без дополнительного жеста.
- Иконки во всех плотностях + adaptive icon (`mipmap-anydpi-v26`), тёмный фон запуска.
- Release-сборка минифицируется R8 (`proguard-rules.pro` сохраняет классы Capacitor и
  JS-моста).
- Разрешения: `VIBRATE` (тактильная отдача), `READ_MEDIA_AUDIO` (свои сэмплы), `INTERNET`
  нужен только самому WebView — студия в сеть не ходит.

## 7. Обновить приложение

```bash
bash scripts/build-www.sh && npx cap sync android
cd android && ./gradlew assembleDebug        # или просто пуш в ветку → CI
```

Пользователям с установленным APK: новый файл ставится поверх старого, **если подпись тем же
ключом** и `versionCode` больше.
