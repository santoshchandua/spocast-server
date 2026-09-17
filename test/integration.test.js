import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { openDatabase, migrate } from '../src/db.js';
import { getConfig } from '../src/config.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { createBilling, saveSubscription, entitlements } from '../src/billing.js';
import { decrypt, encrypt, hmac, id, hash } from '../src/security.js';
import { receiveFeed, storeFeed, projection } from '../src/cricket.js';

const config = getConfig({ NODE_ENV:'test', OTP_PROVIDER:'development', DATABASE_MODE:process.env.TEST_DATABASE_URL?'postgres':'embedded', DATABASE_URL:process.env.TEST_DATABASE_URL, DATABASE_PATH:':memory:', DATA_ENCRYPTION_KEY:randomBytes(32).toString('hex'), LOOKUP_HMAC_KEY:randomBytes(32).toString('hex') });
test('database-backed security and product integration', async t => {
  const db = await openDatabase(config); await migrate(db); await seed(db,config);
  const server = createApp({db,config}).listen(0,'127.0.0.1'); await new Promise(resolve=>server.on('listening',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,{method='GET',body,token,headers={}}={})=>{
    const response=await fetch(base+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} :{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const json=response.status===204?{}:await response.json(); return {status:response.status,json,headers:response.headers};
  };
  const startOtp=async(phone,email,headers={})=>{const response=await call('/auth/otp/request',{method:'POST',body:{phone,fullName:'Test User',...(email?{email}:{})},headers});assert.equal(response.status,200);const challengeId=response.json.data.challengeId;assert.equal(response.json.data.code,undefined);const sms=(await db.query('SELECT code_cipher FROM development_sms WHERE challenge_id=$1',[challengeId])).rows[0];return{challengeId,code:decrypt(sms.code_cipher,config.encryptionKey)};};
  let alice,bob,aliceToken,bobToken;
  await t.test('schema, indexes, and database cricket reads',async()=>{
    const tables=(await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
    assert.ok(tables>=35);
    assert.ok((await db.query("SELECT indexname FROM pg_indexes WHERE indexname='matches_status_start_idx'")).rows.length);
    const all=await call('/matches');assert.equal(all.status,200);assert.equal(all.json.data.length,5);assert.equal(all.json.data[0].dataMode,'demo');
    for(const status of ['live','upcoming','completed'])assert.ok((await call('/matches?status='+status)).json.data.every(m=>m.status===status));
    assert.equal((await call('/matches?status=bad')).status,400);
    assert.equal((await call('/matches?limit=10000')).status,400);
    assert.equal((await call('/matches/missing')).status,404);
    const detail=(await call('/matches/ind-aus')).json.data;
    assert.equal(detail.innings[0].batting.reduce((s,p)=>s+p.runs,0)+8,168);
    assert.equal((await call('/news')).json.data.length,3);
    assert.equal((await call('/me/favorites')).status,401);
  });
  await t.test('OTP only, encrypted identity, one-use codes and ownership',async()=>{
    assert.equal((await call('/auth/login',{method:'POST',body:{}})).status,404);
    assert.equal((await call('/auth/otp/request',{method:'POST',body:{phone:'+919000000001',fullName:'Test',role:'admin'}})).status,400);
    const proof=await startOtp('+919000000001','alice@example.test');
    const login=await call('/auth/otp/verify',{method:'POST',body:proof});assert.equal(login.status,200);alice=login.json.data.user;aliceToken=login.json.data.token;
    assert.equal((await call('/auth/otp/verify',{method:'POST',body:proof})).status,400);
    const bp=await startOtp('+919000000002');const bl=await call('/auth/otp/verify',{method:'POST',body:bp});bob=bl.json.data.user;bobToken=bl.json.data.token;
    assert.equal(bob.email,null);assert.equal(alice.verified,true);assert.equal(alice.role,'user');
    const stored=(await db.query('SELECT * FROM users WHERE id=$1',[alice.id])).rows[0];assert.notEqual(stored.phone_cipher,alice.phone);assert.equal(stored.password_hash,null);assert.equal(decrypt(stored.phone_cipher,config.encryptionKey),alice.phone);assert.throws(()=>decrypt(stored.phone_cipher,randomBytes(32).toString('hex')));
    assert.equal((await call('/me/favorites',{method:'POST',token:aliceToken,body:{matchId:'ind-aus'}})).status,200);assert.deepEqual((await call('/me/favorites',{token:bobToken})).json.data,[]);
    const session=(await call('/me/sessions',{token:aliceToken})).json.data[0];await call('/me/sessions/'+session.id,{method:'DELETE',token:bobToken});assert.equal((await call('/auth/session',{token:aliceToken})).status,200);
    assert.equal((await call('/billing/checkout',{method:'POST',token:aliceToken,body:{planId:'plus_monthly'},headers:{'Idempotency-Key':id()}})).status,503);
  });
  await t.test('browser cookie sessions require CSRF; optional email cannot claim another account',async()=>{
    const proof=await startOtp('+919000000003','alice@example.test');const login=await call('/auth/otp/verify',{method:'POST',body:proof,headers:{Origin:'http://localhost:8081'}});
    assert.equal(login.json.data.token,undefined);assert.notEqual(login.json.data.user.id,alice.id);assert.equal(login.json.data.user.email,null);assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await call('/me',{method:'PATCH',body:{name:'Unsafe'},headers:{Cookie:cookie,Origin:'http://localhost:8081'}})).status,403);
    assert.equal((await call('/me',{method:'PATCH',body:{name:'Safe'},headers:{Cookie:cookie,Origin:'http://localhost:8081','X-CSRF-Token':login.json.data.csrfToken}})).status,200);
    assert.equal((await call('/matches',{headers:{Origin:'https://attacker.example'}})).status,403);
  });
  await t.test('OTP retry budget persists and expired codes fail',async()=>{
    const proof=await startOtp('+919000000004');const wrong={...proof,code:proof.code==='000000'?'111111':'000000'};
    for(let i=0;i<5;i++)assert.equal((await call('/auth/otp/verify',{method:'POST',body:wrong})).status,400);
    assert.equal((await call('/auth/otp/verify',{method:'POST',body:proof})).status,400);assert.equal((await db.query('SELECT attempts FROM otp_challenges WHERE id=$1',[proof.challengeId])).rows[0].attempts,5);
    const expired=await startOtp('+919000000005');await db.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.challengeId]);assert.equal((await call('/auth/otp/verify',{method:'POST',body:expired})).status,400);
  });
  await t.test('rankings, records and achievement history expose explicit demo provenance',async()=>{
    const ranking=(await call('/rankings?format=ODI&gender=women&category=batting')).json.data;assert.equal(ranking.entries[0].name,'Maya Rao');assert.equal(ranking.dataMode,'demo');
    assert.equal((await call('/rankings?format=invalid')).status,400);
    const records=(await call('/records?format=T20')).json.data;assert.equal(records.length,3);
    const profile=(await call('/history/demo_arjun-mehta')).json.data;assert.ok(profile.achievements.length);assert.ok(profile.statistics.length);assert.match(profile.source_label,/Fictional/);
    assert.equal((await call('/history?search=unknown')).json.data.length,0);
  });
  await t.test('preferences, export and premium controls are user-scoped',async()=>{
    await call('/me/preferences',{method:'PATCH',token:aliceToken,body:{analytics_consent:true}});
    assert.equal((await call('/me/preferences',{token:bobToken})).json.data.analytics_consent,false);
    assert.equal((await call('/me/export',{token:aliceToken})).json.data.profile.email,'alice@example.test');
    assert.equal((await call('/matches/ind-aus/insights')).json.data.projection.scenarios,undefined);
    await db.transaction(tx=>saveSubscription(tx,{userId:alice.id,planId:'plus_monthly',provider:'stripe',subscriptionId:'sub_test',status:'active',periodEnd:new Date(Date.now()+86400000).toISOString()}));
    assert.equal((await call('/ads/scores_inline',{token:aliceToken})).json.data,null);
    assert.ok((await call('/ads/scores_inline',{token:bobToken})).json.data);
    assert.equal((await call('/matches/ind-aus/insights',{token:aliceToken})).json.data.projection.scenarios.length,3);
    await db.query("UPDATE subscriptions SET current_period_end=now()-interval '1 second' WHERE user_id=$1",[alice.id]);
    assert.equal((await entitlements(db,alice.id)).plus,false);
  });
  await t.test('provider ingestion rejects forgery, deduplicates and prevents stale overwrites',async()=>{
    const feedConfig={...config,licenseConfirmed:true,feedWebhookSecret:'test-only-secret'};
    await db.query("UPDATE providers SET enabled=true,license_reference='test contract',license_expires_at=now()+interval '1 day' WHERE id='licensed'");
    const match=(await call('/matches/ind-aus')).json.data;for(const key of ['dataMode','providerUpdatedAt','fetchedAt','stale'])delete match[key];
    const feed={updatedAt:new Date().toISOString(),matches:[match]},raw=Buffer.from(JSON.stringify(feed)),timestamp=String(Math.floor(Date.now()/1000)),eventId='event-1';
    const headers={'x-feed-timestamp':timestamp,'x-feed-event-id':eventId,'x-feed-signature':hmac(feedConfig.feedWebhookSecret,Buffer.concat([Buffer.from(`${timestamp}.${eventId}.`),raw]))};
    await assert.rejects(()=>receiveFeed(db,feedConfig,raw,{...headers,'x-feed-signature':'bad'}));
    assert.equal((await receiveFeed(db,feedConfig,raw,headers)).written,1);assert.equal((await receiveFeed(db,feedConfig,raw,headers)).duplicate,true);
    const stale={...feed,updatedAt:new Date(Date.now()-60000).toISOString(),matches:[{...match,summary:'Outdated'}]};await db.transaction(tx=>storeFeed(tx,'licensed',stale));
    assert.notEqual((await call('/matches/licensed_ind-aus')).json.data.summary,'Outdated');
    await assert.rejects(()=>receiveFeed(db,feedConfig,raw,{...headers,'x-feed-timestamp':'1000000000'}));
    await db.query("UPDATE providers SET license_expires_at=now()-interval '1 second' WHERE id='licensed'");assert.equal((await call('/matches/licensed_ind-aus')).status,404);
  });
  await t.test('fresh OTP deletion suspends account and revokes all sessions',async()=>{
    await db.query('DELETE FROM rate_limits');const response=await call('/me/deletion-otp',{method:'POST',token:bobToken,body:{}});assert.equal(response.status,200);const challengeId=response.json.data.challengeId;
    const code=decrypt((await db.query('SELECT code_cipher FROM development_sms WHERE challenge_id=$1',[challengeId])).rows[0].code_cipher,config.encryptionKey);
    assert.equal((await call('/me/deletion-request',{method:'POST',token:bobToken,body:{challengeId,code}})).status,200);assert.equal((await call('/auth/session',{token:bobToken})).status,401);
  });
  await t.test('rate limits, payload limits, and production fail-closed configuration',async()=>{
    await db.query('DELETE FROM rate_limits');await startOtp('+919000000006');assert.equal((await call('/auth/otp/request',{method:'POST',body:{phone:'+919000000006',fullName:'Test User'}})).status,429);
    assert.equal((await call('/auth/otp/request',{method:'POST',body:{fullName:'x'.repeat(20000)}})).status,413);
    assert.throws(()=>getConfig({NODE_ENV:'production',DATA_ENCRYPTION_KEY:config.encryptionKey,LOOKUP_HMAC_KEY:config.lookupKey}),/PostgreSQL/);assert.equal(projection({format:'T20',status:'upcoming',teams:[]}),null);
  });
});

test('billing rejects unsigned events without changing entitlements',async()=>{
  const billing=createBilling({...config,billingProvider:'stripe',stripeKey:'sk_test_placeholder',stripeWebhookSecret:'whsec_test'});
  await assert.rejects(()=>billing.webhook(null,'stripe',Buffer.from('{}'),{'stripe-signature':'fake'}),/Invalid webhook/);
  const razor=createBilling({...config,billingProvider:'razorpay',razorpayKey:'test',razorpaySecret:'test',razorpayWebhookSecret:'test'});
  await assert.rejects(()=>razor.webhook(null,'razorpay',Buffer.from('{}'),{'x-razorpay-signature':'fake'}),/Invalid webhook/);
});

test('verified Stripe events reconcile current state atomically, with replay and ownership protection',async t=>{
  const db=await openDatabase({...config,databaseMode:'embedded',databasePath:':memory:'});await migrate(db);await seed(db,config);t.after(()=>db.close());
  const userId=id();await db.query('INSERT INTO users(id,email_hash,email_cipher,name_cipher,password_hash,email_verified_at) VALUES($1,$2,$3,$4,$5,now())',[userId,hmac(config.lookupKey,'billing@example.test'),encrypt('billing@example.test',config.encryptionKey),encrypt('Billing Test',config.encryptionKey),'test-only-not-a-login']);
  await db.query("INSERT INTO billing_customers(user_id,provider,provider_customer_id) VALUES($1,'stripe','cus_verified')",[userId]);
  const sdk=new Stripe('sk_test_local'), secret='whsec_local_testing';let reads=0;
  const current={id:'sub_verified',status:'active',customer:'cus_verified',metadata:{userId,planId:'plus_monthly'},items:{data:[{price:{id:'price_monthly'},quantity:1,current_period_end:Math.floor(Date.now()/1000)+3600}]},latest_invoice:{id:'in_verified',status:'paid',amount_paid:19900,currency:'inr'}};
  const billing=createBilling({...config,billingProvider:'stripe',stripeKey:'sk_test_local',stripeWebhookSecret:secret,stripePrices:{plus_monthly:'price_monthly'}},{stripe:{webhooks:sdk.webhooks,subscriptions:{retrieve:async()=>{reads++;return current;}}}});
  const event={id:'evt_verified',type:'customer.subscription.updated',data:{object:{id:current.id,status:'past_due'}}};
  const payload=JSON.stringify(event), signature=sdk.webhooks.generateTestHeaderString({payload,secret});
  await billing.webhook(db,'stripe',Buffer.from(payload),{'stripe-signature':signature});
  assert.equal((await entitlements(db,userId)).plus,true);assert.equal((await db.query('SELECT count(*)::int AS n FROM payments')).rows[0].n,1);
  assert.equal((await billing.webhook(db,'stripe',Buffer.from(payload),{'stripe-signature':signature})).duplicate,true);assert.equal(reads,1);
  current.status='canceled';const cancelled=JSON.stringify({...event,id:'evt_cancelled'});await billing.webhook(db,'stripe',Buffer.from(cancelled),{'stripe-signature':sdk.webhooks.generateTestHeaderString({payload:cancelled,secret})});assert.equal((await entitlements(db,userId)).plus,false);
  current.customer='cus_someone_else';const wrong=JSON.stringify({...event,id:'evt_wrong_owner'});await assert.rejects(()=>billing.webhook(db,'stripe',Buffer.from(wrong),{'stripe-signature':sdk.webhooks.generateTestHeaderString({payload:wrong,secret})}),/mismatch/);
  assert.equal((await db.query("SELECT 1 FROM webhook_events WHERE event_id='evt_wrong_owner'")).rows.length,0);
});
