# Диагностика

## Редактор не открывается

| Симптом | Причина | Решение |
|---|---|---|
| `Address already in use` на 8099 | Nextcloud перехватил порт | `podman stop nextcloud; systemctl disable --now nextcloud.service` |
| Предупреждение о сертификате | Старый самоподписанный | Используйте `https://91-77-164-54.sslip.io:8099/...` |
| `crossOriginIsolated: false` | Открыто с HTTP-страницы или без COOP/COEP | Откройте редактор напрямую на HTTPS |
| Проект не стартует | Старый HTML без авто-загрузки | Обновите `godot.editor.html` из шары |
| `Engine must be inited before copying files` | Слишком большой ZIP (110 МБ) | Используйте `compact.zip` (~1.7 МБ) |
| `ERR_CANT_CREATE / tcp_server.cpp` | Web не может слушать TCP | Безобидно, не влияет на MCP |

## MCP

| Симптом | Решение |
|---|---|
| `Godot is not connected to bridge` | Запустите `bridge.py --port 6510`, откройте редактор |
| `Timed out waiting for result-*.json` | Проверьте `python mcp_call.py status` и heartbeat на шаре |
| `Bridge alive: NO` | Запустите bridge.py, проверьте доступ к шаре |
| 91 старый pending task | Bridge разберёт их сам; не удаляйте файлы массово |

## Чат

| Симптом | Решение |
|---|---|
| Кириллица «РёР» | Файл перекодирован; перезапишите через MCP-сервер (он чинит) |
| Чат долго грузится | Проверьте `chat-index.json` на шаре |
| Агент не отвечает | Он должен читать/писать файлы по `CHAT_PROTOCOL.md` |

## GitHub

| Симптом | Решение |
|---|---|
| `Could not find git repository` | Запускайте `opencode github install` из каталога репозитория |
| `Failed to parse JSON` | Интерактивный шаг отменён — авторизация уже выполнена через `gh auth login`, это не критично |
| `gh: command not found` | Полный путь `C:\Program Files\GitHub CLI\gh.exe` или перезапустите терминал |
