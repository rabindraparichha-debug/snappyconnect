# SnappyConnect API — integration guide

Everything an external application (CRM, ATS, marketplace, …) needs to place calls
through SnappyConnect and read back what happened.

- **Base URL:** `https://call.snappyhires.com/api/v1`
- **Format:** JSON everywhere. Dates are ISO-8601 UTC strings.
- **Errors:** standard HTTP codes with `{ "message": "...", "statusCode": 400 }`.

---

## 1. Authentication

JWT bearer tokens, obtained by logging in as a SnappyConnect user.

```http
POST /auth/login
Content-Type: application/json

{ "email": "recruiter1@snappyhires.in", "password": "..." }
```

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": "uuid", "name": "India Recruiter 1", "email": "...",
            "role": "user", "provider": "native_dialer", "status": "active" }
}
```

Send it on every subsequent request:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**Tokens expire after 24 hours.** On `401`, log in again and retry.

> **Call as the recruiter, not as a service account.** Every call is attributed to
> the authenticated user, so per-recruiter reporting only works if the integration
> holds one token per recruiter. A single shared login makes every call look like
> the same person.

`GET /auth/me` returns the current user — useful for resolving which recruiter a
stored token belongs to.

---

## 2. Placing a call

```http
POST /calls/click-to-call
{ "phoneNumber": "+919876543210", "source": "api", "region": "india" }
```

`source` (`web` | `mobile` | `extension` | `api`) and `region`
(`india` | `usa` | `uae`) are optional; region defaults to the number's dial code.

**Calls are asynchronous.** The response tells you what is happening next, which
depends on the recruiter's provider:

```json
{
  "action": "queued_to_mobile",
  "provider": "native_dialer",
  "phoneNumber": "+919876543210",
  "requestId": "uuid",
  "callLogId": null,
  "dialUrl": null,
  "message": "Call request sent to your mobile app — it will open the native dialer."
}
```

| `action` | Region / provider | What happens |
|---|---|---|
| `queued_to_mobile` | India — native dialer | The recruiter's phone picks up the request and opens its dialer. Returns `requestId`; the call log is created when the call finishes. |
| `client_dial` | USA — Telnyx | The recruiter talks in the browser/app over WebRTC. Open `dialUrl` to hand off to the SnappyConnect web dialer. |
| `pbx_originated` | UAE — Asterisk/PBX | The PBX rings the recruiter's extension, then dials the candidate. Returns `callLogId` immediately. |

Because the outcome arrives later, **subscribe to the webhook** (§4) rather than
polling — or poll `GET /calls` (§5) filtered by `userId` and time.

`POST /calls/initiate` is the same operation with `source` defaulting to `web`.

---

## 3. Call records

A call record (returned by `GET /calls`, `POST /calls/log`, `PATCH /calls/log/:id`):

```json
{
  "id": "uuid",
  "userId": "uuid",
  "user": { "id": "uuid", "name": "...", "email": "..." },
  "phoneNumber": "+919876543210",
  "contactName": "Priya Sharma",
  "provider": "native_dialer",
  "direction": "outbound",
  "status": "completed",
  "durationSeconds": 95,
  "ringTimeSeconds": 8,
  "startedAt": "2026-07-31T09:12:03.000Z",
  "endedAt": "2026-07-31T09:13:38.000Z",
  "disposition": "interview_scheduled",
  "notes": "Available from Monday",
  "followUpDate": "2026-08-04T04:30:00.000Z",
  "recordingUrl": "/calls/recordings/abc123.mp3",
  "transcript": null,
  "aiSummary": null,
  "candidateId": null, "jobId": null, "companyId": null,
  "region": "india",
  "country": "IN",
  "source": "api",
  "externalId": null,
  "metadata": { "requestId": "uuid" },
  "createdAt": "2026-07-31T09:13:38.000Z"
}
```

**Enums**

| Field | Values |
|---|---|
| `status` | `initiated`, `ringing`, `in_progress`, `answered`, `completed`, `missed`, `failed`, `busy`, `no_answer`, `canceled` |
| `disposition` | `interview_scheduled`, `not_interested`, `callback_requested`, `left_voicemail`, `wrong_number`, `offer_made`, `hired`, `no_answer_disposition` |
| `provider` | `telnyx`, `grandstream`, `native_dialer`, `asterisk` |
| `region` | `india`, `usa`, `uae` |
| `direction` | `outbound`, `inbound` |

**Linking calls to your records.** `candidateId`, `jobId` and `companyId` are free
UUID fields reserved for the external system. Set them with:

```http
PATCH /calls/log/:id
{ "candidateId": "uuid", "notes": "...", "disposition": "interview_scheduled" }
```

Recordings stream from `GET /calls/recordings/:filename` (authenticated). There is
no per-call `GET /calls/:id`; fetch via the list endpoint filtered by `q` or read
the webhook payload.

---

## 4. Webhooks (recommended)

SnappyConnect pushes events as they happen. Subscriptions are managed by an admin:

```http
POST /webhooks-config          ← admin token
{
  "name": "SnappyHires CRM",
  "url": "https://crm.snappyhires.com/api/webhooks/live-call",
  "events": ["call.completed", "disposition.set"],
  "secret": "<shared secret>"
}
```

Also available: `GET /webhooks-config`, `POST /webhooks-config/:id/test`,
`DELETE /webhooks-config/:id`.

**Events:** `call.completed`, `disposition.set`, `sms.received`.

**Delivery:** `POST` with `Content-Type: application/json`,
`User-Agent: SnappyConnect-Webhook/1`, 10-second timeout, and — when a secret is
set — an HMAC header:

```
X-SnappyConnect-Signature: sha256=<hex HMAC-SHA256 of the raw body>
```

Verify over the **raw request bytes**, not re-serialized JSON.

```json
{
  "event": "call.completed",
  "firedAt": "2026-07-31T09:13:38.000Z",
  "data": {
    "callId": "uuid",
    "phoneNumber": "+919876543210",
    "contactName": null,
    "direction": "outbound",
    "status": "completed",
    "durationSeconds": 95,
    "region": "india",
    "startedAt": "2026-07-31T09:12:03.000Z",
    "user": { "id": "uuid", "name": "India Recruiter 1", "email": "..." }
  }
}
```

`disposition.set` carries `{ callId, phoneNumber, contactName, disposition, notes, user }`.

> **Always return `200`** for any payload whose signature validates, including the
> `{ "test": true }` payload sent by the Test button. Returning 4xx for unknown
> shapes makes healthy subscriptions look broken.

---

## 5. Reading call history

```http
GET /calls?page=1&limit=100
```

Filters (all optional, combinable): `q` (free text over number / user name / email),
`userId`, `provider`, `direction`, `status`, `disposition`, `from`, `to` (ISO dates),
`hasRecording=true`. `limit` max 500.

```json
{ "items": [ /* call records */ ], "total": 130, "page": 1, "limit": 100 }
```

`GET /calls/export` returns the same query as CSV.

---

## 6. Other useful endpoints

| Purpose | Endpoint |
|---|---|
| Current user | `GET /auth/me` |
| Contact history for a number | `GET /calls/contacts/:phoneNumber` |
| All contacts called | `GET /calls/contacts` |
| Follow-ups due | `GET /calls/follow-ups` |
| Log a call placed elsewhere | `POST /calls/log` |
| Update notes / disposition / CRM ids | `PATCH /calls/log/:id` |
| Send SMS (USA/Telnyx) | `POST /sms/send` — `{ "to": "+1...", "body": "..." }` |
| SMS threads | `GET /sms/threads`, `GET /sms/threads/:phoneNumber` |
| Schedule a call | `POST /scheduled-calls` — `{ "phoneNumber", "scheduledAt", "contactName?", "notes?", "region?" }` |
| Upcoming scheduled calls | `GET /scheduled-calls/upcoming` |
| Do-not-call list | `GET /dnc`, `GET /dnc/check?phoneNumber=...`, `POST /dnc` |
| Activity feed | `GET /activity` |
| Dashboard counters | `GET /dashboard/stats` |
| Phone numbers on the account | `GET /numbers` (admin) |
| Health check (no auth) | `GET /health` |

---

## 7. Available lines per region

`GET /numbers` lists **Telnyx (USA) numbers** and their assignments. The other two
regions have no enumerable pool:

- **India** — each recruiter calls from the SIM in their own phone.
- **UAE** — all recruiters share one GSM trunk (one concurrent call per SIM).

So "which line will this call go out from" resolves as: USA → the recruiter's
assigned Telnyx number; India → their handset SIM; UAE → the shared UAE line.

---

## 8. Worked example

```bash
BASE=https://call.snappyhires.com/api/v1

# 1. authenticate as the recruiter
TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"recruiter1@snappyhires.in","password":"..."}' \
  | jq -r .accessToken)

# 2. place the call
curl -s -X POST $BASE/calls/click-to-call \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"phoneNumber":"+919876543210","source":"api"}'

# 3. the result arrives at your webhook; or poll:
curl -s "$BASE/calls?limit=1" -H "Authorization: Bearer $TOKEN"

# 4. attach your own record ids and outcome
curl -s -X PATCH $BASE/calls/log/<callId> \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"candidateId":"<uuid>","disposition":"interview_scheduled"}'
```

---

## 9. Notes for integrators

- **Rate limits:** none enforced today. Be reasonable; prefer webhooks over polling.
- **CORS** is open, so browser-based clients work, but never ship a recruiter
  password to the browser — authenticate server-side and proxy.
- **One call at a time per SIM** in UAE; India is limited by the recruiter's own
  phone. Queue accordingly rather than firing calls in parallel for one user.
- **Numbers** may be sent in any common format (`+91…`, `0091…`, local); the API
  normalizes per region before dialing.
