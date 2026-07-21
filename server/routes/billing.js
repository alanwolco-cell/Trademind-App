const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

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
//    request doesn't hit blob every time. Keyed by lowercased Sleeper username
//    (the app's identity today) with a customer-id index for subscription events.
const ENT_PATH = 'entitlements/pro.json';
let _ent = null, _entTs = 0;

async function loadEnt() {
  if (_ent && Date.now() - _entTs < 30000) return _ent;
  let data = { byUser: {}, byCustomer: {} };
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: ENT_PATH, limit: 1 });
    if (blobs.length) {
      const j = await (await fetch(blobs[0].url + '?t=' + Date.now())).json();
      if (j && typeof j === 'object') data = j;
    }
  } catch (_) { if (_ent) return _ent; }
  data.byUser = data.byUser || {};
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

async function isPro(user) {
  if (!user) return false;
  try {
    const e = await loadEnt();
    const rec = e.byUser[String(user).toLowerCase()];
    return !!(rec && (rec.status === 'active' || rec.status === 'trialing'));
  } catch (_) { return false; }
}

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
  const embedded = !!(req.body || {}).embedded;
  try {
    const origin = req.headers.origin || ('https://' + (req.headers.host || 'trademind-starter.vercel.app'));
    if (embedded) {
      const session = await stripe.checkout.sessions.create({
        ui_mode: 'embedded',
        mode: 'subscription',
        line_items: [{ price: PRICE_ID, quantity: 1 }],
        client_reference_id: user,
        allow_promotion_codes: true,
        return_url: origin + '/sage?upgraded=1&session_id={CHECKOUT_SESSION_ID}',
      });
      return res.json({ clientSecret: session.client_secret });
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      client_reference_id: user,
      allow_promotion_codes: true,
      success_url: origin + '/sage?upgraded=1',
      cancel_url: origin + '/sage',
    });
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
  try {
    if (whsec) {
      event = stripe.webhooks.constructEvent(req.rawBody || req.body, sig, whsec);
    } else {
      // No signing secret set yet: accept unverified so the flow can be tested.
      // SET STRIPE_WEBHOOK_SECRET in production to reject forged events.
      event = (req.body && req.body.type) ? req.body : JSON.parse((req.rawBody || Buffer.from('{}')).toString());
      console.warn('[billing] webhook UNVERIFIED - set STRIPE_WEBHOOK_SECRET');
    }
  } catch (err) {
    console.error('[billing] webhook signature:', err.message);
    return res.status(400).send('bad signature');
  }
  try {
    const e = await loadEnt();
    const apply = (user, customer, status, extra) => {
      user = String(user || '').toLowerCase();
      if (!user && customer) user = e.byCustomer[customer];
      if (!user) return;
      e.byUser[user] = Object.assign({}, e.byUser[user], { status, customer, updated: Date.now() }, extra || {});
      if (customer) e.byCustomer[customer] = user;
    };
    const o = (event.data && event.data.object) || {};
    if (event.type === 'checkout.session.completed') {
      apply(o.client_reference_id, o.customer, 'active', { sub: o.subscription });
    } else if (event.type === 'customer.subscription.updated') {
      apply(null, o.customer, o.status, { sub: o.id, periodEnd: o.current_period_end });
    } else if (event.type === 'customer.subscription.deleted') {
      apply(null, o.customer, 'canceled', { sub: o.id });
    }
    await saveEnt(e);
  } catch (err) {
    console.error('[billing] webhook handle:', err.message);
  }
  res.json({ received: true });
});

// GET /api/billing/status?user=  -> { pro, configured }
router.get('/status', async (req, res) => {
  const user = String(req.query.user || '').trim().toLowerCase().slice(0, 40);
  res.set('Cache-Control', 'no-store');
  res.json({ pro: await isPro(user), configured: !!process.env.STRIPE_SECRET_KEY });
});

// POST /api/billing/portal  { user } -> { url } (manage/cancel subscription)
router.post('/portal', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not turned on yet.' });
  const user = String((req.body || {}).user || '').trim().toLowerCase().slice(0, 40);
  const e = await loadEnt();
  const rec = e.byUser[user];
  if (!rec || !rec.customer) return res.status(404).json({ error: 'No subscription found for this account.' });
  try {
    const origin = req.headers.origin || ('https://' + (req.headers.host || ''));
    const session = await stripe.billingPortal.sessions.create({ customer: rec.customer, return_url: origin + '/analyze' });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.isPro = isPro;
