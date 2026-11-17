# WebPort: плагин для переноса браузерной игры в Redot

Документ отвечает на вопрос «как сделать так, чтобы проект на HTML/CSS/JS можно было
перенести в Redot без ручного переписывания с нуля» — и что при этом честно остаётся
ручной работой.

Плагин лежит в `addons/webport/` этого репозитория. Готовый архив:
`dist/webport-addon.zip`.

---

## 1. Что было в исходной веб-игре

Разбор ветки `arena/22e54df2-game-ai` (браузерная «Корона и знамя»):

| Часть | Объём | Как переносится |
|---|---|---|
| `viewer/game.html` | 312 КБ, один `<script>` + CSS | разметка → сцена `Game.tscn` (128 узлов), скрипт → `scripts/Game.gd` |
| `src/battle_simulation.mjs` | 501 строка, 37 функций | → `webport/src/battle_simulation.gd`, **0 TODO** после доработки конвертера |
| `src/battle_contract.mjs` | 85 строк | → `webport/src/battle_contract.gd`, **0 TODO** |
| `data/*.json` | 7 файлов, 384 записи | копируются как есть |
| `assets/**` | 1817 файлов, 356 МБ | копируются, пути `res://assets/…` совпадают с веб-версией |
| `server.mjs`, `tests/**` | — | в отчёте помечены как исключённые (вне клиента) |

## 2. Что делает плагин

```
viewer/game.html ──┬── HTML ──► html_dom.mjs ──► html_to_scene.mjs ──► scenes/Game.tscn
                   ├── CSS  ──► parseCss ──────► StyleBoxFlat / контейнеры
                   └── JS   ──► acorn ─────────► js_to_gd.mjs ──► scripts/Game.gd
src/*.mjs ─────────────────────────────────────────────────────────► webport/src/*.gd
data/*.json ──────────────────────────────────────────────────────► data/*.json
assets/** ────────────────────────────────────────────────────────► assets/** (без изменений)
                                                            └──► webport/REPORT.md + report.json
```

Соответствия, которые важны на практике:

| HTML | Redot |
|---|---|
| `div` с фоном | `Panel` + `StyleBoxFlat` (цвет, рамка, скругление) |
| `div` без фона | `Control` (не рисует лишний прямоугольник) |
| `display:flex` | `HBoxContainer` / `VBoxContainer` + `theme_override_constants/separation` |
| `display:grid` + `repeat(3, 1fr)` | `GridContainer` + `columns = 3` |
| `button`, `select`, `input` | `Button`, `OptionButton`, `LineEdit` / `CheckBox` |
| `img src="/assets/…"` | `TextureRect` + `ExtResource("res://assets/…")` |
| `id="resourceBar"` | `webport/dom_links.json` + `WebportLinks.ui("resourceBar")` |

| JS | GDScript |
|---|---|
| `Math.max/min/floor/round/sign` | одноимённые встроенные функции |
| `Number.isFinite(x)` | `is_finite(WebportRuntime.num(x))` — как `Number()` в JS |
| `a / b` | `WebportRuntime.div(a, b)` — иначе `3/2` даёт `1` |
| `a || b`, `a && b` (значения) | `(a if a else b)` / `(b if a else a)`; для условий — `or`/`and` |
| `{...state, gold: 1}` | `WebportRuntime.merge({}, state, {"gold": 1})` — порядок сохраняется |
| `arr.map/filter/some/find/reduce/sort` | `WebportRuntime.*` и `sort_custom` |
| `[...a, ...b]` | `([...a] + b)` → в Godot `(a + b)` для массивов |
| `for (const [k, v] of dict)` | `for k in dict.keys(): var v = dict[k]` |
| `for (let i = 0; i < n; i += 1)` | `for i in range(n)` |
| `a?.b` | `(a.b if a != null else null)` |

## 3. Чего плагин не делает (и почему это в отчёте)

| Конструкция | Почему нельзя автоматически | Что делать |
|---|---|---|
| `el.innerHTML = ...` | узлов нет в HTML — их физически не существует до выполнения JS | разметку — в сцену, обновление — через `WebportLinks.set_prop` |
| `document.*`, `querySelector`, `addEventListener` | в Godot нет DOM; события — это сигналы | подключать в `_ready()` сцены |
| `fetch`, `await`, Promise | в GDScript нет промисов | `WebportData.load_json` + сигналы |
| `setTimeout`, `requestAnimationFrame` | нет очереди задач браузера | `Timer`, `_process(delta)` |
| `class Unit {}` | у GDScript другая модель наследования | сцена + скрипт, либо композиция |
| регулярные выражения | синтаксис RegEx отличается | `RegEx.new()` вручную |
| `<canvas>` с игровым циклом | это императивное рисование | `_draw()`, `Node2D`, `Sprite2D` |
| `Map`/`Set` | нет прямых аналогов | `Dictionary`/`Array` (плагин делает замену и предупреждает) |

Типичный отчёт по «Короне и знамени» (полный — в `docs/WEBPORT_SAMPLE_REPORT_RU.md`):

```
Экранов (HTML → сцена):        3
JS-модулей → GDScript:         5
Строк GDScript:              648
JSON-данных:                 384
Ассетов:                    1817 (356.4 МБ)
Требуют ручной работы:        16
Ошибок линтера GDScript:       0
```

## 4. Порядок работы

1. **Структура.** Соберите без ассетов (`--no-copy-assets`) — это 2 секунды:
   смотрите, сколько узлов получилось на экран и сколько замечаний.
2. **Модули.** Разбирайте `report.json` по файлам: у `battle_simulation.gd`
   должно быть 0 TODO; TODO допустимы только в UI-скриптах.
3. **Сцены.** Откройте проект в Redot и пройдитесь по сценам: контейнеры,
   `size_flags`, отступы. Это самая заметная часть ручной работы.
4. **Ассеты.** Повторите сборку с ассетами — пути уже совпадают с веб-версией,
   ничего переименовывать не нужно.
5. **Логика.** Модель боя (`webport/src/*.gd`) уже перенесена; подключайте её
   к сценам через `preload` и вызывайте из `_ready()`/`_process()`.

## 5. Установка плагина в Redot

```bash
# вариант 1: архив (внутри уже addons/webport/…)
unzip dist/webport-addon.zip -d /path/to/redot-project

# вариант 2: из репозитория
cp -r addons/webport /path/to/redot-project/addons/
```

`Project → Project Settings → Plugins → WebPort → Enable`.
Требуется Node.js 18+ в `PATH` (панель сама проверит и скажет, если его нет).

## 6. Проверки, которые уже прогнаны

```bash
node addons/webport/tests/run_tests.mjs     # 30 проверок, 0 провалов
gdparse addons/webport/runtime/*.gd addons/webport/gdscript/*.gd
```

* Конвертер проверен на реальных модулях проекта: оба `.mjs` дают
  синтаксически валидный GDScript без заглушек.
* Сборка полного проекта: 0 ошибок линтера на 5 модулях.
* Найдены и исправлены семантические ловушки: порядок `merge` при spread
  объектов, приоритет `%`/`+`, целочисленное деление, `const` с неконстантным
  выражением, отступы в `try/catch`.

## 7. Ограничение, которое стоит принять заранее

Перенос «один к одному» возможен для **данных и правил** (бой, экономика,
каталоги юнитов) — они становятся GDScript-модулями с теми же функциями.
Интерфейс, который браузер строит из JS, переносится **как структура**
(дерево узлов, стили, id), а обновление содержимого пишется заново — это
недостаток не плагина, а разницы между DOM и деревом сцен.
