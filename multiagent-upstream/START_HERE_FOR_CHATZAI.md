# Подключение chat.z.ai → Godot/Redot через MCP bridge

Этот файл — инструкция для облачного ИИ (chat.z.ai), чтобы он мог управлять редактором Godot/Redot на машине пользователя через WebFTP-мост.

## 1. Конфигурация (важно!)

- **WebFTP-шара ( OrangePi 5+ ):** `${WEBFTP_SHARE}`
- Шара публичная, `permission: write` — можно писать `task-*.json` и читать `result-*.json` через HTTP PUT/GET.
- **bridge.py** запущен на **AMD-PC (Windows)** на порту **6510**, подключён к этой же шаре.
- Порты **6505–6508** заняты Node.js MCP-сервером Godot MCP Pro (он же используется локальным OpenCode). Не трогать.
- Godot/Redot должен быть открыт с включённым аддоном **Godot MCP Pro v1.16+** — он подключается к bridge по WS `ws://127.0.0.1:6510`.

## 2. Что нужно скачать с шары

```
${WEBFTP_SHARE}/mcp_call.py?view=1
${WEBFTP_SHARE}/Godot-MCP-Bridge-Guide.pdf?view=1
${WEBFTP_SHARE}/dashboard.html?view=1
${WEBFTP_SHARE}/README.md?view=1
```

`bridge.py` скачивать НЕ нужно — он уже запущен у пользователя. Он живёт здесь же на шаре на случай перезапуска.

## 3. Проверка подключения

ОБЯЗАТЕЛЬно задай переменную окружения `WEBFTP_SHARE`, иначе `mcp_call.py` стучится на старую шару:

```bash
WEBFTP_SHARE=${WEBFTP_SHARE} python mcp_call.py status
```

Ожидаемо:
```
Bridge alive : YES
Godot conn   : True
Pending tasks: 0
```

- `Bridge alive: NO` → попроси пользователя запустить `bridge.py` (см. §5).
- `Godot conn: False` → попроси открыть редактор Godot/Redot и включить аддон Godot MCP Pro.

## 4. Вызовы инструментов

```bash
# список методов
WEBFTP_SHARE=... python mcp_call.py tools/list

# информация о проекте
WEBFTP_SHARE=... python mcp_call.py get_project_info

# дерево сцен / скриптов
WEBFTP_SHARE=... python mcp_call.py get_filesystem_tree '{"filter":"*.tscn"}'
WEBFTP_SHARE=... python mcp_call.py get_filesystem_tree '{"filter":"*.gd"}'

# дерево текущей сцены
WEBFTP_SHARE=... python mcp_call.py get_scene_tree

# работа с редактором
python mcp_call.py play_scene '{"mode":"main"}'
python mcp_call.py stop_scene
python mcp_call.py get_editor_screenshot
python mcp_call.py get_game_screenshot        # только когда игра запущена
python mcp_call.py capture_frames '{"count":3,"interval":0.5}'
python mcp_call.py simulate_key '{"keycode":"KEY_SPACE"}'

# логи
python mcp_call.py get_editor_errors
python mcp_call.py get_output_log
python mcp_call.py read_script '{"path":"res://scripts/main.gd"}'

# состояние/история
python mcp_call.py history 10
```

Все вызовы — stateless: `mcp_call.py` пишет `task-<id>.json` на шару и ждёт `result-<id>.json` (обычно 3–8 сек).

## 5. Если bridge не запущен (инструкция пользователю)

На Windows-машине с Godot, в отдельном терминале:

```powershell
pip install websockets
python bridge.py --port 6510 --share ${WEBFTP_SHARE}
```

В консоли должно появиться:
```
[bridge] Godot connected from ('127.0.0.1', ...)
```
и heartbeat на шаре обновится:
```
${WEBFTP_SHARE}/bridge-heartbeat.json?view=1
```

## 6. Дашборд (визуальный статус)

```
${WEBFTP_SHARE}/dashboard.html?view=1
```
Показывает: Bridge alive, Godot connected, Pending tasks, Total calls, историю вызовов и быстрые кнопки.

## 7. Особые замечания

- В шаре много старых `result-*.json` — это аудит, **не удалять массово**.
- `get_game_screenshot` работает только когда игра запущена (`play_scene`).
- В Web-редакторе могут появляться ошибки `ERR_CANT_CREATE / tcp_server.cpp:65` — это ограничение браузера (нельзя слушать TCP), на MCP не влияет.
- Текущий проект: «Корона и знамя», главная сцена `res://scenes/main/main.tscn`.
- Полный PDF-гайд (26 стр.): `${WEBFTP_SHARE}/Godot-MCP-Bridge-Guide.pdf?view=1`

---

## Готовый промпт для chat.z.ai (скопируй целиком)

```
Подключись к моему Godot/Redot через MCP bridge.

Конфигурация:
- WebFTP шара (OrangePi 5+): ${WEBFTP_SHARE}
- bridge.py уже запущен у меня на Windows на порту 6510
- Godot MCP Pro addon включён в редакторе

Что сделать:
1. Скачай mcp_call.py с шары и ВСЕГДА ставь WEBFTP_SHARE=${WEBFTP_SHARE}
2. python mcp_call.py status → если Godot conn: False, скажи мне открыть редактор
3. Вызови tools/list и покажи количество методов
4. Вызови get_project_info — скажи название проекта и версию Godot
5. Вызови get_filesystem_tree с фильтром "*.tscn" — покажи сцены
6. Вызови get_scene_tree — покажи иерархию
7. Сохрани состояние в mcp-state/ и скажи «готов»
```
