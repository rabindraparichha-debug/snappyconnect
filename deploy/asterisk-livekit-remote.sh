#!/bin/bash
# Let the voice-platform box (HostHatch, 85.155.191.198) send calls into the
# `livekit` endpoint, which currently only trusts loopback. Same endpoint,
# second identify — calls from the platform ride the recruiters dialplan
# exactly like the local LiveKit-SIP's do.
set -euo pipefail

PJSIP=/etc/asterisk/pjsip.conf
PLATFORM_IP=85.155.191.198
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/root/asterisk-backups

if grep -qF "$PLATFORM_IP" "$PJSIP"; then
  echo "SKIP: $PLATFORM_IP already trusted"
  exit 0
fi
if ! grep -qE '^\[livekit\]' "$PJSIP"; then
  echo "ERROR: livekit endpoint missing — run asterisk-livekit-endpoint.sh first" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp -a "$PJSIP" "$BACKUP_DIR/pjsip.conf.$STAMP"
echo "Backed up $PJSIP -> $BACKUP_DIR/pjsip.conf.$STAMP"

cat >> "$PJSIP" << EOF

; ---- AI voice platform (HostHatch box) ---------------------------------
[livekit-remote]
type=identify
endpoint=livekit
match=$PLATFORM_IP
EOF

if ! asterisk -rx "pjsip reload" >/dev/null 2>&1; then
  echo "ERROR: pjsip reload failed — restoring backup" >&2
  cp -a "$BACKUP_DIR/pjsip.conf.$STAMP" "$PJSIP"
  asterisk -rx "pjsip reload" >/dev/null 2>&1
  exit 1
fi

sleep 1
asterisk -rx "pjsip show identifies" 2>/dev/null | grep -A1 "livekit" | head -6
echo "OK: platform calls from $PLATFORM_IP now enter the recruiters dialplan"
