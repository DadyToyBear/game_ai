# Настройка OrangePi 5+

## 1. WebFTP

Установлен в `/opt/webftp`, serves:
- `/opt/webftp/storage` — файлы шар
- `/opt/webftp/web` — статические сайты (`/web/...`)
- `/opt/webftp/public` — корень порта 80

Шара чата: `/opt/webftp/storage/UPLOADS/chat.z.ai` → `${WEBFTP_SHARE}`

## 2. Веб-редактор

Путь: `/opt/webftp/web/webredot/`

Файлы: `godot.editor.html` (с правками), `godot.editor.js`, `godot.editor.wasm`,
`compact.zip` (проект «Корона и знамя»), воркеры, иконки.

Правки в HTML:
- авто-загрузка `compact.zip` через `startEditor(arrayBuffer)`;
- аргументы `--path /home/web_user/preload --editor`;
- авто-закрытие welcome-модалки;
- скрытая панель моста, кнопка «Логи», CSS-масштабирование canvas.

## 3. HTTPS на порту 8099

Порт 8099 проброшен роутером на OrangePi. Используется доверенный сертификат
Let's Encrypt для домена `91-77-164-54.sslip.io` (бесплатный wildcard DNS).

```bash
# выпуск сертификата (acme.sh + webroot порта 80)
curl https://get.acme.sh | sh
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
~/.acme.sh/acme.sh --issue -d 91-77-164-54.sslip.io -w /opt/webftp/public

mkdir -p /etc/ssl/zai
cp ~/.acme.sh/91-77-164-54.sslip.io_ecc/fullchain.cer /etc/ssl/zai/fullchain.cer
cp ~/.acme.sh/91-77-164-54.sslip.io_ecc/91-77-164-54.sslip.io.key /etc/ssl/zai/privkey.key
```

Сервер: `/root/editor_https.py` (Python `ThreadingHTTPServer` + TLS, заголовки COOP/COEP):

```bash
nohup python3 /root/editor_https.py > /root/editor_https.log 2>&1 &
ss -tlnp | grep 8099
```

Ссылки:
- редактор: https://91-77-164-54.sslip.io:8099/godot.editor.html
- дашборд: https://91-77-164-54.sslip.io:8099/dashboard.html

## 4. Конфликт порта 8099

Раньше порт занимал контейнер Nextcloud (`0.0.0.0:8099->80`). Он отключён:

```bash
podman stop nextcloud
systemctl disable --now nextcloud.service
```

Если редактор не стартует с `Address already in use` — проверьте `podman ps`.

## 5. Проброс портов роутера (Huawei)

Внешний → внутренний: `8099 → 192.168.100.70:8099`, `80 → 192.168.100.70:80`.

## 6. Обновление редактора

Скопируйте новый `godot.editor.html` и `compact.zip` в
`/opt/webftp/web/webredot/`, затем перезапустите сервер:

```bash
kill $(ss -tlnp | grep 8099 | grep -o 'pid=[0-9]*' | cut -d= -f2)
nohup python3 /root/editor_https.py > /root/editor_https.log 2>&1 &
```
