#!/bin/bash
# Put the AI operator in front of calls to the UAE SIM.
#
# Calls from the Dubai office PBX arrive in the `from-ucm` context and today
# ring every recruiter (ring group 6000). This rewrites that one rule: the
# dialplan asks SnappyConnect whether the AI should take the call, dials the
# voice platform's bridge for it, and when that leg ends asks again what to
# do with the caller: hang up, ring one extension, or ring everyone as before.
# SnappyConnect answers "" when the AI is off or unavailable, so the old
# behaviour is the fallback at every step.
#
# Run on the VPS as root:  bash /opt/snappyconnect/asterisk-support-line.sh
# Needs ASTERISK_SUPPORT_KEY in /opt/snappyconnect/backend/.env (the same
# value is written into the dialplan). Re-running replaces the block it added.
set -euo pipefail

EXT=/etc/asterisk/extensions.conf
ENV_FILE=/opt/snappyconnect/backend/.env
API=http://127.0.0.1:4000/api/v1/webhooks/asterisk-support
BRIDGE=85.155.191.198:5060
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/root/asterisk-backups

KEY=$(grep -E '^ASTERISK_SUPPORT_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)
if [ -z "$KEY" ]; then
  echo "ERROR: ASTERISK_SUPPORT_KEY is not set in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp -a "$EXT" "$BACKUP_DIR/extensions.conf.$STAMP"
echo "Backed up $EXT -> $BACKUP_DIR/extensions.conf.$STAMP"

# Drop a previous copy of our block and the original "ring everyone" rule,
# then append the new rule to the end of the from-ucm context (the last
# context in the file).
python3 - "$EXT" << 'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
text = re.sub(r"\n; ---- support line \(AI operator\).*?; ---- end support line ----\n", "\n", text, flags=re.S)
text = text.replace("exten => _X.,1,NoOp(Inbound ${EXTEN} from ${CALLERID(num)} -> ring everyone)\n same => n,Goto(from-ucm,6000,1)\n", "")
open(path, "w").write(text.rstrip("\n") + "\n")
PY

cat >> "$EXT" << BLOCK

; ---- support line (AI operator) ----------------------------------------
; Added by asterisk-support-line.sh. SnappyConnect decides; "" means the AI
; is off, so the caller rings everyone exactly as before.
exten => _X.,1,NoOp(Inbound \${EXTEN} from \${CALLERID(num)})
 same => n,Set(CALLER=\${FILTER(0-9+,\${CALLERID(num)})})
 same => n,Set(SUPPORT=\${SHELL(curl -s -m 4 -X POST -H "X-Support-Key: ${KEY}" --data-urlencode "caller=\${CALLER}" --data-urlencode "line=\${EXTEN}" --data-urlencode "channel=\${UNIQUEID}" ${API}/announce)})
 same => n,GotoIf(\$["\${SUPPORT}" = ""]?ring)
 same => n,Set(ARRAY(TASK,REF)=\${SUPPORT})
 same => n,GotoIf(\$["\${REF}" = ""]?ring)
 same => n,Answer()
 ; g: carry on here when the AI leg hangs up; r: ringback while it connects
 same => n,Dial(PJSIP/livekit/sip:\${REF}@${BRIDGE},20,gr)
 same => n,Set(NEXT=\${SHELL(curl -s -m 4 -X POST -H "X-Support-Key: ${KEY}" --data-urlencode "status=\${DIALSTATUS}" ${API}/after/\${TASK})})
 same => n,GotoIf(\$["\${NEXT}" = "hangup"]?bye)
 same => n,GotoIf(\$["\${NEXT:0:6}" = "exten:"]?person)
 same => n(ring),Goto(from-ucm,6000,1)
 same => n(person),Dial(PJSIP/\${NEXT:6},45)
 same => n,Goto(from-ucm,6000,1)
 same => n(bye),Hangup()
; the caller's own leg is gone, whichever step it was at
exten => h,1,GotoIf(\$["\${TASK}" = ""]?done)
 same => n,Set(IGNORE=\${SHELL(curl -s -m 4 -X POST -H "X-Support-Key: ${KEY}" --data-urlencode "channel=\${UNIQUEID}" ${API}/ended)})
 same => n(done),NoOp()
; ---- end support line ----
BLOCK

if ! asterisk -rx "dialplan reload" | grep -q -i "reloaded"; then
  echo "ERROR: dialplan reload failed — restoring backup" >&2
  cp -a "$BACKUP_DIR/extensions.conf.$STAMP" "$EXT"
  asterisk -rx "dialplan reload" >/dev/null 2>&1
  exit 1
fi
sleep 1
echo "--- from-ucm now ---"
asterisk -rx "dialplan show from-ucm" | grep -E "_X\.|livekit|6000" | head -8
echo "OK: UAE SIM calls go to the AI operator when it is switched on in SnappyConnect"
