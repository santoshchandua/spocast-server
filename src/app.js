import express from 'express';
import helmet from 'helmet';
import { z, ZodError } from 'zod';
import { id, hmac, ApiError, limit } from './security.js';
import { authMiddleware, mountAuth, requireUser } from './phone-auth.js';
import { createBilling, mountBilling, entitlements } from './billing.js';
import { projection, receiveFeed } from './cricket.js';
import { mountAudio } from './audio.js';
import { mountHistory } from './history.js';

export function createApp({ db, config, billing = createBilling(config), otp }) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', config.trustProxy);
  app.use(helmet({ strictTransportSecurity: config.production ? { maxAge: 31536000, includeSubDomains: true } : false }));
  app.use((req, res, next) => {
    req.requestId = id(); res.setHeader('X-Request-ID', req.requestId); res.setHeader('Cache-Control', 'no-store');
    if (config.production && !req.secure) return res.status(426).json({ error: 'HTTPS is required' });
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin)) return res.status(403).json({ error: 'Origin is not allowed' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.vary('Origin'); }
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token,Idempotency-Key'); return res.sendStatus(204); }
    next();
  });
  app.get('/api/health', (req, res) => res.json({ data: { status: 'ok' } }));
  app.get('/api/ready', async (req, res) => { await db.query('SELECT 1'); res.json({ data: { status: 'ready' } }); });
  app.use(async (req, res, next) => { try { await limit(db, 'ip:' + hmac(config.lookupKey, req.ip || 'unknown'), 300, 60); next(); } catch (error) { next(error); } });
  app.post('/api/webhooks/billing/:provider', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    const provider = z.enum(['stripe','razorpay']).parse(req.params.provider);
    if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'JSON content type required');
    res.json({ data: await billing.webhook(db, provider, req.body, req.headers) });
  });
  app.post('/api/webhooks/cricket', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new ApiError(400, 'JSON content type required');
    res.json({ data: await receiveFeed(db, config, req.body, req.headers) });
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use((req, res, next) => { if (['POST','PATCH'].includes(req.method) && !req.is('application/json')) return next(new ApiError(415, 'JSON content type required')); next(); });
  app.use(authMiddleware(db, config));
  mountAuth(app, db, config, otp); mountBilling(app, db, config, billing);
  mountAudio(app,db,config); mountHistory(app,db,config);
  const result = (res, data) => res.json({ data });
  const hydrate = row => ({ ...row.payload, dataMode: row.provider_id === 'demo' ? 'demo' : 'licensed', providerUpdatedAt: row.provider_updated_at, fetchedAt: row.fetched_at, stale: row.provider_id !== 'demo' && row.status === 'live' && Date.now() - new Date(row.fetched_at).getTime() > 60000 });
  app.get('/api/matches', async (req, res) => {
    const query = z.object({ status: z.enum(['live','upcoming','completed','abandoned']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(10000).default(0) }).strict().parse(req.query);
    const rows = (await db.query("SELECT m.* FROM matches m JOIN providers p ON p.id=m.provider_id WHERE ($1::text IS NULL OR m.status=$1) AND p.enabled=true AND (p.id='demo' OR p.license_expires_at>now()) ORDER BY CASE m.status WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,m.starts_at LIMIT $2 OFFSET $3", [query.status || null, query.limit, query.offset])).rows;
    result(res, rows.map(hydrate));
  });
  app.get('/api/matches/:id', async (req, res) => {
    const match = (await db.query("SELECT m.* FROM matches m JOIN providers p ON p.id=m.provider_id WHERE m.id=$1 AND p.enabled=true AND (p.id='demo' OR p.license_expires_at>now())", [req.params.id])).rows[0];
    if (!match) throw new ApiError(404, 'Match not found'); result(res, hydrate(match));
  });
  app.get('/api/matches/:id/insights', async (req, res) => {
    const match = (await db.query("SELECT m.* FROM matches m JOIN providers p ON p.id=m.provider_id WHERE m.id=$1 AND p.enabled=true AND (p.id='demo' OR p.license_expires_at>now())", [req.params.id])).rows[0];
    if (!match) throw new ApiError(404, 'Match not found');
    const access = await entitlements(db, req.user?.id), insight = projection(match.payload);
    if (insight && !access.plus) delete insight.scenarios;
    result(res, { projection: insight, plus: access.plus, dataMode: match.provider_id === 'demo' ? 'demo' : 'licensed', providerUpdatedAt: match.provider_updated_at });
  });
  app.get('/api/news', async (req, res) => result(res, (await db.query("SELECT a.payload FROM articles a JOIN providers p ON p.id=a.provider_id WHERE p.enabled=true AND (p.id='demo' OR p.license_expires_at>now()) ORDER BY a.published_at DESC LIMIT 50")).rows.map(r => r.payload)));
  app.get('/api/news/:id', async (req, res) => { const article = (await db.query("SELECT a.payload FROM articles a JOIN providers p ON p.id=a.provider_id WHERE a.id=$1 AND p.enabled=true AND (p.id='demo' OR p.license_expires_at>now())", [req.params.id])).rows[0]; if (!article) throw new ApiError(404, 'Article not found'); result(res, article.payload); });
  app.get('/api/me/favorites', requireUser, async (req, res) => result(res, (await db.query('SELECT match_id FROM favorites WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id])).rows.map(r => r.match_id)));
  app.post('/api/me/favorites', requireUser, async (req, res) => {
    const { matchId } = z.object({ matchId: z.string().min(1).max(220) }).strict().parse(req.body);
    await db.transaction(async tx => { await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]); const count = (await tx.query('SELECT count(*)::int AS n FROM favorites WHERE user_id=$1', [req.user.id])).rows[0].n; if (count >= 100) throw new ApiError(409, 'Favorite limit reached'); if (!(await tx.query('SELECT 1 FROM matches WHERE id=$1', [matchId])).rows.length) throw new ApiError(404, 'Match not found'); await tx.query('INSERT INTO favorites(user_id,match_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, matchId]); }); result(res, { ok: true });
  });
  app.delete('/api/me/favorites/:id', requireUser, async (req, res) => { await db.query('DELETE FROM favorites WHERE user_id=$1 AND match_id=$2', [req.user.id, req.params.id]); result(res, { ok: true }); });
  app.get('/api/ads/:placement', async (req, res) => {
    const placement = z.enum(['scores_inline','news_inline']).parse(req.params.placement);
    if ((await entitlements(db, req.user?.id)).adFree) return result(res, null);
    if (!(await db.query('SELECT 1 FROM ad_placements WHERE id=$1 AND enabled=true', [placement])).rows.length) return result(res, null);
    const creative = (await db.query('SELECT c.id,c.headline,c.body,c.destination_url FROM ad_creatives c JOIN ad_campaigns a ON a.id=c.campaign_id JOIN ad_placements p ON p.id=c.placement_id WHERE c.placement_id=$1 AND c.approved=true AND p.enabled=true AND a.enabled=true AND a.starts_at<=now() AND a.ends_at>now() ORDER BY a.starts_at DESC LIMIT 1', [placement])).rows[0];
    result(res, creative ? { ...creative, label: 'Advertisement' } : config.production ? null : { label: 'Advertisement', headline: 'Your brand. The next big innings.', body: 'Reserved sponsor placement · No tracking in this demo', destination_url: null });
  });
  app.use((req, res) => res.status(404).json({ error: 'Route not found', requestId: req.requestId }));
  app.use((error, req, res, next) => {
    const status = error instanceof ZodError ? 400 : error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status === 429) res.setHeader('Retry-After', '60');
    if (status >= 500) console.error(JSON.stringify({ event: 'request_failed', requestId: req.requestId, code: error.code || 'INTERNAL_ERROR' }));
    res.status(status).json({ error: error instanceof ZodError ? 'Invalid request fields' : status >= 500 ? 'Service temporarily unavailable' : error.type === 'entity.parse.failed' ? 'Invalid JSON' : error.message, requestId: req.requestId });
  });
  return app;
}
