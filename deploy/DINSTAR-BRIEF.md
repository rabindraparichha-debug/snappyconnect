# Dinstar session brief — paste this into the new Claude session

You are continuing SnappyConnect UAE calling work. This machine is on the office
LAN, so the Dinstar GSM gateway is reachable directly (it is not reachable from
anywhere else). Everything else is already built and live — only the Dinstar
needs configuring.

## Infrastructure (all live)

- **VPS** `145.223.18.237` — Asterisk 20.20.1 + SnappyConnect backend/web.
  SSH: `ssh -i <key> root@145.223.18.237` (key only on the owner's Mac; if you
  don't have it, everything below can still be done from the Dinstar UI alone).
- **On-prem UCM6301** 192.168.3.24 (public 2.49.10.116), trunk `SnappyVPS`
  registered to the VPS over TLS 5061.
- **Dinstar GSM gateway** `192.168.3.26`, 8 SIM slots, trunked to the UCM as
  `GSM_Trunk`. **This is the only thing that needs work.**

## Call flow already working

- Outbound: app (SIP account 2001-2025) → Asterisk → UCM trunk → Dinstar → SIM.
  Asterisk presents caller ID **1002** because the UCM's outbound route only
  accepts that CID.
- Inbound: SIM → Dinstar → UCM inbound route `GSM_Inbound` → External Number
  `6000` → outbound route `SnappyVPS-RingGroups` (`_6XXX`) → Asterisk ring group
  6000 → rings all recruiter apps.

## Tasks for this session (in the Dinstar web UI at 192.168.3.26)

1. **SIM audit** — confirm which of the 8 slots have SIMs, are registered to the
   carrier, and are enabled. Report the list.
2. **Outbound SIM pinning** — add routing rules so a dialed number prefixed
   `8<N>` goes out on SIM port N, stripping the `8<N>` prefix before dialing.
   Example: `81` + `0585981474` → port 1 dials `0585981474`.
   (Asterisk already sends this prefix for recruiters tagged with a SIM group.)
3. **Inbound port tagging** — make each SIM port present a distinct called
   number to the UCM (e.g. port N → `600N`), so each SIM's return calls can ring
   only that SIM's team.

## After the Dinstar is done (UCM side, via GDMS remote access)

- Add inbound route(s) on `GSM_Trunk` matching `_600X` → External Number
  `600X` (they will ride the existing `_6XXX` outbound route to the VPS).
- Add an outbound route pattern `_8X.` → GSM_Trunk with Dial Trunk enabled and
  privilege International, so prefixed outbound calls pass through.

## Verifying on the VPS (if SSH is available)

```bash
snappy-recruiter-list            # 25 lines, teams, registration state
snappy-recruiter group 2007 3    # assign a line to SIM 3
snappy-recruiter-sync            # rebuild ring groups after changes
asterisk -rx 'pjsip show contacts'
```

## Rules

- Do not change the UCM's `GSM_Inbound` → 6000 routing without saying so; that
  is what makes return calls ring the apps.
- Do not paste Dinstar or UCM passwords into chat.
