#!/bin/bash
# Nightly SnappyConnect database backup.
#
#   ./backup.sh            # write a new dump, copy it off-server, prune old ones
#
# Installed on the VPS by vps-setup.sh and run by the snappyconnect-backup
# systemd timer. Dumps are custom-format (pg_restore-compatible) and
# compressed, so a restore can pick individual tables if it ever needs to.
#
# Each dump is kept locally (fast restores) AND copied to the storage box, so
# losing the VPS disk no longer takes the database and its backups together.
# Set BACKUP_REMOTE_HOST="" to skip the off-server copy.
#
# Restore from the storage box copy:
#   scp -i /root/.ssh/id_storage \
#     root@85.155.191.143:/data/backups/snappyconnect/snappyconnect-YYYYMMDD-HHMMSS.dump /tmp/
#   snappyconnect-restore /tmp/snappyconnect-YYYYMMDD-HHMMSS.dump
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/var/backups/snappyconnect}
RETENTION_DAYS=${RETENTION_DAYS:-14}
DB_NAME=${DB_NAME:-snappyconnect}
REMOTE_HOST=${BACKUP_REMOTE_HOST-root@85.155.191.143}
REMOTE_KEY=${BACKUP_REMOTE_KEY:-/root/.ssh/id_storage}
REMOTE_DIR=${BACKUP_REMOTE_DIR:-/data/backups/snappyconnect}
REMOTE_RETENTION_DAYS=${REMOTE_RETENTION_DAYS:-30}
# Shared Resend-backed mailer that the snappyhires backups on this box already use.
ALERT_LIB=${ALERT_LIB:-/opt/snappyhires/deploy/alert.sh}
STAMP=$(date +%Y%m%d-%H%M%S)
TARGET="$BACKUP_DIR/$DB_NAME-$STAMP.dump"

# Email on any failure: a failed run used to be visible only in the journal,
# which is how a missed night went unnoticed.
alert() {
  if [ -f "$ALERT_LIB" ]; then
    # shellcheck disable=SC1090
    . "$ALERT_LIB"
    send_alert "SnappyConnect backup FAILED" \
      "<p><b>The nightly SnappyConnect backup did not complete.</b></p>
       <p>$1</p>
       <p>Time (UTC): $(date -u '+%Y-%m-%d %H:%M:%SZ')</p>
       <p>Existing backups are untouched; pruning only runs after a verified dump.
       Details: <code>journalctl -u snappyconnect-backup</code></p>" || true
  fi
}
fail() {
  echo "ERROR: $1" >&2
  alert "$1"
  exit 1
}
trap 'alert "Unexpected error at line $LINENO of backup.sh"' ERR

mkdir -p "$BACKUP_DIR"

# Write to a .partial file and only publish it under the real name once the
# dump has been verified, so a failed or half-written run can never leave
# something that looks like a usable backup.
PARTIAL="$TARGET.partial"
trap 'rm -f "$PARTIAL"' EXIT

# Dump as the postgres superuser so ownership and extensions come across.
if ! sudo -u postgres pg_dump --format=custom --compress=9 "$DB_NAME" > "$PARTIAL"; then
  fail "pg_dump failed for '$DB_NAME'; keeping existing backups"
fi

# A dump that cannot be listed is not a backup — fail loudly before pruning
# so the previous good copies are never removed on the strength of a bad one.
if ! sudo -u postgres pg_restore --list "$PARTIAL" > /dev/null 2>&1; then
  fail "the dump of '$DB_NAME' is unreadable; keeping existing backups"
fi

mv "$PARTIAL" "$TARGET"

SIZE=$(du -h "$TARGET" | cut -f1)
echo "Backup written: $TARGET ($SIZE)"

# Prune only after the new dump has been verified.
find "$BACKUP_DIR" -name "$DB_NAME-*.dump" -type f -mtime +"$RETENTION_DAYS" -delete
REMAINING=$(find "$BACKUP_DIR" -name "$DB_NAME-*.dump" -type f | wc -l | tr -d ' ')
echo "Retention: $RETENTION_DAYS days, $REMAINING backups on disk"

[ -n "$REMOTE_HOST" ] || { echo "Off-server copy disabled (BACKUP_REMOTE_HOST is empty)"; exit 0; }

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15
     -o ServerAliveCountMax=8 -o StrictHostKeyChecking=accept-new -i "$REMOTE_KEY")
NAME=$(basename "$TARGET")

"${SSH[@]}" "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'" \
  || fail "cannot reach the storage box ($REMOTE_HOST); the local dump $TARGET is fine"

# Same .partial rule on the far side, then confirm every byte arrived before
# promoting it.
"${SSH[@]}" "$REMOTE_HOST" "cat > '$REMOTE_DIR/$NAME.partial'" < "$TARGET" \
  || fail "copying $NAME to the storage box failed; the local dump is fine"
LOCAL_BYTES=$(stat -c %s "$TARGET")
REMOTE_BYTES=$("${SSH[@]}" "$REMOTE_HOST" "stat -c %s '$REMOTE_DIR/$NAME.partial'") \
  || fail "could not verify $NAME on the storage box"
[ "$LOCAL_BYTES" = "$REMOTE_BYTES" ] \
  || fail "storage box copy of $NAME is $REMOTE_BYTES bytes, expected $LOCAL_BYTES"
"${SSH[@]}" "$REMOTE_HOST" "mv '$REMOTE_DIR/$NAME.partial' '$REMOTE_DIR/$NAME'" \
  || fail "could not finalize $NAME on the storage box"
echo "Off-server copy: $REMOTE_HOST:$REMOTE_DIR/$NAME"

# Remote pruning also only runs after a verified copy; it clears abandoned
# .partial files from interrupted runs too.
REMOTE_REMAINING=$("${SSH[@]}" "$REMOTE_HOST" \
  "find '$REMOTE_DIR' -name '$DB_NAME-*.dump' -type f -mtime +$REMOTE_RETENTION_DAYS -delete;
   find '$REMOTE_DIR' -name '$DB_NAME-*.partial' -type f -mmin +60 -delete;
   find '$REMOTE_DIR' -name '$DB_NAME-*.dump' -type f | wc -l") \
  || fail "pruning old copies on the storage box failed"
echo "Off-server retention: $REMOTE_RETENTION_DAYS days, $REMOTE_REMAINING copies on the storage box"
