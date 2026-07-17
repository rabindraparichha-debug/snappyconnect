# SnappyConnect

A simple, modern multi-platform calling platform. Web, Android and iOS calling with pluggable providers, exposed through clean REST APIs so other applications (CRM, ATS, marketplaces, …) can integrate later.

**This is a calling platform only** — no CRM, ATS, recruitment or AI features.

## Repository layout

| Directory | Stack | Purpose |
|---|---|---|
| [`backend/`](backend) | NestJS + PostgreSQL + TypeORM + JWT | REST API: auth, users, calling, call history, SMS, dashboard, settings, webhooks |
| [`web/`](web) | Next.js + React + TypeScript + Tailwind CSS | Admin & user web app with in-browser Telnyx dialer |
| [`mobile/`](mobile) | Flutter (single codebase, Android + iOS) | Mobile dialer: native-SIM calling (India), Telnyx VoIP, call-history sync |
| [`extension/`](extension) | Chrome Extension (Manifest V3) | Detects phone numbers on any page and click-to-calls via the API — zero business logic |

## Calling providers

Providers are pluggable strategies behind one interface ([`provider.interface.ts`](backend/src/providers/provider.interface.ts)). `POST /calls/initiate` returns an *action* describing what happens next:

| Region | Provider | How a call flows | Action |
|---|---|---|---|
| 🇺🇸 USA | **Telnyx** | Browser/mobile dials over WebRTC with a short-lived token minted by the API. SMS via Telnyx Messages API. Webhooks reconcile call status. | `client_dial` |
| 🇦🇪 UAE | **Grandstream PBX + Dinstar** | All UAE users share a single Wave extension (configured in Settings). API originates via the UCM HTTPS API: PBX rings the shared extension, then dials out through the Dinstar trunk. One call at a time; SnappyConnect tracks which user initiated each call. | `pbx_originated` |
| 🇮🇳 India | **Native Mobile Dialer** | No VoIP. API queues a call request; the Flutter app polls, opens the native dialer (user's own SIM), then syncs duration & outcome back. | `queued_to_mobile` |

To add a provider: implement `CallingProviderStrategy`, register it in [`providers.service.ts`](backend/src/providers/providers.service.ts), and add its settings namespace.

## Quick start

Prereqs: Node 20+, PostgreSQL 14+, (optional) Flutter 3.x for mobile.

### 1. Backend (port 4000)

```bash
createdb snappyconnect
cd backend
cp .env.example .env        # adjust DB credentials & secrets
npm install
npm run start:dev
```

On first boot an admin account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (default `admin@snappyconnect.local` / `admin123` — change these).

Alternatively start Postgres with Docker: `docker compose up -d`.

### 2. Web app (port 3000)

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Sign in at http://localhost:3000 with the admin credentials.

### 3. Chrome extension

1. Open `chrome://extensions`, enable *Developer mode*, click *Load unpacked* and pick the `extension/` folder.
2. Click the extension icon, enter the API URL (`http://localhost:4000/api/v1`) and sign in.
3. Phone numbers on web pages get a green call button. Clicking it calls `POST /calls/click-to-call`; for Telnyx users a pre-filled web dialer tab opens, for Grandstream the PBX rings the extension, for Native Dialer the request is pushed to the mobile app.

### 4. Mobile app

```bash
cd mobile
flutter pub get
flutter run          # emulator: use http://10.0.2.2:4000/api/v1 as the server URL
```

- **Native Dialer users (India):** the app polls for browser-initiated call requests, opens the phone's dialer, and after the call syncs the real duration (Android reads the device call log; iOS asks for confirmation). A sync button imports recent device calls in bulk.
- **Telnyx users (USA):** in-app VoIP calls via the Telnyx WebRTC SDK using tokens minted by the API.

## Admin configuration

Under **Settings** (admin only), stored AES-256-GCM-encrypted at rest:

- **Telnyx** — API key, telephony credential ID (WebRTC tokens), connection ID, default from-number, messaging profile (SMS).
- **Grandstream PBX** — host, API port (8089), API username/password, shared Wave extension (e.g. 101), optional outbound prefix. All UAE users call through this single extension.
- **Dinstar** — gateway host/credentials, stored for reference (it is trunked to the PBX; calls don't hit it directly).

Configure the Telnyx webhook to `https://<your-host>/api/v1/webhooks/telnyx` to reconcile call statuses and durations.

## API overview

All routes are prefixed `/api/v1`. Authenticate with `Authorization: Bearer <token>`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login` · `GET /auth/me` · `POST /auth/change-password` |
| Users (admin) | `GET/POST /users` · `GET/PATCH/DELETE /users/:id` · `PATCH /users/:id/status` · `PATCH /users/:id/provider` |
| Calling | `POST /calls/initiate` · `POST /calls/click-to-call` · `POST /calls/telnyx/token` · `POST /calls/log` · `PATCH /calls/log/:id` |
| Native dialer | `GET /calls/requests/pending` · `POST /calls/requests/:id/ack` · `POST /calls/requests/:id/complete` · `POST /calls/requests/:id/cancel` · `POST /calls/sync` |
| History | `GET /calls` (search + filters + pagination) · `GET /calls/export` (CSV) |
| SMS | `POST /sms/send` · `GET /sms` |
| Dashboard | `GET /dashboard/stats` |
| Settings (admin) | `GET /settings/providers` · `PUT /settings/providers/:key` |
| Webhooks | `POST /webhooks/telnyx` (public) |
| Health | `GET /health` (public) |

Users always see only their own calls; admins see everything. External applications integrate exactly like the first-party clients: log in (or use a dedicated integration user), then call the same endpoints.

## Production notes

- Set strong `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY` and admin credentials; disable `DATABASE_SYNCHRONIZE` and use migrations.
- Serve both apps behind HTTPS; WebRTC requires a secure context in the browser.
- The Grandstream UCM dial action name can vary by firmware — see `dialViaUcm()` in [`grandstream.provider.ts`](backend/src/providers/grandstream.provider.ts).
- Mobile V1 uses foreground polling for click-to-call; add FCM/APNs push (and CallKit/ConnectionService for Telnyx) as a follow-up.
