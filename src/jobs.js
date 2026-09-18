import nodemailer from 'nodemailer';
import { decrypt } from './security.js';
export async function deliverEmail(db, config) {
  if (!config.smtpHost || !config.mailFrom) return { disabled: true };
  const transport = nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: config.smtpPort === 465, requireTLS: true, auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, connectionTimeout: 10000, socketTimeout: 15000, disableFileAccess: true, disableUrlAccess: true });
  let sent = 0;
  for (let i = 0; i < 20; i++) {
    const row = await db.transaction(async tx => {
      const message = (await tx.query("SELECT * FROM email_outbox WHERE (status='pending' OR (status='sending' AND leased_until<now())) AND attempts<5 AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
      if (!message) return null;
      await tx.query("UPDATE email_outbox SET status='sending',attempts=attempts+1,leased_until=now()+interval '60 seconds' WHERE id=$1", [message.id]); return message;
    });
    if (!row) break;
    try {
      const message = JSON.parse(decrypt(row.payload_cipher, config.encryptionKey));
      await transport.sendMail({ from: config.mailFrom, to: message.to, subject: message.subject, text: message.text, messageId: `<${row.id}@cricket-pulse.local>` });
      await db.query("UPDATE email_outbox SET status='sent',sent_at=now(),payload_cipher='' WHERE id=$1", [row.id]); sent++;
    } catch { await db.query("UPDATE email_outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_attempt_at=now()+interval '5 minutes',leased_until=NULL WHERE id=$1", [row.id]); }
  }
  transport.close(); return { sent };
}
export async function cleanup(db) {
  await db.query('DELETE FROM otp_challenges WHERE expires_at<now()');
  await db.query("DELETE FROM audio_clips WHERE created_at<now()-interval '1 day'");
  await db.query('DELETE FROM rate_limits WHERE reset_at<now()');
  await db.query("DELETE FROM sessions WHERE expires_at<now()-interval '7 days' OR revoked_at<now()-interval '7 days'");
  await db.query("DELETE FROM auth_tokens WHERE expires_at<now()-interval '1 day'");
  await db.query("DELETE FROM email_outbox WHERE created_at<now()-interval '7 days'");
  // Cricket retention is a contractual setting. Never infer a retention period from a pricing plan.
  await db.query("DELETE FROM matches m USING providers p WHERE m.provider_id=p.id AND p.id<>'demo' AND p.retention_days IS NOT NULL AND m.fetched_at<now()-p.retention_days*interval '1 day'");
  await db.transaction(async tx => {
    await tx.query("DELETE FROM cricket_series s USING providers p WHERE s.provider_id=p.id AND p.id<>'demo' AND p.retention_days IS NOT NULL AND s.updated_at<now()-p.retention_days*interval '1 day'");
    await tx.query("DELETE FROM cricket_records r USING providers p WHERE r.provider_id=p.id AND p.id<>'demo' AND p.retention_days IS NOT NULL AND r.updated_at<now()-p.retention_days*interval '1 day'");
    // Preserve a still-retained record while removing a stale profile association.
    await tx.query("UPDATE cricket_records SET profile_id=NULL WHERE profile_id IN (SELECT h.id FROM historical_profiles h JOIN providers p ON p.id=h.provider_id WHERE p.id<>'demo' AND p.retention_days IS NOT NULL AND h.updated_at<now()-p.retention_days*interval '1 day')");
    await tx.query("DELETE FROM historical_profiles h USING providers p WHERE h.provider_id=p.id AND p.id<>'demo' AND p.retention_days IS NOT NULL AND h.updated_at<now()-p.retention_days*interval '1 day'");
    await tx.query("DELETE FROM ranking_snapshots s USING providers p WHERE s.provider_id=p.id AND p.id<>'demo' AND p.retention_days IS NOT NULL AND s.fetched_at<now()-p.retention_days*interval '1 day'");
  });
}
