'use strict';
const crypto = require('crypto');

// ── Account keys ───────────────────────────────────────────────────────────
// TradeMind has no passwords by design: you paste a Sleeper username and you
// are in. That means a username proves nothing - anyone can type yours. So a
// username can label things, but it must never authorize anything.
//
// Instead the browser mints one opaque random secret ("account key") and sends
// it on every /api call in the x-tm-acct header. Whoever holds the key is the
// account. The server stores only sha256(key), so a leak of the blob store
// never hands out working credentials.
//
// This is what stops a stranger who knows your Sleeper handle from reading your
// "anonymous" trades, cancelling your subscription, or stuffing a vote.

const HEADER = 'x-tm-acct';
// 24-128 chars of url-safe text. Wide enough for any client-side generator,
// narrow enough to reject junk before it reaches a hash or a blob key.
const SHAPE = /^[A-Za-z0-9_-]{24,128}$/;

/** Raw account key from the request, or '' when absent/malformed. */
function readAcct(req) {
  if (!req) return '';
  const raw = req.headers && req.headers[HEADER];
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  const candidate = String(
    fromHeader ||
    (req.body && req.body.acct) ||
    (req.query && req.query.acct) ||
    ''
  ).trim();
  return SHAPE.test(candidate) ? candidate : '';
}

/** Stable opaque id for storage. Never store the key itself. */
function acctId(acct) {
  if (!acct || !SHAPE.test(String(acct))) return '';
  return crypto.createHash('sha256').update(String(acct)).digest('hex').slice(0, 32);
}

/** Account id for this request, or '' if the caller sent no usable key. */
function readAcctId(req) {
  return acctId(readAcct(req));
}

/**
 * Guard for endpoints that act on someone's own data. Ends the response and
 * returns '' when the caller is anonymous, so handlers can early-return.
 */
function requireAcctId(req, res) {
  const id = readAcctId(req);
  if (!id) {
    res.status(401).json({ error: 'Reconnect your account to continue.' });
    return '';
  }
  return id;
}

// ── Cron authentication ────────────────────────────────────────────────────
// Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations
// once CRON_SECRET is set in the project. Until it is set we cannot tell a real
// cron from a stranger, so the endpoints stay open and say so loudly in the
// logs - failing closed here would silently stop the daily market snapshot,
// and that data cannot be backfilled from anywhere.
function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[cron] CRON_SECRET is not set - %s is reachable by anyone', req.originalUrl || req.url);
    return true;
  }
  const got = String((req.headers && req.headers.authorization) || '');
  const want = 'Bearer ' + secret;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Express guard: 401s unauthorized cron callers. Returns true when allowed. */
function allowCron(req, res) {
  if (isCronAuthorized(req)) return true;
  res.status(401).json({ error: 'unauthorized' });
  return false;
}

module.exports = { HEADER, readAcct, acctId, readAcctId, requireAcctId, isCronAuthorized, allowCron };
