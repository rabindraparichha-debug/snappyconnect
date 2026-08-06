#!/bin/bash
# Let the AI voice agent dial out over the UAE SIM path.
#
# LiveKit-SIP (host network) delivers the agent's calls to Asterisk on
# 127.0.0.1:5070. This adds a `livekit` endpoint matched purely by that
# loopback source address — no credentials, nothing routable from outside —
# landing in the same `recruiters` context human recruiters use, so AI calls
# ride the identical dialplan: pool SIM today, pinning later, same 1002 CID.
set -euo pipefail

PJSIP=/etc/asterisk/pjsip.conf
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/root/asterisk-backups

if grep -qE '^\[livekit\]' "$PJSIP"; then
  echo "SKIP: livekit endpoint already present"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
cp -a "$PJSIP" "$BACKUP_DIR/pjsip.conf.$STAMP"
echo "Backed up $PJSIP -> $BACKUP_DIR/pjsip.conf.$STAMP"

cat >> "$PJSIP" << 'EOF'

; ---- AI voice agent (LiveKit-SIP on this host) -------------------------
; Matched by loopback source only; carries the agent's outbound calls into
; the recruiters context. No auth: 127.0.0.1 cannot be spoofed remotely.
[livekit]
type=endpoint
context=recruiters
disallow=all
allow=ulaw
allow=alaw
direct_media=no
rtp_symmetric=yes

[livekit]
type=aor
max_contacts=1

[livekit-identify]
type=identify
endpoint=livekit
match=127.0.0.1
EOF

if ! asterisk -rx "pjsip reload" >/dev/null 2>&1; then
  echo "ERROR: pjsip reload failed — restoring backup" >&2
  cp -a "$BACKUP_DIR/pjsip.conf.$STAMP" "$PJSIP"
  asterisk -rx "pjsip reload" >/dev/null 2>&1
  exit 1
fi

sleep 1
echo "--- endpoint check ---"
asterisk -rx "pjsip show endpoint livekit" 2>/dev/null | grep -E "Endpoint:|context" | head -3 \
  || { echo "ERROR: endpoint did not load" >&2; exit 1; }
echo "OK: AI agent calls will now enter the recruiters dialplan"
