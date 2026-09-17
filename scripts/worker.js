import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { deliverEmail, cleanup } from '../src/jobs.js';
import { syncFeed } from '../src/cricket.js';
import { generateAudio } from '../src/audio.js';
const config=getConfig(), db=await openDatabase(config);
if (config.databaseMode !== 'postgres') throw new Error('Separate workers require PostgreSQL. Embedded development uses email preview and in-process jobs.');
let stopping=false;
for (const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>{stopping=true;});
while (!stopping) {
  try { await deliverEmail(db,config); if(config.licenseConfirmed) await syncFeed(db,config); await generateAudio(db,config); await cleanup(db); }
  catch { console.error(JSON.stringify({ event:'worker_iteration_failed' })); }
  await new Promise(resolve=>setTimeout(resolve,30000));
}
await db.close();
