import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Embedded PostgreSQL is single-process. Fail before opening its files, not after.
export async function acquireDatabaseLock(databasePath) {
  if (databasePath === ':memory:') return async () => {};
  const lockPath = resolve(databasePath) + '.lock';
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Embedded database is locked. Stop its owning API/CLI process before opening it again. After an unclean shutdown, verify no owner is running before removing the adjacent .lock file.');
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  catch (error) { await handle.close(); await unlink(lockPath); throw error; }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close();
    await unlink(lockPath);
  };
}
