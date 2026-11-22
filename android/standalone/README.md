# Сборка APK без Android SDK и без Gradle

Обычная сборка (`android/README-APK.md`, job `release` в CI) требует Android SDK,
Gradle и Maven Central. Этот каталог — второй, независимый путь: APK собирается
на машине, где есть только git, node и python, а из интернета доступны лишь
GitHub и npm/PyPI.

```
smali/com/ministudio/app/MainActivity.smali   активность приложения (WebView + офлайн www/)
res/values/strings.xml                        название приложения
AndroidManifest.xml                           манифест облегчённой сборки
tools/smali-driver/SmaliToDex.java            драйвер: smali → classes.dex (dexlib2)
```

## Как собрать

```bash
bash scripts/install-toolchain.sh      # один раз: JDK, aapt2, android.jar, apktool, подписчик
bash scripts/build-apk-local.sh        # соберёт и подпишет APK
# → android/standalone/build/mini-studio-standalone-<версия>.apk
```

Ключ подписи берётся из `android/keystore.properties` (его создаёт
`scripts/gen-keystore.sh`) или из переменных окружения:

```bash
MS_KEYSTORE=/путь/release.p12 MS_KEYSTORE_PASSWORD=пароль MS_KEY_ALIAS=ministudio \
  bash scripts/build-apk-local.sh 1.0.19
```

Без ключа скрипт выпустит неподписанный APK — установить его нельзя, это только
проверка сборки.

## Что происходит внутри

| Шаг | Инструмент | Откуда берётся |
| --- | --- | --- |
| веб-часть → `www/` | `scripts/build-www.sh` | репозиторий |
| ресурсы → `resources.arsc` | `aapt2` (build-tools 34) | git-блобы публичного репозитория |
| `smali` → `classes.dex` | `apktool` (dexlib2 `SmaliBuilder`) | npm `apktool-jar` |
| сборка APK | `aapt2 link` + `scripts/pack-apk.py` | — |
| выравнивание | `zipalign -p 4` | git-блобы + `libc++.so` |
| подпись v1 + v2 | `apk_sign_ts` | npm |
| проверка | `scripts/check-standalone-apk.py`, `aapt2 dump badging` | — |

Тулчейн ставится в `tools/` (в git не попадает) и переиспользуется между
запусками. `scripts/install-toolchain.sh` идемпотентен: повторный вызов ничего не
перекачивает.

## Чем это отличается от основного APK

| | основная сборка (Gradle + Capacitor) | эта (standalone) |
| --- | --- | --- |
| плагины Capacitor | да | нет, только `WebView` |
| `MainActivity` | Java (`android/app/src/main/java/…`) | smali (`android/standalone/smali/…`) |
| ресурсы, иконки, темы | полный набор Android Studio | строка `app_name` |
| подпись | `apksigner` + ключ из Secrets | `apk_sign_ts` (JAR v1 + v2) |
| AAB для Google Play | да | нет, только APK |
| где собирается | CI (job `release`) / локально с SDK | где угодно, в т. ч. в CI (job `standalone-apk`) |

Приложение ведёт себя так же: тот же `www/`, тот же `index.html`, офлайн, экран не
гаснет, зум отключён, кнопка «назад» листает историю WebView. Разница только в
обвязке: нет моста Capacitor, поэтому нет доступа к системным «Поделиться» и
вибрации через плагины — вибрация в веб-версии идёт через `navigator.vibrate`.

## Запасной путь: только `apktool`

Если нет `aapt2`, но есть `apktool.jar` вместе с framework-res
(`$HOME/.local/share/apktool/framework/1.apk`), можно собрать APK целиком через
`apktool b`:

```bash
java -jar tools/lib/apktool.jar b android/standalone/build/project -o out.apk
```

Для этого в каталоге проекта нужен `apktool.yml` — в `android/standalone/` он уже
лежит. В CI (ubuntu-latest + JDK 17) этот путь работает без `aapt2`; в
песочнице framework-res нет, поэтому основной скрипт его не использует.

## Проверка готового файла

```bash
python3 scripts/check-standalone-apk.py android/standalone/build/mini-studio-standalone-*.apk
tools/build-tools/aapt2 dump badging android/standalone/build/mini-studio-standalone-*.apk | head -5
```
