#!/bin/bash
# Make the Dinstar SIM pinning app-managed instead of baked into pjsip.conf.
#
# Endpoints used to carry `set_var=SIMGROUP=N`, which forced every call from
# that extension down the `8N<number>` SIM-pinned branch of the dialplan. The
# UCM has no `_8X.` outbound route yet, so those calls come back 404 and the
# recruiter hears nothing. Worse, the pinning could only be changed by hand-
# editing pjsip.conf and reloading.
#
# After this script the SIM port lives in Asterisk's own database, keyed by the
# calling extension, and the API writes it over AMI when an admin assigns a
# recruiter to a SIM port. Unassigned extensions read back empty and fall
# through to the existing `[pool]` branch, which is the path that works today.
#
# The lookup has to happen before the dialplan rewrites CALLERID to 1002,
# otherwise every call would look up the SIM for extension "1002".
set -euo pipefail

PJSIP=/etc/asterisk/pjsip.conf
EXTEN=/etc/asterisk/extensions.conf
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/root/asterisk-backups
LOOKUP='exten => _0X.,n,Set(SIMGROUP=${DB(simgroup/${CALLERID(num)})})'

mkdir -p "$BACKUP_DIR"

# ---- 1. dialplan: look the SIM port up per caller -------------------------
if grep -qF 'DB(simgroup/' "$EXTEN"; then
  echo "SKIP: dialplan already reads simgroup from the Asterisk database"
else
  cp -a "$EXTEN" "$BACKUP_DIR/extensions.conf.$STAMP"
  echo "Backed up $EXTEN -> $BACKUP_DIR/extensions.conf.$STAMP"

  # Insert immediately after the NoOp that opens the _0X. rule, which is the
  # last point at which CALLERID(num) is still the recruiter's extension.
  awk -v lookup="$LOOKUP" '
    { print }
    /^exten => _0X\.,1,NoOp\(/ && !done {
      print "; SIM port for this recruiter, assigned from the app (empty -> pool)"
      print lookup
      done = 1
    }
  ' "$EXTEN" > /tmp/new-extensions.conf

  if ! grep -qF 'DB(simgroup/' /tmp/new-extensions.conf; then
    echo "ERROR: could not find the _0X. NoOp anchor; dialplan unchanged" >&2
    exit 1
  fi
  cp /tmp/new-extensions.conf "$EXTEN"
fi

# ---- 2. endpoints: stop hardcoding the SIM port ---------------------------
if grep -qE '^\s*set_var\s*=\s*SIMGROUP' "$PJSIP"; then
  cp -a "$PJSIP" "$BACKUP_DIR/pjsip.conf.$STAMP"
  echo "Backed up $PJSIP -> $BACKUP_DIR/pjsip.conf.$STAMP"
  sed -i -E '/^\s*set_var\s*=\s*SIMGROUP/d' "$PJSIP"
  echo "Removed hardcoded SIMGROUP from $(basename "$PJSIP")"
else
  echo "SKIP: no hardcoded SIMGROUP left in $(basename "$PJSIP")"
fi

# ---- 3. reload, rolling back if either file is bad ------------------------
if ! asterisk -rx "dialplan reload" | grep -qi "reloaded"; then
  echo "ERROR: dialplan reload failed — restoring backups" >&2
  [ -f "$BACKUP_DIR/extensions.conf.$STAMP" ] && cp -a "$BACKUP_DIR/extensions.conf.$STAMP" "$EXTEN"
  [ -f "$BACKUP_DIR/pjsip.conf.$STAMP" ] && cp -a "$BACKUP_DIR/pjsip.conf.$STAMP" "$PJSIP"
  asterisk -rx "dialplan reload" >/dev/null 2>&1
  exit 1
fi
asterisk -rx "pjsip reload" >/dev/null 2>&1

# ---- 4. show the result ---------------------------------------------------
echo "--- _0X. rule now ---"
asterisk -rx "dialplan show _0X.@recruiters" 2>/dev/null | sed -n '2,12p'

echo "--- endpoints still pinned to a SIM (should be none) ---"
asterisk -rx "pjsip show endpoints" 2>/dev/null | grep -E "^ Endpoint:  20" | awk '{print $3}' \
  | while read -r ep; do
      v=$(asterisk -rx "pjsip show endpoint $ep" 2>/dev/null | awk '/^ SIMGROUP/ {print $3}')
      [ -n "$v" ] && echo "  $ep -> SIMGROUP=$v"
    done
echo "  (none listed above means every extension now uses the app-assigned port)"
