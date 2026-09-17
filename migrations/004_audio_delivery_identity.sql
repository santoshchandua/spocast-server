ALTER TABLE audio_clips ADD COLUMN event_key text;
CREATE INDEX audio_delivery_idx ON audio_clips(match_id,event_key) WHERE event_key IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES('004_audio_delivery_identity');
