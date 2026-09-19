# UAE calling — how it works

One page to answer "how does a UAE call actually happen, and who is on which
SIM?" Read this before touching extensions, SIMs, or the Users form.

## The call path

```
Recruiter's browser (web dialer, SIP extension 2001–2025)
        │  WSS / SIP over TLS
        ▼
Asterisk on the VPS (145.223.18.237 — same server as the app)
        │  TLS trunk "SnappyVPS", always presents caller ID 1002
        ▼
Office PBX in Dubai (Grandstream UCM6301, 192.168.3.24)
        │  GSM_Trunk on the office LAN
        ▼
Dinstar GSM gateway (192.168.3.26, 8 SIM slots)
        ▼
Candidate's phone — sees the SIM's ordinary +971 mobile number
```

Return calls run in reverse: candidate calls the SIM back → UCM inbound route
`GSM_Inbound` forwards to Asterisk ring group 6000 → every recruiter browser
rings.

Non-obvious constraints (learned the hard way — do not "fix" these):

- The UCM→VPS trunk must be **TLS**. The UAE ISP drops plain UDP/TCP SIP.
- The trunk always shows **caller ID 1002** — the UCM rejects non-extension
  caller IDs. Recruiter identity lives in Asterisk CDRs, not in the CID.
- Answer supervision arrives ~30 s late from the GSM side: a call can show
  "NO ANSWER" or Talk 0:00 while the candidate is already talking. Timeouts
  are set generously (≥80 s); don't trust sub-30-second failure statuses.
- The old Wave / Grandstream path (`Grandstream PBX (UAE)` provider,
  extensions 1000–1007, CloudUCM 1021–1025) is **legacy**. Only the 1002
  identity survives, as the trunk caller ID.

## Extensions: the pool and auto-assignment

- Asterisk owns **25 pre-provisioned extensions, 2001–2025**, defined in
  `/etc/asterisk/pjsip.conf` on the VPS. The backend reads that file directly
  (`SipPoolService`), so the app and PBX can never disagree on credentials.
- **Nobody types SIP credentials.** A user with the UAE region ticked gets the
  lowest free extension automatically — on creation, on edit, or lazily the
  first time their dialer asks for config (`ensureSipLine`). The Users table
  shows it as the green 🇦🇪 ext badge; the user sees it on their Profile.
- The SIP fields in the Users form live under "Advanced overrides" and exist
  only to pin a specific person to a specific extension. Leave them empty.

## SIMs ↔ extensions: the mapping

The Dinstar has **8 SIM slots**. By design, **each SIM is shared by 3
extensions**, assigned in fixed blocks from 2001
(`simPortExtensions()` in `backend/src/providers/numbers.controller.ts`):

| SIM port | Extensions  |
|----------|-------------|
| 1        | 2001–2003   |
| 2        | 2004–2006   |
| 3        | 2007–2009   |
| 4        | 2010–2012   |
| 5        | 2013–2015   |
| 6        | 2016–2018   |
| 7        | 2019–2021   |
| 8        | 2022–2024   |

(2025 is a spare outside the SIM blocks.)

How pinning physically works: Asterisk keeps a `simgroup/<extension> → port`
table in its own database (astdb). When a pinned extension dials, the dialplan
prefixes the number with `8<port>`; the UCM's `_8X.` route strips it and tells
the Dinstar which SIM to use. Unpinned extensions fall through to the default
pool — whatever SIM the Dinstar picks (with one active SIM, that one).

**Current live state (check before assuming):** pinning is designed but not
active — the astdb `simgroup` table is empty and the `pinningReady` toggle is
off, because the per-port rules on the Dinstar itself were never finished.
Today every call goes out the active SIM regardless of extension. One SIM =
one concurrent call, so the practical UAE limit is one call per active SIM.

## Where admins manage this

- **Users page** — create a user, tick the UAE region, done. Extension is
  automatic. Advanced overrides only for pinning someone to a known extension.
- **Phone Numbers page → SIM ports card** (`SimPortsCard`) — label each SIM
  with its real number, assign a recruiter to a port (this moves their
  extension into that port's block AND pins astdb in one step), and flip the
  pinning switch once the Dinstar port rules exist.
- **API**: `GET/POST /numbers/sim-ports*` — labels, assignment, pinning.

## Quick sanity checks

```bash
# What does the pool look like / who holds which extension?
ssh root@145.223.18.237 "asterisk -rx 'pjsip show endpoints' | grep 20"

# Is anyone pinned to a SIM right now?
ssh root@145.223.18.237 "asterisk -rx 'database show simgroup'"

# Live registrations (which recruiters' dialers are online)
ssh root@145.223.18.237 "asterisk -rx 'pjsip show contacts'"
```
