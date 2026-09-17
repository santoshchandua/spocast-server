import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { syncFeed } from '../src/cricket.js';
const config=getConfig(), db=await openDatabase(config);
try { console.log(await syncFeed(db,config)); } finally { await db.close(); }
