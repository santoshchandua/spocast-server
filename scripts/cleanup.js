import { getConfig } from '../src/config.js';
import { openDatabase, requireCurrentSchema } from '../src/db.js';
import { cleanup } from '../src/jobs.js';
const db = await openDatabase(getConfig());
try { await requireCurrentSchema(db); await cleanup(db); console.log('Configured retention cleanup completed.'); }
finally { await db.close(); }
