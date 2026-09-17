CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE users (
 id uuid PRIMARY KEY, email_hash text NOT NULL UNIQUE, email_cipher text NOT NULL, name_cipher text NOT NULL,
 password_hash text NOT NULL, role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','support','admin')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','deleted')),
 email_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE,
 device_label varchar(80) NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE auth_tokens (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE,
 purpose text NOT NULL CHECK(purpose IN ('verify','reset')), expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens(user_id, purpose);
CREATE INDEX auth_tokens_expiry_idx ON auth_tokens(expires_at);
CREATE TABLE user_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, locale varchar(10) NOT NULL DEFAULT 'en',
 notifications_enabled boolean NOT NULL DEFAULT false, analytics_consent boolean NOT NULL DEFAULT false,
 marketing_consent boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE consent_events (
 id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE SET NULL, purpose text NOT NULL,
 granted boolean NOT NULL, policy_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_user_time_idx ON consent_events(user_id, created_at DESC);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL,
 target_type text NOT NULL, target_id text, request_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_actor_time_idx ON audit_events(actor_id, created_at DESC);
CREATE INDEX audit_time_idx ON audit_events(created_at);
CREATE TABLE rate_limits (key text PRIMARY KEY, hits integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(reset_at);
CREATE TABLE email_outbox (
 id uuid PRIMARY KEY, user_id uuid REFERENCES users(id) ON DELETE CASCADE, payload_cipher text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), leased_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX email_dispatch_idx ON email_outbox(status, next_attempt_at);

CREATE TABLE providers (
 id text PRIMARY KEY, name text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 license_reference text, license_expires_at timestamptz, retention_days integer CHECK(retention_days > 0),
 last_success_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sync_runs (
 id uuid PRIMARY KEY, provider_id text NOT NULL REFERENCES providers(id), status text NOT NULL CHECK(status IN ('running','completed','failed')),
 records_written integer NOT NULL DEFAULT 0, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, error_code text
);
CREATE INDEX sync_provider_time_idx ON sync_runs(provider_id, started_at DESC);
CREATE TABLE job_leases (name text PRIMARY KEY, owner uuid NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE countries (code char(2) PRIMARY KEY, name text NOT NULL);
CREATE TABLE venues (id uuid PRIMARY KEY, name text NOT NULL, city text, country_code char(2) REFERENCES countries(code), timezone text);
CREATE INDEX venues_country_idx ON venues(country_code);
CREATE TABLE teams (id text PRIMARY KEY, name text NOT NULL, short_name text NOT NULL, country_code char(2) REFERENCES countries(code));
CREATE TABLE players (id uuid PRIMARY KEY, name text NOT NULL, country_code char(2) REFERENCES countries(code), batting_style text, bowling_style text);
CREATE INDEX players_country_idx ON players(country_code);
CREATE TABLE competitions (id uuid PRIMARY KEY, name text NOT NULL, format text NOT NULL CHECK(format IN ('T20','ODI','TEST','OTHER')));
CREATE TABLE seasons (id uuid PRIMARY KEY, competition_id uuid NOT NULL REFERENCES competitions(id), name text NOT NULL, starts_on date, ends_on date, UNIQUE(competition_id,name));
CREATE TABLE squads (season_id uuid NOT NULL REFERENCES seasons(id), team_id text NOT NULL REFERENCES teams(id), player_id uuid NOT NULL REFERENCES players(id), PRIMARY KEY(season_id,team_id,player_id));
CREATE INDEX squads_player_idx ON squads(player_id);
CREATE TABLE matches (
 id text PRIMARY KEY, provider_id text NOT NULL REFERENCES providers(id), provider_match_id text NOT NULL,
 season_id uuid REFERENCES seasons(id), venue_id uuid REFERENCES venues(id), status text NOT NULL CHECK(status IN ('live','upcoming','completed','abandoned')),
 starts_at timestamptz NOT NULL, payload jsonb NOT NULL, provider_updated_at timestamptz NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider_id,provider_match_id)
);
CREATE INDEX matches_status_start_idx ON matches(status, starts_at);
CREATE INDEX matches_season_idx ON matches(season_id, starts_at);
CREATE INDEX matches_venue_idx ON matches(venue_id);
CREATE INDEX matches_fetched_idx ON matches(provider_id, fetched_at);
CREATE TABLE match_teams (match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE, team_id text NOT NULL REFERENCES teams(id), PRIMARY KEY(match_id,team_id));
CREATE INDEX match_teams_team_idx ON match_teams(team_id, match_id);
CREATE TABLE innings (id uuid PRIMARY KEY, match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE, number smallint NOT NULL CHECK(number > 0), batting_team_id text REFERENCES teams(id), runs integer NOT NULL DEFAULT 0 CHECK(runs>=0), wickets smallint NOT NULL DEFAULT 0 CHECK(wickets BETWEEN 0 AND 10), legal_balls integer NOT NULL DEFAULT 0 CHECK(legal_balls>=0), UNIQUE(match_id,number));
CREATE INDEX innings_team_idx ON innings(batting_team_id);
CREATE TABLE deliveries (id uuid PRIMARY KEY, innings_id uuid NOT NULL REFERENCES innings(id) ON DELETE CASCADE, provider_event_id text NOT NULL, sequence integer NOT NULL, legal_ball boolean NOT NULL, runs smallint NOT NULL CHECK(runs>=0), wicket boolean NOT NULL DEFAULT false, commentary text, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(innings_id,provider_event_id), UNIQUE(innings_id,sequence));
CREATE TABLE batting_figures (innings_id uuid NOT NULL REFERENCES innings(id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES players(id), runs integer NOT NULL DEFAULT 0, balls integer NOT NULL DEFAULT 0, fours integer NOT NULL DEFAULT 0, sixes integer NOT NULL DEFAULT 0, dismissal text, PRIMARY KEY(innings_id,player_id));
CREATE INDEX batting_player_idx ON batting_figures(player_id);
CREATE TABLE bowling_figures (innings_id uuid NOT NULL REFERENCES innings(id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES players(id), legal_balls integer NOT NULL DEFAULT 0, runs integer NOT NULL DEFAULT 0, wickets integer NOT NULL DEFAULT 0, PRIMARY KEY(innings_id,player_id));
CREATE INDEX bowling_player_idx ON bowling_figures(player_id);
CREATE TABLE standings (season_id uuid NOT NULL REFERENCES seasons(id), team_id text NOT NULL REFERENCES teams(id), played integer NOT NULL DEFAULT 0, won integer NOT NULL DEFAULT 0, points integer NOT NULL DEFAULT 0, net_run_rate numeric(8,3), PRIMARY KEY(season_id,team_id));
CREATE INDEX standings_team_idx ON standings(team_id);
CREATE TABLE articles (id text PRIMARY KEY, provider_id text NOT NULL REFERENCES providers(id), category text NOT NULL, title text NOT NULL, payload jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX articles_published_idx ON articles(published_at DESC);
CREATE INDEX articles_provider_idx ON articles(provider_id);
CREATE TABLE favorites (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,match_id));
CREATE INDEX favorites_match_idx ON favorites(match_id);
CREATE TABLE notification_devices (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_cipher text NOT NULL, token_hash text NOT NULL UNIQUE, platform text NOT NULL CHECK(platform IN ('ios','android')), created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notification_devices_user_idx ON notification_devices(user_id);
CREATE TABLE notification_jobs (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, match_id text REFERENCES matches(id) ON DELETE CASCADE, dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', scheduled_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX notification_dispatch_idx ON notification_jobs(status,scheduled_at);
CREATE INDEX notification_user_idx ON notification_jobs(user_id);
CREATE INDEX notification_match_idx ON notification_jobs(match_id);

CREATE TABLE plans (id text PRIMARY KEY, name text NOT NULL, amount_minor integer NOT NULL CHECK(amount_minor>=0), currency char(3) NOT NULL, interval text NOT NULL CHECK(interval IN ('month','year')), features jsonb NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE billing_customers (user_id uuid NOT NULL REFERENCES users(id), provider text NOT NULL CHECK(provider IN ('stripe','razorpay','apple','google')), provider_customer_id text NOT NULL, PRIMARY KEY(user_id,provider), UNIQUE(provider,provider_customer_id));
CREATE TABLE subscriptions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), plan_id text NOT NULL REFERENCES plans(id), provider text NOT NULL CHECK(provider IN ('stripe','razorpay','apple','google')), provider_subscription_id text NOT NULL, status text NOT NULL CHECK(status IN ('pending','active','past_due','cancelled','expired')), current_period_end timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,provider_subscription_id));
CREATE INDEX subscriptions_user_status_idx ON subscriptions(user_id,status,current_period_end);
CREATE INDEX subscriptions_plan_idx ON subscriptions(plan_id);
CREATE TABLE checkout_requests (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), plan_id text NOT NULL REFERENCES plans(id), idempotency_key uuid NOT NULL, provider text NOT NULL, provider_checkout_id text, checkout_url text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,idempotency_key));
CREATE INDEX checkout_plan_idx ON checkout_requests(plan_id);
CREATE TABLE payments (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), subscription_id uuid REFERENCES subscriptions(id), provider text NOT NULL, provider_payment_id text NOT NULL, amount_minor bigint NOT NULL CHECK(amount_minor>=0), currency char(3) NOT NULL, status text NOT NULL CHECK(status IN ('paid','refunded','failed')), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,provider_payment_id));
CREATE INDEX payments_user_time_idx ON payments(user_id,created_at DESC);
CREATE INDEX payments_subscription_idx ON payments(subscription_id);
CREATE TABLE refunds (id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id), provider_refund_id text NOT NULL UNIQUE, amount_minor bigint NOT NULL CHECK(amount_minor>0), status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX refunds_payment_idx ON refunds(payment_id);
CREATE TABLE webhook_events (provider text NOT NULL, event_id text NOT NULL, payload_hash text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id));

CREATE TABLE ad_placements (id text PRIMARY KEY, name text NOT NULL, enabled boolean NOT NULL DEFAULT true);
CREATE TABLE ad_campaigns (id uuid PRIMARY KEY, name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT false, CHECK(ends_at>starts_at));
CREATE TABLE ad_creatives (id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES ad_campaigns(id), placement_id text NOT NULL REFERENCES ad_placements(id), headline varchar(120) NOT NULL, body varchar(240) NOT NULL, destination_url text, approved boolean NOT NULL DEFAULT false);
CREATE INDEX ad_creatives_placement_idx ON ad_creatives(placement_id,approved);
CREATE INDEX ad_creatives_campaign_idx ON ad_creatives(campaign_id);
CREATE TABLE ad_daily_metrics (creative_id uuid NOT NULL REFERENCES ad_creatives(id), day date NOT NULL, impressions bigint NOT NULL DEFAULT 0, clicks bigint NOT NULL DEFAULT 0, PRIMARY KEY(creative_id,day));
CREATE TABLE prediction_models (id uuid PRIMARY KEY, name text NOT NULL, version text NOT NULL, methodology text NOT NULL, evaluation jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT false, UNIQUE(name,version));
CREATE TABLE match_predictions (id uuid PRIMARY KEY, match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE, model_id uuid NOT NULL REFERENCES prediction_models(id), probability numeric(5,4) CHECK(probability BETWEEN 0 AND 1), input_timestamp timestamptz NOT NULL, generated_at timestamptz NOT NULL DEFAULT now(), explanation jsonb NOT NULL, UNIQUE(match_id,model_id,input_timestamp));
CREATE INDEX predictions_match_time_idx ON match_predictions(match_id,generated_at DESC);
CREATE INDEX predictions_model_idx ON match_predictions(model_id);
CREATE TABLE privacy_requests (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('export','deletion')), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','rejected')), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
CREATE INDEX privacy_user_idx ON privacy_requests(user_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES ('001_initial');
