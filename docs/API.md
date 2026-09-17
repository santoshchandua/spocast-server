# API reference

Base path `/api`. Responses use `{ "data": ... }`; failures use `{ "error": ... }` and an HTTP status. Send JSON for POST/PATCH. Native sessions use `Authorization: Bearer TOKEN`. Browser sessions use HttpOnly cookies and `X-CSRF-Token` returned by login/session. Release clients require HTTPS.

| Method and path | Purpose |
| --- | --- |
| GET /health, /ready | Liveness; DB readiness |
| GET /auth/config | OTP availability and supported country prefixes |
| POST /auth/otp/request | `{fullName, phone, email?}`. E.164 phone; returns challengeId, masked destination, expiry, resend delay; never returns OTP |
| POST /auth/otp/verify | `{challengeId, code}`. Creates or restores mobile account; returns session and profile |
| GET /auth/session | Current authenticated profile and browser CSRF token |
| POST /auth/logout, /auth/logout-all | Revoke current/all sessions; body `{}` |
| PATCH /me | `{name, email?}`; optional email can be cleared; phone change is not implemented |
| GET /me/sessions; DELETE /me/sessions/:id | Own active sessions; revoke |
| GET, PATCH /me/preferences | Locale and optional consent preferences |
| GET /me/export | Own data export; rate limited |
| POST /me/deletion-otp | Send fresh OTP scoped to account deletion |
| POST /me/deletion-request | `{challengeId, code}`; suspend account and queue operator deletion |
| GET /matches | Optional status, limit (1–100), offset (0–10000) |
| GET /matches/:id | Scorecard and text commentary from internal DB |
| GET /matches/:id/insights | Scoring-pace projection; Plus scenarios require entitlement |
| GET /matches/:id/audio | Ordered recent clips, readiness, AI disclosure, generation availability |
| GET /audio/:id | Licensed MP3 bytes; supports a single explicit byte range |
| GET /news; GET /news/:id | Published articles |
| GET /rankings | format=T20/ODI/TEST; category=team/batting/bowling/allrounder; gender=men/women |
| GET /records | Optional format, category=batting/bowling/team; up to 100 |
| GET /history | Optional kind=player/team and search (up to 80 characters) |
| GET /history/:id | Career statistics, achievements and records |
| GET, POST /me/favorites; DELETE /me/favorites/:matchId | Own follows; POST `{matchId}` |
| GET /plans | Approved plan pricing and checkout availability |
| GET /me/subscription; GET /me/payments | Own subscription, entitlement and payment history |
| POST /billing/checkout | `{planId}` with UUID Idempotency-Key; hosted checkout URL |
| POST /billing/portal | Stripe customer portal URL |
| POST /billing/cancel | `{subscriptionId}` for own subscription |
| POST /webhooks/billing/:provider | Raw provider-signed event; not a client payment success callback |
| POST /webhooks/cricket | Signed canonical provider snapshot; documented in DEPLOYMENT.md |
| GET /ads/:placement | Contextual approved sponsor creative; Plus receives none |

No password registration/login/reset endpoints. Optional email is not a login identifier. No public data-provider secrets, admin mutation, OTP retrieval or arbitrary audio synthesis endpoint.

Schemas in src/phone-auth.js, src/cricket.js and src/history.js are authoritative. History import uses the private CLI, not the mobile API. All list sizes are bounded; ranking history snapshots are stored but browsing older snapshots is a future feature.
