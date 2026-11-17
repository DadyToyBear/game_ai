# Отчёт переноса в Redot

Источник: `/home/user/game_ai/examples/webgame_min`
Проект: `/home/user/game_ai/demo/webport_min`
Собрано: 2026-11-17T19:57:20.785Z

## Итог

| Показатель | Значение |
|---|---|
| Экранов (HTML → сцена) | 1 |
| JS-модулей → GDScript | 2 |
| Строк GDScript | 51 |
| JSON-данных скопировано | 0 |
| Ассетов скопировано | 0 (0 МБ) |
| Замечаний всего | 6 |
| Из них требуют ручной работы | 0 |
| Ошибок линтера GDScript | 0 |

## Экраны

| Страница | Сцена | Узлов | CSS-правил | Замечаний |
|---|---|---|---|---|
| index.html | `scenes/Index.tscn` | 8 | 12 | 0 |

## JS → GDScript

| Модуль | Файл | Строк | TODO | Предупреждений |
|---|---|---|---|---|
| index.html:inline | `scripts/Index.gd` | 18 | 6 | 0 |
| src/campaign.mjs | `webport/src/campaign.gd` | 33 | 0 | 0 |

## Что требует внимания

### index.html:inline

- строка 7: #gold.textContent = … — перенесите в WebportLinks.set_prop("gold", "text")
- строка 8: #army.textContent = … — перенесите в WebportLinks.set_prop("army", "text")
- строка 9: #log.innerHTML = … — перенесите в WebportLinks.set_prop("log", "text")
- строка 12: getElementById() — используйте WebportDom/узлы сцены
- строка 12: анонимная функция/стрелка вне вызова — вынесите в отдельный func
- строка 12: .addEventListener("click") — подключите через WebportEvents или сигнал сцены

## Как проверить

```bash
# из каталога проекта
redot --headless --quit --path /home/user/game_ai/demo/webport_min
```

Если движок пишет об ошибке сцены — начните с файла `webport/report.json`:
там те же замечания в машиночитаемом виде.
