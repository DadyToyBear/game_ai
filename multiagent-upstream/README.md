# Redot Web + MCP Bridge + Multiagent Chat

Полный набор инструментов для работы облачного ИИ (chat.z.ai) с веб-редактором Godot/Redot через WebFTP-мост.

**Репозиторий:** https://github.com/DadyToyBear/redot-mcp-multiagent-bridge

## Что это

```
Облачный ИИ (chat.z.ai)
        │  HTTP PUT/GET task-*.json / result-*.json
        ▼
WebFTP-шара на OrangePi 5+  (${WEBFTP_SHARE})
        │  polling 1.5 c
        ▼
bridge.py (Windows AMD-PC, WS :6510)
        │  WebSocket
        ▼
Redot Web Editor + Godot MCP Pro addon ( OrangePi, HTTPS :8099 )
```

Плюс мультиагентский чат поверх тех же файлов и MCP-сервер `multiagent-mcp.py`.

## Состав репозитория

| Файл | Назначение |
|---|---|
| `multiagent-mcp.py` | MCP-сервер чата: `chat_agents`, `chat_post`, `chat_dm`, `chat_read`, `chat_assign` |
| `CHAT_PROTOCOL.md` | Формат файлов чата (`chat-*`, `dm-*`, `assign-*`) |
| `START_HERE_FOR_CHATZAI.md` | Подключение облачного ИИ к MCP-мосту |
| `dashboard.html` | Дашборд с вкладками Dashboard / Live / Чат |
| `opencode.example.json` | Пример конфигурации OpenCode без секретов |
| `docs/BUILD.md` | Сборка и запуск всех компонентов |
| `docs/ORANGEPI.md` | Настройка OrangePi 5+ (HTTPS, шара, редактор) |
| `docs/TROUBLESHOOTING.md` | Типичные проблемы и решения |

## Быстрый старт

1. Откройте дашборд: https://91-77-164-54.sslip.io:8099/dashboard.html
2. Вкладка **🎮 Live** — редактор + живой кадр игры + логи.
3. Вкладка **💬 Чат** — комната, личные сообщения, выдача заданий моделям.
4. Для доступа извне используйте WebFTP-шару и `mcp_call.py` (см. `START_HERE_FOR_CHATZAI.md`).

## Важно

- API-ключи и пароли **не хранятся** в репозитории — используйте переменные окружения (`{env:OPENROUTER_API_KEY}`).
- Полная сборка редактора и проект находятся на OrangePi, в репозитории — только инструменты.

Подробности: [docs/BUILD.md](docs/BUILD.md).
