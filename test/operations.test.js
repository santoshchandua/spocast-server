import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { acquireDatabaseLock } from '../src/database-lock.js';
import { openDatabase, migrate, requireCurrentSchema } from '../src/db.js';
import { getConfig } from '../src/config.js';
import { seed } from '../src/seed.js';
import { importHistory } from '../src/history.js';
import { runWorkerCycle } from '../src/worker-cycle.js';
import { cleanup } from '../src/jobs.js';

test('embedded database excludes concurrent owners and releases cleanly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pulse-lock-test-'));
  const path = join(directory, 'database');
  try {
    const release = await acquireDatabaseLock(path);
    await assert.rejects(() => acquireDatabaseLock(path), /database is locked/);
    await release(); await release();
    const next = await acquireDatabaseLock(path); await next();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('worker isolates provider failures and still runs audio and privacy cleanup', async () => {
  const called = [], logs = [];
  const jobs = Object.fromEntries(['deliverEmail','syncFeed','generateAudio','cleanup'].map(name => [name, async () => { called.push(name); if (name === 'syncFeed') throw new Error('secret upstream details'); }]));
  const result = await runWorkerCycle(null, { licenseConfirmed: true }, jobs, entry => logs.push(entry));
  assert.deepEqual(called, ['deliverEmail','syncFeed','generateAudio','cleanup']);
  assert.equal(result.cleanup, 'completed'); assert.equal(result.syncFeed, 'failed');
  assert.deepEqual(logs, [{ event: 'worker_job_failed', job: 'syncFeed' }]);
});

test('schema gate and archive retention honor ingestion time, preserve recent data and cascade safely', async t => {
  const config = getConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'), LOOKUP_HMAC_KEY: randomBytes(32).toString('hex') });
  const db = await openDatabase(config); t.after(() => db.close());
  await assert.rejects(() => requireCurrentSchema(db), /schema is missing/);
  await migrate(db); await requireCurrentSchema(db); await seed(db, config);
  await db.query("DELETE FROM schema_migrations WHERE version='005_archive_retention'");
  await assert.rejects(() => requireCurrentSchema(db), /migrations are pending/);
  await db.query("INSERT INTO schema_migrations(version) VALUES('005_archive_retention')");
  await db.query("UPDATE providers SET enabled=true,license_reference='test',license_expires_at=now()+interval '1 day',retention_days=1 WHERE id='licensed'");
  const data = { sourceLabel: 'Test source', profiles: [{ id: 'player', kind: 'player', name: 'Test Player', team: 'TEST', biography: '', careerStart: 1900, careerEnd: 1920, statistics: [], achievements: [{ year: 1910, title: 'Test', description: '', category: 'award' }] }], rankings: [{ format: 'TEST', category: 'batting', gender: 'men', asOf: '1910-01-01', sourceLabel: 'Test', entries: [{ rank: 1, entityId: 'player', name: 'Test Player', team: 'TEST', rating: 100, previousRank: null }] }], records: [{ format: 'TEST', category: 'batting', title: 'Test', holderName: 'Test Player', profileId: 'player', value: '100', achievedOn: '1910-01-01', context: '', sourceLabel: 'Test' }] };
  await db.transaction(tx => importHistory(tx, 'licensed', data));
  await cleanup(db);
  assert.equal((await db.query("SELECT * FROM ranking_snapshots WHERE provider_id='licensed'")).rows.length, 1, 'old sporting dates must not expire a fresh import');
  await db.query("UPDATE historical_profiles SET updated_at=now()-interval '2 days' WHERE provider_id='licensed'");
  await db.query("UPDATE ranking_snapshots SET fetched_at=now()-interval '2 days' WHERE provider_id='licensed'");
  await cleanup(db);
  assert.equal((await db.query("SELECT * FROM historical_profiles WHERE provider_id='licensed'")).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM achievements WHERE profile_id='licensed_player'")).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM ranking_snapshots WHERE provider_id='licensed'")).rows.length, 0);
  assert.equal((await db.query("SELECT profile_id FROM cricket_records WHERE provider_id='licensed'")).rows[0].profile_id, null);
  await db.query("UPDATE cricket_records SET updated_at=now()-interval '2 days' WHERE provider_id='licensed'");
  await cleanup(db);
  assert.equal((await db.query("SELECT * FROM cricket_records WHERE provider_id='licensed'")).rows.length, 0);
  assert.ok((await db.query("SELECT * FROM historical_profiles WHERE provider_id='demo'")).rows.length);
});
