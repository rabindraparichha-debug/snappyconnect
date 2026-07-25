#!/bin/bash
# Deploy SnappyConnect (backend + web) to the Hostinger VPS.
#
#   ./deploy/deploy.sh            # full deploy (rsync + build + restart)
#
# Requires the snappyconnect_vps SSH key to be authorized on the server.
# Secrets are generated once into deploy/.secrets.env (gitignored) and
# reused on every subsequent deploy, so re-running is always safe.
set -euo pipefail

VPS_IP=145.223.18.237
# Public domain (CloudPanel reverse proxy: / -> web, /api -> backend)
DOMAIN=call.snappyhires.com
# 3000/3001/3002 are taken by other apps on this VPS (workhub, etc.)
WEB_PORT=3003
SSH_KEY=~/.ssh/snappyconnect_vps
SSH="ssh -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@$VPS_IP"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS="$REPO_ROOT/deploy/.secrets.env"

# ----- one-time secret generation -----
if [ ! -f "$SECRETS" ]; then
  echo "Generating secrets (first deploy) -> deploy/.secrets.env"
  cat > "$SECRETS" << EOF
DB_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 48)
ADMIN_PASSWORD=$(openssl rand -base64 15 | tr -d '+/=')
EOF
fi
# shellcheck disable=SC1090
source "$SECRETS"

echo "==> 1/4 Syncing code to $VPS_IP"
rsync -az --delete -e "ssh -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  --exclude node_modules --exclude dist --exclude .next --exclude .env \
  --exclude .env.local --exclude tsconfig.tsbuildinfo \
  "$REPO_ROOT/backend" "$REPO_ROOT/web" root@$VPS_IP:/opt/snappyconnect/

echo "==> 2/4 Uploading setup script"
rsync -az -e "ssh -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
  "$REPO_ROOT/deploy/vps-setup.sh" root@$VPS_IP:/opt/snappyconnect/vps-setup.sh

echo "==> 3/4 Running server setup (install deps, build, restart services)"
$SSH "VPS_IP=$VPS_IP DOMAIN=$DOMAIN WEB_PORT=$WEB_PORT DB_PASSWORD=$DB_PASSWORD JWT_SECRET=$JWT_SECRET \
  SETTINGS_ENCRYPTION_KEY=$SETTINGS_ENCRYPTION_KEY ADMIN_PASSWORD=$ADMIN_PASSWORD \
  bash /opt/snappyconnect/vps-setup.sh"

echo "==> 4/4 Health checks"
sleep 3
curl -fsS "http://$VPS_IP:4000/api/v1/health" && echo
curl -fsS -o /dev/null -w "web: %{http_code}\n" "http://$VPS_IP:$WEB_PORT"

echo
echo "Deployed. Web: http://$VPS_IP:$WEB_PORT   API: http://$VPS_IP:4000/api/v1"
echo "Admin login: admin@snappyconnect.local / (see deploy/.secrets.env ADMIN_PASSWORD)"
