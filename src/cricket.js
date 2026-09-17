import { z } from 'zod';
import { id, hash, hmac, safeEqual, ApiError } from './security.js';
import { queueCommentary } from './audio.js';
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const team = z.object({ code: z.string().regex(/^[A-Z0-9]{2,8}$/), name: z.string().min(1).max(80), score: z.string().max(30), overs: z.string().max(10) }).strict();
const batter = z.object({ name: z.string().max(100), dismissal: z.string().max(200), runs: z.number().int().nonnegative(), balls: z.number().int().nonnegative(), fours: z.number().int().nonnegative(), sixes: z.number().int().nonnegative() }).strict();
const bowler = z.object({ name: z.string().max(100), overs: z.string().max(10), maidens: z.number().int().nonnegative(), runs: z.number().int().nonnegative(), wickets: z.number().int().min(0).max(10) }).strict();
const inningsSchema = z.object({ team: z.string().max(8), total: z.string().max(40), extras: z.number().int().nonnegative(), batting: z.array(batter).max(15), bowling: z.array(bowler).max(15) }).strict();
export const feedSchema = z.object({ updatedAt: z.iso.datetime({ offset: true }), matches: z.array(z.object({ id: safeId, series: z.string().max(150), stage: z.string().max(100), format: z.enum(['T20','ODI','TEST','OTHER']), status: z.enum(['live','upcoming','completed','abandoned']), venue: z.string().max(150), startTime: z.iso.datetime({ offset: true }), teams: z.array(team).length(2), summary: z.string().max(500), innings: z.array(inningsSchema).max(4).default([]), commentary: z.array(z.object({ eventId: safeId.optional(), over: z.string().max(15), runs: z.string().max(5), text: z.string().max(1000) }).strict()).max(1000).default([]), featured: z.boolean().optional() }).strict()).max(200) }).strict();
export async function storeFeed(tx, providerId, input) {
  const feed = feedSchema.parse(input);
  if (new Date(feed.updatedAt).getTime() > Date.now() + 300000) throw new ApiError(400, 'Provider timestamp is in the future');
  const provider = (await tx.query('SELECT * FROM providers WHERE id=$1', [providerId])).rows[0];
  if (!provider?.enabled || (providerId !== 'demo' && (!provider.license_reference || !provider.license_expires_at || new Date(provider.license_expires_at) <= new Date()))) throw new ApiError(403, 'Provider license is not enabled or has expired');
  let written = 0;
  for (const match of feed.matches) {
    const matchId = providerId === 'demo' ? match.id : `${providerId}_${match.id}`;
    const result = await tx.query(`INSERT INTO matches(id,provider_id,provider_match_id,status,starts_at,payload,provider_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider_id,provider_match_id) DO UPDATE SET status=EXCLUDED.status,starts_at=EXCLUDED.starts_at,payload=EXCLUDED.payload,provider_updated_at=EXCLUDED.provider_updated_at,fetched_at=now() WHERE matches.provider_updated_at<=EXCLUDED.provider_updated_at RETURNING id`, [matchId, providerId, match.id, match.status, match.startTime, JSON.stringify({ ...match, id: matchId }), feed.updatedAt]);
    if (!result.rows.length) continue;
    await tx.query('DELETE FROM match_teams WHERE match_id=$1', [matchId]);
    for (const t of match.teams) {
      const teamId = `${providerId}_${t.code}`;
      await tx.query('INSERT INTO teams(id,name,short_name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name', [teamId, t.name, t.code]);
      await tx.query('INSERT INTO match_teams(match_id,team_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [matchId, teamId]);
    }
    await queueCommentary(tx,{...match,id:matchId},feed.updatedAt);
    written++;
  }
  await tx.query('UPDATE providers SET last_success_at=now() WHERE id=$1', [providerId]);
  return written;
}
export async function syncFeed(db, config) {
  if (!config.licenseConfirmed || !config.feedUrl || !config.feedToken || !config.feedHost) throw new ApiError(503, 'Licensed cricket feed is not configured');
  const url = new URL(config.feedUrl);
  if (url.protocol !== 'https:' || url.hostname !== config.feedHost || url.username || url.password || url.port && url.port !== '443') throw new Error('Provider must use the configured HTTPS hostname');
  const owner = id();
  const lease = await db.query("INSERT INTO job_leases(name,owner,expires_at) VALUES('cricket-sync',$1,now()+interval '60 seconds') ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE job_leases.expires_at<now() RETURNING owner", [owner]);
  if (!lease.rows.length) return { skipped: true };
  const runId = id();
  try {
    await db.query("INSERT INTO sync_runs(id,provider_id,status) VALUES($1,'licensed','running')", [runId]);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${config.feedToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error('UPSTREAM_HTTP_ERROR');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 2_000_000) throw new Error('FEED_TOO_LARGE'); chunks.push(Buffer.from(chunk)); }
    const feed = feedSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const count = await db.transaction(tx => storeFeed(tx, 'licensed', feed));
    await db.query("UPDATE sync_runs SET status='completed',records_written=$1,finished_at=now() WHERE id=$2", [count, runId]); return { written: count };
  } catch (error) {
    await db.query("UPDATE sync_runs SET status='failed',error_code='SYNC_FAILED',finished_at=now() WHERE id=$1", [runId]); throw new ApiError(502, 'Cricket synchronization failed');
  } finally { await db.query("DELETE FROM job_leases WHERE name='cricket-sync' AND owner=$1", [owner]); }
}
export async function receiveFeed(db, config, raw, headers) {
  if (!config.licenseConfirmed || !config.feedWebhookSecret) throw new ApiError(503, 'Feed ingestion is disabled');
  const timestamp = headers['x-feed-timestamp'], eventId = headers['x-feed-event-id'];
  if (!/^\d{10}$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !safeId.safeParse(eventId).success) throw new ApiError(400, 'Invalid feed event');
  const signed = Buffer.concat([Buffer.from(`${timestamp}.${eventId}.`), raw]);
  if (!safeEqual(headers['x-feed-signature'], hmac(config.feedWebhookSecret, signed))) throw new ApiError(401, 'Invalid feed signature');
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new ApiError(400, 'Invalid JSON'); }
  return db.transaction(async tx => {
    const event = await tx.query("INSERT INTO webhook_events(provider,event_id,payload_hash) VALUES('cricket',$1,$2) ON CONFLICT DO NOTHING RETURNING event_id", [eventId, hash(raw)]);
    if (!event.rows.length) { const previous = (await tx.query("SELECT payload_hash FROM webhook_events WHERE provider='cricket' AND event_id=$1", [eventId])).rows[0]; if (previous.payload_hash !== hash(raw)) throw new ApiError(409, 'Event ID payload mismatch'); return { duplicate: true }; }
    return { written: await storeFeed(tx, 'licensed', payload) };
  });
}
export function projection(match) {
  if (!['T20','ODI'].includes(match.format) || match.status !== 'live') return null;
  // A transparent pace extrapolation, not a trained prediction or win probability.
  const t = match.teams.find(t => /^\d+\/\d+$/.test(t.score) && /^\d+(\.[0-5])?$/.test(t.overs) && Number(t.score.split('/')[1]) < 10 && Number(t.overs) < (match.format === 'T20' ? 20 : 50));
  if (!t) return null;
  const [whole, remainder = '0'] = t.overs.split('.'); const balls = Number(whole) * 6 + Number(remainder);
  const totalBalls = match.format === 'T20' ? 120 : 300; const runs = Number(t.score.split('/')[0]);
  if (balls < 6 || balls >= totalBalls || Number(t.score.split('/')[1]) >= 10) return null;
  const rate = runs / balls * 6;
  return { team: t.code, currentRunRate: Number(rate.toFixed(2)), projectedTotal: Math.round(runs / balls * totalBalls), method: 'Current scoring rate extrapolated to the full innings. Does not account for wickets, pitch, opponents, or rain.', confidence: 'Not a probability forecast', scenarios: [-1, 0, 1].map(delta => ({ runsPerOver: Number(Math.max(0, rate + delta).toFixed(2)), total: Math.round(runs + (totalBalls - balls) / 6 * Math.max(0, rate + delta)) })) };
}
