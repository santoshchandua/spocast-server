import { randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
await mkdir('.data', { recursive: true });
const contents = `NODE_ENV=development\nHOST=0.0.0.0\nPORT=4000\nDATABASE_MODE=embedded\nDATABASE_PATH=./.data/postgres\nDATA_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nLOOKUP_HMAC_KEY=${randomBytes(32).toString('hex')}\nALLOWED_ORIGINS=http://localhost:8081\nPUBLIC_APP_URL=http://localhost:8081\nBILLING_PROVIDER=disabled\nOTP_PROVIDER=development\nAUDIO_ENABLED=false\n`;
try { await writeFile('.env', contents, { flag: 'wx', mode: 0o600 }); console.log('Created local configuration. Keep .env private. Next: npm run migrate && npm run seed'); }
catch (error) { if (error.code === 'EEXIST') console.log('.env already exists; no secrets changed.'); else throw error; }
