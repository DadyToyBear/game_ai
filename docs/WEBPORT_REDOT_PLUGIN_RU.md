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
| `viewer/game.html` | около 210 КБ встроенного JS + CSS | разметка → `Game.tscn` (128 статических узлов); браузерная интерактивность требует ручного переноса |
| `src/battle_simulation.mjs` | игровой модуль фиксированного шага | → `webport/src/battle_simulation.gd`; конверсия отмечает семантические предупреждения и один TODO |
| `src/battle_contract.mjs` | контракт для симуляции боя | → `webport/src/battle_contract.gd`; результат требует сверки с исходным JS |
| `data/*.json` | 386 JSON-файлов в репозитории | копируются как есть |
| `assets/**` | 1821 файлов, 357,7 МБ | копируются; пути `res://assets/…` сохраняются |
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
Экранов (фильтр viewer/game.html):  1
Статических узлов сцены:          128
JS-модулей → GDScript:              3
Строк GDScript:                   638
JSON-данных:                      386
Ассетов:                         1821 (357.7 МБ)
TODO / предупреждения:           10 / 67
Ошибок gdparse:                    0
```

## 4. Порядок работы

1. **Структура.** Для этой игры используйте `--only viewer/game.html --no-copy-assets`:
   фильтр оставляет один экран, но общие модули и JSON сохраняет. Для быстрой
   проверки сцены ассеты не копируются; полноценная сборка займёт больше времени.
2. **Модули.** Разбирайте `report.json` по каждому файлу. В текущем прогоне у
   боевого модуля остаётся один TODO и есть семантические предупреждения — нельзя
   считать GDScript эквивалентом JS без сравнения сценариев.
3. **Сцены.** Откройте проект в Redot и проверьте контейнеры, размеры, ресурсы и
   сигналы. Шесть узлов, создаваемых динамическим HTML, отмечены в отчёте для
   ручного создания; Canvas и обработчики DOM переписываются отдельно.
4. **Ассеты.** Повторите сборку без `--no-copy-assets`; для этой игры это около
   358 МБ. Пути ресурсов сохраняются.
5. **Логика.** Сгенерированные `webport/src/*.gd` — стартовая основа для ручной
   интеграции, а не готовое подключённое игровое ядро. Сверьте поведение с браузерной
   версией до того, как считать перенос завершённым.

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
node addons/webport/tests/run_tests.mjs     # 32 проверки, 0 провалов
gdparse addons/webport/runtime/*.gd addons/webport/gdscript/*.gd
```

* `npm test`: 66/66 тестов браузерной игры.
* WebPort: 32/32 теста; проверена и сборка тестового проекта, включая сохранение
  модулей/JSON/ассетов при `--only` и запрет выходного каталога внутри исходников.
* Сборка выбранного экрана игры: gdparse проверил три сгенерированных файла,
  синтаксических ошибок нет. В Redot сам проект не запускался — движок недоступен
  в среде проверки.
* HTML raw-text обработка исправлена: встроенный скрипт игры больше не обрезается
  на `<` в сравнениях/шаблонах; динамически создаваемые id показываются в отчёте.

## 7. Ограничение, которое стоит принять заранее

Сборка WebPort создаёт основу Redot-проекта, но на текущем этапе **не даёт
играбельную нативную версию «Короны и знамени»**. Кампания строит интерфейс через
JavaScript, DOM и Canvas; эта логика, обработчики и шесть динамических UI-узлов
требуют ручного переноса. Сгенерированные GDScript-файлы и сцена должны быть
проверены в Redot и сравнены с браузерными сценариями. Подробности и актуальные
цифры — в [`WEBPORT_GAME_AUDIT_RU.md`](WEBPORT_GAME_AUDIT_RU.md).
