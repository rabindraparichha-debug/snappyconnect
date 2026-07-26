#!/bin/bash
# Runs ON the VPS as root (uploaded and invoked by deploy/deploy.sh).
# Idempotent: installs Node 20 + PostgreSQL on first run, then (re)builds
# the backend and web apps and (re)starts their systemd services.
#
# Expects env: VPS_IP, WEB_PORT, DB_PASSWORD, JWT_SECRET, SETTINGS_ENCRYPTION_KEY, ADMIN_PASSWORD
set -euo pipefail
WEB_PORT=${WEB_PORT:-3003}
# When DOMAIN is set, public URLs go through the CloudPanel reverse proxy (HTTPS)
if [ -n "${DOMAIN:-}" ]; then
  PUBLIC_WEB_URL="https://$DOMAIN"
  PUBLIC_API_URL="https://$DOMAIN/api/v1"
else
  PUBLIC_WEB_URL="http://$VPS_IP:$WEB_PORT"
  PUBLIC_API_URL="http://$VPS_IP:4000/api/v1"
fi

APP_DIR=/opt/snappyconnect
export DEBIAN_FRONTEND=noninteractive

echo "--- system packages"
if ! command -v node > /dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v psql > /dev/null; then
  apt-get update -qq
  apt-get install -y postgresql postgresql-contrib
  systemctl enable --now postgresql
fi

echo "--- database"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='snappy'" | grep -q 1 ||
  sudo -u postgres psql -c "CREATE ROLE snappy LOGIN PASSWORD '$DB_PASSWORD'"
sudo -u postgres psql -c "ALTER ROLE snappy PASSWORD '$DB_PASSWORD'"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='snappyconnect'" | grep -q 1 ||
  sudo -u postgres createdb -O snappy snappyconnect

echo "--- backend"
cat > $APP_DIR/backend/.env << EOF
PORT=4000
WEB_APP_URL=$PUBLIC_WEB_URL
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=snappy
DATABASE_PASSWORD=$DB_PASSWORD
DATABASE_NAME=snappyconnect
DATABASE_SYNCHRONIZE=true
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=1d
SETTINGS_ENCRYPTION_KEY=$SETTINGS_ENCRYPTION_KEY
ADMIN_NAME=Admin
ADMIN_EMAIL=admin@snappyconnect.local
ADMIN_PASSWORD=$ADMIN_PASSWORD
# Asterisk Manager Interface (same host) — powers click-to-call and the
# automatic call-history ingestion for UAE calls.
ASTERISK_AMI_HOST=127.0.0.1
ASTERISK_AMI_PORT=5038
ASTERISK_AMI_USERNAME=snappyconnect
ASTERISK_AMI_PASSWORD=${AMI_PASSWORD:-}
EOF
cd $APP_DIR/backend
npm ci --no-audit --no-fund
npm run build

echo "--- web"
echo "NEXT_PUBLIC_API_URL=$PUBLIC_API_URL" > $APP_DIR/web/.env.local
cd $APP_DIR/web
npm ci --no-audit --no-fund
npm run build

echo "--- systemd services"
cat > /etc/systemd/system/snappyconnect-api.service << EOF
[Unit]
Description=SnappyConnect API (NestJS)
After=network.target postgresql.service

[Service]
WorkingDirectory=$APP_DIR/backend
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/snappyconnect-web.service << EOF
[Unit]
Description=SnappyConnect Web (Next.js)
After=network.target snappyconnect-api.service

[Service]
WorkingDirectory=$APP_DIR/web
ExecStart=$APP_DIR/web/node_modules/.bin/next start -p $WEB_PORT
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable snappyconnect-api snappyconnect-web
systemctl restart snappyconnect-api snappyconnect-web

echo "--- firewall (only touched if ufw is active; CloudPanel rules untouched)"
if ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$WEB_PORT"/tcp > /dev/null
  ufw allow 4000/tcp > /dev/null
fi

echo "--- done: $(systemctl is-active snappyconnect-api) / $(systemctl is-active snappyconnect-web)"
