#!/usr/bin/env bash
# Установка SystemPrompt PRO на чистый сервер Ubuntu. Запуск (от root):
#   curl -fsSL https://raw.githubusercontent.com/ivannickolaev90-svg/systemprompt-pro/main/server/install.sh | bash
# Повторный запуск безопасен: обновит код и настройки, секреты не тронет.
set -euo pipefail
REPO=https://github.com/ivannickolaev90-svg/systemprompt-pro
APP=/opt/systemprompt-pro
DATA=/var/lib/systemprompt-pro
ENVF=/etc/systemprompt-pro.env
export DEBIAN_FRONTEND=noninteractive

echo "==> Пакеты"
apt-get update -q
apt-get install -y -q git curl ca-certificates sqlite3 caddy openssl

if ! node -e 'require("node:sqlite")' 2>/dev/null; then
  apt-get install -y -q nodejs || true
fi
if ! node -e 'require("node:sqlite")' 2>/dev/null; then
  echo "==> Ставлю Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -e 'require("node:sqlite")' 2>/dev/null || { echo "ОШИБКА: нужен Node.js 22.13+"; exit 1; }
echo "Node.js $(node -v)"

echo "==> Пользователь и папки"
id sp >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d "$APP" sp
mkdir -p "$DATA/backups"
chown -R sp:sp "$DATA"

echo "==> Код"
if [ -d "$APP/.git" ]; then
  runuser -u sp -- git -C "$APP" fetch -q origin main
  runuser -u sp -- git -C "$APP" reset -q --hard origin/main
else
  rm -rf "$APP"; mkdir -p "$APP"; chown sp:sp "$APP"
  runuser -u sp -- git clone -q --depth 1 "$REPO" "$APP"
fi

echo "==> Секреты"
if [ ! -f "$ENVF" ]; then
  umask 077
  {
    echo "LICENSE_SECRET=$(openssl rand -hex 32)"
    echo "ADMIN_TOKEN=$(openssl rand -hex 16)"
    echo "YOOKASSA_SHOP_ID=1516450"
  } > "$ENVF"
  ask() { # $1 — имя переменной, $2 — подсказка; ввод не показывается на экране
    local val=""
    if [ -r /dev/tty ]; then read -rsp "$2 (Enter — пропустить): " val </dev/tty || true; echo; fi
    if [ -n "$val" ]; then echo "$1=$val" >> "$ENVF"; fi
    return 0
  }
  ask GROQ_API_KEY "Вставьте ключ Groq (gsk_...)"
  ask YOOKASSA_SECRET_KEY "Вставьте секретный ключ ЮKassa (live_...)"
fi
chmod 600 "$ENVF"

# Команда для смены секрета позже: systemprompt-secret GROQ_API_KEY
cat > /usr/local/bin/systemprompt-secret <<'SEC'
#!/usr/bin/env bash
set -e
[ -n "$1" ] || { echo "Использование: systemprompt-secret ИМЯ"; exit 1; }
read -rsp "Значение для $1: " v; echo
F=/etc/systemprompt-pro.env
grep -v "^$1=" "$F" > "$F.tmp" || true
echo "$1=$v" >> "$F.tmp"; chmod 600 "$F.tmp"; mv "$F.tmp" "$F"
systemctl restart systemprompt-pro && echo "Сохранено, сайт перезапущен"
SEC
chmod 755 /usr/local/bin/systemprompt-secret

echo "==> Службы"
cat > /etc/systemd/system/systemprompt-pro.service <<UNIT
[Unit]
Description=SystemPrompt PRO
After=network-online.target
Wants=network-online.target

[Service]
User=sp
WorkingDirectory=$APP
EnvironmentFile=$ENVF
Environment=PORT=8787 DB_PATH=$DATA/db.sqlite NODE_ENV=production
ExecStart=/usr/bin/node --no-warnings server/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

# Автообновление: раз в 2 минуты забирает новую версию из GitHub и перезапускает сайт
cat > /usr/local/bin/systemprompt-update <<'UPD'
#!/usr/bin/env bash
set -e
APP=/opt/systemprompt-pro
g() { runuser -u sp -- git -C "$APP" "$@"; }
g fetch -q origin main
if [ "$(g rev-parse HEAD)" != "$(g rev-parse origin/main)" ]; then
  g reset -q --hard origin/main
  systemctl restart systemprompt-pro
  echo "updated to $(g rev-parse --short HEAD)"
fi
UPD
chmod 755 /usr/local/bin/systemprompt-update

cat > /etc/systemd/system/systemprompt-update.service <<'UNIT'
[Unit]
Description=SystemPrompt PRO auto-update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/systemprompt-update
UNIT
cat > /etc/systemd/system/systemprompt-update.timer <<'UNIT'
[Unit]
Description=SystemPrompt PRO auto-update every 2 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT

# Резервная копия базы раз в сутки, хранится 14 дней
cat > /usr/local/bin/systemprompt-backup <<'BAK'
#!/usr/bin/env bash
set -e
D=/var/lib/systemprompt-pro
[ -f "$D/db.sqlite" ] || exit 0
runuser -u sp -- sqlite3 "$D/db.sqlite" ".backup '$D/backups/db-$(date +%F).sqlite'"
find "$D/backups" -name 'db-*.sqlite' -mtime +14 -delete
BAK
chmod 755 /usr/local/bin/systemprompt-backup

cat > /etc/systemd/system/systemprompt-backup.service <<'UNIT'
[Unit]
Description=SystemPrompt PRO DB backup
[Service]
Type=oneshot
ExecStart=/usr/local/bin/systemprompt-backup
UNIT
cat > /etc/systemd/system/systemprompt-backup.timer <<'UNIT'
[Unit]
Description=SystemPrompt PRO daily DB backup
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
UNIT

echo "==> HTTPS (Caddy)"
cat > /etc/caddy/Caddyfile <<'CADDY'
systemprompt-pro.com, www.systemprompt-pro.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
CADDY

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

systemctl daemon-reload
systemctl enable --now systemprompt-pro systemprompt-update.timer systemprompt-backup.timer >/dev/null
systemctl restart systemprompt-pro
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

sleep 2
echo
if curl -fsS -H 'Host: systemprompt-pro.com' http://127.0.0.1:8787/api/status >/dev/null; then
  echo "ГОТОВО: сайт запущен. IP сервера: $(hostname -I | awk '{print $1}')"
else
  echo "ОШИБКА: сайт не отвечает. Пришлите вывод: journalctl -u systemprompt-pro -n 30 --no-pager"
fi
if grep -q '^GROQ_API_KEY=' "$ENVF"; then echo "Ключ Groq: есть"; else echo "Ключ Groq: нет"; fi
if grep -q '^YOOKASSA_SECRET_KEY=' "$ENVF"; then echo "Ключ ЮKassa: есть"; else echo "Ключ ЮKassa: нет"; fi
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://api.groq.com/openai/v1/models || echo 000)
if [ "$code" = "401" ] || [ "$code" = "200" ]; then echo "Groq отсюда: доступен"; else echo "Groq отсюда: НЕДОСТУПЕН (код $code)"; fi
