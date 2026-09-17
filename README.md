# Spocast server

Node.js / Express API with PostgreSQL, licensed cricket ingestion, phone OTP accounts, subscriptions, contextual ads, AI commentary audio and cricket archives. Mobile app: [spocast](https://github.com/santoshchandua/spocast).

## Local development

Use Node 22.13+. Run npm ci, npm run setup, npm run migrate, npm run seed, then npm start. The API listens on port 4000. Setup generates private local secrets and enables development OTP; no real SMS is sent. Stop the embedded API before npm run dev:otp to inspect your locally queued test code, then restart it.

Run npm test for 13 integration checks. Embedded PGlite is development-only and must have one owning process. Production requires managed PostgreSQL, verified TLS and configured Twilio Verify.

## Features and limits

Mobile OTP is the only login method: full name and phone are required; email is optional. Personal fields are encrypted; sessions are hashed and revocable; browser writes require CSRF proof. Provider keys remain server-side.

Scores come from the internal DB. The licensed adapter validates and deduplicates provider snapshots. Archives include rankings, records, history and achievements. AI speech clips are generated once and reused, with explicit AI disclosure. Stripe/Razorpay hosted subscriptions use signed webhook reconciliation; eligible Razorpay merchants can enable UPI/AutoPay. No real provider/merchant credentials are included.

This is a production-oriented foundation, not a completed commercial deployment. Refund/dispute repair, native store billing, production infrastructure, real provider testing and independent security review remain.

- [Deployment and provider configuration](docs/DEPLOYMENT.md)
- [Architecture and tables](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Security and release gates](docs/SECURITY.md)
- [Validation](docs/VALIDATION.md)

Source excludes .env, databases, logs, dependency folders and credentials. Demo data is fictional. No hosted CI workflow is included.
