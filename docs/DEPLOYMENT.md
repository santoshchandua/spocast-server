# Setup, integrations and operations

## Local development

Node 22.13+ is required. In this repository root, run:

```sh
npm ci
npm run setup
npm run migrate
npm run seed
npm start
```

In the separate spocast mobile repository:

```sh
npm ci
npm start
```

Use Expo Go compatible with SDK 55 or a development build. The app detects Expo's LAN address for port 4000. To override, set `EXPO_PUBLIC_API_URL` in `mobile/.env`. Release builds require an HTTPS URL. Browser development uses http://localhost:8081 and must exactly match `ALLOWED_ORIGINS`.

`npm run setup` creates random local secrets in `.env` without displaying them. It never overwrites an existing file. `.env` and `.data` are intentionally excluded from source archives. Do not lose the keys for data you intend to retain.

PGlite persists to `.data/postgres` and must have ONE owning process. Stop the API before running migrations, seeding, operator commands or the development OTP viewer against that directory. Tests use independent in-memory databases. For separate workers use PostgreSQL.

Phone OTP is the only sign-in method. Setup enables OTP_PROVIDER=development: no real SMS is sent. For an existing installation, add that setting to the private .env. Enter full name, E.164 mobile number (for example +91 followed by ten digits), and optional email. Click Send OTP, then stop the embedded API and run:

```sh
npm run dev:otp
```

Restart the API, enter the six-digit code within five minutes, and verify. The development CLI prints only locally queued test codes and refuses production use. A PostgreSQL development database allows API and CLI concurrently. Never expose the development SMS table through HTTP.

Production requires OTP_PROVIDER=twilio and TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID. Set permitted OTP_PHONE_PREFIXES and a conservative OTP_DAILY_CAP. Real SMS delivery must be tested with your business account.

Optional actual PostgreSQL: configure a unique POSTGRES_PASSWORD and start `infra/compose.local.yml` with Docker Compose. Set DATABASE_MODE=postgres and DATABASE_URL to the local PostgreSQL connection, then migrate/seed. This local Compose file is not production infrastructure.

## Production database and API

1. Provision private managed PostgreSQL, TLS certificates/CA, application compute, TLS ingress, secret manager and SMS verification provider. Docker/psql were not available for deployment in the implementation environment.
2. Start from `.env.production.example`. Inject secrets outside source control. Use a separate migration identity; run `npm run migrate` once per release before switching traffic.
3. Review/apply `infra/runtime-grants.sql`. Give the API and worker distinct managed login identities that inherit only their required roles. Do not use the owner account in the API.
4. Provision plans using the operator CLI and your real approved pricing JSON. Production demo seeding is disabled. Configure the licensed provider record through the operator CLI.
5. Build the API image from the `server` directory. Run API and worker separately, with a read-only container filesystem where possible. Inject secrets through the deployment platform. Set HOST=0.0.0.0 only when needed inside a private container network, and restrict ingress.
6. Terminate HTTPS at the trusted ingress or configure TLS_CERT_FILE/TLS_KEY_FILE in Node. Set the exact trusted proxy CIDRs and prevent clients from reaching the origin directly. Public HTTP is rejected in production.
7. Use a same-site deployment for web/app API (for example app.example.com and api.example.com). SameSite=Strict cookies intentionally do not support arbitrary cross-site embeds.
8. Run `npm run worker` against PostgreSQL. It generates audio, dispatches optional email, syncs the licensed feed when enabled, and runs cleanup. Current sync cadence is 30 seconds; adjust only to licensed rate limits and measured load.
9. Configure readiness checks, restarts, metrics, backups, restore drills, alerts and operational ownership before launch.

## Cricket provider adapter

The included adapter accepts a canonical JSON snapshot. It does not assume the schema or authentication of an unspecified vendor. Implement the mapper for your chosen provider first, after confirming storage/display/retention rights.

Canonical top-level payload:

```json
{
  "updatedAt": "2026-09-16T10:00:00Z",
  "matches": [{
    "id": "provider-match-1",
    "series": "Licensed competition",
    "stage": "Match 1",
    "format": "T20",
    "status": "upcoming",
    "venue": "Ground name",
    "startTime": "2026-09-17T12:00:00Z",
    "teams": [
      {"code":"IND","name":"India","score":"—","overs":""},
      {"code":"AUS","name":"Australia","score":"—","overs":""}
    ],
    "summary": "Match scheduled",
    "innings": [],
    "commentary": []
  }]
}
```

`src/cricket.js` defines the strict complete schema. HTTP poll configuration uses CRICKET_FEED_URL, CRICKET_FEED_HOST and CRICKET_FEED_TOKEN (Bearer). Redirects are rejected. Configure network egress to the provider host. CRICKET_LICENSE_CONFIRMED=true plus a current enabled database license record are both required.

Push ingestion: POST `/api/webhooks/cricket` using application/json and these headers:

- `X-Feed-Timestamp`: Unix seconds, within five minutes.
- `X-Feed-Event-ID`: stable unique alphanumeric/dash/underscore ID, maximum 100 characters.
- `X-Feed-Signature`: lowercase hex HMAC-SHA256 over `timestamp + '.' + eventId + '.' + rawBody`, keyed by CRICKET_WEBHOOK_SECRET.

This is the contract for your adapter, not a claim that a third-party provider uses this signature format. Do not expose an endpoint that simply trusts client-submitted scores.

## Web subscriptions and payments

Set BILLING_PROVIDER to exactly one of disabled, stripe or razorpay. Configure separate sandbox and production credentials. The app currently shows sample INR prices; use the operator plan command to define your approved amounts/currency. Configure external provider plans to match amount, currency and recurrence exactly. No user-supplied amount is accepted.

Stripe: configure secret key, webhook secret, monthly/yearly Price IDs and the hosted Customer Portal in the Stripe dashboard. Receive checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid and invoice.payment_failed at `/api/webhooks/billing/stripe`.

Razorpay: configure key ID/secret, webhook secret and monthly/yearly Plan IDs. Hosted subscription links are created server-side. Send subscription lifecycle and subscription.charged events to `/api/webhooks/billing/razorpay`. The account screen supports renewal cancellation; a Stripe-style customer portal is not provided by this adapter.

POST `/api/billing/checkout` requires a verified session and an Idempotency-Key UUID. The body is `{ "planId": "plus_monthly" }`. This returns a provider-hosted HTTPS URL. Reuse the same key after a network failure. Ambiguous provider creation is deliberately blocked for operator reconciliation instead of risking duplicate charges. No client success flag grants access.

Only the web build exposes checkout/portal buttons. Native digital subscription purchase flows remain disabled until Apple/Google billing, server receipt verification and storefront rules are implemented and tested. Existing verified entitlements can be consumed by the mobile app.

Before taking money, finish refund/dispute handling and periodic reconciliation, define taxation/invoice/refund terms, test with sandbox accounts, and obtain merchant approval. The current payments table records successful subscription invoice/payment references, not a complete accounting ledger.

## Operator commands

Run from this repository root on an authorized private maintenance host with audited access. These are not HTTP admin routes.

```sh
node --env-file=.env scripts/operator.js status
node --env-file=.env scripts/operator.js suspend USER_UUID
node --env-file=.env scripts/operator.js restore USER_UUID
node --env-file=.env scripts/operator.js provider approved-provider.json
node --env-file=.env scripts/operator.js plans approved-plans.json
node --env-file=.env scripts/operator.js advertisement approved-ad.json
node --env-file=.env scripts/operator.js finalize-deletion USER_UUID
```

Provider JSON: name, licenseReference, licenseExpiresAt (ISO UTC), retentionDays. Secrets go into the environment, not this file.

Plans JSON is an array with id (plus_monthly/plus_yearly), name, amountMinor, currency, interval (month/year), features (array of strings). Do not change existing provider prices without a migration plan for existing subscribers.

Advertisement JSON: name, startsAt, endsAt, placement (scores_inline/news_inline), headline, body, destinationUrl (HTTPS). Publication is an operator-approved action. No HTML, ad scripts, or user targeting are accepted. Ad metric tables are reserved; impressions/clicks are not being collected.

Deletion finalization requires a pending user deletion request and no active/pending/past-due subscription. Cancel/reconcile billing first. The command erases personal app fields and keeps minimal accounting references according to the documented retention policy. Handle payment-provider/email-provider records and backups separately.

## Verification commands

```sh
# server
npm test
npm audit --omit=dev --audit-level=high
# mobile
npx expo export --platform all
```

For real PostgreSQL tests, set TEST_DATABASE_URL to a NEW, EMPTY, ISOLATED disposable database before `npm test`. Never point it at real user data; the tests insert fixtures and clear rate-limit rows. No hosted CI workflow is included.

## AI commentary and archive imports

Set AUDIO_ENABLED=true and a server-only OPENAI_API_KEY after confirming speech-generation and distribution rights for the commentary. The worker sends only sports commentary to OpenAI, never account data, uses gpt-4o-mini-tts/coral and stores MP3 bytes in audio_clips. AUDIO_DAILY_CAP limits attempts across workers. Provider billing limits should also be set externally. Standard AI voice is disclosed; human broadcaster impersonation is not used.

Audio is generated once per content fingerprint and reused by all app users. Each poll queues the latest six commentary events, oldest first; this is delayed narration, not a complete guaranteed real-time stream. Supply stable commentary eventId values unique across innings, including wides/no-balls, for corrections. Without eventId, only identical text is deduplicated; corrections cannot reliably replace old events. Clips retry up to three times, expire after one day and are hidden when a feed license expires. Demo narration remains explicitly fictional. For large audiences, migrate media storage to a private object store/CDN with equivalent license checks and lifecycle policies.

With embedded development, stop the API and run npm run audio, then restart it. This invokes the configured paid speech API only when enabled and keyed. Use PostgreSQL for a continuous worker alongside the API. Actual sound generation and physical-device playback require acceptance testing; mocked audio tests do not validate sound quality.

Archive ingestion: map your licensed source to the strict historySchema in src/history.js and run npm run import:history -- approved-history.json from the backend. Profiles contain statistics and achievements; rankings include format, gender, category, asOf, sourceLabel and entries; records are a complete provider snapshot. Imports are transactional. Current API history/records lists cap at 100; large archives need cursor pagination. Contractual deletion of archives needs an operator process; the match retention cleanup does not yet purge historical profiles/rankings/records.

For UPI, enable approved UPI/UPI AutoPay methods in the Razorpay merchant account. Hosted subscription checkout determines eligible methods for the device/account. This code never collects a UPI PIN or treats a redirect as payment proof. Native digital purchases remain disabled pending store billing integration and review. See [Razorpay UPI](https://razorpay.com/docs/payments/payment-methods/upi/) and [OpenAI speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).
