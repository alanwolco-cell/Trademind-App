const express = require('express');
const router = express.Router();
const { put, list } = require('@vercel/blob');
const { readAcctId, requireAcctId } = require('../lib/identity');

// Community storage on Vercel Blob: one JSON document, read-modify-write.
// Fine at launch scale; swap for a real DB when traffic demands it.
const DOC_PATH = 'community/db.json';
let cache = null;
let cacheTs = 0;
const CACHE_MS = 1500; // short, so a just-posted trade shows up almost immediately

function emptyDb() {
  return { posts: [], opinions: {}, forum: [], replies: {}, users: {}, ranks: {},
    refBonus: {}, refClaimed: {}, refDevices: {}, refList: {} };
}

// Launch reset: trades published before this instant are hidden from every public
// view (the pre-launch test trades). New posts stamp created_at > now, so they
// pass. This "removes existing published trades" without a destructive wipe.
const POSTS_SINCE = 1784698977791; // 2026-07-22 launch reset

// Trades are published ANONYMOUSLY: the public feed never exposes who posted.
// We keep `username` in storage (so "My Trades" and ownership work) but strip it
// on the way out. Comments/opinions stay named on purpose.
function publicPost(p) {
  const o = Object.assign({}, p);
  delete o.username; delete o.voters; delete o.owner;
  o.anon = true;
  return o;
}

function configured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// Account ids are an internal join key. They cannot be replayed as credentials
// (the server only ever compares the hash of a key it was given), but shipping
// them would let a reader correlate the same account across the forum, the
// trade block and the anonymous feed. Strip them on the way out.
function stripOwner(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  const o = Object.assign({}, rec);
  delete o.owner;
  return o;
}
const stripOwners = (arr) => (Array.isArray(arr) ? arr.map(stripOwner) : arr);

// Names nobody should be able to squat on: the founder's handle and anything a
// reader would take as official. Without this, first-come-first-served would let
// a stranger grab "trademind" or "wolco" on launch day and post as the house.
// RESERVED_ACCT_ID is the account id allowed to use them; while it is unset the
// names are simply unavailable, which is the safe default.
const RESERVED_NAMES = new Set([
  'wolco', 'trademind', 'sage', 'admin', 'support', 'staff', 'official', 'moderator', 'mod', 'team',
]);
const RESERVED_ACCT_ID = process.env.RESERVED_ACCT_ID || '';

// ── Display-name binding ───────────────────────────────────────────────────
// Comments and forum posts carry a name on purpose - that is what keeps the
// community accountable. But the name arrived straight from the request body,
// so anyone could sign a comment with another manager's handle and put words
// in their mouth.
//
// First claim wins: the first account to post under a name owns it, and no
// other account may use it afterwards. Not as strong as real accounts, but it
// makes impersonating an established manager impossible instead of trivial.
// Returns an error string when the name is taken, or '' when the caller may use it.
// El nombre se guarda tal cual llega y despues se pinta en la UI, asi que el
// servidor no puede aceptar cualquier byte: una comilla en un username basta para
// romper un atributo on* del cliente. Handles de Sleeper reales son alfanumericos
// con guion bajo; punto y guion se admiten de sobra.
const NAME_SHAPE = /^[A-Za-z0-9_.-]{1,40}$/;
function badName(username) {
  return NAME_SHAPE.test(String(username || '').trim()) ? '' : 'That name has characters we cannot accept. Use letters, numbers, dot, dash or underscore.';
}

function claimName(db, acctId, username) {
  const name = String(username || '').trim().toLowerCase();
  if (!name) return 'A name is required.';
  const shapeErr = badName(username);
  if (shapeErr) return shapeErr;
  if (!acctId) return 'Reconnect your account to post.';
  if (RESERVED_NAMES.has(name) && acctId !== RESERVED_ACCT_ID) return 'That name is reserved.';
  db.nameOwners = db.nameOwners || {};
  const holder = db.nameOwners[name];
  if (!holder) { db.nameOwners[name] = acctId; return ''; }
  if (holder !== acctId) return 'That name is already in use by another manager.';
  return '';
}

async function readDb() {
  if (cache && Date.now() - cacheTs < CACHE_MS) return cache;
  try {
    const { blobs } = await list({ prefix: DOC_PATH, limit: 1 });
    if (!blobs.length) { cache = emptyDb(); cacheTs = Date.now(); return cache; }
    const r = await fetch(blobs[0].url + '?t=' + Date.now());
    cache = await r.json();
    cacheTs = Date.now();
    return cache;
  } catch (e) {
    console.error('[community] read:', e.message);
    return cache || emptyDb();
  }
}

async function writeDb(db) {
  cache = db; cacheTs = Date.now();
  await put(DOC_PATH, JSON.stringify(db), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

router.get('/status', (req, res) => res.json({ configured: configured() }));

// GET /api/community/whoami — the caller's own account id, derived from the key
// their own browser sent. Safe to expose: it reveals nothing about anyone else
// and the id cannot be replayed as a credential.
//
// Typing this URL into the address bar will always look anonymous: the account
// key rides in a header that only the app's fetch wrapper attaches, and a plain
// navigation does not go through it. Use the /whoami PAGE instead, which reads
// the key from localStorage and calls this with the header set.
router.get('/whoami', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const acct = readAcctId(req);
  res.json(acct
    ? { acct, note: 'Set this as RESERVED_ACCT_ID in Vercel to claim the reserved names.' }
    : { acct: null, note: 'No account key on this request. Open https://trademindff.com/whoami instead - a bare address-bar visit never carries the header.' });
});

// Kept for frontend compatibility; BK is cosmetic karma now
router.post('/user/init', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    const db = await readDb();
    if (!db.users[username]) { db.users[username] = { username, bk_balance: 250, total_earned: 0 }; await writeDb(db); }
    res.json(db.users[username]);
  } catch (e) { res.json({ username, bk_balance: 250, total_earned: 0, local: true }); }
});

router.get('/user/:username', async (req, res) => {
  const db = await readDb();
  res.json(db.users[req.params.username] || null);
});

router.post('/charge', (req, res) => res.json({ ok: true })); // analysis is free

router.get('/feed', async (req, res) => {
  const db = await readDb();
  const offset = parseInt(req.query.offset) || 0;
  const posts = db.posts.slice()
    .filter(p => (p.created_at || 0) >= POSTS_SINCE)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(offset, offset + 20)
    .map(publicPost);
  res.json(posts);
});

// GET /api/community/feed/mine — a manager's OWN published trades, so they can
// come back and read the votes/comments they collected.
//
// Ownership is matched on the caller's ACCOUNT ID, never on a username passed
// in the query. Sleeper usernames are public and enumerable, so the old
// ?username= form let anyone walk the list of handles and map every
// "anonymous" trade in the feed back to the manager who posted it - which
// defeats the whole point of publishing anonymously.
router.get('/feed/mine', async (req, res) => {
  const owner = readAcctId(req);
  if (!owner) return res.json([]);
  const db = await readDb();
  const offset = parseInt(req.query.offset) || 0;
  const mine = db.posts.slice()
    .filter(p => (p.created_at || 0) >= POSTS_SINCE && p.owner && p.owner === owner)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(offset, offset + 20)
    .map(p => Object.assign(publicPost(p), { mine: true }));
  res.json(mine);
});

router.post('/post', async (req, res) => {
  try {
    const { username, give_side, get_side, verdict, ktc_gap, headline, league_type, team_name, context, description, league_settings, rosters } = req.body || {};
    if (!username || !give_side || !get_side) return res.status(400).json({ error: 'missing fields' });
    const nameShapeErr = badName(username);
    if (nameShapeErr) return res.status(400).json({ error: nameShapeErr });
    if (!configured()) return res.status(503).json({ error: 'storage not configured' });
    // How the trade came about, so readers know what opinion you're after.
    const ctx = ['incoming', 'outgoing', 'processed'].includes(context) ? context : 'outgoing';
    const db = await readDb();
    const post = {
      id: uid(), username: String(username).slice(0, 40), owner: readAcctId(req), give_side, get_side,
      verdict: verdict || 'unknown', ktc_gap: ktc_gap || 0,
      headline: headline || '', league_type: league_type || 'dynasty',
      team_name: team_name || '', context: ctx, anon: true,
      description: (description || '').toString().slice(0, 280),
      league_settings: (league_settings && typeof league_settings === 'object') ? league_settings : null,
      rosters: (rosters && typeof rosters === 'object') ? {
        mine: Array.isArray(rosters.mine) ? rosters.mine.slice(0, 30) : [],
        theirs: Array.isArray(rosters.theirs) ? rosters.theirs.slice(0, 30) : [],
      } : null,
      upvotes: 0, downvotes: 0,
      created_at: Date.now(),
    };
    db.posts.unshift(post);
    if (db.posts.length > 500) db.posts.length = 500;
    await writeDb(db);
    res.json({ post });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// One vote per user, switchable: voting the other way moves your vote across.
function applySwitchableVote(post, username, vote) {
  if (!post.voters) post.voters = {};
  const prev = username ? post.voters[username] : null;
  if (prev === vote) return false; // same vote twice = no change
  if (prev === 1) post.upvotes = Math.max(0, (post.upvotes || 0) - 1);
  if (prev === -1) post.downvotes = Math.max(0, (post.downvotes || 0) - 1);
  if (vote === 1) post.upvotes = (post.upvotes || 0) + 1;
  else post.downvotes = (post.downvotes || 0) + 1;
  if (username) post.voters[username] = vote;
  return true;
}

router.post('/vote/:postId', async (req, res) => {
  try {
    const { vote } = req.body || {};
    // One vote per ACCOUNT. Keying on a client-supplied username meant a single
    // person could stuff the ballot by sending a different name each time.
    const voter = requireAcctId(req, res);
    if (!voter) return;
    const db = await readDb();
    const post = db.posts.find(p => p.id === req.params.postId);
    if (!post) return res.status(404).json({ error: 'not found' });
    const changed = applySwitchableVote(post, voter, vote === 1 ? 1 : -1);
    if (changed) await writeDb(db);
    res.json({ upvotes: post.upvotes || 0, downvotes: post.downvotes || 0, your_vote: vote === 1 ? 1 : -1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/opinions/:postId', async (req, res) => {
  const db = await readDb();
  res.json(stripOwners(db.opinions[req.params.postId] || []));
});

router.post('/opinions', async (req, res) => {
  try {
    const { post_id, username, text } = req.body || {};
    if (!post_id || !username || !text) return res.status(400).json({ error: 'missing fields' });
    const acct = requireAcctId(req, res);
    if (!acct) return;
    const db = await readDb();
    const nameErr = claimName(db, acct, username);
    if (nameErr) return res.status(403).json({ error: nameErr });
    if (!db.opinions[post_id]) db.opinions[post_id] = [];
    const op = { id: uid(), post_id, username, owner: acct, text: String(text).slice(0, 500), like_count: 0, created_at: Date.now() };
    db.opinions[post_id].push(op);
    await writeDb(db);
    res.json({ opinion: op });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/opinion-like/:opinionId', async (req, res) => {
  try {
    // Un like es un voto: se cuenta por CUENTA, una sola vez. Antes era anonimo y
    // repetible, asi que un bucle inflaba el contador y el karma del autor.
    const liker = requireAcctId(req, res);
    if (!liker) return;
    const db = await readDb();
    let found = null;
    Object.values(db.opinions).forEach(arr => arr.forEach(o => { if (o.id === req.params.opinionId) found = o; }));
    if (!found) return res.status(404).json({ error: 'not found' });
    found.likers = found.likers || {};
    if (found.likers[liker]) return res.json({ new_like_count: found.like_count || 0 });
    found.likers[liker] = 1;
    found.like_count = (found.like_count || 0) + 1;
    if (db.users[found.username]) db.users[found.username].bk_balance += 5;
    await writeDb(db);
    res.json({ new_like_count: found.like_count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/forum', async (req, res) => {
  const db = await readDb();
  const offset = parseInt(req.query.offset) || 0;
  res.json(stripOwners(db.forum.slice().sort((a, b) => b.created_at - a.created_at).slice(offset, offset + 20)));
});

router.post('/forum/post', async (req, res) => {
  try {
    const { username, text } = req.body || {};
    if (!username || !text) return res.status(400).json({ error: 'missing fields' });
    const acct = requireAcctId(req, res);
    if (!acct) return;
    const db = await readDb();
    const nameErr = claimName(db, acct, username);
    if (nameErr) return res.status(403).json({ error: nameErr });
    const post = { id: uid(), username, owner: acct, text: String(text).slice(0, 500), upvotes: 0, downvotes: 0, created_at: Date.now() };
    db.forum.unshift(post);
    if (db.forum.length > 500) db.forum.length = 500;
    await writeDb(db);
    res.json({ post });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/forum/vote/:postId', async (req, res) => {
  try {
    const { vote } = req.body || {};
    const voter = requireAcctId(req, res);
    if (!voter) return;
    const db = await readDb();
    const post = db.forum.find(p => p.id === req.params.postId);
    if (!post) return res.status(404).json({ error: 'not found' });
    const changed = applySwitchableVote(post, voter, vote === 1 ? 1 : -1);
    if (changed) await writeDb(db);
    res.json({ upvotes: post.upvotes || 0, downvotes: post.downvotes || 0, your_vote: vote === 1 ? 1 : -1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/forum/replies/:postId', async (req, res) => {
  const db = await readDb();
  res.json(stripOwners(db.replies[req.params.postId] || []));
});

router.post('/forum/reply', async (req, res) => {
  try {
    const { post_id, username, text } = req.body || {};
    if (!post_id || !username || !text) return res.status(400).json({ error: 'missing fields' });
    const acct = requireAcctId(req, res);
    if (!acct) return;
    const db = await readDb();
    const nameErr = claimName(db, acct, username);
    if (nameErr) return res.status(403).json({ error: nameErr });
    if (!db.replies[post_id]) db.replies[post_id] = [];
    const reply = { id: uid(), post_id, username, owner: acct, text: String(text).slice(0, 500), created_at: Date.now() };
    db.replies[post_id].push(reply);
    await writeDb(db);
    res.json({ reply });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── COMMUNITY CONSENSUS RANKINGS (head-to-head Elo voting) ──────────────────
// Dynasty and redraft are separate boards: redraft entries live under an 'r_'
// key prefix in the same ranks map (legacy un-prefixed keys = dynasty).
const rankKey = (id, mode) => (mode === 'redraft' ? 'r_' : '') + id;

// Seed a mode's board from FantasyCalc market values so the crowd starts from a
// strong consensus base instead of an empty page; user votes drift it from there.
async function seedRanks(db, mode) {
  const fetch = require('node-fetch');
  const r = await fetch('https://api.fantasycalc.com/values/current?isDynasty=' + (mode === 'redraft' ? 'false' : 'true') + '&numQbs=1&ppr=1', {
    headers: { 'User-Agent': 'Mac Draft/1.0', 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error('FantasyCalc ' + r.status);
  const players = await r.json();
  const top = players.filter(p => p.player && p.player.sleeperId).sort((a, b) => b.value - a.value).slice(0, 40);
  if (!top.length) return false;
  const maxV = top[0].value, minV = top[top.length - 1].value, range = (maxV - minV) || 1;
  top.forEach(p => {
    const k = rankKey(String(p.player.sleeperId), mode);
    if (db.ranks[k]) return; // never overwrite real votes
    db.ranks[k] = {
      id: String(p.player.sleeperId), name: p.player.name,
      elo: Math.round(1450 + ((p.value - minV) / range) * 260),
      votes: 1, seeded: true
    };
  });
  return true;
}

// POST /api/community/rank  { winner, loser, winnerName, loserName, mode }
router.post('/rank', async (req, res) => {
  try {
    const { winner, loser, winnerName, loserName, mode } = req.body || {};
    if (!winner || !loser) return res.status(400).json({ error: 'missing ids' });
    const db = await readDb();
    if (!db.ranks) db.ranks = {};
    const get = (id, nm) => {
      const k = rankKey(id, mode);
      return db.ranks[k] || (db.ranks[k] = { id, name: nm || id, elo: 1500, votes: 0 });
    };
    const w = get(winner, winnerName), l = get(loser, loserName);
    if (winnerName) w.name = winnerName;
    if (loserName) l.name = loserName;
    const K = 24;
    const ew = 1 / (1 + Math.pow(10, (l.elo - w.elo) / 400));
    w.elo += K * (1 - ew); l.elo += K * (0 - (1 - ew));
    w.votes++; l.votes++;
    delete w.seeded; delete l.seeded; // a real vote makes the entry the crowd's
    await writeDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/community/rankings?mode=dynasty|redraft  -> consensus list sorted by elo
router.get('/rankings', async (req, res) => {
  try {
    const mode = req.query.mode === 'redraft' ? 'redraft' : 'dynasty';
    const db = await readDb();
    if (!db.ranks) db.ranks = {};
    const inMode = k => (mode === 'redraft' ? k.startsWith('r_') : !k.startsWith('r_'));
    let entries = Object.keys(db.ranks).filter(inMode).map(k => db.ranks[k]);
    if (entries.length < 10) {
      // Serve the seeded board even if the Blob write fails (e.g. local dev without a token)
      try {
        if (await seedRanks(db, mode)) {
          entries = Object.keys(db.ranks).filter(inMode).map(k => db.ranks[k]);
          try { await writeDb(db); } catch (_) {}
        }
      } catch (_) {}
    }
    const list = entries
      .filter(r => r.votes >= 1)
      .sort((a, b) => b.elo - a.elo)
      .map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, elo: Math.round(r.elo), votes: r.votes, seeded: !!r.seeded }));
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ rankings: list, mode });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TRADE BLOCK: the public marketplace board ────────────────────────────────
// Managers list players they're SHOPPING (open to moving) or WANTED (hunting).
// GET /api/community/block — newest first
router.get('/block', async (req, res) => {
  try {
    const db = await readDb();
    const list = stripOwners((db.block || []).slice().sort((a, b) => b.created_at - a.created_at).slice(0, 120));
    res.set('Cache-Control', 'public, max-age=20');
    res.json({ listings: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/community/block  { username, type: 'shopping'|'wanted', player_id, player_name, pos, team, note, league_type }
router.post('/block', async (req, res) => {
  try {
    const { username, type, player_id, player_name, pos, team, note, league_type } = req.body || {};
    if (!username || !player_name || !['shopping', 'wanted'].includes(type)) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const acct = requireAcctId(req, res);
    if (!acct) return;
    const db = await readDb();
    const nameErr = claimName(db, acct, username);
    if (nameErr) return res.status(403).json({ error: nameErr });
    if (!db.block) db.block = [];
    // One live listing per account+player+type; re-listing bumps it to the top
    db.block = db.block.filter(l => !(l.owner === acct && l.player_name === player_name && l.type === type));
    const listing = {
      id: uid(), username: String(username).slice(0, 40), owner: acct, type,
      player_id: player_id ? String(player_id) : null,
      player_name: String(player_name).slice(0, 60),
      pos: String(pos || '').slice(0, 4), team: String(team || '').slice(0, 4),
      note: String(note || '').slice(0, 180),
      league_type: league_type === 'redraft' ? 'redraft' : 'dynasty',
      created_at: Date.now()
    };
    db.block.unshift(listing);
    if (db.block.length > 400) db.block = db.block.slice(0, 400);
    await writeDb(db);
    res.json({ ok: true, listing });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/community/block/:id — owner takes their own listing down.
// Matched on account id: the old ?username= form let anyone delete anyone's
// listings just by naming them.
router.delete('/block/:id', async (req, res) => {
  try {
    const acct = requireAcctId(req, res);
    if (!acct) return;
    const db = await readDb();
    const before = (db.block || []).length;
    db.block = (db.block || []).filter(l => !(l.id === req.params.id && l.owner === acct));
    if (db.block.length !== before) await writeDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PRIVATE FEEDBACK: anyone can send it, only the founder can read it ───────
const ADMIN_USER = 'wolco';
router.post('/feedback', async (req, res) => {
  try {
    const { username, text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'empty' });
    if (username && badName(username)) return res.status(400).json({ error: badName(username) });
    if (!configured()) return res.status(503).json({ error: 'storage not configured' });
    const db = await readDb();
    if (!db.feedback) db.feedback = [];
    db.feedback.unshift({
      id: uid(), from: (username || 'anonymous').toString().slice(0, 40),
      text: String(text).slice(0, 1200), created_at: Date.now(),
    });
    if (db.feedback.length > 1000) db.feedback.length = 1000;
    await writeDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Admin inbox. A Sleeper username is public information, so it cannot be the
// key to an admin surface - anyone who knew the founder's handle could read
// every message users had sent. Gated on ADMIN_TOKEN instead; with no token
// configured the inbox stays shut rather than falling back to the old check.
router.get('/feedback', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  const given = String(req.headers['x-admin-token'] || req.query.token || '');
  if (!token) return res.status(503).json({ error: 'admin inbox not configured' });
  const a = Buffer.from(given), b = Buffer.from(token);
  const ok = a.length === b.length && require('crypto').timingSafeEqual(a, b);
  if (!ok) return res.status(403).json({ error: 'not authorized' });
  const db = await readDb();
  res.json(db.feedback || []);
});

// ── TRADE INDEX: market comps from real Mac Draft trades ────────────────────
// GET /api/community/trade-index — most-traded players in the last 30 days
router.get('/trade-index', async (req, res) => {
  try {
    const db = await readDb();
    const cutoff = Date.now() - 30 * 86400000;
    const counts = {};
    (db.posts || []).filter(p => (p.created_at || 0) >= cutoff).forEach(p => {
      [...(p.give_side || []), ...(p.get_side || [])].forEach(a => {
        const name = (a && (a.name || a)) + '';
        if (!name || /round|pick/i.test(name)) return;
        const key = name.toLowerCase();
        if (!counts[key]) counts[key] = { name, count: 0, sleeper_id: a.sleeper_id || null };
        counts[key].count++;
      });
    });
    const list = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 15);
    res.set('Cache-Control', 'public, max-age=120');
    res.json({ window_days: 30, players: list, total_trades: (db.posts || []).filter(p => (p.created_at || 0) >= cutoff).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/community/player-trades?name=  — community deals involving a player (comps)
router.get('/player-trades', async (req, res) => {
  try {
    const q = String(req.query.name || '').toLowerCase().trim();
    if (!q) return res.status(400).json({ error: 'missing name' });
    const db = await readDb();
    const hit = (side) => (side || []).some(a => ((a && (a.name || a)) + '').toLowerCase() === q);
    const deals = (db.posts || [])
      .filter(p => (p.created_at || 0) >= POSTS_SINCE && (hit(p.give_side) || hit(p.get_side)))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 8)
      .map(p => ({
        id: p.id, created_at: p.created_at, league_type: p.league_type,
        give_side: p.give_side, get_side: p.get_side, verdict: p.verdict, context: p.context || 'outgoing'
      }));
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ deals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── REFERRALS: earn a bonus Mac question per friend who joins via your link ──
// Un-abusable by design: the reward only fires when the referred person connects a
// REAL Sleeper league (hard to fake) for the first time; one claim per device kills
// self-referral and multi-accounting; self-referral is blocked outright; and each
// referrer is hard-capped. Two-sided: the joiner also gets a welcome bonus.
const MAX_REFERRALS = 10;
// Questions each side gains on the day a referral lands. Both sides get the
// same: the person sharing has to feel paid for the favour, and the person
// arriving needs room to actually try Mac before deciding. Expires that day.
const REFERRAL_BONUS = 2;
router.post('/referral/claim', async (req, res) => {
  try {
    let { referrer, newUser, device } = req.body || {};
    referrer = String(referrer || '').trim().toLowerCase().slice(0, 40);
    newUser = String(newUser || '').trim().toLowerCase().slice(0, 40);
    device = String(device || '').slice(0, 64);
    if (!referrer || !newUser || !device) return res.status(400).json({ error: 'missing fields' });
    if (referrer === newUser) return res.json({ ok: false, reason: 'self' });
    if (!configured()) return res.status(503).json({ error: 'storage not configured' });
    // Every bonus here is a free Claude call, so this endpoint spends real money.
    // The device check alone was client-supplied and trivially rotated; pin the
    // claim to the account key as well, one claim per account, forever.
    const acct = requireAcctId(req, res);
    if (!acct) return;
    const db = await readDb();
    db.refBonus = db.refBonus || {}; db.refClaimed = db.refClaimed || {};
    db.refDevices = db.refDevices || {}; db.refList = db.refList || {};
    db.refAccts = db.refAccts || {};
    if (db.refClaimed[newUser]) return res.json({ ok: false, reason: 'already' });
    if (db.refDevices[device]) return res.json({ ok: false, reason: 'device' });
    if (db.refAccts[acct]) return res.json({ ok: false, reason: 'device' });
    db.refAccts[acct] = 1;
    db.refClaimed[newUser] = referrer;
    db.refDevices[device] = 1;
    grantReferralBonus(db, newUser, REFERRAL_BONUS); // welcome boost for the joiner, today only
    let credited = false;
    if ((db.refList[referrer] || []).length < MAX_REFERRALS) {
      grantReferralBonus(db, referrer, REFERRAL_BONUS);
      credited = true;
    }
    db.refList[referrer] = (db.refList[referrer] || []).concat(newUser);
    await writeDb(db);
    res.json({ ok: true, referrerCredited: credited });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/referral/status', async (req, res) => {
  const user = String(req.query.username || req.query.user || '').trim().toLowerCase().slice(0, 40);
  if (!user) return res.json({ bonus: 0, referred: 0, cap: MAX_REFERRALS });
  const db = await readDb();
  res.json({ bonus: (db.refBonus || {})[user] || 0, referred: ((db.refList || {})[user] || []).length, cap: MAX_REFERRALS });
});
// Read-only helper for sage.js to extend a user's free weekly Mac allowance.
// UTC day number, the same bucket sage.js counts usage in.
const _dayNum = () => Math.floor(Date.now() / 86400000);

// The referral bonus is a SAME-DAY boost, not a permanent raise. It gives both
// sides room to actually use Mac on the day the referral lands and then
// expires, so a handful of invites can never turn into a free unlimited plan.
function grantReferralBonus(db, user, n) {
  db.refBonus = db.refBonus || {};
  const key = String(user || '').toLowerCase();
  const day = _dayNum();
  const cur = db.refBonus[key];
  const today = (cur && typeof cur === 'object' && cur.day === day) ? (cur.n || 0) : 0;
  db.refBonus[key] = { day, n: today + n };
}

async function getReferralBonus(user) {
  try {
    const db = await readDb();
    const rec = (db.refBonus || {})[String(user || '').toLowerCase()];
    // Plain numbers are the old permanent form; they no longer grant anything.
    if (!rec || typeof rec !== 'object') return 0;
    return rec.day === _dayNum() ? (rec.n || 0) : 0;
  } catch (_) { return 0; }
}
router.getReferralBonus = getReferralBonus;

module.exports = router;
