#!/usr/bin/env bash
# Выкатывает сервер комнат на russia: ./deploy.sh [ssh-хост]
# Первый запуск ещё и заводит vhost river.wkiseven.me и сертификат.
set -euo pipefail
HOST=${1:-russia}
DOMAIN=river.wkiseven.me
cd "$(dirname "$0")"

tar -czf - package.json relay.mjs Dockerfile docker-compose.yml nginx.conf | ssh "$HOST" "mkdir -p /root/river-relay && tar -xzf - -C /root/river-relay"

ssh "$HOST" DOMAIN="$DOMAIN" bash -s <<'REMOTE'
set -euo pipefail
cd /root/river-relay
docker compose up -d --build
for i in $(seq 1 20); do curl -fs 127.0.0.1:8095/health && break; sleep 1; done
echo

SITE=/etc/nginx/sites-available/$DOMAIN
if [ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  # Сначала только порт 80, чтобы certbot смог подтвердить домен.
  printf 'server {\n  listen 80;\n  listen [::]:80;\n  server_name %s;\n  location / { return 404; }\n}\n' "$DOMAIN" > "$SITE"
  ln -sf "$SITE" /etc/nginx/sites-enabled/$DOMAIN
  nginx -t && systemctl reload nginx
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos
fi
cp nginx.conf "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx
echo "ok: https://$DOMAIN"
REMOTE
