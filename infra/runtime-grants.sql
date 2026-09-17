-- Run as the database owner after migrations. Create LOGIN identities and passwords
-- separately using your infrastructure/secret manager. These group roles do not log in.
CREATE ROLE pulse_api NOLOGIN;
CREATE ROLE pulse_worker NOLOGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pulse_api, pulse_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pulse_api, pulse_worker;
GRANT INSERT, UPDATE, DELETE ON users,sessions,auth_tokens,user_preferences,consent_events,rate_limits,email_outbox,favorites,privacy_requests,billing_customers,subscriptions,checkout_requests,payments,refunds,webhook_events,job_leases TO pulse_api;
GRANT INSERT ON audit_events TO pulse_api, pulse_worker;
GRANT INSERT,UPDATE,DELETE ON otp_challenges,development_sms TO pulse_api;
GRANT DELETE ON otp_challenges,development_sms TO pulse_worker;
GRANT INSERT,UPDATE,DELETE ON audio_clips TO pulse_api,pulse_worker;
GRANT USAGE,SELECT ON SEQUENCE audio_clips_sequence_seq TO pulse_api,pulse_worker;
-- Signed provider ingestion uses the same API service in this deployment.
GRANT INSERT,UPDATE,DELETE ON matches,teams,match_teams,sync_runs TO pulse_api, pulse_worker;
GRANT UPDATE ON providers TO pulse_api, pulse_worker;
GRANT INSERT,UPDATE,DELETE ON job_leases,webhook_events,email_outbox,rate_limits,sessions,auth_tokens TO pulse_worker;
-- No DDL, role grants, ad publication, or audit deletion rights for the API identity.
-- Grant these group roles to separate managed LOGIN identities, never to PUBLIC.
