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
//    purchase/cancel, so volume is tiny), cached in memory for 30s so a Mac
//    request doesn't hit blob every time.
//
//    Keyed by ACCOUNT ID (sha256 of the browser's account key), never by
//    username. A Sleeper username is public information, so keying on it let
//    anyone who knew your handle read your plan, open your Stripe billing
//    portal, or cancel the subscription you were paying for. The username is
//    still recorded alongside the record, but only as a support label.
// Vive en Postgres (macdraft.suscripciones), NO en Blob.
//
// Antes esto era entitlements/pro.json escrito con access:'public' y
// addRandomSuffix:false. Verificado el 6 de agosto de 2026: ese archivo
// respondia 200 a un GET sin ninguna credencial, en una ruta fija y
// adivinable. Lo unico que lo protegia era que nadie supiera el hostname del
// store. La lista de quien paga, con sus customer y subscription de Stripe,
// no puede depender de eso.
//
// La forma en memoria { byAcct, byUser, byCustomer } se conserva IGUAL, asi
// que los 12 puntos que la consultan siguen funcionando sin cambios. Lo unico
// que cambia es de donde sale y a donde va.
const TABLA = 'suscripciones';
const ESQUEMA = 'macdraft';
const datos = require('../lib/datos');
let _ent = null, _entTs = 0;

// Fila de Postgres -> la forma que el resto del archivo espera.
function aRegistro(f) {
  return {
    status: f.estado,
    customer: f.stripe_customer_id || undefined,
    sub: f.stripe_sub_id || undefined,
    username: f.username || undefined,
    updated: f.actualizado ? Date.parse(f.actualizado) : undefined,
  };
}

async function loadEnt() {
  if (_ent && Date.now() - _entTs < 30000) return _ent;

  const data = { byAcct: {}, byCustomer: {}, byUser: {} };
  try {
    const filas = await datos.seleccionar(TABLA, 'select=*', ESQUEMA);
    for (const f of filas || []) {
      const rec = aRegistro(f);
      data.byAcct[f.acct_id] = rec;
      if (f.stripe_customer_id) data.byCustomer[f.stripe_customer_id] = rec.username || f.acct_id;
    }
  } catch (err) {
    // Si la base no responde se sirve lo ultimo que se leyo, aunque este
    // vencido: es mejor que decirle a alguien que pago que no tiene Pro.
    console.error('[billing] loadEnt:', err.message);
    if (_ent) return _ent;
    return data;
  }

  // Indice por nombre, igual que antes: el plan sigue al manager a cualquier
  // dispositivo. Se deriva de byAcct, no se guarda aparte.
  for (const acct in data.byAcct) {
    const u = String((data.byAcct[acct] || {}).username || '').trim().toLowerCase();
    if (u && !data.byUser[u]) data.byUser[u] = acct;
  }

  _ent = data; _entTs = Date.now();
  return _ent;
}

async function saveEnt(e) {
  // La cache se actualiza primero: si la escritura falla, el proceso que acaba
  // de cobrar sigue viendo el estado correcto en vez de un valor viejo.
  _ent = e; _entTs = Date.now();

  const filas = Object.entries(e.byAcct || {}).map(([acct_id, r]) => ({
    acct_id,
    username: r.username ? String(r.username).trim().toLowerCase() : null,
    stripe_customer_id: r.customer || null,
    stripe_sub_id: r.sub || null,
    estado: r.status || 'inactiva',
    actualizado: new Date(r.updated || Date.now()).toISOString(),
  }));
  if (!filas.length) return;

  try {
    await datos.guardar(TABLA, filas, ESQUEMA, 'acct_id');
  } catch (err) {
    // Un fallo aca significa que un pago no quedo registrado. Se grita fuerte:
    // es el unico error de este archivo que cuesta plata.
    console.error('[billing] saveEnt FALLO, la suscripcion no se guardo:', err.message);
  }
}

// Who gets Pro, and why it is keyed on the Sleeper name.
//
// Access follows the MANAGER, not the browser. Keying it on the account key
// alone got both halves wrong: the buyer signing in on their phone was told
// they had no Pro, while anyone else using the buyer's computer inherited it
// just by sitting down. A manager expects their plan to follow their name onto
// every device, and to leave when someone else signs in.
//
// The account key stays the credential for MANAGING the plan - cancel, resume,
// billing portal, plan details - so knowing someone's public Sleeper name still
// buys you nothing there. The residual exposure is that a person who knows a
// subscriber's name could borrow their unlimited Mac; the per-day and
// per-month fair-use ceilings already cap what that can cost.
const _live = (rec) => !!(rec && (rec.status === 'active' || rec.status === 'trialing'));

// Finds the plan a caller is entitled to, and who owns it. Everything that
// answers "does this person have Pro" must go through here: when the lookup
// lived in two places they drifted apart, and a subscriber on their phone was
// told they were Pro by one endpoint and offered the upgrade by the other.
// Returns { rec, owner } where owner is the account key that bought it.
async function resolvePlan(e, acctId, username) {
  const u = String(username || '').trim().toLowerCase();
  if (u && e.byUser[u] && _live(e.byAcct[e.byUser[u]])) {
    return { rec: e.byAcct[e.byUser[u]], owner: e.byUser[u] };
  }
  const own = acctId ? e.byAcct[String(acctId)] : null;
  // The buying browser still counts while its record carries no name to match
  // on, and before sign-in there is no name to check at all.
  if (_live(own) && (!String(own.username || '').trim() || !u)) {
    return { rec: own, owner: String(acctId) };
  }
  return { rec: null, owner: null };
}

// isPro dice "existe un plan vivo para esta persona" y sirve para PINTAR estado.
// isPlanOwner dice "quien llama TIENE la llave que compro el plan", que es lo unico
// que puede autorizar gasto: un username de Sleeper es publico, asi que por si solo
// no puede abrir la puerta a las llamadas al modelo.
async function isPlanOwner(acctId, username) {
  try {
    if (!acctId) return false;
    const e = await loadEnt();
    const { rec, owner } = await resolvePlan(e, acctId, username);
    return _live(rec) && owner === String(acctId);
  } catch (_) { return false; }
}

async function isPro(acctId, username) {
  try {
    const e = await loadEnt();
    const { rec } = await resolvePlan(e, acctId, username);
    return _live(rec);
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

// One-time repair. A subscription bought before the name was recorded is
// stranded on the browser that paid: it cannot reach that manager's phone, and
// it follows whoever else signs in on that computer. The moment the buying
// browser tells us which name it belongs to, bind the two together.
//
// Only the holder of the account key can trigger this, and only onto a name
// nobody else has claimed, so it cannot be used to take over a plan.
async function bindNameIfUnclaimed(acctId, username) {
  const u = String(username || '').trim().toLowerCase();
  if (!acctId || !u) return;
  try {
    const e = await loadEnt();
    const rec = e.byAcct[String(acctId)];
    if (!_live(rec)) return;
    if (String(rec.username || '').trim()) return; // already named
    if (e.byUser[u]) return;                       // name belongs to someone else
    rec.username = u;
    e.byUser[u] = String(acctId);
    await saveEnt(e);
    console.log('[billing] bound orphaned subscription to a name');
  } catch (_) {}
}

// GET /api/billing/entitlements -> owner-only shape check. Never returns keys,
// customer ids or names; just enough to tell whether a plan is stranded.
router.get('/entitlements', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  const given = String(req.headers['x-admin-token'] || req.query.token || '');
  if (!token) return res.status(503).json({ error: 'admin token not configured' });
  const a = Buffer.from(given), b = Buffer.from(token);
  if (!(a.length === b.length && require('crypto').timingSafeEqual(a, b))) {
    return res.status(403).json({ error: 'not authorized' });
  }
  res.set('Cache-Control', 'no-store');
  try {
    const e = await loadEnt();
    res.json({
      total: Object.keys(e.byAcct).length,
      nombresEnlazados: Object.keys(e.byUser),
      registros: Object.keys(e.byAcct).map(k => ({
        status: e.byAcct[k].status,
        nombre: String(e.byAcct[k].username || '') || null,
        tieneCliente: !!e.byAcct[k].customer,
        tieneSub: !!e.byAcct[k].sub,
      })),
    });
  } catch (err) { res.status(502).json({ error: err.message }); }
});

// POST /api/billing/claim-name { user } -> owner-only repair.
// Makes one name the single owner of the live subscription and drops every
// other name pointing at it. Needed because the self-repair could bind more
// than once: several serverless instances, each with its own cached copy, can
// all believe the plan is still unnamed and each bind a different name.
router.post('/claim-name', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  const given = String(req.headers['x-admin-token'] || '');
  if (!token) return res.status(503).json({ error: 'admin token not configured' });
  const a = Buffer.from(given), b = Buffer.from(token);
  if (!(a.length === b.length && require('crypto').timingSafeEqual(a, b))) {
    return res.status(403).json({ error: 'not authorized' });
  }
  const u = String((req.body || {}).user || '').trim().toLowerCase().slice(0, 40);
  if (!u) return res.status(400).json({ error: 'user required' });
  try {
    const e = await loadEnt();
    const owner = Object.keys(e.byAcct).find(k => _live(e.byAcct[k]));
    if (!owner) return res.status(404).json({ error: 'no active subscription' });
    for (const name of Object.keys(e.byUser)) {
      if (e.byUser[name] === owner && name !== u) delete e.byUser[name];
    }
    e.byAcct[owner].username = u;
    e.byUser[u] = owner;
    await saveEnt(e);
    res.json({ ok: true, nombre: u, nombresEnlazados: Object.keys(e.byUser) });
  } catch (err) { res.status(502).json({ error: err.message }); }
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
      // Index the name so the plan reaches every device this manager signs in on.
      const uname = String(e.byAcct[acct].username || '').trim().toLowerCase();
      if (uname) e.byUser[uname] = acct;
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
  await bindNameIfUnclaimed(readAcctId(req), req.query.user);
  res.json({ pro: await isPro(readAcctId(req), req.query.user), configured: !!process.env.STRIPE_SECRET_KEY });
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
  const { rec, owner } = await resolvePlan(e, acctId, req.query.user);
  if (!rec || !rec.sub) return res.json({ pro: false, manageable: false });
  // Reading the plan works anywhere the manager signs in; CHANGING it stays
  // with the browser that bought it, which is the one holding the key.
  const manageable = !!acctId && owner === String(acctId);
  try {
    const s = await stripe.subscriptions.retrieve(rec.sub);
    const item = s.items && s.items.data && s.items.data[0];
    const price = item && item.price;
    res.json({
      pro: s.status === 'active' || s.status === 'trialing',
      manageable,
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
module.exports.isPlanOwner = isPlanOwner;
module.exports.bindNameIfUnclaimed = bindNameIfUnclaimed;
