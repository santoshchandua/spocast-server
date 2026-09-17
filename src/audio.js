import { z } from 'zod';
import { id, hash, ApiError, limit } from './security.js';
export async function queueCommentary(tx,match,updatedAt){
  if(match.status!=='live')return;
  // Feed commentary is latest-first. Preserve delivery order for the playback queue.
  for(const ball of [...match.commentary.slice(0,6)].reverse()){
    const input=`Over ${ball.over}. ${ball.text}`;
    const fingerprint=hash(JSON.stringify([match.id,ball.eventId||null,ball.over,ball.text,'gpt-4o-mini-tts','coral','en']));
    await tx.query("INSERT INTO audio_clips(id,match_id,content_hash,commentary_text,ball_label,source_timestamp,model,voice,event_key) VALUES($1,$2,$3,$4,$5,$6,'gpt-4o-mini-tts','coral',$7) ON CONFLICT(content_hash) DO NOTHING",[id(),match.id,fingerprint,input,ball.over,updatedAt,ball.eventId||null]);
    // Only a stable provider delivery ID can identify corrections: wides share over labels.
    if(ball.eventId)await tx.query("UPDATE audio_clips SET status='failed',media=NULL WHERE match_id=$1 AND event_key=$2 AND content_hash<>$3",[match.id,ball.eventId,fingerprint]);
  }
}
export async function generateAudio(db,config,fetcher=fetch){
  if(!config.audioEnabled||!config.openaiKey)return{disabled:true};
  let generated=0;
  for(let i=0;i<6;i++){
    const clip=await db.transaction(async tx=>{
      const row=(await tx.query("SELECT a.* FROM audio_clips a JOIN matches m ON m.id=a.match_id JOIN providers p ON p.id=m.provider_id WHERE (a.status='pending' OR (a.status='processing' AND a.lease_until<now())) AND a.attempts<3 AND a.next_attempt_at<=now() AND a.created_at>now()-interval '1 hour' AND p.enabled=true AND (p.id='demo' OR p.license_expires_at>now()) ORDER BY a.sequence FOR UPDATE OF a SKIP LOCKED LIMIT 1")).rows[0];
      if(!row)return null;
      await limit(tx,'audio-daily:'+new Date().toISOString().slice(0,10),config.audioDailyCap,86400);
      await tx.query("UPDATE audio_clips SET status='processing',attempts=attempts+1,lease_until=now()+interval '90 seconds' WHERE id=$1",[row.id]);return row;
    });
    if(!clip)break;
    try{
      const response=await fetcher('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${config.openaiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:clip.model,voice:clip.voice,input:clip.commentary_text,response_format:'mp3',instructions:'Read the supplied cricket commentary clearly in English with an energetic sports announcer tone. Do not add any words or imitate a real person.'}),signal:AbortSignal.timeout(45000),redirect:'error'});
      if(!response.ok)throw new Error('TTS_HTTP_ERROR');
      const chunks=[];let length=0;
      for await(const chunk of response.body){length+=chunk.length;if(length>2_000_000)throw new Error('AUDIO_TOO_LARGE');chunks.push(Buffer.from(chunk));}
      if(length<10)throw new Error('EMPTY_AUDIO');
      const media=Buffer.concat(chunks);
      await db.query("UPDATE audio_clips SET status='ready',media=$1,ready_at=now(),lease_until=NULL WHERE id=$2 AND status='processing'",[media,clip.id]);generated++;
    }catch{await db.query("UPDATE audio_clips SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+interval '1 minute',lease_until=NULL WHERE id=$1 AND status='processing'",[clip.id]);}
  }return{generated};
}
export function mountAudio(app,db,config){
  app.get('/api/matches/:id/audio',async(req,res)=>{
    const match=(await db.query("SELECT m.provider_id FROM matches m JOIN providers p ON p.id=m.provider_id WHERE m.id=$1 AND p.enabled=true AND (p.id='demo' OR p.license_expires_at>now())",[req.params.id])).rows[0];if(!match)throw new ApiError(404,'Match not found');
    const clips=(await db.query("SELECT id,sequence,ball_label,commentary_text,status,ready_at FROM audio_clips WHERE match_id=$1 AND status<>'failed' ORDER BY sequence DESC LIMIT 30",[req.params.id])).rows.reverse();
    res.json({data:{enabled:!!config.audioEnabled&&!!config.openaiKey,disclosure:'AI-generated voice. Commentary may be delayed and is not a live human broadcast.',dataMode:match.provider_id==='demo'?'demo':'licensed',clips:clips.map(c=>({...c,url:c.status==='ready'?`/api/audio/${c.id}`:null}))}});
  });
  app.get('/api/audio/:id',async(req,res)=>{
    const clipId=z.uuid().parse(req.params.id);
    const clip=(await db.query("SELECT a.media FROM audio_clips a JOIN matches m ON m.id=a.match_id JOIN providers p ON p.id=m.provider_id WHERE a.id=$1 AND a.status='ready' AND p.enabled=true AND (p.id='demo' OR p.license_expires_at>now())",[clipId])).rows[0];
    if(!clip?.media)throw new ApiError(404,'Audio is not available');
    const media=Buffer.from(clip.media);res.set('Content-Type','audio/mpeg');res.set('Accept-Ranges','bytes');res.set('Content-Disposition','inline');
    // No external redirects or user-provided file paths. Re-check license on every read.
    const range=req.headers.range;
    if(range){const parsed=/^bytes=(\d+)-(\d*)$/.exec(range);if(!parsed)return res.status(416).set('Content-Range',`bytes */${media.length}`).end();const start=Number(parsed[1]),end=parsed[2]?Math.min(Number(parsed[2]),media.length-1):media.length-1;if(start>=media.length||end<start)return res.status(416).set('Content-Range',`bytes */${media.length}`).end();return res.status(206).set('Content-Range',`bytes ${start}-${end}/${media.length}`).send(media.subarray(start,end+1));}
    res.send(media);
  });
}
