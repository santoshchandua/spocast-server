import { readFileSync } from 'node:fs';
export function getConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const requireKey = name => { const key = env[name]; if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error(`${name} must be 32 random bytes encoded as hex. Run npm run setup locally.`); return key; };
  const config = {
    production, port: Number(env.PORT || 4000), host: env.HOST || '127.0.0.1',
    databaseUrl: env.DATABASE_URL, databaseMode: env.DATABASE_MODE || 'embedded', databasePath: env.DATABASE_PATH || './.data/postgres',
    dbCa: env.DB_CA_FILE ? readFileSync(env.DB_CA_FILE, 'utf8') : undefined,
    encryptionKey: requireKey('DATA_ENCRYPTION_KEY'), lookupKey: requireKey('LOOKUP_HMAC_KEY'),
    origins: (env.ALLOWED_ORIGINS || 'http://localhost:8081').split(',').map(v => v.trim()),
    publicUrl: env.PUBLIC_APP_URL || 'http://localhost:8081', trustProxy: env.TRUST_PROXY_CIDRS?.split(',').map(v => v.trim()) || false,
    billingProvider: env.BILLING_PROVIDER || 'disabled', stripeKey: env.STRIPE_SECRET_KEY, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    stripePrices: { plus_monthly: env.STRIPE_PRICE_PLUS_MONTHLY, plus_yearly: env.STRIPE_PRICE_PLUS_YEARLY },
    razorpayKey: env.RAZORPAY_KEY_ID, razorpaySecret: env.RAZORPAY_KEY_SECRET, razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    razorpayPlans: { plus_monthly: env.RAZORPAY_PLAN_PLUS_MONTHLY, plus_yearly: env.RAZORPAY_PLAN_PLUS_YEARLY },
    feedUrl: env.CRICKET_FEED_URL, feedHost: env.CRICKET_FEED_HOST, feedToken: env.CRICKET_FEED_TOKEN,
    feedWebhookSecret: env.CRICKET_WEBHOOK_SECRET, licenseConfirmed: env.CRICKET_LICENSE_CONFIRMED === 'true',
    smtpHost: env.SMTP_HOST, smtpPort: Number(env.SMTP_PORT || 465), smtpUser: env.SMTP_USER, smtpPass: env.SMTP_PASS, mailFrom: env.MAIL_FROM,
    tlsCert: env.TLS_CERT_FILE, tlsKey: env.TLS_KEY_FILE
    ,otpProvider: env.OTP_PROVIDER || 'disabled', twilioAccount: env.TWILIO_ACCOUNT_SID, twilioToken: env.TWILIO_AUTH_TOKEN,
    twilioService: env.TWILIO_VERIFY_SERVICE_SID, phonePrefixes: (env.OTP_PHONE_PREFIXES || '+91').split(','),
    otpDailyCap: Number(env.OTP_DAILY_CAP || 500), audioEnabled: env.AUDIO_ENABLED === 'true',
    openaiKey: env.OPENAI_API_KEY, audioVoice: 'coral', audioModel: 'gpt-4o-mini-tts', audioDailyCap: Number(env.AUDIO_DAILY_CAP || 1000)
  };
  if (!['disabled','stripe','razorpay'].includes(config.billingProvider)) throw new Error('Invalid BILLING_PROVIDER');
  if (production) {
    if (config.encryptionKey === config.lookupKey) throw new Error('Production encryption and lookup keys must be independent');
    if (config.trustProxy && config.trustProxy.some(value => ['true','0.0.0.0/0','::/0'].includes(value))) throw new Error('Trust only specific proxy addresses or private proxy subnets');
    if (config.databaseMode !== 'postgres' || !config.databaseUrl) throw new Error('Production requires PostgreSQL');
    if (!env.ALLOWED_ORIGINS || config.origins.some(v => !v.startsWith('https://') || v.includes('*'))) throw new Error('Production requires explicit HTTPS origins');
    if (!config.publicUrl.startsWith('https://')) throw new Error('Production PUBLIC_APP_URL must use HTTPS');
    if (config.otpProvider !== 'twilio' || !config.twilioAccount || !config.twilioToken || !config.twilioService) throw new Error('Production requires configured SMS verification');
    if (!(config.tlsCert && config.tlsKey) && !config.trustProxy) throw new Error('Production requires TLS or explicit trusted proxy CIDRs');
  }
  if (!['disabled','development','twilio'].includes(config.otpProvider)) throw new Error('Invalid OTP_PROVIDER');
  if (!Number.isInteger(config.otpDailyCap) || config.otpDailyCap < 1 || !Number.isInteger(config.audioDailyCap) || config.audioDailyCap < 1) throw new Error('Invalid provider daily limit');
  return config;
}
