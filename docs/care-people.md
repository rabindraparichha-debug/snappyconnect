# Snappy Care person lookup (`/universe/people`)

Snappy Care — the SnappyHires internal support desk, inside the ATS — shows a
"customer 360" card per product. For SnappyConnect it calls this one read-only
route. Code: `backend/src/universe/`.

## Contract

```
GET /api/v1/universe/people?universe_id=&email=&phone=
Authorization: Bearer <universe service token>
```

**Token.** An HS256 JWT signed with the shared SnappyHires (GoTrue) secret:

| Claim | Required value |
|---|---|
| `aud` | `"authenticated"` |
| `role` | `"service"` |
| `app_metadata.app` | `"ats"` or `"support"` — nothing else is accepted |
| `exp` | optional; when present it must be in the future |

It is not a SnappyConnect session token: it is checked against
`UNIVERSE_JWT_SECRET`, never against `JWT_SECRET`, and a SnappyConnect login
token does not open this route.

**Answers.**

| Status | When | Body |
|---|---|---|
| 200 | token good, at least one identifier | the card below |
| 401 | no token, bad signature, wrong `alg`/`aud`/`role`, app not allowed, expired | `{"error":"unauthorized"}` |
| 422 | none of `universe_id`, `email`, `phone` is usable | `{"error":"universe_id, email or phone is required"}` |
| 429 | more than 60 requests a minute from one address | throttler default |
| 503 | `UNIVERSE_JWT_SECRET` is not set on the server | `{"error":"not configured"}` |

**Card (200).**

```json
{
  "found": true,
  "product": "snappyconnect",
  "roles": ["caller"],
  "summary": "2 calls in the last 90 days, last on 2026-09-30",
  "last_activity_at": "2026-09-30T10:00:00.000Z",
  "flags": { "do_not_call": false, "has_voicemail": true },
  "facts": [
    { "label": "Call", "value": "2026-09-30 inbound · 3m12s · completed · handled by Asha Rao" }
  ],
  "links": [{ "label": "SnappyConnect call history", "url": "https://call.snappyhires.com/history" }]
}
```

Unknown person: `found:false`, `roles/facts/links` empty, `summary` `""`,
`last_activity_at` `null`, `flags` `{}`. Strings are capped at 200 characters,
`facts` at 12.

## What is looked up

**By `phone`** (any spelling; reduced to digits and matched as `+E.164`, bare
digits, `00…`, and for US/Canada with and without the leading 1):

- the last five calls with that number as the outside party — date, direction,
  duration, disposition (or call status when no disposition was set), and the
  display name of the agent who handled it;
- `summary`: "N calls in the last 90 days, last on …";
- role `caller`; flags `do_not_call` (the Do Not Call list) and
  `has_voicemail` (the number has left a voicemail).

**By `email`** (or by `phone` when it is an agent's own mobile number): the
SnappyConnect account — role `agent` or `admin`, status, calling regions,
member-since date, calls handled in the last 90 days, and that agent's last
five calls with the other party masked (`+•••••1234`). Flags `account_active`,
`calling_enabled`.

Both can match in one request; roles and facts are then combined.

**Not modelled in SnappyConnect, so not returned:** workspace (the product is
a single workspace), plan/billing, and a SnappyHires universe id on users —
"Continue with SnappyHires" matches on the verified e-mail only. A request
with `universe_id` alone is accepted (no 422) and answers `found:false`; send
the e-mail or phone alongside it.

## What never leaves

Recordings and recording URLs, voicemail audio, transcripts, AI summaries,
call notes, contact names, agents' e-mail addresses and numbers, and any other
party's full phone number. The looked-up number itself is not echoed back and
is not put in a link. The card is built field by field, so a column added to
`call_logs` later cannot appear by accident.

## Owner steps

1. **SnappyConnect server** — add to the backend environment and restart the
   API:

   ```
   UNIVERSE_JWT_SECRET=<the shared SnappyHires GoTrue JWT secret>
   ```

   It is the same HS256 secret the other products already hold for universe
   service tokens. Until it is set the route answers 503 and nothing else in
   SnappyConnect is affected. (`WEB_APP_URL`, already set, is used for the
   links.)
2. **ATS** — set
   `CARE_360_SNAPPYCONNECT_URL=https://call.snappyhires.com/api/v1/universe/people`.

Check from any machine holding the secret:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://call.snappyhires.com/api/v1/universe/people?email=someone@example.com"
```

## Known limits

- Numbers saved in call history with spaces or dashes inside them are not
  matched (the lookup uses the indexed exact match, in every common spelling).
- The 60/minute limit is per calling address, like every other limit in this
  API.
- Tests: `cd backend && npm test` (`src/universe/universe-people.spec.ts`).
