import { getConfig } from '../src/config.js';
import { openDatabase, migrate } from '../src/db.js';
const db = await openDatabase(getConfig());
try { await migrate(db); console.log('Schema migrated.'); } finally { await db.close(); }
