#!/bin/bash
# Rebuild + restart SnappyConnect ON the VPS, reusing the .env files already on
# the server — no secret generation, so it is safe to run from anywhere.
#
# Two ways to get fresh code onto the box before the build:
#
#   1. Pushed to you (GitHub Actions or deploy/deploy.sh rsyncs backend/ + web/
#      into /opt/snappyconnect, then runs this script with no arguments):
#        bash /opt/snappyconnect/server-update.sh
#
#   2. Pulled by you (run directly on the server; clones/updates the repo and
#      syncs it into place — for a private repo, authorize a read-only deploy
#      key on GitHub first, and set REPO_URL to the ssh:// form):
#        bash /opt/snappyconnect/server-update.sh --pull [branch]
#
# First-time provisioning (DB, systemd units, secrets) is vps-setup.sh's job;
# this script refuses to run until that has happened once.
set -euo pipefail

APP_DIR=/opt/snappyconnect
REPO_URL=${REPO_URL:-https://github.com/rabindraparichha-debug/snappyconnect.git}

if [ "${1:-}" = "--pull" ]; then
  BRANCH=${2:-main}
  command -v git > /dev/null || apt-get install -y git
  if [ ! -d "$APP_DIR/repo/.git" ]; then
    git clone "$REPO_URL" "$APP_DIR/repo"
  fi
  git -C "$APP_DIR/repo" fetch origin "$BRANCH"
  git -C "$APP_DIR/repo" checkout -B "$BRANCH" "origin/$BRANCH"
  echo "--- syncing $BRANCH ($(git -C "$APP_DIR/repo" rev-parse --short HEAD)) into $APP_DIR"
  # Excluded paths are also protected from --delete, so .env survives.
  rsync -a --delete \
    --exclude .env --exclude .env.local --exclude node_modules \
    --exclude dist --exclude .next --exclude tsconfig.tsbuildinfo \
    "$APP_DIR/repo/backend" "$APP_DIR/repo/web" "$APP_DIR/"
fi

if [ ! -f "$APP_DIR/backend/.env" ]; then
  echo "ERROR: $APP_DIR/backend/.env is missing." >&2
  echo "Run the full deploy (deploy/deploy.sh from the original machine) once first." >&2
  exit 1
fi

echo "--- backend build"
cd "$APP_DIR/backend"
npm ci --no-audit --no-fund
npm run build

echo "--- web build"
cd "$APP_DIR/web"
npm ci --no-audit --no-fund
npm run build

echo "--- restart"
systemctl restart snappyconnect-api snappyconnect-web
sleep 3
curl -fsS http://localhost:4000/api/v1/health && echo
echo "--- done: $(systemctl is-active snappyconnect-api) / $(systemctl is-active snappyconnect-web)"
