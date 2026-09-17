import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

export async function openDatabase(config) {
  if (config.databaseMode === 'postgres') {
    const url = new URL(config.databaseUrl);
    // Do not let URL sslmode parameters override certificate verification.
    for (const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert','sslpassword']) url.searchParams.delete(key);
    const pool = new pg.Pool({ connectionString: url.toString(), ssl: config.production || config.dbCa ? { rejectUnauthorized: true, ...(config.dbCa ? { ca: config.dbCa } : {}) } : false, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000 });
    const db = {
      query: (sql, values = []) => pool.query(sql, values),
      transaction: async fn => { const client = await pool.connect(); try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); } },
      close: () => pool.end()
    };
    await db.query('SELECT 1'); return db;
  }
  if (config.production) throw new Error('Embedded database is development-only');
  const client = new PGlite(config.databasePath === ':memory:' ? undefined : config.databasePath);
  await client.waitReady;
  // Serialize local operations so requests cannot interleave with a transaction on one connection.
  let pending = Promise.resolve();
  const serial = fn => { const next = pending.then(fn); pending = next.catch(() => {}); return next; };
  return { query: (sql, values = []) => serial(() => client.query(sql, values)), transaction: fn => serial(() => client.transaction(tx => fn(tx))), close: () => serial(() => client.close()) };
}
export async function migrate(db) {
  const exists = await db.query("SELECT to_regclass('public.schema_migrations') AS name");
  const applied = new Set(exists.rows[0].name ? (await db.query('SELECT version FROM schema_migrations')).rows.map(r=>r.version) : []);
  const directory = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter(n=>/^\d+_[a-z_]+\.sql$/.test(n)).sort()) {
    const version=file.replace('.sql',''); if(applied.has(version))continue;
    const sql = await readFile(new URL(file, directory), 'utf8');
    await db.transaction(async tx => { for (const statement of sql.split(';').map(v => v.trim()).filter(Boolean)) await tx.query(statement); });
  }
}
