const express = require('express');
const router = express.Router();
const { put, list } = require('@vercel/blob');

// Community storage on Vercel Blob: one JSON document, read-modify-write.
// Fine at launch scale; swap for a real DB when traffic demands it.
const DOC_PATH = 'community/db.json';
let cache = null;
let cacheTs = 0;
const CACHE_MS = 5000;

function emptyDb() {
  return { posts: [], opinions: {}, forum: [], replies: {}, users: {}, ranks: {} };
}

function configured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
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
  const posts = db.posts.slice().sort((a, b) => b.created_at - a.created_at).slice(offset, offset + 20);
  res.json(posts);
});

router.post('/post', async (req, res) => {
  try {
    const { username, give_side, get_side, verdict, ktc_gap, headline, league_type, team_name } = req.body || {};
    if (!username || !give_side || !get_side) return res.status(400).json({ error: 'missing fields' });
    if (!configured()) return res.status(503).json({ error: 'storage not configured' });
    const db = await readDb();
    const post = {
      id: uid(), username, give_side, get_side,
      verdict: verdict || 'unknown', ktc_gap: ktc_gap || 0,
      headline: headline || '', league_type: league_type || 'dynasty',
      team_name: team_name || '', upvotes: 0, downvotes: 0,
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
    const { vote, username } = req.body || {};
    const db = await readDb();
    const post = db.posts.find(p => p.id === req.params.postId);
    if (!post) return res.status(404).json({ error: 'not found' });
    const changed = applySwitchableVote(post, username, vote === 1 ? 1 : -1);
    if (changed) await writeDb(db);
    res.json({ upvotes: post.upvotes || 0, downvotes: post.downvotes || 0, your_vote: vote === 1 ? 1 : -1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/opinions/:postId', async (req, res) => {
  const db = await readDb();
  res.json(db.opinions[req.params.postId] || []);
});

router.post('/opinions', async (req, res) => {
  try {
    const { post_id, username, text } = req.body || {};
    if (!post_id || !username || !text) return res.status(400).json({ error: 'missing fields' });
    const db = await readDb();
    if (!db.opinions[post_id]) db.opinions[post_id] = [];
    const op = { id: uid(), post_id, username, text: String(text).slice(0, 500), like_count: 0, created_at: Date.now() };
    db.opinions[post_id].push(op);
    await writeDb(db);
    res.json({ opinion: op });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/opinion-like/:opinionId', async (req, res) => {
  try {
    const db = await readDb();
    let found = null;
    Object.values(db.opinions).forEach(arr => arr.forEach(o => { if (o.id === req.params.opinionId) found = o; }));
    if (!found) return res.status(404).json({ error: 'not found' });
    found.like_count = (found.like_count || 0) + 1;
    if (db.users[found.username]) db.users[found.username].bk_balance += 5;
    await writeDb(db);
    res.json({ new_like_count: found.like_count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/forum', async (req, res) => {
  const db = await readDb();
  const offset = parseInt(req.query.offset) || 0;
  res.json(db.forum.slice().sort((a, b) => b.created_at - a.created_at).slice(offset, offset + 20));
});

router.post('/forum/post', async (req, res) => {
  try {
    const { username, text } = req.body || {};
    if (!username || !text) return res.status(400).json({ error: 'missing fields' });
    const db = await readDb();
    const post = { id: uid(), username, text: String(text).slice(0, 500), upvotes: 0, downvotes: 0, created_at: Date.now() };
    db.forum.unshift(post);
    if (db.forum.length > 500) db.forum.length = 500;
    await writeDb(db);
    res.json({ post });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/forum/vote/:postId', async (req, res) => {
  try {
    const { vote, username } = req.body || {};
    const db = await readDb();
    const post = db.forum.find(p => p.id === req.params.postId);
    if (!post) return res.status(404).json({ error: 'not found' });
    const changed = applySwitchableVote(post, username, vote === 1 ? 1 : -1);
    if (changed) await writeDb(db);
    res.json({ upvotes: post.upvotes || 0, downvotes: post.downvotes || 0, your_vote: vote === 1 ? 1 : -1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/forum/replies/:postId', async (req, res) => {
  const db = await readDb();
  res.json(db.replies[req.params.postId] || []);
});

router.post('/forum/reply', async (req, res) => {
  try {
    const { post_id, username, text } = req.body || {};
    if (!post_id || !username || !text) return res.status(400).json({ error: 'missing fields' });
    const db = await readDb();
    if (!db.replies[post_id]) db.replies[post_id] = [];
    const reply = { id: uid(), post_id, username, text: String(text).slice(0, 500), created_at: Date.now() };
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
    headers: { 'User-Agent': 'TradeMind/1.0', 'Accept': 'application/json' }
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
    const list = (db.block || []).slice().sort((a, b) => b.created_at - a.created_at).slice(0, 120);
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
    const db = await readDb();
    if (!db.block) db.block = [];
    // One live listing per user+player+type; re-listing bumps it to the top
    db.block = db.block.filter(l => !(l.username === username && l.player_name === player_name && l.type === type));
    const listing = {
      id: uid(), username: String(username).slice(0, 40), type,
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

// DELETE /api/community/block/:id?username=  — owner takes the listing down
router.delete('/block/:id', async (req, res) => {
  try {
    const db = await readDb();
    const before = (db.block || []).length;
    db.block = (db.block || []).filter(l => !(l.id === req.params.id && l.username === req.query.username));
    if (db.block.length !== before) await writeDb(db);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TRADE INDEX: market comps from real TradeMind trades ────────────────────
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
      .filter(p => hit(p.give_side) || hit(p.get_side))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 8)
      .map(p => ({
        id: p.id, created_at: p.created_at, league_type: p.league_type,
        give_side: p.give_side, get_side: p.get_side, verdict: p.verdict, username: p.username
      }));
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ deals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
