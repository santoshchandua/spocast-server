import { z } from 'zod';
import { ApiError } from './security.js';

const count = z.number().int().nonnegative().max(10000000).nullable().default(null);
const fields = ['matches','innings','runs','ballsFaced','dismissals','centuries','fifties','sixes','fours','wickets','catches','stumpings','runsConceded','legalBalls','threeWicketHauls','fiveWicketHauls'];
const statistics = z.object(Object.fromEntries(fields.map(key => [key, count]))).strict().superRefine((s,ctx) => {
  if (s.dismissals !== null && s.innings !== null && s.dismissals > s.innings) ctx.addIssue({code:'custom',message:'Dismissals exceed innings'});
  if (s.fiveWicketHauls !== null && s.threeWicketHauls !== null && s.fiveWicketHauls > s.threeWicketHauls) ctx.addIssue({code:'custom',message:'3+ hauls must include 5+ hauls'});
});
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const label = z.string().min(1).max(200);
export const seriesSchema = z.object({id:key,name:label,format:z.enum(['T20','ODI','TEST']),sourceLabel:label,players:z.array(z.object({id:key,name:label,team:label,statistics}).strict()).max(1000).refine(rows => new Set(rows.map(r=>r.id)).size === rows.length, 'Duplicate player')}).strict();
export const metrics = [
  ['runs','Most runs','Batting','desc'],['centuries','Centuries (100+)','Batting','desc'],['fifties','Fifties (50–99)','Batting','desc'],
  ['battingAverage','Batting average','Batting','desc'],['strikeRate','Strike rate','Batting','desc'],['sixes','Sixes','Batting','desc'],['fours','Fours','Batting','desc'],
  ['wickets','Most wickets','Bowling','desc'],['economy','Economy','Bowling','asc'],['bowlingAverage','Bowling average','Bowling','asc'],
  ['threeWicketHauls','3+ wicket hauls','Bowling','desc'],['fiveWicketHauls','5+ wicket hauls','Bowling','desc'],
  ['catches','Catches','Fielding','desc'],['stumpings','Stumpings','Fielding','desc']
].map(([key,label,group,direction])=>({key,label,group,direction}));
export function calculateSeriesStatistics(raw) {
  const s = statistics.parse(raw);
  const ratio = (a,b,factor=1) => a === null || b === null || b === 0 ? null : Math.round(a / b * factor * 100) / 100;
  return {...s,battingAverage:ratio(s.runs,s.dismissals),strikeRate:ratio(s.runs,s.ballsFaced,100),economy:ratio(s.runsConceded,s.legalBalls,6),bowlingAverage:ratio(s.runsConceded,s.wickets)};
}
// Caller supplies a transaction. This replaces one complete series snapshot, not a delta.
export async function importSeries(tx, providerId, raw) {
  const data = seriesSchema.parse(raw);
  const p = (await tx.query('SELECT * FROM providers WHERE id=$1',[providerId])).rows[0];
  if (!p?.enabled || (providerId !== 'demo' && (!p.license_reference || new Date(p.license_expires_at || 0) <= new Date()))) throw new ApiError(403,'Series license is not enabled');
  const seriesId = `${providerId}_${data.id}`;
  await tx.query('INSERT INTO cricket_series(id,provider_id,name,format,source_label) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,format=EXCLUDED.format,source_label=EXCLUDED.source_label,updated_at=now()',[seriesId,providerId,data.name,data.format,data.sourceLabel]);
  await tx.query('DELETE FROM series_player_statistics WHERE series_id=$1',[seriesId]);
  for (const player of data.players) await tx.query('INSERT INTO series_player_statistics(series_id,player_id,name,team,statistics) VALUES($1,$2,$3,$4,$5)',[seriesId,`${providerId}_${player.id}`,player.name,player.team,JSON.stringify(calculateSeriesStatistics(player.statistics))]);
  return {id:seriesId,players:data.players.length};
}
export function mountSeries(app,db) {
  const access = "p.enabled=true AND (p.id='demo' OR p.license_expires_at>now())";
  app.get('/api/series',async(req,res)=>{
    const q=z.object({offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(req.query);
    const rows=(await db.query(`SELECT s.*,CASE WHEN p.id='demo' THEN 'demo' ELSE 'licensed' END AS data_mode FROM cricket_series s JOIN providers p ON p.id=s.provider_id WHERE ${access} ORDER BY s.updated_at DESC,s.id LIMIT 101 OFFSET $1`,[q.offset])).rows;
    res.json({data:{series:rows.slice(0,100),nextOffset:rows.length>100?q.offset+100:null}});
  });
  app.get('/api/series/:id/statistics',async(req,res)=>{
    const q=z.object({metric:z.enum(metrics.map(m=>m.key)).default('runs'),offset:z.coerce.number().int().min(0).max(10000).default(0),minInnings:z.coerce.number().int().min(0).max(1000).default(0),minBalls:z.coerce.number().int().min(0).max(100000).default(0)}).strict().parse(req.query);
    const series=(await db.query(`SELECT s.*,CASE WHEN p.id='demo' THEN 'demo' ELSE 'licensed' END AS data_mode FROM cricket_series s JOIN providers p ON p.id=s.provider_id WHERE s.id=$1 AND ${access}`,[req.params.id])).rows[0];
    if (!series) throw new ApiError(404,'Series not found');
    const metric=metrics.find(m=>m.key===q.metric);
    const rows=(await db.query(`SELECT *, (statistics->>$2)::numeric AS value FROM series_player_statistics WHERE series_id=$1 AND (statistics->>$2)::numeric IS NOT NULL AND ($3=0 OR (statistics->>'innings')::int >= $3) AND ($4=0 OR (statistics->>$5)::int >= $4) ORDER BY value ${metric.direction === 'asc' ? 'ASC' : 'DESC'},name,player_id LIMIT 101 OFFSET $6`,[series.id,q.metric,q.minInnings,q.minBalls,metric.group==='Bowling'?'legalBalls':'ballsFaced',q.offset])).rows;
    res.json({data:{series,metrics,metric,players:rows.slice(0,100),nextOffset:rows.length>100?q.offset+100:null}});
  });
}
export async function seedSeries(tx) {
  for (const [id,name,format] of [['demo-t20','Pulse T20 Cup · Demo','T20'],['demo-odi','Pulse ODI Series · Demo','ODI']]) await importSeries(tx,'demo',{id,name,format,sourceLabel:'Fictional demonstration statistics',players:[
    {id:'arjun',name:'Arjun Rao',team:'IND',statistics:{matches:5,innings:5,runs:320,ballsFaced:210,dismissals:4,centuries:1,fifties:2,sixes:18,fours:27,wickets:0,catches:4,stumpings:0,runsConceded:0,legalBalls:0,threeWicketHauls:0,fiveWicketHauls:0}},
    {id:'sam',name:'Sam Carter',team:'AUS',statistics:{matches:5,innings:4,runs:190,ballsFaced:110,dismissals:4,centuries:0,fifties:2,sixes:14,fours:15,wickets:12,catches:3,stumpings:0,runsConceded:130,legalBalls:114,threeWicketHauls:2,fiveWicketHauls:1}},
    {id:'dev',name:'Dev Shah',team:'IND',statistics:{matches:5,innings:4,runs:215,ballsFaced:160,dismissals:3,centuries:0,fifties:3,sixes:9,fours:21,wickets:0,catches:7,stumpings:3,runsConceded:0,legalBalls:0,threeWicketHauls:0,fiveWicketHauls:0}}
  ]});
}
