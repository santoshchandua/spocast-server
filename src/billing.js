import Stripe from 'stripe';
import { z } from 'zod';
import { id, hash, hmac, safeEqual, ApiError, audit, limit } from './security.js';
import { requireUser, requireVerified } from './phone-auth.js';

export async function entitlements(db, userId) {
  if (!userId) return { plus: false, adFree: false };
  const row = (await db.query("SELECT 1 FROM subscriptions WHERE user_id=$1 AND status='active' AND current_period_end>now() LIMIT 1", [userId])).rows[0];
  return { plus: !!row, adFree: !!row };
}
export async function saveSubscription(tx, snapshot) {
  const { userId, planId, provider, subscriptionId, status, periodEnd, cancelAtEnd } = snapshot;
  const existing = (await tx.query('SELECT user_id FROM subscriptions WHERE provider=$1 AND provider_subscription_id=$2', [provider, subscriptionId])).rows[0];
  if (existing && existing.user_id !== userId) throw new ApiError(409, 'Subscription ownership mismatch');
  await tx.query(`INSERT INTO subscriptions(id,user_id,plan_id,provider,provider_subscription_id,status,current_period_end,cancel_at_period_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(provider,provider_subscription_id) DO UPDATE SET status=EXCLUDED.status,current_period_end=EXCLUDED.current_period_end,cancel_at_period_end=EXCLUDED.cancel_at_period_end,plan_id=EXCLUDED.plan_id,updated_at=now()`, [id(), userId, planId, provider, subscriptionId, status, periodEnd, !!cancelAtEnd]);
}
export function createBilling(config, dependencies = {}) {
  const stripe = dependencies.stripe || (config.stripeKey ? new Stripe(config.stripeKey, { maxNetworkRetries: 2, timeout: 10000 }) : null);
  const razor = async (path, method = 'GET', body) => {
    if (!config.razorpayKey || !config.razorpaySecret) throw new ApiError(503, 'Payment provider is not configured');
    const response = await fetch(`https://api.razorpay.com/v1/${path}`, { method, headers: { Authorization: 'Basic ' + Buffer.from(`${config.razorpayKey}:${config.razorpaySecret}`).toString('base64'), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new ApiError(502, 'Payment provider request failed');
    return response.json();
  };
  const ensureConfigured = () => {
    if (config.billingProvider === 'disabled') throw new ApiError(503, 'Payments are not enabled yet');
    if (config.billingProvider === 'stripe' && (!stripe || !config.stripeWebhookSecret)) throw new ApiError(503, 'Payment provider is not configured');
    if (config.billingProvider === 'razorpay' && (!config.razorpayKey || !config.razorpaySecret || !config.razorpayWebhookSecret)) throw new ApiError(503, 'Payment provider is not configured');
  };
  return {
    enabled: () => { try { ensureConfigured(); return true; } catch { return false; } },
    async checkout(db, user, plan, key) {
      ensureConfigured();
      // Persist intent before calling the provider. An ambiguous Razorpay result is never blindly retried.
      const intent = await db.transaction(async tx => {
        await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
        const existing = (await tx.query('SELECT * FROM checkout_requests WHERE user_id=$1 AND idempotency_key=$2', [user.id, key])).rows[0];
        if (existing) { if (existing.plan_id !== plan.id || existing.provider !== config.billingProvider) throw new ApiError(409, 'Idempotency key was used for another checkout'); return existing; }
        const current = (await tx.query("SELECT 1 FROM subscriptions WHERE user_id=$1 AND status IN ('active','past_due','pending') LIMIT 1", [user.id])).rows[0];
        if (current) throw new ApiError(409, 'Manage your existing subscription before starting another');
        const pending = (await tx.query("SELECT 1 FROM checkout_requests WHERE user_id=$1 AND created_at>now()-interval '24 hours' LIMIT 1", [user.id])).rows[0];
        if (pending) throw new ApiError(409, 'A checkout already exists. Reuse it or contact support before creating another.');
        return (await tx.query('INSERT INTO checkout_requests(id,user_id,plan_id,idempotency_key,provider) VALUES($1,$2,$3,$4,$5) RETURNING *', [id(), user.id, plan.id, key, config.billingProvider])).rows[0];
      });
      if (intent.checkout_url) return { url: intent.checkout_url };
      const claim = await db.query('INSERT INTO job_leases(name,owner,expires_at) VALUES($1,$2,now()+interval \'60 seconds\') ON CONFLICT(name) DO NOTHING RETURNING name', ['checkout:' + intent.id, id()]);
      if (!claim.rows.length) throw new ApiError(409, 'Checkout is pending provider confirmation. Please contact support if it does not complete.');
      let externalId, url;
      if (config.billingProvider === 'stripe') {
        const priceId = config.stripePrices[plan.id]; if (!priceId) throw new ApiError(503, 'This plan is not configured');
        const price = await stripe.prices.retrieve(priceId);
        if (price.unit_amount !== plan.amount_minor || price.currency.toUpperCase() !== plan.currency || price.recurring?.interval !== plan.interval) throw new ApiError(503, 'Plan configuration mismatch');
        let customer = (await db.query("SELECT provider_customer_id FROM billing_customers WHERE user_id=$1 AND provider='stripe'", [user.id])).rows[0]?.provider_customer_id;
        if (!customer) {
          customer = (await stripe.customers.create({ metadata: { userId: user.id } }, { idempotencyKey: `customer:${user.id}` })).id;
          await db.query("INSERT INTO billing_customers(user_id,provider,provider_customer_id) VALUES($1,'stripe',$2) ON CONFLICT(user_id,provider) DO NOTHING", [user.id, customer]);
        }
        const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer, line_items: [{ price: priceId, quantity: 1 }], success_url: config.publicUrl, cancel_url: config.publicUrl, client_reference_id: user.id, subscription_data: { metadata: { userId: user.id, planId: plan.id } } }, { idempotencyKey: intent.id });
        externalId = session.id; url = session.url;
      } else {
        const planId = config.razorpayPlans[plan.id]; if (!planId) throw new ApiError(503, 'This plan is not configured');
        const externalPlan = await razor(`plans/${encodeURIComponent(planId)}`);
        if (externalPlan.item?.amount !== plan.amount_minor || externalPlan.item?.currency !== plan.currency || externalPlan.period !== (plan.interval === 'month' ? 'monthly' : 'yearly') || externalPlan.interval !== 1) throw new ApiError(503, 'Plan configuration mismatch');
        const subscription = await razor('subscriptions', 'POST', { plan_id: planId, total_count: plan.interval === 'month' ? 120 : 10, quantity: 1, customer_notify: 1, notes: { userId: user.id, planId: plan.id, checkoutId: intent.id } });
        externalId = subscription.id; url = subscription.short_url;
      }
      if (!url?.startsWith('https://')) throw new ApiError(502, 'Provider returned an invalid checkout URL');
      await db.query('UPDATE checkout_requests SET provider_checkout_id=$1,checkout_url=$2 WHERE id=$3', [externalId, url, intent.id]);
      return { url };
    },
    async portal(db, userId) {
      ensureConfigured();
      if (config.billingProvider !== 'stripe') throw new ApiError(409, 'Use Cancel renewal for Razorpay subscriptions. Payment-method changes are handled by Razorpay support.');
      const customer = (await db.query("SELECT provider_customer_id FROM billing_customers WHERE user_id=$1 AND provider='stripe'", [userId])).rows[0];
      if (!customer) throw new ApiError(404, 'No billing account yet');
      return { url: (await stripe.billingPortal.sessions.create({ customer: customer.provider_customer_id, return_url: config.publicUrl })).url };
    },
    async cancel(db, userId, subscriptionId) {
      ensureConfigured();
      const sub = (await db.query('SELECT * FROM subscriptions WHERE id=$1 AND user_id=$2', [subscriptionId, userId])).rows[0];
      if (!sub) throw new ApiError(404, 'Subscription not found');
      if (sub.provider === 'stripe' && stripe) await stripe.subscriptions.update(sub.provider_subscription_id, { cancel_at_period_end: true });
      else if (sub.provider === 'razorpay') await razor(`subscriptions/${encodeURIComponent(sub.provider_subscription_id)}/cancel`, 'POST', { cancel_at_cycle_end: 1 });
      else throw new ApiError(409, 'Manage this subscription in its app store');
      await db.query('UPDATE subscriptions SET cancel_at_period_end=true,updated_at=now() WHERE id=$1', [sub.id]);
      return { message: 'Renewal cancellation requested. Access continues until the paid period ends.' };
    },
    async webhook(db, provider, raw, headers) {
      if (provider !== config.billingProvider) throw new ApiError(503, 'Payment provider is not enabled');
      ensureConfigured();
      let event;
      try {
        if (provider === 'stripe') event = stripe.webhooks.constructEvent(raw, headers['stripe-signature'], config.stripeWebhookSecret, 300);
        else { if (!safeEqual(headers['x-razorpay-signature'], hmac(config.razorpayWebhookSecret, raw))) throw new Error('signature'); event = JSON.parse(raw.toString('utf8')); }
      } catch { throw new ApiError(400, 'Invalid webhook signature or payload'); }
      // Body-derived Razorpay event fingerprint cannot be changed by editing an unsigned header.
      const eventId = provider === 'stripe' ? event.id : hash(raw);
      if (await processed(db, provider, eventId)) return { duplicate: true };
      let externalId;
      if (provider === 'stripe') {
        const obj = event.data.object;
        externalId = event.type.startsWith('customer.subscription.') ? obj.id : event.type === 'checkout.session.completed' ? obj.subscription : event.type.startsWith('invoice.') ? (obj.parent?.subscription_details?.subscription || obj.subscription) : null;
      } else externalId = event.payload?.subscription?.entity?.id;
      if (!externalId) return { ignored: true };
      // Serialize reconciliation across workers; retrieve current state, not stale event state.
      const owner = id(), lockName = `billing:${provider}:${externalId}`;
      const lease = await db.query("INSERT INTO job_leases(name,owner,expires_at) VALUES($1,$2,now()+interval '60 seconds') ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE job_leases.expires_at<now() RETURNING owner", [lockName, owner]);
      if (!lease.rows.length) throw new ApiError(503, 'Reconciliation busy; retry delivery');
      try {
        const sub = provider === 'stripe' ? await stripe.subscriptions.retrieve(externalId, { expand: ['latest_invoice'] }) : await razor(`subscriptions/${encodeURIComponent(externalId)}`);
        const metadata = provider === 'stripe' ? sub.metadata : sub.notes;
        const userId = z.uuid().parse(metadata?.userId), planId = z.enum(['plus_monthly','plus_yearly']).parse(metadata?.planId);
        if (provider === 'stripe') {
          const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
          const owned = (await db.query("SELECT 1 FROM billing_customers WHERE user_id=$1 AND provider='stripe' AND provider_customer_id=$2", [userId, customer])).rows[0];
          if (!owned || sub.items.data.length !== 1 || sub.items.data[0].price.id !== config.stripePrices[planId] || sub.items.data[0].quantity !== 1) throw new ApiError(409, 'Subscription configuration mismatch');
        } else {
          const owned = (await db.query("SELECT 1 FROM checkout_requests WHERE id=$1 AND user_id=$2 AND provider='razorpay' AND provider_checkout_id=$3", [metadata.checkoutId, userId, sub.id])).rows[0];
          if (!owned || sub.plan_id !== config.razorpayPlans[planId] || sub.quantity !== 1) throw new ApiError(409, 'Subscription configuration mismatch');
        }
        const end = provider === 'stripe' ? sub.items.data[0]?.current_period_end : sub.current_end;
        const status = ['active'].includes(sub.status) ? 'active' : ['past_due','unpaid','halted','pending'].includes(sub.status) ? 'past_due' : ['canceled','cancelled','completed','expired'].includes(sub.status) ? 'cancelled' : 'pending';
        await db.transaction(async tx => {
          const inserted = await tx.query('INSERT INTO webhook_events(provider,event_id,payload_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id', [provider, eventId, hash(raw)]);
          if (!inserted.rows.length) return;
          await saveSubscription(tx, { userId, planId, provider, subscriptionId: sub.id, status, periodEnd: end ? new Date(end * 1000).toISOString() : null, cancelAtEnd: !!sub.cancel_at_period_end || !!sub.has_scheduled_changes });
          const payment = provider === 'stripe' ? sub.latest_invoice : event.payload?.payment?.entity;
          if (payment && typeof payment === 'object' && (payment.status === 'paid' || payment.status === 'captured')) {
            const local = (await tx.query('SELECT id FROM subscriptions WHERE provider=$1 AND provider_subscription_id=$2', [provider, sub.id])).rows[0];
            await tx.query("INSERT INTO payments(id,user_id,subscription_id,provider,provider_payment_id,amount_minor,currency,status) VALUES($1,$2,$3,$4,$5,$6,$7,'paid') ON CONFLICT(provider,provider_payment_id) DO NOTHING", [id(), userId, local.id, provider, payment.id, payment.amount_paid ?? payment.amount, payment.currency.toUpperCase()]);
          }
          await audit(tx, userId, 'subscription.reconciled', 'subscription', sub.id);
        }); return { received: true };
      } finally { await db.query('DELETE FROM job_leases WHERE name=$1 AND owner=$2', [lockName, owner]); }
    }
  };
}
async function processed(db, provider, eventId) { return !!(await db.query('SELECT 1 FROM webhook_events WHERE provider=$1 AND event_id=$2', [provider, eventId])).rows[0]; }
export function mountBilling(app, db, config, billing) {
  app.get('/api/plans', async (req, res) => res.json({ data: { plans: (await db.query('SELECT id,name,amount_minor,currency,interval,features FROM plans WHERE active=true ORDER BY amount_minor')).rows, checkoutEnabled: billing.enabled(), provider: config.billingProvider, nativeBillingEnabled: false } }));
  app.get('/api/me/subscription', requireUser, async (req, res) => res.json({ data: { entitlements: await entitlements(db, req.user.id), subscriptions: (await db.query('SELECT id,plan_id,provider,status,current_period_end,cancel_at_period_end FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC', [req.user.id])).rows } }));
  app.get('/api/me/payments', requireUser, async (req, res) => res.json({ data: (await db.query('SELECT id,provider,amount_minor,currency,status,created_at FROM payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id])).rows }));
  app.post('/api/billing/checkout', requireUser, requireVerified, async (req, res) => {
    await limit(db, 'checkout:' + req.user.id, 5, 3600);
    const { planId } = z.object({ planId: z.enum(['plus_monthly','plus_yearly']) }).strict().parse(req.body);
    const key = z.uuid().parse(req.headers['idempotency-key']);
    const plan = (await db.query('SELECT * FROM plans WHERE id=$1 AND active=true', [planId])).rows[0];
    if (!plan) throw new ApiError(404, 'Plan not found');
    res.json({ data: await billing.checkout(db, req.user, plan, key) });
  });
  app.post('/api/billing/portal', requireUser, requireVerified, async (req, res) => { await limit(db, 'portal:' + req.user.id, 10, 3600); res.json({ data: await billing.portal(db, req.user.id) }); });
  app.post('/api/billing/cancel', requireUser, requireVerified, async (req, res) => {
    const { subscriptionId } = z.object({ subscriptionId: z.uuid() }).strict().parse(req.body); await limit(db, 'cancel:' + req.user.id, 5, 3600);
    res.json({ data: await billing.cancel(db, req.user.id, subscriptionId) });
  });
}
