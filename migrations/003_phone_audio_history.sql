ALTER TABLE users ALTER COLUMN email_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN email_cipher DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN phone_hash text UNIQUE;
ALTER TABLE users ADD COLUMN phone_cipher text;
ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;
UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL;
CREATE TABLE otp_challenges (
 id uuid PRIMARY KEY, phone_hash text NOT NULL, phone_cipher text NOT NULL, profile_cipher text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('login','delete')), user_id uuid REFERENCES users(id),
 provider text NOT NULL CHECK(provider IN ('development','twilio')), provider_reference text,
 code_hash text, attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','pending','used','failed')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE INDEX otp_phone_created_idx ON otp_challenges(phone_hash,created_at DESC);
CREATE INDEX otp_expiry_idx ON otp_challenges(expires_at);
CREATE INDEX otp_user_idx ON otp_challenges(user_id);
CREATE TABLE development_sms (challenge_id uuid PRIMARY KEY REFERENCES otp_challenges(id) ON DELETE CASCADE, code_cipher text NOT NULL);
CREATE TABLE audio_clips (
 id uuid PRIMARY KEY, match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE, content_hash text NOT NULL UNIQUE,
 commentary_text text NOT NULL, ball_label text NOT NULL, sequence bigint GENERATED ALWAYS AS IDENTITY, source_timestamp timestamptz NOT NULL, model text NOT NULL, voice text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','ready','failed')),
 attempts smallint NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 media bytea, created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz
);
CREATE INDEX audio_match_created_idx ON audio_clips(match_id,created_at DESC);
CREATE INDEX audio_dispatch_idx ON audio_clips(status,next_attempt_at);
CREATE TABLE ranking_snapshots (
 id uuid PRIMARY KEY, provider_id text NOT NULL REFERENCES providers(id), category text NOT NULL CHECK(category IN ('team','batting','bowling','allrounder')),
 format text NOT NULL CHECK(format IN ('T20','ODI','TEST')), gender text NOT NULL CHECK(gender IN ('men','women')),
 as_of date NOT NULL, source_label text NOT NULL, UNIQUE(provider_id,category,format,gender,as_of)
);
CREATE TABLE ranking_entries (
 snapshot_id uuid NOT NULL REFERENCES ranking_snapshots(id) ON DELETE CASCADE, rank integer NOT NULL CHECK(rank>0),
 entity_id text NOT NULL, name text NOT NULL, team text NOT NULL, rating numeric(10,2) NOT NULL CHECK(rating>=0),
 previous_rank integer CHECK(previous_rank>0), PRIMARY KEY(snapshot_id,rank), UNIQUE(snapshot_id,entity_id)
);
CREATE INDEX ranking_entity_idx ON ranking_entries(entity_id);
CREATE TABLE historical_profiles (
 id text PRIMARY KEY, provider_id text NOT NULL REFERENCES providers(id), kind text NOT NULL CHECK(kind IN ('player','team')),
 name text NOT NULL, team text NOT NULL, biography text NOT NULL, career_start integer, career_end integer,
 statistics jsonb NOT NULL DEFAULT '[]', source_label text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX history_provider_idx ON historical_profiles(provider_id);
CREATE TABLE achievements (
 id uuid PRIMARY KEY, profile_id text NOT NULL REFERENCES historical_profiles(id) ON DELETE CASCADE,
 year integer NOT NULL, title text NOT NULL, description text NOT NULL, category text NOT NULL
);
CREATE INDEX achievement_profile_year_idx ON achievements(profile_id,year DESC);
CREATE TABLE cricket_records (
 id uuid PRIMARY KEY, provider_id text NOT NULL REFERENCES providers(id), format text NOT NULL CHECK(format IN ('T20','ODI','TEST')),
 category text NOT NULL, title text NOT NULL, holder_name text NOT NULL, profile_id text REFERENCES historical_profiles(id),
 value text NOT NULL, achieved_on date, context text NOT NULL, source_label text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX records_format_category_idx ON cricket_records(format,category);
CREATE INDEX records_provider_idx ON cricket_records(provider_id);
CREATE INDEX records_profile_idx ON cricket_records(profile_id);
INSERT INTO schema_migrations(version) VALUES ('003_phone_audio_history');
