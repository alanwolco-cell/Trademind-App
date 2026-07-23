const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();
const { readAcctId, requireAcctId } = require('../lib/identity');

// The Pro plan price (test mode). Overridable via env for live mode later.
const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1TvXEhCLgUN9IYFApEHe2fVg';
// Publishable key is PUBLIC by design (safe in the browser). Test default here;
// set STRIPE_PUBLISHABLE_KEY for live mode.
const PUB_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_51TvWa3FyuZdsgDKGBy5DOkOPCddbVlgJShlCetJne5KD2axrJdF2o3O2jRVQh9jYZHDaB7CgLcSoA8QwWFRiy4As00uRqpZRDq';

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

// ── Entitlement store: who is Pro. Blob-backed (writes only happen on a
//    purchase/cancel, so volume is tiny), cached in memory for 30s so a Sage
//    request doesn't hit blob every time.
//
//    Keyed by ACCOUNT ID (sha256 of the browser's account key), never by
//    username. A Sleeper username is public information, so keying on it let
//    anyone who knew your handle read your plan, open your Stripe billing
//    portal, or cancel the subscription you were paying for. The username is
//    still recorded alongside the record, but only as a support label.
const ENT_PATH = 'entitlements/pro.json';
let _ent = null, _entTs = 0;

async function loadEnt() {
  if (_ent && Date.now() - _entTs < 30000) return _ent;
  let data = { byAcct: {}, byCustomer: {} };
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: ENT_PATH, limit: 1 });
    if (blobs.length) {
      const j = await (await fetch(blobs[0].url + '?t=' + Date.now())).json();
      if (j && typeof j === 'object') data = j;
    }
  } catch (_) { if (_ent) return _ent; }
  data.byAcct = data.byAcct || {};
  data.byCustomer = data.byCustomer || {};
  _ent = data; _entTs = Date.now();
  return _ent;
}

async function saveEnt(e) {
  _ent = e; _entTs = Date.now();
  try {
    const { put } = require('@vercel/blob');
    await put(ENT_PATH, JSON.stringify(e), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
  } catch (err) { console.error('[billing] saveEnt:', err.message); }
}

// Takes an ACCOUNT ID (see lib/identity), not a username.
async function isPro(acctId) {
  if (!acctId) return false;
  try {
    const e = await loadEnt();
    const rec = e.byAcct[String(acctId)];
    return !!(rec && (rec.status === 'active' || rec.status === 'trialing'));
  } catch (_) { return false; }
}

// GET /api/billing/account -> what Stripe actually thinks this account is.
// Owner-only. Answers the questions you cannot answer from the dashboard at a
// glance: which country the account is registered in, whether it may take
// charges yet, and exactly what Stripe is still waiting on. Returns no keys and
// no customer data.
router.get('/account', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  const given = String(req.headers['x-admin-token'] || req.query.token || '');
  if (!token) return res.status(503).json({ error: 'admin token not configured' });
  const a = Buffer.from(given), b = Buffer.from(token);
  if (!(a.length === b.length && require('crypto').timingSafeEqual(a, b))) {
    return res.status(403).json({ error: 'not authorized' });
  }
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'stripe not configured' });
  res.set('Cache-Control', 'no-store');
  try {
    const acct = await stripe.accounts.retrieve();
    const req_ = acct.requirements || {};
    res.json({
      country: acct.country,
      defaultCurrency: acct.default_currency,
      businessType: acct.business_type,
      chargesEnabled: acct.charges_enabled,
      payoutsEnabled: acct.payouts_enabled,
      detailsSubmitted: acct.details_submitted,
      disabledReason: req_.disabled_reason || null,
      currentlyDue: req_.currently_due || [],
      pastDue: req_.past_due || [],
      pendingVerification: req_.pending_verification || [],
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// GET /api/billing/config -> the public info the browser needs for embedded checkout
router.get('/config', (req, res) => {
  res.json({ publishableKey: PUB_KEY, configured: !!process.env.STRIPE_SECRET_KEY });
});

// POST /api/billing/checkout  { user, embedded? }
//   embedded:true  -> { clientSecret }  (payment form rendered ON our site)
//   otherwise      -> { url }           (Stripe-hosted redirect fallback)
router.post('/checkout', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Checkout is not turned on yet.' });
  const user = String((req.body || {}).user || '').trim().toLowerCase().slice(0, 40);
  if (!user) return res.status(401).json({ error: 'Sign in first, then upgrade.' });
  // The subscription is bound to the account key, not the typed username, so
  // only this browser can later manage or cancel it. The username rides along
  // as a support label so a human can match a Stripe customer to a manager.
  const acctId = requireAcctId(req, res);
  if (!acctId) return;
  const embedded = !!(req.body || {}).embedded;
  try {
    const origin = req.headers.origin || ('https://' + (req.headers.host || 'trademindff.com'));
    const common = {
      mode: 'subscription',
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      client_reference_id: acctId,
      metadata: { acct: acctId, username: user },
      subscription_data: { metadata: { acct: acctId, username: user } },
      allow_promotion_codes: true,
    };
    if (embedded) {
      const session = await stripe.checkout.sessions.create(Object.assign({}, common, {
        ui_mode: 'embedded',
        return_url: origin + '/sage?upgraded=1&session_id={CHECKOUT_SESSION_ID}',
      }));
      return res.json({ clientSecret: session.client_secret });
    }
    const session = await stripe.checkout.sessions.create(Object.assign({}, common, {
      success_url: origin + '/sage?upgraded=1',
      cancel_url: origin + '/sage',
    }));
    res.json({ url: session.url });
  } catch (e) {
    console.error('[billing] checkout:', e.message);
    res.status(500).json({ error: 'Could not start checkout. Try again in a moment.' });
  }
});

// POST /api/billing/webhook  (Stripe calls this; raw body verified via signature)
router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).end();
  const sig = req.headers['stripe-signature'];
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  // No signing secret means we cannot tell Stripe from a stranger, and a forged
  // `checkout.session.completed` would hand out a free Pro plan. Refuse to
  // process anything rather than trust an unsigned event.
  if (!whsec) {
    console.error('[billing] webhook rejected: STRIPE_WEBHOOK_SECRET is not set');
    return res.status(503).json({ error: 'webhook not configured' });
  }
  try {
    event = stripe.webhooks.constructEvent(req.rawBody || req.body, sig, whsec);
  } catch (err) {
    console.error('[billing] webhook signature:', err.message);
    return res.status(400).send('bad signature');
  }
  try {
    const e = await loadEnt();
    const apply = (acct, customer, status, extra) => {
      acct = String(acct || '');
      if (!acct && customer) acct = e.byCustomer[customer];
      if (!acct) return;
      e.byAcct[acct] = Object.assign({}, e.byAcct[acct], { status, customer, updated: Date.now() }, extra || {});
      if (customer) e.byCustomer[customer] = acct;
    };
    const o = (event.data && event.data.object) || {};
    const metaAcct = (o.metadata && o.metadata.acct) || null;
    if (event.type === 'checkout.session.completed') {
      apply(o.client_reference_id || metaAcct, o.customer, 'active', {
        sub: o.subscription,
        username: (o.metadata && o.metadata.username) || undefined,
      });
    } else if (event.type === 'customer.subscription.updated') {
      apply(metaAcct, o.customer, o.status, { sub: o.id, periodEnd: o.current_period_end });
    } else if (event.type === 'customer.subscription.deleted') {
      apply(metaAcct, o.customer, 'canceled', { sub: o.id });
    }
    await saveEnt(e);
  } catch (err) {
    console.error('[billing] webhook handle:', err.message);
  }
  res.json({ received: true });
});

// GET /api/billing/status?user=  -> { pro, configured }
router.get('/status', async (req, res) => {
  // Read-only and polled by the UI, so an anonymous caller gets "not pro"
  // rather than an error.
  res.set('Cache-Control', 'no-store');
  res.json({ pro: await isPro(readAcctId(req)), configured: !!process.env.STRIPE_SECRET_KEY });
});

// POST /api/billing/portal  { user } -> { url } (manage/cancel subscription)
router.post('/portal', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not turned on yet.' });
  const acctId = requireAcctId(req, res);
  if (!acctId) return;
  const e = await loadEnt();
  const rec = e.byAcct[acctId];
  if (!rec || !rec.customer) return res.status(404).json({ error: 'No subscription found for this account.' });
  try {
    const origin = req.headers.origin || ('https://' + (req.headers.host || ''));
    const session = await stripe.billingPortal.sessions.create({ customer: rec.customer, return_url: origin + '/analyze' });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── In-app subscription management (no Stripe redirect) ────────────────────
// GET /api/billing/subscription?user= -> plan details for the in-app Manage modal
router.get('/subscription', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'not configured' });
  const acctId = readAcctId(req);
  const e = await loadEnt();
  const rec = acctId ? e.byAcct[acctId] : null;
  if (!rec || !rec.sub) return res.json({ pro: false });
  try {
    const s = await stripe.subscriptions.retrieve(rec.sub);
    const item = s.items && s.items.data && s.items.data[0];
    const price = item && item.price;
    res.json({
      pro: s.status === 'active' || s.status === 'trialing',
      status: s.status,
      amount: price ? price.unit_amount / 100 : null,
      interval: price && price.recurring ? price.recurring.interval : 'month',
      periodEnd: s.current_period_end,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
    });
  } catch (err) { res.status(502).json({ error: err.message }); }
});
// POST /api/billing/cancel { user } -> cancel at period end (keeps Pro until then)
router.post('/cancel', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'not configured' });
  const acctId = requireAcctId(req, res);
  if (!acctId) return;
  const e = await loadEnt();
  const rec = e.byAcct[acctId];
  if (!rec || !rec.sub) return res.status(404).json({ error: 'No subscription found for this account.' });
  try {
    const s = await stripe.subscriptions.update(rec.sub, { cancel_at_period_end: true });
    res.json({ ok: true, cancelAtPeriodEnd: true, periodEnd: s.current_period_end });
  } catch (err) { res.status(502).json({ error: err.message }); }
});
// POST /api/billing/resume { user } -> undo a scheduled cancellation
router.post('/resume', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'not configured' });
  const acctId = requireAcctId(req, res);
  if (!acctId) return;
  const e = await loadEnt();
  const rec = e.byAcct[acctId];
  if (!rec || !rec.sub) return res.status(404).json({ error: 'No subscription found for this account.' });
  try {
    const s = await stripe.subscriptions.update(rec.sub, { cancel_at_period_end: false });
    res.json({ ok: true, cancelAtPeriodEnd: false, periodEnd: s.current_period_end });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

module.exports = router;
module.exports.isPro = isPro;
