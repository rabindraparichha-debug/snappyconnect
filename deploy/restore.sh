#!/bin/bash
# Restore a SnappyConnect database backup.
#
#   ./restore.sh                     # list available backups
#   ./restore.sh <path-to-.dump>     # restore that dump
#
# Destructive: the target database is dropped and recreated. A safety dump of
# the current state is taken first, so a bad restore can still be walked back.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/snappyconnect}
DB_NAME=${DB_NAME:-snappyconnect}
DB_OWNER=${DB_OWNER:-snappy}

if [ $# -eq 0 ]; then
  echo "Available backups in $BACKUP_DIR:"
  ls -lh "$BACKUP_DIR"/$DB_NAME-*.dump 2>/dev/null || echo "  (none)"
  echo
  echo "Usage: $0 <path-to-.dump>"
  exit 0
fi

DUMP=$1
[ -f "$DUMP" ] || { echo "No such file: $DUMP" >&2; exit 1; }

sudo -u postgres pg_restore --list "$DUMP" > /dev/null 2>&1 \
  || { echo "Not a valid pg_dump custom-format file: $DUMP" >&2; exit 1; }

echo "This will REPLACE the '$DB_NAME' database with $DUMP"
read -r -p "Type the database name to confirm: " CONFIRM
[ "$CONFIRM" = "$DB_NAME" ] || { echo "Aborted."; exit 1; }

SAFETY="/var/backups/snappyconnect/pre-restore-$(date +%Y%m%d-%H%M%S).dump"
mkdir -p "$(dirname "$SAFETY")"
echo "==> Saving current state to $SAFETY"
sudo -u postgres pg_dump --format=custom --compress=9 "$DB_NAME" > "$SAFETY"

echo "==> Stopping the API so nothing writes mid-restore"
systemctl stop snappyconnect-api || true

echo "==> Recreating $DB_NAME"
sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME"
sudo -u postgres createdb -O "$DB_OWNER" "$DB_NAME"

echo "==> Restoring"
sudo -u postgres pg_restore --no-owner --role="$DB_OWNER" -d "$DB_NAME" "$DUMP"

echo "==> Starting the API"
systemctl start snappyconnect-api

echo "Restored $DB_NAME from $DUMP"
echo "Previous state kept at $SAFETY"
