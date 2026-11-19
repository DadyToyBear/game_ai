# Отчёт переноса в Redot

Источник: `game_ai` (ветка `arena/22e54df2-game-ai`, веб-версия «Корона и знамя»)
Проект: `koh_redot` (путь у каждого свой)
Собрано: 2026-11-17T19:56:40.840Z

## Итог

| Показатель | Значение |
|---|---|
| Экранов (HTML → сцена) | 3 |
| JS-модулей → GDScript | 5 |
| Строк GDScript | 648 |
| JSON-данных скопировано | 384 |
| Ассетов скопировано | 1817 (356.4 МБ) |
| Замечаний всего | 48 |
| Из них требуют ручной работы | 16 |
| Ошибок линтера GDScript | 0 |

## Экраны

| Страница | Сцена | Узлов | CSS-правил | Замечаний |
|---|---|---|---|---|
| viewer/animations.html | `scenes/Animations.tscn` | 7 | 33 | 2 |
| viewer/game.html | `scenes/Game.tscn` | 128 | 681 | 47 |
| viewer/squad-demo.html | `scenes/SquadDemo.tscn` | 5 | 17 | 0 |

## JS → GDScript

| Модуль | Файл | Строк | TODO | Предупреждений |
|---|---|---|---|---|
| viewer/animations.html:inline | `scripts/Animations.gd` | 76 | 38 | 1 |
| viewer/game.html:inline | `scripts/Game.gd` | 1 | 1 | 0 |
| viewer/squad-demo.html:inline | `scripts/SquadDemo.gd` | 1 | 1 | 0 |
| src/battle_contract.mjs | `webport/src/battle_contract.gd` | 85 | 0 | 3 |
| src/battle_simulation.mjs | `webport/src/battle_simulation.gd` | 485 | 0 | 18 |

## Что требует внимания

### viewer/animations.html:inline

- строка 41: регулярные выражения не переносятся, используйте RegEx вручную
- строка 41: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 44: getElementById() — используйте WebportDom/узлы сцены
- строка 47: querySelectorAll() — используйте WebportDom/узлы сцены
- строка 47: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 47: b.addEventListener("click") — подключите через WebportEvents или сигнал сцены
- строка 55: инструкция ClassDeclaration не поддержана
- строка 115: requestAnimationFrame() — замените на таймер/сигнал процесса
- строка 120: await — переносите асинхронность вручную (сигналы/tween)
- строка 125: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 134: getElementById() — используйте WebportDom/узлы сцены
- строка 136: getElementById() — используйте WebportDom/узлы сцены
- строка 145: await — переносите асинхронность вручную (сигналы/tween)
- строка 146: await — переносите асинхронность вручную (сигналы/tween)
- строка 155: createElement() — используйте WebportDom/узлы сцены
- строка 160: appendChild() — используйте WebportDom/узлы сцены
- строка 167: appendChild() — используйте WebportDom/узлы сцены
- строка 168: querySelector() — используйте WebportDom/узлы сцены
- строка 171: querySelector() — используйте WebportDom/узлы сцены
- строка 172: querySelector() — используйте WebportDom/узлы сцены
- строка 173: querySelector() — используйте WebportDom/узлы сцены
- строка 174: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 174: range.addEventListener("input") — подключите через WebportEvents или сигнал сцены
- строка 179: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 179: pp.addEventListener("click") — подключите через WebportEvents или сигнал сцены
- строка 183: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 117: requestAnimationFrame() — замените на таймер/сигнал процесса
- строка 190: getElementById() — используйте WebportDom/узлы сцены
- строка 190: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 190: .addEventListener("change") — подключите через WebportEvents или сигнал сцены
- строка 193: getElementById() — используйте WebportDom/узлы сцены
- строка 193: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 193: .addEventListener("change") — подключите через WebportEvents или сигнал сцены
- строка 196: getElementById() — используйте WebportDom/узлы сцены
- строка 196: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 196: .addEventListener("change") — подключите через WebportEvents или сигнал сцены
- строка 204: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 204: Promise (.then/.catch) — асинхронность переносится вручную

### viewer/game.html:inline

- строка 32: синтаксис JS не разобран: Unexpected token (32:304)

### (сцена)

- max-width 588.8000000000001px у ResourceBar — замените на size_flags/скрипт
- max-width 360px у IntroSubtitle — замените на size_flags/скрипт
- max-width 780px у IntroFactionPicker — замените на size_flags/скрипт
- max-width 460px у P — замените на size_flags/скрипт
- max-width 780px у IntroLoadPanel — замените на size_flags/скрипт
- max-width 780px у IntroSettingsPanel — замените на size_flags/скрипт
- max-width 460px у Footnote — замените на size_flags/скрипт
- max-width 780px у IntroExitPanel — замените на size_flags/скрипт

### viewer/squad-demo.html:inline

- строка 58: синтаксис JS не разобран: Unexpected token (58:16)

## Предупреждения (перенесено, но проверьте)

- строка 144: try/catch: в GDScript нет исключений — catch выполняется всегда, обработку ошибок проверьте вручную
- viewer/animations.html: в HTML всего 7 статических узлов, а JS — 7 КБ: интерфейс строится из кода (innerHTML), переносите его узлы вручную или через WebportLinks
- letter-spacing не поддерживается Label — перенесите в шрифт (H1)
- innerHTML-контейнер #status отсутствует в HTML — создайте узел вручную
- letter-spacing не поддерживается Label — перенесите в шрифт (Brand)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle2)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle3)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle4)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle5)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle6)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle7)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle8)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle9)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle10)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle11)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle12)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle13)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle14)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle15)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle16)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle17)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle18)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle19)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle20)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle21)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle22)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle23)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle24)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle25)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle26)
- letter-spacing не поддерживается Label — перенесите в шрифт (SectionTitle27)
- letter-spacing не поддерживается Label — перенесите в шрифт (IntroKicker)
- letter-spacing не поддерживается Label — перенесите в шрифт (IntroTitle)
- letter-spacing не поддерживается Label — перенесите в шрифт (ContinueGame)
- letter-spacing не поддерживается Label — перенесите в шрифт (StartGame)
- letter-spacing не поддерживается Label — перенесите в шрифт (LoadGame)
- letter-spacing не поддерживается Label — перенесите в шрифт (SettingsGame)
- letter-spacing не поддерживается Label — перенесите в шрифт (ExitGame)
- letter-spacing не поддерживается Label — перенесите в шрифт (ConfirmIntroFaction)
- letter-spacing не поддерживается Label — перенесите в шрифт (BackIntroMenu)
- letter-spacing не поддерживается Label — перенесите в шрифт (IntroFoot)
- innerHTML-контейнер #status отсутствует в HTML — создайте узел вручную
- строка 36: побитовый >>> в GDScript работает с int: проверьте приведение
- строка 36: побитовый >>> в GDScript работает с int: проверьте приведение
- строка 37: побитовый >>> в GDScript работает с int: проверьте приведение
- строка 80: Set → Array (для .has() используется оператор in)
- строка 107: || с побочным эффектом в левой части — используется хелпер, right вычисляется всегда
- строка 113: побитовый >>> в GDScript работает с int: проверьте приведение
- строка 134: Set → Array (для .has() используется оператор in)
- строка 135: многострочная лямбда вынесена в метод _wb_lambda_1() — проверьте захват внешних переменных
- строка 146: || с побочным эффектом в левой части — используется хелпер, right вычисляется всегда
- строка 214: побитовый >>> в GDScript работает с int: проверьте приведение
- строка 215: побитовый << в GDScript работает с int: проверьте приведение
- строка 216: побитовый >>> в GDScript работает с int: проверьте приведение
- строка 217: побитовый << в GDScript работает с int: проверьте приведение
- строка 218: побитовый >>> в GDScript работает с int: проверьте приведение
- строка 266: многострочная лямбда вынесена в метод _wb_lambda_2() — проверьте захват внешних переменных
- строка 323: || с побочным эффектом в левой части — используется хелпер, right вычисляется всегда
- строка 323: || с побочным эффектом в левой части — используется хелпер, right вычисляется всегда
- …ещё 4

## Как проверить

```bash
# из каталога проекта
redot --headless --quit --path /tmp/port_full
```

Если движок пишет об ошибке сцены — начните с файла `webport/report.json`:
там те же замечания в машиночитаемом виде.
