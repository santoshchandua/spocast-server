import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { id, token, hash, hmac, safeEqual, encrypt, decrypt, ApiError, audit, limit } from './security.js';
const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/);
const nameSchema = z.string().trim().min(2).max(100);
const emailSchema = z.string().trim().toLowerCase().email().max(254).optional();
const proofSchema = z.object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const publicUser=(u,c)=>({id:u.id,name:decrypt(u.name_cipher,c.encryptionKey),phone:u.phone_cipher?decrypt(u.phone_cipher,c.encryptionKey):null,email:u.email_cipher?decrypt(u.email_cipher,c.encryptionKey):null,verified:!!u.phone_verified_at,role:u.role,createdAt:u.created_at});
export function requireUser(req,res,next){if(!req.user)return next(new ApiError(401,'Sign in with your mobile number to continue'));next();}
export function requireVerified(req,res,next){if(!req.user?.phone_verified_at)return next(new ApiError(403,'Verify your mobile number first'));next();}
export function authMiddleware(db,config){return async(req,res,next)=>{try{
  const bearer=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('cp_session='))?.slice(11);
  const value=bearer||cookie;if(!value)return next();
  const row=tokenSchema.safeParse(value).success?(await db.query("SELECT u.*,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active' AND u.phone_verified_at IS NOT NULL",[hash(value)])).rows[0]:null;
  if(!row){res.clearCookie('cp_session',{httpOnly:true,secure:config.production,sameSite:'strict',path:'/api'});return next();}
  req.user=row;req.sessionToken=value;
  if(!bearer&&!['GET','HEAD','OPTIONS'].includes(req.method)&&(!req.headers.origin||!config.origins.includes(req.headers.origin)||!safeEqual(req.headers['x-csrf-token'],hmac(config.lookupKey,value))))throw new ApiError(403,'Request verification failed');
  next();
}catch(e){next(e);}};}

export function createOtpProvider(config, fetcher=fetch){
  const remote=async(path,fields)=>{
    if(!config.twilioAccount||!config.twilioToken||!/^VA[0-9a-f]{32}$/i.test(config.twilioService||''))throw new ApiError(503,'SMS verification is not configured');
    const response=await fetcher(`https://verify.twilio.com/v2/Services/${config.twilioService}/${path}`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${config.twilioAccount}:${config.twilioToken}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields).toString(),signal:AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok)throw new ApiError(503,'SMS verification is temporarily unavailable');
    return response.json();
  };
  return {send:async phone=>(await remote('Verifications',{To:phone,Channel:'sms'})).sid,check:async(reference,code)=>(await remote('VerificationCheck',{VerificationSid:reference,Code:code})).status==='approved'};
}
export function mountAuth(app,db,config,otp=createOtpProvider(config)){
  const respond=(res,data)=>res.json({data});
  async function start(req,purpose){
    if(config.otpProvider==='disabled'||(config.production&&config.otpProvider==='development'))throw new ApiError(503,'Mobile OTP sign-in is not enabled yet');
    let phone,profile,userId=null;
    if(purpose==='login'){
      const input=z.object({phone:phoneSchema,fullName:nameSchema,email:emailSchema}).strict().parse(req.body);phone=input.phone;profile={name:input.fullName,email:input.email||null};
    }else{phone=decrypt(req.user.phone_cipher,config.encryptionKey);profile={name:decrypt(req.user.name_cipher,config.encryptionKey)};userId=req.user.id;}
    if(!config.phonePrefixes.some(prefix=>phone.startsWith(prefix)))throw new ApiError(400,'This country code is not supported yet');
    const phoneHash=hmac(config.lookupKey,phone);
    await limit(db,'otp-ip:'+hmac(config.lookupKey,req.ip||'unknown'),10,3600);
    await limit(db,'otp-phone:'+phoneHash,5,3600);
    await limit(db,'otp-cooldown:'+phoneHash,1,60);
    await limit(db,'otp-daily:'+new Date().toISOString().slice(0,10),config.otpDailyCap,86400);
    const challengeId=id();const code=String(randomInt(0,1000000)).padStart(6,'0');
    await db.transaction(async tx=>{
      await tx.query("UPDATE otp_challenges SET status='failed' WHERE phone_hash=$1 AND purpose=$2 AND status IN ('sending','pending')",[phoneHash,purpose]);
      await tx.query('INSERT INTO otp_challenges(id,phone_hash,phone_cipher,profile_cipher,purpose,user_id,provider,code_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[challengeId,phoneHash,encrypt(phone,config.encryptionKey),encrypt(JSON.stringify(profile),config.encryptionKey),purpose,userId,config.otpProvider,config.otpProvider==='development'?hmac(config.lookupKey,`${challengeId}:${code}`):null]);
      if(config.otpProvider==='development')await tx.query('INSERT INTO development_sms(challenge_id,code_cipher) VALUES($1,$2)',[challengeId,encrypt(code,config.encryptionKey)]);
    });
    try {const reference=config.otpProvider==='twilio'?await otp.send(phone):null;if(config.otpProvider==='twilio'&&!/^VE[0-9a-f]{32}$/i.test(reference||''))throw new Error('Invalid provider reference');await db.query("UPDATE otp_challenges SET status='pending',provider_reference=$1 WHERE id=$2 AND status='sending'",[reference,challengeId]);}
    catch{await db.query("UPDATE otp_challenges SET status='failed' WHERE id=$1",[challengeId]);throw new ApiError(503,'Could not send OTP. Please try again later');}
    return{challengeId,expiresIn:300,resendAfter:60,destination:'••••'+phone.slice(-4),message:config.otpProvider==='development'?'Development SMS queued locally; no real SMS was sent.':'Enter the six-digit code sent to your mobile.'};
  }
  async function verify(req,purpose){
    const input=proofSchema.parse(req.body);await limit(db,'otp-verify:'+hmac(config.lookupKey,req.ip||'unknown'),30,900);
    // Attempt increments commit even for incorrect codes; row update serializes concurrent guesses.
    const challenge=(await db.query("UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1 AND purpose=$2 AND status='pending' AND expires_at>now() AND attempts<5 RETURNING *",[input.challengeId,purpose])).rows[0];
    if(!challenge||(purpose==='delete'&&challenge.user_id!==req.user.id))throw new ApiError(400,'OTP is invalid or expired');
    const approved=challenge.provider==='development'&&!config.production?safeEqual(challenge.code_hash,hmac(config.lookupKey,`${challenge.id}:${input.code}`)):challenge.provider==='twilio'?await otp.check(challenge.provider_reference,input.code):false;
    if(!approved)throw new ApiError(400,'OTP is invalid or expired');
    return challenge;
  }
  async function consume(tx,challenge){const claimed=await tx.query("UPDATE otp_challenges SET status='used' WHERE id=$1 AND status='pending' AND expires_at>now() RETURNING id",[challenge.id]);if(!claimed.rows.length)throw new ApiError(400,'OTP is invalid or expired');await tx.query('DELETE FROM development_sms WHERE challenge_id=$1',[challenge.id]);}
  app.get('/api/auth/config',(req,res)=>respond(res,{method:'mobile_otp',enabled:config.otpProvider!=='disabled',development:config.otpProvider==='development',countryPrefixes:config.phonePrefixes}));
  app.post('/api/auth/otp/request',async(req,res)=>respond(res,await start(req,'login')));
  app.post('/api/auth/otp/verify',async(req,res)=>{
    const challenge=await verify(req,'login'),value=token();
    const user=await db.transaction(async tx=>{
      await consume(tx,challenge);
      const profile=JSON.parse(decrypt(challenge.profile_cipher,config.encryptionKey));
      // Never merge an account by optional email; identity is the verified mobile number.
      let user=(await tx.query('SELECT * FROM users WHERE phone_hash=$1 FOR UPDATE',[challenge.phone_hash])).rows[0];
      if(!user){
        const emailHash=profile.email?hmac(config.lookupKey,profile.email):null;
        const emailFree=!emailHash||!(await tx.query('SELECT 1 FROM users WHERE email_hash=$1',[emailHash])).rows.length;
        user=(await tx.query('INSERT INTO users(id,phone_hash,phone_cipher,phone_verified_at,name_cipher,email_hash,email_cipher) VALUES($1,$2,$3,now(),$4,$5,$6) ON CONFLICT(phone_hash) DO UPDATE SET phone_hash=EXCLUDED.phone_hash RETURNING *',[id(),challenge.phone_hash,challenge.phone_cipher,encrypt(profile.name,config.encryptionKey),emailFree?emailHash:null,emailFree&&profile.email?encrypt(profile.email,config.encryptionKey):null])).rows[0];
        await tx.query('INSERT INTO user_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING',[user.id]);
      }
      if(user.status!=='active')throw new ApiError(403,'This account is unavailable. Contact support.');
      await tx.query("INSERT INTO sessions(id,user_id,token_hash,device_label,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours')",[id(),user.id,hash(value),req.headers.origin?'Web browser':'Mobile app']);
      await audit(tx,user.id,'session.otp_verified','user',user.id,req.requestId);return user;
    });
    const browser=!!req.headers.origin;if(browser)res.cookie('cp_session',value,{httpOnly:true,secure:config.production,sameSite:'strict',path:'/api',maxAge:86400000});
    respond(res,{user:publicUser(user,config),...(browser?{csrfToken:hmac(config.lookupKey,value)}:{token:value}),expiresIn:86400});
  });
  app.get('/api/auth/session',requireUser,(req,res)=>respond(res,{user:publicUser(req.user,config),csrfToken:hmac(config.lookupKey,req.sessionToken)}));
  for(const all of [false,true])app.post('/api/auth/'+(all?'logout-all':'logout'),requireUser,async(req,res)=>{await db.query(all?'UPDATE sessions SET revoked_at=now() WHERE user_id=$1':'UPDATE sessions SET revoked_at=now() WHERE id=$1',[all?req.user.id:req.user.session_id]);res.clearCookie('cp_session',{httpOnly:true,secure:config.production,sameSite:'strict',path:'/api'});respond(res,{ok:true});});
  app.get('/api/me/sessions',requireUser,async(req,res)=>respond(res,(await db.query('SELECT id,device_label,created_at,expires_at FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC',[req.user.id])).rows.map(s=>({...s,current:s.id===req.user.session_id}))));
  app.delete('/api/me/sessions/:id',requireUser,async(req,res)=>{await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2',[z.uuid().parse(req.params.id),req.user.id]);respond(res,{ok:true});});
  app.patch('/api/me',requireUser,async(req,res)=>{
    const input=z.object({name:nameSchema,email:z.union([z.string().trim().toLowerCase().email().max(254),z.literal(''),z.null()]).optional()}).strict().parse(req.body);
    const email=input.email===undefined?req.user.email_cipher?decrypt(req.user.email_cipher,config.encryptionKey):null:input.email||null;
    try{await db.query('UPDATE users SET name_cipher=$1,email_hash=$2,email_cipher=$3,email_verified_at=NULL,updated_at=now() WHERE id=$4',[encrypt(input.name,config.encryptionKey),email?hmac(config.lookupKey,email):null,email?encrypt(email,config.encryptionKey):null,req.user.id]);}catch(e){if(e.code==='23505')throw new ApiError(409,'Unable to save that email address');throw e;}respond(res,{ok:true});
  });
  app.get('/api/me/preferences',requireUser,async(req,res)=>respond(res,(await db.query('SELECT locale,notifications_enabled,analytics_consent,marketing_consent FROM user_preferences WHERE user_id=$1',[req.user.id])).rows[0]));
  app.patch('/api/me/preferences',requireUser,async(req,res)=>{const input=z.object({locale:z.enum(['en','hi']).optional(),notifications_enabled:z.boolean().optional(),analytics_consent:z.boolean().optional(),marketing_consent:z.boolean().optional()}).strict().parse(req.body);await db.transaction(async tx=>{for(const[key,value]of Object.entries(input)){await tx.query(`UPDATE user_preferences SET ${key}=$1,updated_at=now() WHERE user_id=$2`,[value,req.user.id]);if(key.endsWith('_consent'))await tx.query('INSERT INTO consent_events(id,user_id,purpose,granted,policy_version) VALUES($1,$2,$3,$4,$5)',[id(),req.user.id,key,value,'2026-09']);}});respond(res,{ok:true});});
  app.get('/api/me/export',requireUser,async(req,res)=>{await limit(db,'export:'+req.user.id,3,3600);const data={profile:publicUser(req.user,config)};for(const [table,columns]of [['favorites','match_id,created_at'],['subscriptions','plan_id,provider,status,current_period_end'],['payments','amount_minor,currency,status,created_at'],['user_preferences','locale,analytics_consent,marketing_consent'],['consent_events','purpose,granted,created_at']])data[table]=(await db.query(`SELECT ${columns} FROM ${table} WHERE user_id=$1`,[req.user.id])).rows;await audit(db,req.user.id,'privacy.exported');respond(res,data);});
  app.post('/api/me/deletion-otp',requireUser,async(req,res)=>respond(res,await start(req,'delete')));
  app.post('/api/me/deletion-request',requireUser,async(req,res)=>{const challenge=await verify(req,'delete');await db.transaction(async tx=>{await consume(tx,challenge);await tx.query("INSERT INTO privacy_requests(id,user_id,kind) VALUES($1,$2,'deletion')",[id(),req.user.id]);await tx.query("UPDATE users SET status='suspended',updated_at=now() WHERE id=$1",[req.user.id]);await tx.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[req.user.id]);await audit(tx,req.user.id,'privacy.deletion_requested');});res.clearCookie('cp_session',{path:'/api',httpOnly:true,secure:config.production,sameSite:'strict'});respond(res,{message:'Access suspended. Support must complete deletion and subscription cancellation. Billing is not automatically cancelled.'});});
}
