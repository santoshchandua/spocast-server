import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { seed } from '../src/seed.js';
const config=getConfig(), db=await openDatabase(config);
try { await seed(db,config); console.log('Demo cricket records and plans seeded.'); } finally { await db.close(); }
