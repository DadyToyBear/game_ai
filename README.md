# Корона и знамя — браузерная стратегия и WebPort

В репозитории находятся браузерный прототип стратегии, игровые данные и ассеты, а также **WebPort** — плагин для переноса HTML/CSS/ES-модулей игры в проект Redot/Godot с отчётом о местах, требующих ручной доработки.

## Запустить игру в браузере

```bash
PORT=3100 node server.mjs
```

Откройте `/game`. Основная документация — [`docs/GAME_PROTOTYPE.md`](docs/GAME_PROTOTYPE.md) и план этапов [`docs/NEXT_STAGES.md`](docs/NEXT_STAGES.md).

## Перенос в Redot с WebPort

Плагин находится в `addons/webport/`; готовый архив — [`dist/webport-addon.zip`](dist/webport-addon.zip). Он собирает сцены `.tscn`, переносит поддерживаемые ES-модули в GDScript и копирует JSON/ассеты. Неподдержанные DOM-, canvas- и асинхронные участки фиксируются в отчёте — автоматическая сборка не означает, что вся игра уже нативно переписана.

**Установка:** распакуйте архив в корень целевого проекта Redot, затем включите `Project → Project Settings → Plugins → WebPort`.

**Сборка игры из этого репозитория:**

```bash
node addons/webport/tools/build_project.mjs \
  --source . \
  --out ../crown-and-banner-redot \
  --name "Корона и знамя" \
  --only viewer/game.html
```

`--only viewer/game.html` ограничивает набор HTML-экранов, но общие GDScript-модули, JSON и ассеты всё равно включаются: полученный проект не теряет зависимости выбранного экрана. Не задавайте каталог вывода внутри исходного репозитория. Первичная сборка переносит ресурсы примерно на 358 МБ. Полный отчёт сборки записывается в выходной проект (`webport/REPORT.md` и `webport/report.json`).

Требования для сборки: Node.js 18+; для синтаксической проверки GDScript дополнительно установите `gdtoolkit`. Redot/Godot в этой среде не установлен, поэтому успешная генерация не заменяет открытие и запуск проекта в движке.

- [Быстрый старт](addons/webport/БЫСТРЫЙ_СТАРТ.md)
- [Установка и настройки](addons/webport/УСТАНОВКА.md)
- [Работа с плагином](addons/webport/РАБОТА_С_ПЛАГИНОМ.md)
- [Техническое описание интеграции](docs/WEBPORT_REDOT_PLUGIN_RU.md)
- [Результаты проверки переноса этой игры](docs/WEBPORT_GAME_AUDIT_RU.md)
- [Пример отчёта](docs/WEBPORT_SAMPLE_REPORT_RU.md)

## Проверки

```bash
npm test
node addons/webport/tests/run_tests.mjs
```

`npm test` проверяет браузерную игру; вторая команда запускает независимые тесты конвертера WebPort.
