import {getConfig} from '../src/config.js';
import {openDatabase} from '../src/db.js';
import {decrypt} from '../src/security.js';
const config=getConfig();if(config.production||config.otpProvider!=='development')throw new Error('Development SMS viewer is disabled');
const db=await openDatabase(config);
try{const rows=(await db.query("SELECT o.id,o.phone_cipher,s.code_cipher FROM development_sms s JOIN otp_challenges o ON o.id=s.challenge_id WHERE o.expires_at>now() AND o.status='pending' ORDER BY o.created_at DESC LIMIT 3")).rows;for(const r of rows)console.log({challengeId:r.id,phone:'••••'+decrypt(r.phone_cipher,config.encryptionKey).slice(-4),code:decrypt(r.code_cipher,config.encryptionKey)});}finally{await db.close();}
