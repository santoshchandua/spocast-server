CREATE INDEX email_outbox_user_idx ON email_outbox(user_id);
CREATE INDEX squads_team_idx ON squads(team_id);
CREATE INDEX privacy_pending_idx ON privacy_requests(status,created_at);
CREATE INDEX users_status_created_idx ON users(status,created_at);
CREATE INDEX ad_campaigns_schedule_idx ON ad_campaigns(starts_at,ends_at) WHERE enabled=true;
CREATE INDEX webhook_processed_idx ON webhook_events(processed_at);
INSERT INTO schema_migrations(version) VALUES ('002_operational_indexes');
