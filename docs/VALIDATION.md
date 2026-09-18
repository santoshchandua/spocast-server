# Validation record

Validated locally on Node 22, Expo SDK 55 and PGlite.

- Backend integration suite: 20 passing tests, including database migrations, OTP single use/attempt limits/expiry, encrypted identities, optional-email isolation, cookie CSRF, account ownership, deletion/session revocation, licensed feed signature/replay/stale-update rejection, archive reads, signed Stripe reconciliation and unsigned payment rejection.
- Audio tests use mocked speech bytes: deduplication, repeated over labels, stable event corrections, disabled-provider behavior, byte ranges and license gating. No real speech API call or sound-quality validation was performed.
- Expo export succeeds for Android, iOS and web. This is bundle validation, not an installed native app/device test.
- Browser checks: ranking list, team history/achievement detail, mobile OTP form and development OTP request. Full OTP authentication is covered by the backend integration suite.
- Backend dependency audit: zero reported vulnerabilities. Mobile toolchain audit reports nine moderate advisories; review and resolve before release. No forced breaking downgrade was applied.

Not validated: production PostgreSQL over TLS, real SMS delivery, real AI audio playback, UPI/AutoPay merchant checkout, native store billing, load capacity, penetration testing, disaster recovery and paid-provider schema mapping. See SECURITY.md for release blockers. No claim of commercial launch readiness.

Latest operations checks: exclusive embedded ownership and release; missing/pending schema rejection; worker failure isolation with sanitized logs; archive retention from ingestion time, cascades and retained-record associations. Migration 005 applied successfully to the local development database.


Series validation: rate denominators, missing/zero values, sorted leaderboards, minimum-sample filters, rejected duplicate players, license gating and retention cascades. Browser verified Matches/Fixtures filtering and the Series leaderboard. Android, iOS and web exports pass after the navigation update.

