# Security model and release gates

Protecting customer and business data requires application controls plus properly operated infrastructure. This document distinguishes implemented controls from work still required before accepting real users or money.

## Implemented controls

- Authentication: full name and E.164 mobile number; one-time six-digit verification, five-minute expiry, five committed attempts, single-use consumption, phone/IP/cooldown/global limits. Twilio Verify in production; development codes are encrypted and accessible only through a private local CLI. Optional email never identifies or merges accounts.
- Sessions: random 256-bit opaque tokens, only SHA-256 digests stored, 24-hour absolute expiry, server-side revocation, logout-all, active device list. Fresh OTP is required for account deletion. The phone-auth migration revokes old sessions.
- Native token storage: Expo SecureStore using platform Keychain/Keystore. Web tokens are in HttpOnly SameSite=Strict cookies; no tokens in browser localStorage/sessionStorage. Production cookies are Secure.
- Browser writes: exact origin allowlist and session-bound CSRF token. No wildcard credentialed CORS. Browser/mobile release requests require HTTPS.
- PII at rest: AES-256-GCM encryption of names, phone numbers, optional email addresses, OTP profiles and queued messages. Phone and email lookups use a separate keyed HMAC. Versioned ciphertext, random IV, authenticated associated data. This is not full-database encryption.
- API: strict input schemas, body size caps, SQL value binding, shared database rate limits, OTP challenge responses without verification codes, request IDs and sanitized server errors. No secret, token, password, email address or raw payment payload logging.
- Provider intake: pinned configured HTTPS hostname, no redirects, timeouts and size limits, licensed-provider gate, five-minute signed push timestamps, event deduplication and stale snapshot rejection.
- Billing: server-selected plan and price checks, local ownership mapping, unique checkout intent, signature verification on raw bytes, authoritative subscription retrieval, short reconciliation lease, transactional event processing and entitlement expiry. Card numbers/CVV never enter the application database.
- Privileged operations: no public admin endpoints. Operator CLI requires private server/database access. Public registration cannot assign roles.
- Ads: text-only approved creatives, HTTPS destination links, no arbitrary HTML/scripts, no third-party tracking SDK. Optional consent defaults to false.

## Required infrastructure

1. Deploy API and worker on private compute behind an HTTPS load balancer/WAF. Restrict origin-server access to that proxy. Set exact `TRUST_PROXY_CIDRS`; never blindly trust forwarded headers from the Internet.
2. Use managed PostgreSQL with private networking, certificate-verified TLS, storage encryption, separate migration/API/worker identities, and no public database listener. Apply reviewed runtime grants. The runtime must not own the schema.
3. Inject independent production secrets using a secret manager. Do not commit `.env`, database directories, keys, raw dumps or logs. Separate development, staging and production accounts.
4. Back up encrypted database snapshots and encryption keys separately. Enable point-in-time recovery; test restores in an isolated environment. Establish actual recovery point/time objectives before launch.
5. Restrict privileged operator access with SSO/MFA, short-lived machine credentials and infrastructure audit logs. The current role column is reserved; an MFA-protected web admin console is not implemented.
6. Configure Twilio Verify, country restrictions, Fraud Guard and spending alerts. Enable only approved countries; review SMS registration/delivery requirements for the target market. Keep SMS and TTS keys on the backend.
7. Set alerts for failed/late cricket sync, webhook failures, payment mismatches, login abuse, overdue deletion requests, worker failures, database saturation and stale live scores. Export sanitized events to protected monitoring.

## Known launch blockers

- No production cloud/database/TLS deployment has been performed or penetration tested.
- No real provider credentials, licensed schema or merchant accounts have been supplied. Canonical cricket ingestion requires the chosen provider's mapper; it is not a universal raw-provider adapter.
- Stripe and Razorpay code needs merchant sandbox/end-to-end certification, including renewal, outage, cancellation, tax, chargeback and refund policies. Refund/dispute reconciliation and periodic repair of missed events are not complete. Do not enable commercial billing until those are finished.
- Native Apple/Google billing and server receipt verification are not implemented; native checkout is deliberately disabled. Store rules vary by storefront and program and must be reviewed before enabling purchase links.
- Mobile device/emulator, accessibility, load and hostile-network testing are still required. SQL compatibility has been exercised on PGlite locally; a real PostgreSQL/TLS instance is still required for deployment acceptance.
- No passkeys/MFA enrollment, SIM-swap/recycled-number detection, phone-change/recovery workflow, automated fraud engine, or fully automated deletion/cancellation workflow yet.
- Developer dependency audit findings must be reviewed before release; the Expo toolchain is not itself a security certification.

## Data lifecycle

Account deletion first suspends access and revokes sessions. An authorized operator must cancel/reconcile subscriptions, process the provider's customer-erasure procedure as appropriate, then run `finalize-deletion`. The CLI erases account fields, devices, favorites, sessions and preferences while retaining minimal accounting references. Set a jurisdiction-appropriate billing/audit retention schedule with counsel; this code does not establish a legal retention period.

Worker cleanup removes expired OTP challenges and one-day-old audio; expired rate counters; old sessions/action tokens; and queued email older than seven days. Configured cricket retention applies to stored match snapshots and licensed archive profiles, achievements, rankings and records, measured from ingestion/update timestamps. Cleanup runs even when another worker job fails. Embedded development databases reject concurrent owners; API and worker startup require the current schema. It does not remove billing/audit history automatically. Backups and third-party systems must be included in deletion/retention procedures.

Keys currently use one active v1 key; production key rotation needs a reviewed maintenance job to decrypt/re-encrypt PII and rebuild phone/email HMACs using old and new keys transactionally. Changing environment keys alone makes existing records unreadable. Keep recovery keys under separate access control.

## References reviewed

- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Razorpay raw-body webhook validation](https://razorpay.com/docs/webhooks/validate-test/)
- [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Google Play backend verification](https://developer.android.com/google/play/billing/security)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

