# game_ai → **WebPort**: плагин переноса браузерной игры в Redot

[![Redot](https://img.shields.io/badge/Redot-26.x%20%2F%20Godot%204.5-8b6f3e)](https://redotengine.org/)
[![Node](https://img.shields.io/badge/Node-18%2B-4a7a3a)](https://nodejs.org/)
[![tests](https://img.shields.io/badge/tests-30%20passed-3f7a4a)](#проверки)

**WebPort** превращает готовую браузерную игру на HTML/CSS/JS в проект
Redot: разметка становится сценой `.tscn`, ES-модули — GDScript с теми же
функциями, JSON и ассеты копируются, а все места, которые нельзя перенести
автоматически, попадают в отчёт с номерами строк.

Сделан для игры **«Корона и знамя»** и проверен на её реальной кодовой базе:
HTML на 312 КБ, тактический бой в `src/battle_simulation.mjs`, 356 МБ ассетов.

---

## Что переносится

| В веб-версии | В проекте Redot | Автоматизация |
|---|---|---|
| `viewer/game.html` + CSS | `scenes/Game.tscn` — 128 узлов, видны в редакторе | структура и стили |
| `src/battle_simulation.mjs` (501 строка) | `webport/src/battle_simulation.gd` — **0 заглушек** | полная по смыслу |
| `src/battle_contract.mjs` | `webport/src/battle_contract.gd` — **0 заглушек** | полная по смыслу |
| `data/*.json` (384 записи) | `data/*.json` без изменений | файлы как есть |
| `assets/**` (1817 файлов, 356 МБ) | `assets/**`, пути `res://assets/…` совпадают | файлы как есть |
| `id="resourceBar"` | `WebportLinks.ui("resourceBar")` | таблица `dom_links.json` |
| `el.innerHTML`, `fetch`, `await`, `class` | — | **в отчёт, руками** |

---

## Установка за 3 минуты

```bash
# 1. архив (или скопируйте каталог из репозитория)
unzip webport-addon.zip -d /path/to/redot-project

# 2. включите плагин
#    Redot → Project → Project Settings → Plugins → WebPort → Enable

# 3. соберите проект из веб-игры
node /path/to/redot-project/addons/webport/tools/build_project.mjs \
  --source /path/to/web-game \
  --out    /path/to/redot-project \
  --name   "Корона и знамя"
```

Требования: **Redot 26.x** (Godot 4.5) и **Node.js 18+**. Опционально
`pip install gdtoolkit` — тогда сборка сама проверяет синтаксис GDScript.

В редакторе появляется панель **WebPort**: два пути, кнопка «Собрать»,
сводка последней сборки, отчёт и локальная страница проверки сцен.

---

## Документация

| Документ | Для чего |
|---|---|
| **[БЫСТРЫЙ_СТАРТ.md](addons/webport/БЫСТРЫЙ_СТАРТ.md)** | 5 минут: установка, первый перенос, чтение отчёта |
| [УСТАНОВКА.md](addons/webport/УСТАНОВКА.md) | все способы установки, проверка, настройки, обновление |
| [РАБОТА_С_ПЛАГИНОМ.md](addons/webport/РАБОТА_С_ПЛАГИНОМ.md) | цикл переноса, разбор замечаний, шпаргалка соответствий |
| [README плагина](addons/webport/README.md) | что внутри, что переносится, ограничения |
| [docs/WEBPORT_REDOT_PLUGIN_RU.md](docs/WEBPORT_REDOT_PLUGIN_RU.md) | техническое описание архитектуры |
| [docs/WEBPORT_SAMPLE_REPORT_RU.md](docs/WEBPORT_SAMPLE_REPORT_RU.md) | пример отчёта по реальной игре |

---

## Проверки

```bash
node addons/webport/tests/run_tests.mjs     # 30 проверок, 0 провалов
gdparse addons/webport/runtime/*.gd addons/webport/gdscript/*.gd
```

Что покрыто: конвертация JS→GDScript (функции, объекты, массивы, лямбды,
`for…of`, `try/catch`, импорты), приоритеты операторов и порядок `merge`
при spread, разбор HTML/CSS в узлы и стили, каскад селекторов, замена
отсутствующих ассетов на TODO, синтаксис сгенерированного кода через gdparse.

**Проверено на реальном проекте:** 3 экрана → сцены, 5 модулей → GDScript,
648 строк, **0 ошибок линтера**, 16 мест для ручной работы.

Не проверено: запуск в живом Redot (в песочнице сборки движок недоступен),
поэтому `.tscn` валидировался по формату, а весь `.gd` — парсером gdtoolkit.

---

## Состав репозитория

```
addons/webport/          плагин: plugin.gd, панель, ядро конвертации, рантайм, тесты
  ├── core/              js_to_gd.mjs, html_to_scene.mjs, html_dom.mjs, …
  ├── runtime/           webport_runtime.gd (аналоги JS), webport_links.gd (id → узел)
  ├── tools/             build_project.mjs, serve.mjs, pack_zip.mjs
  └── vendor/acorn.mjs   парсер JS (MIT, 8.19.0)
demo/webport_min/        готовый пример: мини-игра, перенесённая в Redot
examples/webgame_min/    исходник этого примера (HTML + ES-модуль)
docs/                    техническое описание и пример отчёта
dist/                    webport-addon.zip (готовый плагин), архив ассетов
assets/, tools/          ассеты игры «Корона и знамя» и скрипты их обработки
```

---

## Демо

```bash
node addons/webport/tools/build_project.mjs \
  --source examples/webgame_min --out /tmp/webport_demo --name "WebPort demo"
redot --path /tmp/webport_demo

# или посмотреть отчёт и предпросмотр сцен в браузере
node addons/webport/tools/serve.mjs --project /tmp/webport_demo --port 8123
```

Демо собирается с **0 ручных замечаний**: 1 экран, 2 модуля, 51 строка GDScript.

---

## Ограничения

* Интерфейс, который строится из JS (`innerHTML`), переносится как структура:
  узлы и стили — да, обновление содержимого — руками.
* `<canvas>` становится узлом-заглушкой: рисование переписывается на `_draw()`.
* Классы JS не транслируются; асинхронность (`fetch`, `await`) — на сигналы.
* Пиксельная точность CSS недостижима: раскладка в Godot контейнерная.

Это разница между DOM и деревом сцен, а не недоделка плагина: всё, что можно
сделать детерминированно, плагин делает и показывает в отчёте, что осталось.

---

## Лицензия

Код плагина — MIT. `addons/webport/vendor/acorn.mjs` — acorn 8.19.0 (MIT),
текст лицензии в `addons/webport/vendor/ACORN_LICENSE.txt`.
