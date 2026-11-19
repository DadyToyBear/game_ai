# WebPort (addon в составе проекта)

Этот каталог — часть перенесённого проекта. Он нужен, чтобы проект оставался
самодостаточным и открывался в Redot без исходного веб-каталога.

- `runtime/webport_runtime.gd` — аналоги JS-функций (map/filter/typeof/compare…).
- `runtime/webport_links.gd` — автозагрузка «id из HTML → путь к узлу».
- `webport/dom_links.json` — таблица соответствия id и узлов.

Пересобрать проект можно из репозитория плагина:
`node addons/webport/tools/build_project.mjs --source <веб-игра> --out <этот проект>`.
