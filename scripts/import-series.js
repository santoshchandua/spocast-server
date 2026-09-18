import { readFile, stat } from 'node:fs/promises';
import { getConfig } from '../src/config.js';
import { openDatabase, requireCurrentSchema } from '../src/db.js';
import { importSeries } from '../src/series.js';
const path = process.argv[2];
if (!path) throw new Error('Usage: npm run import:series -- approved-series.json');
if ((await stat(path)).size > 2 * 1024 * 1024) throw new Error('Series file exceeds 2 MB');
const raw = JSON.parse(await readFile(path,'utf8'));
const db = await openDatabase(getConfig());
try { await requireCurrentSchema(db); console.log(await db.transaction(tx=>importSeries(tx,'licensed',raw))); } finally { await db.close(); }
