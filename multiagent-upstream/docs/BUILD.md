# Сборка и запуск

## 1. Требования

- Windows 11 (AMD-PC) с Git, Node.js 18+, Python 3.10+
- OrangePi 5+ (Fedora aarch64) с root-доступом
- GitHub CLI (`winget install --id GitHub.cli`)
- Редактор Redot Web из `redot-web-editor-with-local-bridge.zip`

## 2. GitHub

```powershell
winget install --id GitHub.cli -e
gh auth login --web --git-protocol https
# введите одноразовый код с https://github.com/login/device

git clone https://github.com/DadyToyBear/redot-mcp-multiagent-bridge.git
cd redot-mcp-multiagent-bridge
```

## 3. WebFTP-шара (OrangePi)

Шара уже создана: `${WEBFTP_SHARE}` (public, write).

Создание новой шары через API:

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<WEBFTP_ADMIN_PASSWORD>"}' \
  http://192.168.100.70/api/login -c /tmp/cookies

curl -X POST -H "Content-Type: application/json" -b /tmp/cookies \
  -d '{"path":"/UPLOADS/chat.z.ai","kind":"public","permission":"write"}' \
  http://192.168.100.70/api/share
```

## 4. MCP-мост (AMD-PC)

Файлы `bridge.py`, `mcp_call.py` находятся на шаре.

```powershell
pip install websockets
python bridge.py --port 6510 --share ${WEBFTP_SHARE}
```

Ожидаемый вывод:
```
[bridge] Godot connected from ('127.0.0.1', ...)
```

Проверка:
```powershell
$env:WEBFTP_SHARE="${WEBFTP_SHARE}"
python mcp_call.py status
python mcp_call.py get_project_info
python mcp_call.py get_editor_errors
```

## 5. Мультиагентский чат

```powershell
pip install websockets
python multiagent-mcp.py
```

Добавьте в `opencode.json` (см. `opencode.example.json`):

```jsonc
{
  "mcp": {
    "multiagent": {
      "type": "local",
      "command": ["python", "multiagent-mcp.py"],
      "enabled": true,
      "environment": {
        "WEBFTP_SHARE": "${WEBFTP_SHARE}"
      }
    }
  }
}
```

Проверка в OpenCode: `opencode mcp list` → `multiagent connected`.

## 6. OpenRouter (бесплатные модели)

```jsonc
{
  "provider": {
    "openrouter": { "options": { "apiKey": "{env:OPENROUTER_API_KEY}" } }
  },
  "small_model": "openrouter/google/gemma-4-31b-it:free"
}
```

Список бесплатных моделей: https://openrouter.ai/models?variant=free

## 7. Веб-редактор на OrangePi

См. [ORANGEPI.md](ORANGEPI.md).

## 8. Сборка ZIP-набора для облачного ИИ

На OrangePi:

```bash
cd /tmp
rm -rf chatzai-kit && mkdir -p chatzai-kit/webredot chatzai-kit/mcp
cp /opt/webftp/web/webredot/* chatzai-kit/webredot/  # кроме crown_banner.zip
cp /opt/webftp/storage/UPLOADS/chat.z.ai/*.py chatzai-kit/mcp/
cd chatzai-kit && zip -qr /opt/webftp/storage/UPLOADS/chat.z.ai/chatzai-full-kit.zip .
```

Ссылка: `${WEBFTP_SHARE}/chatzai-full-kit.zip`
