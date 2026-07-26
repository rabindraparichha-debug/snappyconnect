#!/bin/bash
# Nightly SnappyConnect database backup.
#
#   ./backup.sh            # write a new dump and prune old ones
#
# Installed on the VPS by vps-setup.sh and run by the snappyconnect-backup
# systemd timer. Dumps are custom-format (pg_restore-compatible) and
# compressed, so a restore can pick individual tables if it ever needs to.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/snappyconnect}
RETENTION_DAYS=${RETENTION_DAYS:-14}
DB_NAME=${DB_NAME:-snappyconnect}
STAMP=$(date +%Y%m%d-%H%M%S)
TARGET="$BACKUP_DIR/$DB_NAME-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

# Write to a .partial file and only publish it under the real name once the
# dump has been verified, so a failed or half-written run can never leave
# something that looks like a usable backup.
PARTIAL="$TARGET.partial"
trap 'rm -f "$PARTIAL"' EXIT

# Dump as the postgres superuser so ownership and extensions come across.
if ! sudo -u postgres pg_dump --format=custom --compress=9 "$DB_NAME" > "$PARTIAL"; then
  echo "ERROR: pg_dump failed for '$DB_NAME'; keeping existing backups" >&2
  exit 1
fi

# A dump that cannot be listed is not a backup — fail loudly before pruning
# so the previous good copies are never removed on the strength of a bad one.
if ! sudo -u postgres pg_restore --list "$PARTIAL" > /dev/null 2>&1; then
  echo "ERROR: the dump of '$DB_NAME' is unreadable; keeping existing backups" >&2
  exit 1
fi

mv "$PARTIAL" "$TARGET"

SIZE=$(du -h "$TARGET" | cut -f1)
echo "Backup written: $TARGET ($SIZE)"

# Prune only after the new dump has been verified.
find "$BACKUP_DIR" -name "$DB_NAME-*.dump" -type f -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" -name "$DB_NAME-*.dump" -type f | wc -l | tr -d ' ')
echo "Retention: $RETENTION_DAYS days, $REMAINING backups on disk"
