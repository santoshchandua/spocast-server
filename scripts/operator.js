// Privileged maintenance CLI. Never expose this script through an HTTP route.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { audit, id, encrypt, token } from '../src/security.js';
const config=getConfig(), db=await openDatabase(config), [command,arg]=process.argv.slice(2);
try {
  if(command==='status') {
    const summary=await db.query("SELECT (SELECT count(*)::int FROM users WHERE status='active') AS active_users,(SELECT count(*)::int FROM privacy_requests WHERE status='pending') AS privacy_requests,(SELECT count(*)::int FROM email_outbox WHERE status='failed') AS failed_emails,(SELECT count(*)::int FROM subscriptions WHERE status='past_due') AS overdue_subscriptions"); console.log(summary.rows[0]);
  } else if(command==='suspend' || command==='restore') {
    const userId=z.uuid().parse(arg);
    await db.transaction(async tx=>{const row=(await tx.query("UPDATE users SET status=$1,updated_at=now() WHERE id=$2 AND status<>'deleted' RETURNING id",[command==='suspend'?'suspended':'active',userId])).rows[0];if(!row)throw new Error('User not found');await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[userId]);await audit(tx,null,'operator.'+command,'user',userId);});console.log('User status updated and sessions revoked.');
  } else if(command==='provider') {
    const input=z.object({name:z.string().min(1).max(100),licenseReference:z.string().min(1).max(300),licenseExpiresAt:z.iso.datetime({offset:true}),retentionDays:z.number().int().min(1).max(36500)}).strict().parse(JSON.parse(await readFile(arg,'utf8')));
    if(new Date(input.licenseExpiresAt)<=new Date())throw new Error('License must not be expired');
    await db.query("INSERT INTO providers(id,name,enabled,license_reference,license_expires_at,retention_days) VALUES('licensed',$1,true,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,enabled=true,license_reference=EXCLUDED.license_reference,license_expires_at=EXCLUDED.license_expires_at,retention_days=EXCLUDED.retention_days",[input.name,input.licenseReference,input.licenseExpiresAt,input.retentionDays]);await audit(db,null,'operator.provider_configured','provider','licensed');console.log('Provider license configured. Set its secret and endpoint in the environment separately.');
  } else if(command==='plans') {
    const plans=z.array(z.object({id:z.enum(['plus_monthly','plus_yearly']),name:z.string().min(1).max(80),amountMinor:z.number().int().positive(),currency:z.string().regex(/^[A-Z]{3}$/),interval:z.enum(['month','year']),features:z.array(z.string().max(120)).min(1).max(10)}).strict()).max(2).parse(JSON.parse(await readFile(arg,'utf8')));
    await db.transaction(async tx=>{for(const p of plans)await tx.query('INSERT INTO plans(id,name,amount_minor,currency,interval,features) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,amount_minor=EXCLUDED.amount_minor,currency=EXCLUDED.currency,interval=EXCLUDED.interval,features=EXCLUDED.features',[p.id,p.name,p.amountMinor,p.currency,p.interval,JSON.stringify(p.features)]);await audit(tx,null,'operator.plans_updated','plan');});console.log('Plans configured. Provider prices must match exactly.');
  } else if(command==='advertisement') {
    const input=z.object({name:z.string().min(1).max(80),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),placement:z.enum(['scores_inline','news_inline']),headline:z.string().min(1).max(120),body:z.string().max(240),destinationUrl:z.url().refine(v=>new URL(v).protocol==='https:')}).strict().parse(JSON.parse(await readFile(arg,'utf8')));
    await db.transaction(async tx=>{const campaignId=id();await tx.query('INSERT INTO ad_placements(id,name) VALUES($1,$1) ON CONFLICT DO NOTHING',[input.placement]);await tx.query('INSERT INTO ad_campaigns(id,name,starts_at,ends_at,enabled) VALUES($1,$2,$3,$4,true)',[campaignId,input.name,input.startsAt,input.endsAt]);await tx.query('INSERT INTO ad_creatives(id,campaign_id,placement_id,headline,body,destination_url,approved) VALUES($1,$2,$3,$4,$5,$6,true)',[id(),campaignId,input.placement,input.headline,input.body,input.destinationUrl]);await audit(tx,null,'operator.ad_published','ad_campaign',campaignId);});console.log('Approved advertisement scheduled.');
  } else if(command==='finalize-deletion') {
    const userId=z.uuid().parse(arg);
    await db.transaction(async tx=>{
      const pending=(await tx.query("SELECT id FROM privacy_requests WHERE user_id=$1 AND kind='deletion' AND status='pending' FOR UPDATE",[userId])).rows[0];if(!pending)throw new Error('No pending user-authorized deletion request');
      if((await tx.query("SELECT 1 FROM subscriptions WHERE user_id=$1 AND status IN ('active','pending','past_due')",[userId])).rows.length)throw new Error('Cancel and reconcile all subscriptions before finalizing deletion');
      await tx.query('DELETE FROM otp_challenges WHERE phone_hash=(SELECT phone_hash FROM users WHERE id=$1)',[userId]);
      await tx.query("UPDATE users SET phone_hash=NULL,phone_cipher=NULL,phone_verified_at=NULL,email_hash=$1,email_cipher=$2,name_cipher=$3,password_hash='deleted',status='deleted',email_verified_at=NULL,updated_at=now() WHERE id=$4",[token(),encrypt(`deleted-${userId}@invalid.example`,config.encryptionKey),encrypt('Deleted account',config.encryptionKey),userId]);
      for(const table of ['sessions','auth_tokens','email_outbox','favorites','notification_devices','notification_jobs','user_preferences'])await tx.query(`DELETE FROM ${table} WHERE user_id=$1`,[userId]);
      await tx.query('UPDATE consent_events SET user_id=NULL WHERE user_id=$1',[userId]);await tx.query('UPDATE audit_events SET actor_id=NULL WHERE actor_id=$1',[userId]);await tx.query("UPDATE privacy_requests SET status='completed',completed_at=now() WHERE user_id=$1 AND kind='deletion'",[userId]);await audit(tx,null,'operator.deletion_completed','user',userId);
    });console.log('Personal account fields erased. Minimal billing references remain for the documented retention policy.');
  } else throw new Error('Usage: operator.js status | suspend <uuid> | restore <uuid> | provider <json-file> | plans <json-file> | advertisement <json-file> | finalize-deletion <uuid>');
} finally {await db.close();}
