# WebPort — плагин переноса браузерной игры в Redot

Плагин-мост для **Redot 26.x** (совместим с Godot 4.3+, `config_version=5`).
Берёт готовую браузерную игру на HTML/CSS/JS и собирает из неё проект Redot:

| В веб-версии | В проекте Redot |
|---|---|
| `viewer/game.html` (разметка + CSS + JS) | `scenes/Game.tscn` и `scripts/Game.gd`, GDScript подключён к корневому узлу сцены |
| стили из `<style>` | `StyleBoxFlat`, размеры, цвета, `HBoxContainer`/`VBoxContainer`/`GridContainer` |
| `src/battle_simulation.mjs`, `battle_contract.mjs` | `webport/src/battle_simulation.gd` — GDScript-модуль с теми же функциями |
| `<canvas>` | `SubViewportContainer` + `SubViewport`; подложка и SVG-слой подключаются как `TextureRect`, метки открывают информационный диалог; динамическое состояние и камера остаются TODO |
| `data/*.json` | `data/*.json` без изменений (`JSON.parse_string`) |
| `assets/**` | `assets/**` (пути сохраняются, `url('/assets/…')` становится `res://assets/…`) |
| `id="resourceBar"` | `webport/dom_links.json`: `resourceBar → ResourceBar`, доступ через `WebportLinks.ui("resourceBar")` |

Ключевой принцип: **плагин не делает вид, что перенос полный**. Каждая неперенесённая
конструкция попадает в `webport/REPORT.md` с номером строки, а в GDScript остаётся
`pass  # TODO(webport): …`. Вы сразу видите, что осталось руками.

---

## Установка (3 минуты)

1. Скачайте `webport-addon.zip` и распакуйте **в корень проекта Redot**
   (внутри архива уже лежит `addons/webport/…`).
2. `Project → Project Settings → Plugins` → включите **WebPort**.
3. Внизу редактора появится панель **WebPort**; её же можно открыть через
   `Проект → Сервис → WebPort: открыть панель переноса`.

Требования: **Node.js 18+** в `PATH`. Проверка: `node --version`.
Панель сама напишет, если Node не найден, и заблокирует кнопку сборки.

> Почему Node, а не чистый GDScript? Разбор JS/CSS/HTML в GDScript означал бы
> второй парсер, который придётся поддерживать. Сборщик на Node использует
> проверенный парсер **acorn** (MIT, лежит в `vendor/`) и работает за секунды.
> В самом Redot остаются только рантайм-хелперы и таблица узлов.

---

## Как переносить

1. Панель **WebPort** → укажите пути:
   - *Веб-игра* — каталог, где лежат `viewer/`, `src/`, `data/`, `assets/`;
   - *Проект Redot* — соседний или внешний каталог (сборка внутрь исходников запрещена);
   - *HTML-экраны* — необязательный фильтр, например `viewer/game.html`, чтобы собирать только экран игры.
2. Выключите «копировать ассеты», если хотите сначала проверить структуру
   (в этой игре около 358 МБ ресурсов копируются вместе с остальным).
3. Нажмите **Собрать проект**. Сборка выполняется в отдельном процессе, редактор остаётся отзывчивым; панель покажет итог и сводку по экранам, модулям и замечаниям.
4. Для Canvas задайте `data-background-image` для подложки. Для статических границ задайте также `data-overlay-source="/data/worldmap.json"`, `data-overlay-image="/assets/worldmap/world_overlay.svg"` и `data-territory-colors='{"faction_id":"#668855"}'`: сборщик создаст SVG из территориальных полигонов и точек `objects` в JSON, включит его поверх фона в `SubViewport` и добавит нативный GDScript-обработчик: клик рядом с ориентиром открывает информационное окно с типом и координатами; курсор-рука появляется только над ориентиром, а клики по пустым участкам overlay пропускаются дальше, не блокируя родительскую сцену. Геометрия и владение остаются статичными — игровая смена владельца, управление поселением, игровые постройки/отряды, анимация и камера требуют отдельной реализации.
5. Кнопка **Отчёт** открывает `webport/report.json`, кнопка **Проверка** —
   локальную страницу со структурой сцен.

То же самое из терминала:

```bash
node addons/webport/tools/build_project.mjs \
  --source ../game_ai_web \
  --out ../koh_redot \
  --name "Корона и знамя"
```

Опции: `--only <подстрока>` фильтрует только HTML-экраны (общие модули/JSON/ассеты остаются),
`--no-copy-assets`, `--main-scene viewer/game.html`, `--serve` (поднять страницу проверки).

После сборки проект открывается в Redot обычным способом:

```bash
redot --path ../koh_redot              # редактор
redot --path ../koh_redot --headless --quit   # проверить, что сцены грузятся
```

---

## Что именно переносится

### Разметка → сцена

| HTML | Godot-узел |
|---|---|
| `div`, `section`, `main`, `aside`, `header` | `Panel` (если есть фон/рамка) или `Control` |
| `button` | `Button` |
| `select` | `OptionButton` |
| `input[type=text]` / `textarea` | `LineEdit` |
| `input[type=checkbox]` | `CheckBox` |
| `img` | `TextureRect` (+ `ext_resource` на реальный файл) |
| `canvas` | `Viewport` (заглушка: рисование на канвасе переносится вручную) |
| `span`, `b`, `small`, `h1…h6`, `p` | `Label` |
| `display:flex` | `HBoxContainer` / `VBoxContainer` |
| `display:grid` | `GridContainer` с числом колонок |

CSS разбирается каскадом (тег/класс/id, приоритет по специфичности и порядку).
Из свойств переносятся: `width/height/min-width`, `background-color`,
`border`, `border-radius`, `color`, `font-size`, `text-align`, `padding`, `gap`.
Псевдоклассы (`:hover`) и медиазапросы **не** применяются — они уходят в отчёт.

### JS → GDScript

Реализовано (проверяется тестами): `const/let` с выводом типа, `var`/`const`
по контексту, арифметика и сравнения, тернарники, объекты и массивы,
`Math.*`, `Object.keys/values/entries`, `JSON.*`, шаблонные строки,
деструктуризация параметров, `?.`, `??`, `for…of` (включая пары `[k, v]`),
классический `for` → `range()`, `while`, `try/catch` (с предупреждением),
`map/filter/some/every/find/reduce/sort/forEach` → `WebportRuntime.*`,
`.push/.slice/.includes/.indexOf/.join/.split/…`.

Важная деталь: `a || b` в JS возвращает **операнд**, а не `bool`. Конвертер это
учитывает: для значений получается `(a if a else b)`, для условий — `or`.

Не переносится автоматически (и честно попадает в отчёт):
`document.*`, `querySelector`, `innerHTML`, `addEventListener`, `fetch`,
`setTimeout`/`requestAnimationFrame`, `await`/Promise, `Map`/`Set` (заменяются
на `Dictionary`/`Array` с предупреждением), регулярные выражения, классы `class`,
анонимные функции вне вызова.

---

## Что внутри

```
addons/webport/
├── plugin.cfg / plugin.gd        точка входа редакторского плагина
├── gdscript/
│   ├── webport_panel.gd          док-панель (пути, сборка, сводка, лог)
│   └── webport_cli.gd            запуск Node-сборщика из редактора
├── runtime/
│   ├── webport_runtime.gd        аналоги JS-функций (map/filter/typeof/…)
│   └── webport_links.gd          автозагрузка: id из HTML → узел
├── core/
│   ├── js_to_gd.mjs              JS AST → GDScript (на acorn)
│   ├── html_dom.mjs              разбор HTML в дерево
│   ├── html_to_scene.mjs         HTML+CSS → .tscn, id → путь
│   ├── html_scripts.mjs          вынимает JS из страницы
│   ├── dom_bindings.mjs          генерирует таблицу id → узел
│   └── gd_lint.mjs               проверка синтаксиса GDScript (gdtoolkit)
├── tools/
│   ├── build_project.mjs         CLI-сборка проекта
│   ├── build_async.mjs           сборка для панели редактора без блокировки UI
│   ├── serve.mjs                 локальная страница проверки
│   └── pack_zip.mjs              упаковка плагина в ZIP
├── tests/run_tests.mjs           37 проверок без движка
└── vendor/acorn.mjs              парсер JS (MIT)
```

---

## Проверка

```bash
# тесты самого плагина (без Redot)
node addons/webport/tests/run_tests.mjs

# синтаксис GDScript (если установлен gdtoolkit: pip install gdtoolkit)
gdparse addons/webport/runtime/*.gd addons/webport/gdscript/*.gd
```

Сборка сама прогоняет линтер по каждому сгенерированному `.gd` и пишет число
ошибок в отчёт. Если `gdparse` не установлен, в отчёте будет `0` и пометка,
что синтаксис не проверялся — без этого легко принять «файл создан» за «файл работает».

---

## Ограничения, которые важно знать заранее

* **Интерфейс, который строится из JS** (`el.innerHTML = ...`) не может стать
  сценой: в HTML таких узлов физически нет. Плагин создаёт контейнер и пишет
  в отчёт, какие id заполняются из кода — их разметку нужно перенести в сцену
  или собирать в GDScript.
* **Канвас** (`<canvas>` с игровым циклом) переносится как узел-заглушка.
  Рисование переписывается на `_draw()`/`Node2D`/`Sprite2D`.
* **Классы и наследование** (`class Unit {}`) не транслируются: используйте
  сцены + скрипты-компоненты.
* **Асинхронность**: `fetch` становится `WebportData.load_json()` (см. `runtime/`),
  `await` и Promise переписываются вручную через сигналы.
* **Точные пиксели**: CSS-раскладка свободная, Godot — контейнерная. После
  сборки пройдитесь по сценам: обычно нужно поправить 5–10 `size_flags`
  и отступы.

---

## Лицензия и сторонний код

Код плагина — MIT. В `vendor/acorn.mjs` лежит acorn 8.19.0 (MIT, см.
`vendor/ACORN_LICENSE.txt`).
