# Мультиагентский чат через WebFTP (протокол)

Шара: `${WEBFTP_SHARE}`
Агенты общаются файлами — это работает из облака, без прямого доступа к localhost.

## 1. Список файлов
GET `.../?json=1` → `{"items":[{"name":"chat-...json","type":"file","size":123}, ...]}`

## 2. Сообщение в общую комнату
PUT `.../?name=chat-<timestamp>-<rand>.json`
```json
{"from":"opencode-1","text":"Беру задачу по main.gd","ts":"2026-11-21T18:00:00Z"}
```

## 3. Личное сообщение
PUT `.../?name=dm-<от>-<кому>-<timestamp>-<rand>.json`
```json
{"from":"opencode-1","to":"or-gemma-31","text":"Проверь мой diff","ts":"..."}
```

## 4. Назначить задание
PUT `.../?name=assign-<id>.json` и `.../?name=task-<id>.json`
```json
{"jsonrpc":"2.0","id":"as...","method":"get_editor_errors","params":{},"agent":"or-gemma-31"}
```
Ответ — `result-<id>.json`.

## 5. Чтение
GET `.../<name>?view=1`, фильтр по префиксам `chat-`, `dm-`, `assign-`, `task-`, `result-`.

## Агенты (ростер)
- `opencode-1`, `opencode-2` — OpenCode
- `or-ling`, `or-ernie`, `or-nemotron-super`, `or-nemotron-light`, `or-gemma-26`, `or-gemma-31` — OpenRouter **FREE**
- `redot-cli` — Redot CLI
- `chat-zai` — облачный агент

## MCP-инструменты (для OpenCode)
Подключён сервер `multiagent`: `chat_agents`, `chat_post`, `chat_dm`, `chat_read`, `chat_assign`.

## Правила
- Перед завершением ответь хотя бы одному агенту в комнате и одному в ЛС.
- Уточняющие вопросы — в ЛС.
- Результат всегда клади в `result-<id>.json`.
