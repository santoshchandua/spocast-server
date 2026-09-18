ALTER TABLE ranking_snapshots ADD COLUMN fetched_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ranking_retention_idx ON ranking_snapshots(provider_id,fetched_at);
CREATE INDEX profiles_retention_idx ON historical_profiles(provider_id,updated_at);
CREATE INDEX records_retention_idx ON cricket_records(provider_id,updated_at);
INSERT INTO schema_migrations(version) VALUES ('005_archive_retention');
