import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
let activeDerivations = 0;
async function boundedDerive(password, salt, options) {
  if (activeDerivations >= 2) throw new ApiError(503, 'Authentication is busy. Try again shortly.');
  activeDerivations++;
  try { return await derive(password, salt, 64, options); } finally { activeDerivations--; }
}
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const hash = v => createHash('sha256').update(v).digest('hex');
export const hmac = (key, v) => createHmac('sha256', key).update(v).digest('hex');
export const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await boundedDerive(password, salt, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return `scrypt:131072:8:1:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password, stored) {
  if (!stored?.startsWith('scrypt:')) return false;
  const [, n, r, p, salt, digest] = stored.split(':');
  const key = await boundedDerive(password, salt, { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
  return safeEqual(key.toString('hex'), digest);
}
export function encrypt(value, key) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from('cricket-pulse:pii:v1'));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('base64')}`;
}
export function decrypt(value, key) {
  const [version, iv, tag, data] = value.split(':'); if (version !== 'v1') throw new Error('Unknown ciphertext version');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAAD(Buffer.from('cricket-pulse:pii:v1')); decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
export class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
export async function audit(db, actor, action, targetType = 'user', targetId = actor, requestId = null) {
  await db.query('INSERT INTO audit_events(id,actor_id,action,target_type,target_id,request_id) VALUES($1,$2,$3,$4,$5,$6)', [id(), actor, action, targetType, targetId, requestId]);
}
export async function limit(db, key, max, windowSeconds) {
  const result = await db.query(`INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.hits+1 END, reset_at=CASE WHEN rate_limits.reset_at<=now() THEN now()+$2*interval '1 second' ELSE rate_limits.reset_at END RETURNING hits`, [key, windowSeconds]);
  if (result.rows[0].hits > max) throw new ApiError(429, 'Too many requests. Please try again later.');
}
