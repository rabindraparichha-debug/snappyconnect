#!/bin/bash
# Let the UAE trunk carry international destinations.
#
# Clients may send +<country><number>. Only +971 has a rewrite rule today, so
# every other + number falls through with no matching extension. This adds a
# catch-all that converts + to UAE's 00 access code, after which the existing
# _0X. rule routes it out through the UCM exactly like a UAE call.
#
# _+971X. stays more specific than _+X., so UAE dialling is unchanged.
set -euo pipefail

CONF=/etc/asterisk/extensions.conf
BACKUP="/root/asterisk-backups/extensions.conf.$(date +%Y%m%d-%H%M%S)"

if grep -qF '_+X.' "$CONF"; then
  echo "SKIP: international rule already present"
  exit 0
fi

mkdir -p /root/asterisk-backups
cp -a "$CONF" "$BACKUP"
echo "Backed up to $BACKUP"

# Insert directly after the existing +971 normalisation rules.
awk '
  { print }
  /^exten => _971X\.,1,Goto\(recruiters,0\$\{EXTEN:3\},1\)/ && !done {
    print "; international -> UAE 00 access code, then the _0X. rule below"
    print "exten => _+X.,1,Goto(recruiters,00${EXTEN:1},1)"
    done = 1
  }
' "$CONF" > /tmp/new-extensions.conf

if ! grep -qF '_+X.' /tmp/new-extensions.conf; then
  echo "ERROR: anchor line not found; dialplan unchanged" >&2
  exit 1
fi

cp /tmp/new-extensions.conf "$CONF"

if ! asterisk -rx "dialplan reload" | grep -qi "reloaded"; then
  echo "ERROR: dialplan reload failed — restoring backup" >&2
  cp -a "$BACKUP" "$CONF"
  asterisk -rx "dialplan reload" >/dev/null 2>&1
  exit 1
fi

echo "--- routing checks ---"
for n in 0585981474 +971505981474 +447700900123 +12125550123; do
  printf '%-16s -> ' "$n"
  asterisk -rx "dialplan show ${n}@recruiters" 2>/dev/null \
    | grep -m1 -oE "'_?[^']+' =>" || echo "NO MATCH"
done
