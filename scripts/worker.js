import { setTimeout as delay } from 'node:timers/promises';
import { getConfig } from '../src/config.js';
import { openDatabase, requireCurrentSchema } from '../src/db.js';
import { runWorkerCycle } from '../src/worker-cycle.js';
const config = getConfig();
if (config.databaseMode !== 'postgres') throw new Error('Separate workers require PostgreSQL. Stop the embedded API before running one-shot maintenance commands.');
const db = await openDatabase(config), stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop.abort());
try {
  await requireCurrentSchema(db);
  while (!stop.signal.aborted) {
    await runWorkerCycle(db, config);
    if (!stop.signal.aborted) await delay(30000, undefined, { signal: stop.signal }).catch(error => { if (error.name !== 'AbortError') throw error; });
  }
} finally { await db.close(); }
