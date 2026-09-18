CREATE TABLE cricket_series (
 id text PRIMARY KEY, provider_id text NOT NULL REFERENCES providers(id),
 name text NOT NULL, format text NOT NULL CHECK(format IN ('T20','ODI','TEST')),
 source_label text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cricket_series_retention ON cricket_series(provider_id,updated_at);
CREATE TABLE series_player_statistics (
 series_id text NOT NULL REFERENCES cricket_series(id) ON DELETE CASCADE,
 player_id text NOT NULL, name text NOT NULL, team text NOT NULL,
 statistics jsonb NOT NULL, PRIMARY KEY(series_id,player_id)
);
INSERT INTO schema_migrations(version) VALUES('006_series_statistics');
