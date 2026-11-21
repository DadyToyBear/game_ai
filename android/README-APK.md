# Mini Studio → APK

Приложение — та же веб-студия, но упакованная в нативное Android-приложение (Capacitor 6 + WebView).
Всё считается на телефоне: звук (Web Audio), MP3 (LAME), ZIP, сохранения. Интернет не нужен.

## Собрать локально

Нужно: **JDK 17**, **Android SDK** (platform 34, build-tools), Node 20.

```bash
cd /путь/к/проекту
bash scripts/build-www.sh      # копирует index.html, js/, css/, assets/, vendor/ в www/
npm install                    # @capacitor/*
npx cap sync android           # переносит www/ в android/app/src/main/assets/public
cd android
./gradlew assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
```

`local.properties` (путь к SDK) Gradle создаст сам либо укажите вручную:

```properties
sdk.dir=/home/user/Android/Sdk
```

## Собрать без локального Android SDK (через GitHub Actions)

Workflow `.github/workflows/android.yml` уже в репозитории: он собирает APK на каждом пуше
и кладёт его в артефакты (`mini-studio-debug-apk`). Запустить вручную:

```bash
gh workflow run android.yml            # старт
gh run watch                           # прогресс
gh run download --name mini-studio-debug-apk   # забрать APK
```

## Установить на телефон

1. Скачайте `app-debug.apk`.
2. Разрешите «Установка из неизвестных источников» для файлового менеджера/браузера.
3. Откройте APK → «Установить».

Debug-APK подписан отладочным ключом — для личного пользования этого достаточно.
Для раздачи другим людям соберите release и подпишите своим keystore:

```bash
keytool -genkey -v -keystore mini-studio.jks -alias ministudio \
        -keyalg RSA -keysize 2048 -validity 10000
cd android
./gradlew assembleRelease     # неподписанный release
# затем подписать:
$ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks ../mini-studio.jks \
        --out mini-studio-release.apk app/build/outputs/apk/release/app-release-unsigned.apk
```

## Что внутри APK

- `assets/public/` — вся студия (index.html, js, css, assets, vendor/lame.min.js).
- `MainActivity.java` — иммерсивный полноэкранный режим, экран не гаснет, отключён зум,
  отключён системный масштаб шрифта, звук разрешён без дополнительного жеста.
- Иконки во всех плотностях + adaptive icon (mipmap-anydpi-v26).
- Разрешения: `VIBRATE` (тактильная отдача), `READ_MEDIA_AUDIO` (свои сэмплы), `INTERNET`
  (нужно только WebView как таковому; сама студия в сеть не ходит).

## Обновить APK

```bash
bash scripts/build-www.sh && npx cap sync android && cd android && ./gradlew assembleDebug
```

Версия задаётся в `android/app/build.gradle` (`versionCode`, `versionName`) — поднимайте `versionCode`
перед установкой новой сборки поверх старой.
