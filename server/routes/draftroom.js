// Public multiplayer mock drafts. Rooms are JSON docs on Vercel Blob; turns
// serialize the writes (only the on-clock client submits), so Blob's
// read-modify-write model holds up at mock-draft scale.
const express = require('express');
const router = express.Router();
const { put, list, del } = require('@vercel/blob');

const ROOM_PREFIX = 'rooms/';
const roomCache = {}; // code -> {ts, doc}

function code4() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}
function snakeOrder(teams, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r++) {
    for (let s = 0; s < teams; s++) order.push(r % 2 === 0 ? s : teams - 1 - s);
  }
  return order;
}
// Vercel Blob enforces a ~60s minimum CDN cache on overwritten paths - deadly
// for a live draft. So every update is a NEW versioned blob (unique URL, never
// cached stale) and reads resolve the highest version. Old versions are deleted
// best-effort after each write.
async function readRoom(code) {
  const c = roomCache[code];
  if (c && Date.now() - c.ts < 1000) return c.doc;
  const { blobs } = await list({ prefix: ROOM_PREFIX + code + '-', limit: 100 });
  if (!blobs.length) return null;
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1)); // vNNN descending
  const r = await fetch(blobs[0].url);
  const doc = await r.json();
  if (!c || (doc.v || 0) >= (c.doc.v || 0)) {
    roomCache[code] = { ts: Date.now(), doc };
    return doc;
  }
  return c.doc; // never step backwards if CDN handed us an older version
}
async function writeRoom(doc) {
  doc.v = (doc.v || 0) + 1;
  roomCache[doc.code] = { ts: Date.now(), doc };
  const pathname = ROOM_PREFIX + doc.code + '-' + String(doc.v).padStart(6, '0') + '.json';
  await put(pathname, JSON.stringify(doc), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
  // prune older versions so rooms don't accumulate blobs
  try {
    const { blobs } = await list({ prefix: ROOM_PREFIX + doc.code + '-', limit: 100 });
    const stale = blobs.filter(b => b.pathname !== pathname);
    if (stale.length) await del(stale.map(b => b.url));
  } catch (_) {}
}
function autoPickIfNeeded(doc) {
  // Unclaimed seats draft best-available instantly, so humans never wait on bots
  let n = 0;
  while (doc.status === 'drafting' && doc.pickIdx < doc.order.length && n < 40) {
    const seat = doc.order[doc.pickIdx];
    if (doc.seats[seat] && doc.seats[seat].claimed) break;
    const p = doc.pool[0];
    if (!p) break;
    doc.pool.shift();
    doc.picks.push({ seat, id: p.id, name: p.name, pos: p.pos, team: p.team, auto: true });
    doc.pickIdx++; n++;
  }
  if (doc.pickIdx >= doc.order.length) doc.status = 'done';
  else if (doc.status === 'drafting') doc.deadline = Date.now() + (doc.clock || 60) * 1000;
}
// Pick clock: if the human on the clock ran out of time, the room drafts
// best-available for them and the draft keeps moving. Returns true if the doc
// changed (caller must write it).
function enforceClock(doc) {
  let changed = false;
  let n = 0;
  while (doc.status === 'drafting' && doc.deadline && Date.now() > doc.deadline && n < 40) {
    const seat = doc.order[doc.pickIdx];
    const p = doc.pool[0];
    if (!p) break;
    doc.pool.shift();
    doc.picks.push({ seat, id: p.id, name: p.name, pos: p.pos, team: p.team, auto: true, timedOut: true });
    doc.pickIdx++; n++; changed = true;
    if (doc.pickIdx >= doc.order.length) { doc.status = 'done'; break; }
    doc.deadline = Date.now() + (doc.clock || 60) * 1000;
    autoPickIfNeeded(doc);
  }
  return changed;
}

router.post('/create', async (req, res) => {
  try {
    const b = req.body || {};
    const teams = Math.min(14, Math.max(4, parseInt(b.teams) || 10));
    const rounds = Math.min(16, Math.max(3, parseInt(b.rounds) || 8));
    const pool = Array.isArray(b.pool) ? b.pool.slice(0, 260) : [];
    if (pool.length < teams * rounds) return res.status(400).json({ error: 'pool too small' });
    const doc = {
      code: code4(), created: Date.now(), status: 'lobby', teams, rounds,
      clock: Math.min(300, Math.max(10, parseInt(b.clock) || 60)),
      seats: Array.from({ length: teams }, (_, i) => ({ name: i === 0 ? (String(b.name || 'Host').slice(0, 24)) : null, claimed: i === 0, cid: i === 0 ? (String(b.cid || '').slice(0, 40) || null) : null })),
      order: snakeOrder(teams, rounds), pickIdx: 0, picks: [], pool,
    };
    await writeRoom(doc);
    res.json({ code: doc.code, seat: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:code/join', async (req, res) => {
  try {
    const doc = await readRoom(String(req.params.code).toUpperCase());
    if (!doc) return res.status(404).json({ error: 'room not found' });
    const cid = String((req.body || {}).cid || '').slice(0, 40);
    // one seat per person: same device rejoining gets its existing seat back
    if (cid) {
      const mine = doc.seats.findIndex(s => s.claimed && s.cid === cid);
      if (mine >= 0) return res.json({ code: doc.code, seat: mine, rejoined: true });
    }
    if (doc.status !== 'lobby') return res.status(400).json({ error: 'draft already started' });
    const seat = doc.seats.findIndex(s => !s.claimed);
    if (seat < 0) return res.status(400).json({ error: 'room full' });
    doc.seats[seat] = { name: String((req.body || {}).name || 'Manager').slice(0, 24), claimed: true, cid: cid || null };
    await writeRoom(doc);
    res.json({ code: doc.code, seat });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:code/start', async (req, res) => {
  try {
    const doc = await readRoom(String(req.params.code).toUpperCase());
    if (!doc) return res.status(404).json({ error: 'room not found' });
    if (doc.status !== 'lobby') return res.status(400).json({ error: 'already started' });
    doc.status = 'drafting';
    autoPickIfNeeded(doc);
    await writeRoom(doc);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Host-only pause: the clock freezes with its remaining time and nobody can
// pick until the host resumes.
router.post('/:code/pause', async (req, res) => {
  try {
    const doc = await readRoom(String(req.params.code).toUpperCase());
    if (!doc) return res.status(404).json({ error: 'room not found' });
    if (parseInt((req.body || {}).seat) !== 0) return res.status(403).json({ error: 'only the host can pause' });
    if (doc.status !== 'drafting') return res.status(400).json({ error: 'not drafting' });
    enforceClock(doc);
    if (doc.status === 'drafting') {
      doc.status = 'paused';
      doc.pausedLeft = Math.max(3000, (doc.deadline || Date.now()) - Date.now());
      doc.deadline = 0;
    }
    await writeRoom(doc);
    res.json({ ok: true, status: doc.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/:code/resume', async (req, res) => {
  try {
    const doc = await readRoom(String(req.params.code).toUpperCase());
    if (!doc) return res.status(404).json({ error: 'room not found' });
    if (parseInt((req.body || {}).seat) !== 0) return res.status(403).json({ error: 'only the host can resume' });
    if (doc.status !== 'paused') return res.status(400).json({ error: 'not paused' });
    doc.status = 'drafting';
    doc.deadline = Date.now() + (doc.pausedLeft || (doc.clock || 60) * 1000);
    delete doc.pausedLeft;
    await writeRoom(doc);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:code/pick', async (req, res) => {
  try {
    const doc = await readRoom(String(req.params.code).toUpperCase());
    if (!doc) return res.status(404).json({ error: 'room not found' });
    if (doc.status !== 'drafting') return res.status(400).json({ error: 'not drafting' });
    enforceClock(doc);
    const seat = parseInt((req.body || {}).seat);
    const pid = String((req.body || {}).playerId || '');
    if (doc.status !== 'drafting' || doc.order[doc.pickIdx] !== seat) { await writeRoom(doc); return res.status(409).json({ error: 'not your turn' }); }
    const i = doc.pool.findIndex(p => p.id === pid);
    if (i < 0) return res.status(400).json({ error: 'player not available' });
    const p = doc.pool.splice(i, 1)[0];
    doc.picks.push({ seat, id: p.id, name: p.name, pos: p.pos, team: p.team });
    doc.pickIdx++;
    autoPickIfNeeded(doc);
    await writeRoom(doc);
    res.json({ ok: true, pickIdx: doc.pickIdx, status: doc.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:code', async (req, res) => {
  try {
    const doc = await readRoom(String(req.params.code).toUpperCase());
    if (!doc) return res.status(404).json({ error: 'room not found' });
    if (enforceClock(doc)) await writeRoom(doc);
    res.set('Cache-Control', 'no-store');
    // trim the payload: clients only need the top of the pool
    const out = Object.assign({}, doc, { pool: doc.pool.slice(0, 40), poolLeft: doc.pool.length });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
