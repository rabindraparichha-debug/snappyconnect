#!/bin/bash
# Backup staleness check for SnappyConnect.
#
#   ./backup-check.sh      # exit 0 if the storage box holds a recent dump
#
# Installed on the VPS by vps-setup.sh and run by the
# snappyconnect-backup-check timer a few hours after the nightly backup.
#
# backup.sh alerts when it fails, but only if it actually runs. If the timer
# is disabled, the box is down at 02:30, or the unit is removed, no backup
# happens and nothing complains. This checks the outcome instead of the
# process: is there a recent dump on the storage box?
set -uo pipefail

DB_NAME=${DB_NAME:-snappyconnect}
REMOTE_HOST=${BACKUP_REMOTE_HOST:-root@85.155.191.143}
REMOTE_KEY=${BACKUP_REMOTE_KEY:-/root/.ssh/id_storage}
REMOTE_DIR=${BACKUP_REMOTE_DIR:-/data/backups/snappyconnect}
MAX_AGE_HOURS=${MAX_AGE_HOURS:-30}   # nightly run is 02:30, so >30h means a night was missed
ALERT_LIB=${ALERT_LIB:-/opt/snappyhires/deploy/alert.sh}

alert() {
  echo "ALERT: $1" >&2
  if [ -f "$ALERT_LIB" ]; then
    # shellcheck disable=SC1090
    . "$ALERT_LIB"
    send_alert "$1" "$2" || true
  fi
  exit 1
}

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new -i "$REMOTE_KEY")

# Prints "<path> <mtime-epoch>" for the newest dump, or nothing if there is none.
if ! newest=$("${SSH[@]}" "$REMOTE_HOST" \
    "f=\$(ls -1t '$REMOTE_DIR'/$DB_NAME-*.dump 2>/dev/null | head -1); [ -n \"\$f\" ] && echo \"\$f \$(stat -c %Y \"\$f\")\"; true"); then
  alert "SnappyConnect backup check FAILED: storage box unreachable" \
    "<p><b>Could not reach the storage box to check SnappyConnect backups.</b></p>
     <p>Host $REMOTE_HOST at $(date -u '+%Y-%m-%d %H:%M:%SZ') UTC.</p>
     <p>Local dumps in /var/backups/snappyconnect are unaffected, but there may be no off-server copy.</p>"
fi

if [ -z "$newest" ]; then
  alert "SnappyConnect backup MISSING on storage box" \
    "<p><b>No SnappyConnect dumps were found on the storage box.</b></p>
     <p>Looked in $REMOTE_HOST:$REMOTE_DIR at $(date -u '+%Y-%m-%d %H:%M:%SZ') UTC.</p>
     <p>Check <code>journalctl -u snappyconnect-backup</code> on the VPS.</p>"
fi

path=${newest% *}
mtime=${newest##* }
age_hours=$(( ($(date +%s) - mtime) / 3600 ))

if [ "$age_hours" -gt "$MAX_AGE_HOURS" ]; then
  alert "SnappyConnect backup STALE (${age_hours}h old)" \
    "<p><b>The newest SnappyConnect dump on the storage box is ${age_hours} hours old.</b></p>
     <p>$path</p>
     <p>The nightly backup has missed at least one run. Check <code>systemctl status snappyconnect-backup.timer</code> and <code>journalctl -u snappyconnect-backup</code> on the VPS.</p>"
fi

echo "OK: newest off-server dump is ${age_hours}h old ($path)"
