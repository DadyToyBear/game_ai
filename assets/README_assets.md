# Ассеты «Корона и знамя» — что уже сгенерировано

Сгенерировано по файлу промтов «Промты для nano banana 2» (17.11.2026).
Генератор отдаёт широкий кадр 1408×768 (фоны — 1376×768), поэтому все
ассеты дополнительно приведены в игровой вид скриптами из `tools/`.

## Готово

| Блок | Файл | Размер | Примечание |
|---|---|---|---|
| 1.2 | `assets/units/cards/archer_card.png` | 512×512 RGBA | Лучник |
| 1.3 | `assets/units/cards/axeman_card.png` | 512×512 RGBA | Топорщик |
| 1.4 | `assets/units/cards/spearman_card.png` | 512×512 RGBA | Копейщик |
| 1.5 | `assets/units/cards/cavalry_card.png` | 512×512 RGBA | Кавалерист |
| 1.6 | `assets/units/cards/slinger_card.png` | 512×512 RGBA | Пращник |
| 2.1 | `assets/units/cards/viking_card.png` | 512×512 RGBA | Викинг |
| 2.2 | `assets/units/cards/gaul_card.png` | 512×512 RGBA | Галл |
| 2.3 | `assets/units/cards/slavic_card.png` | 512×512 RGBA | Славянин |
| 2.4 | `assets/units/cards/roman_card.png` | 512×512 RGBA | Римлянин |
| 3.1 | `assets/ui/battle/battle_panel.png` | 1408×768 RGB | Пергамент в дубовой раме |
| 3.2 | `assets/ui/battle/battle_buttons.png` | 1408×768 RGB | 6 пустых овальных кнопок в ряд |
| 3.3 | `assets/ui/battle/command_icons.png` + `_row.png` + `icons/` | 1408×768 / 768×128 / 128×128 | 6 иконок приказов |
| 3.4 | `assets/ui/battle/formation_icons.png` + `_row.png` + `icons/` | 1408×768 / 384×128 / 128×128 | 3 иконки построений |
| 3.5 | `assets/ui/battle/status_icons.png` + `_row.png` + `icons/` | 1408×768 / 512×128 / 128×128 | 4 иконки состояний |
| 3.6 | `assets/ui/battle/round_banner.png` | 1315×704 RGBA | Плашка раунда, фон прозрачный |
| 3.7 | `assets/ui/battle/hp_bar.png` | 1408×768 RGB | Рамка полосы численности |
| 4.1 | `assets/battle_scenarios/battle_bg_river.png` | 1376×768 RGB | Река и брод |
| 4.2 | `assets/battle_scenarios/battle_bg_forest.png` | 1348×740 RGB | Лесная чаща (кайма срезана) |
| 4.3 | `assets/battle_scenarios/battle_bg_bridge.png` | 1376×768 RGB | Каменный мост |
| 4.4 | `assets/battle_scenarios/battle_bg_fortress.png` | 1376×768 RGB | Стены крепости |

Иконки 3.3–3.5 нарезаны отдельными файлами с прозрачностью:

- приказы: `attack`, `defend`, `volley`, `charge`, `hold`, `retreat`;
- построения: `line`, `shieldwall`, `wedge`;
- состояния: `morale`, `fatigue`, `sickness`, `march`.

В листе приказов генератор нарисовал 8 иконок вместо 6 (лишние —
дубли конницы и знамени), поэтому годные выбраны вручную:
`--pick 1,2,3,4,6,8`. Файлы `charge2.png` и `hold2.png` — неиспользованные
дубли, их можно удалить.

## Ещё не готово

- 1.1 `sword_card.png` — по файлу промтов нужен только как замена, в игре есть.
- 3.x дубли: 6 кнопок 3.2 не нарезаны на отдельные PNG (пока лист).
- 4.5 `battle_tiles.png` — тайлсет 4×2.
- 5.1–5.2 `*_walk.png` — спрайт-листы ходьбы 8 кадров.
- 6.1–6.3 `codex_cover`, `muster_scene`, `siege_aftermath`.

## Скрипты (`tools/`)

- `normalize_cards.py` — из широкой генерации делает квадратную карточку:
  режет дубли-панели, выбирает вариант, строит альфу, вписывает в 512×512.
- `slice_icons.py` — нарезает лист иконок на круглые PNG 128×128 с
  прозрачностью и собирает ровный лист в один ряд.
- `checkerboard_to_alpha.py` — заменяет нарисованную «шахматку прозрачности»
  настоящей альфой (понадобился для плашки раунда).
- `imgtools.py` — связные области без scipy (общая зависимость).

Примеры запуска — в docstring каждого скрипта. Требуется `pillow` и `numpy`.
