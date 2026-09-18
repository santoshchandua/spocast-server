import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createApp } from './app.js';
import { getConfig } from './config.js';
import { openDatabase, requireCurrentSchema } from './db.js';
const config = getConfig(), db = await openDatabase(config);
let server;
try {
  await requireCurrentSchema(db);
  const app = createApp({ db, config });
  server = config.tlsCert && config.tlsKey ? httpsServer({ cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey), minVersion: 'TLSv1.2' }, app) : httpServer(app);
} catch (error) { await db.close(); throw error; }
server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
server.once('error', async () => { console.error(JSON.stringify({ event: 'server_start_failed' })); await db.close(); process.exitCode = 1; });
server.listen(config.port, config.host, () => console.log(`Cricket Pulse API listening on port ${config.port} (${config.databaseMode})`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.close(async () => { await db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); });
