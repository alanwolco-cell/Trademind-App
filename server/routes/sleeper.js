const express = require('express');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const SLEEPER = 'https://api.sleeper.app/v1';
const shortCache = new NodeCache({ stdTTL: 300 });

// File-based player cache — survives across warm serverless invocations
const CACHE_FILE = path.join('/tmp', 'trademind_players.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — keeps player teams/names current

function readPlayerCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL_MS) return data;
  } catch (_) {}
  return null;
}

function writePlayerCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

async function sleeperFetch(urlPath) {
  const res = await fetch(SLEEPER + urlPath);
  if (!res.ok) throw new Error(`Sleeper returned ${res.status} for ${urlPath}`);
  return res.json();
}

// GET /api/sleeper/state/nfl
router.get('/state/nfl', async (req, res) => {
  try {
    const cached = shortCache.get('state_nfl');
    if (cached) return res.json(cached);
    const data = await sleeperFetch('/state/nfl');
    shortCache.set('state_nfl', data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/user/:username
router.get('/user/:username', async (req, res) => {
  try {
    const data = await sleeperFetch(`/user/${encodeURIComponent(req.params.username)}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/user/:userId/leagues/nfl/:season
router.get('/user/:userId/leagues/nfl/:season', async (req, res) => {
  try {
    const { userId, season } = req.params;
    const data = await sleeperFetch(`/user/${userId}/leagues/nfl/${season}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/league/:leagueId — league info (includes previous_league_id)
router.get('/league/:leagueId', async (req, res) => {
  try {
    const data = await sleeperFetch(`/league/${req.params.leagueId}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/league/:leagueId/rosters
router.get('/league/:leagueId/rosters', async (req, res) => {
  try {
    const data = await sleeperFetch(`/league/${req.params.leagueId}/rosters`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/league/:leagueId/drafts - for the live draft assistant
router.get('/league/:leagueId/drafts', async (req, res) => {
  try {
    const data = await sleeperFetch(`/league/${req.params.leagueId}/drafts`);
    res.set('Cache-Control', 'no-store');   // draft state must never be stale
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/draft/:draftId/picks - polled every few seconds mid-draft
router.get('/draft/:draftId/picks', async (req, res) => {
  try {
    const data = await sleeperFetch(`/draft/${req.params.draftId}/picks`);
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/draft/:draftId - draft settings/order
router.get('/draft/:draftId', async (req, res) => {
  try {
    const data = await sleeperFetch(`/draft/${req.params.draftId}`);
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/league/:leagueId/users
router.get('/league/:leagueId/users', async (req, res) => {
  try {
    const data = await sleeperFetch(`/league/${req.params.leagueId}/users`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/league/:leagueId/traded_picks
router.get('/league/:leagueId/traded_picks', async (req, res) => {
  try {
    const data = await sleeperFetch(`/league/${req.params.leagueId}/traded_picks`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/trending-week
// Most added / dropped players across ALL of Sleeper over the last 7 days, with counts
router.get('/trending-week', async (req, res) => {
  try {
    const cached = shortCache.get('trending-week');
    if (cached) return res.json(cached);
    const [adds, drops] = await Promise.all([
      sleeperFetch('/players/nfl/trending/add?lookback_hours=168&limit=12').catch(() => []),
      sleeperFetch('/players/nfl/trending/drop?lookback_hours=168&limit=12').catch(() => [])
    ]);
    const payload = { adds, drops };
    shortCache.set('trending-week', payload, 900);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message, adds: [], drops: [] });
  }
});

// GET /api/sleeper/league/:leagueId/all-transactions
// Fetches all weeks in parallel and returns only completed trades
router.get('/league/:leagueId/all-transactions', async (req, res) => {
  try {
    const { leagueId } = req.params;
    const weeks = Array.from({ length: 18 }, (_, i) => i + 1);
    const results = await Promise.all(
      weeks.map(w => sleeperFetch(`/league/${leagueId}/transactions/${w}`).catch(() => []))
    );
    const trades = results.flat().filter(t => t && t.type === 'trade' && t.status === 'complete');
    res.json(trades);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/league/:leagueId/recent-activity
// Last 4 weeks of all transaction types (trades, adds, drops) for the live feed
router.get('/league/:leagueId/recent-activity', async (req, res) => {
  try {
    const { leagueId } = req.params;
    const week = parseInt(req.query.week) || 1;
    const start = Math.max(1, week - 3);
    const weeks = Array.from({ length: week - start + 1 }, (_, i) => start + i);
    const results = await Promise.all(
      weeks.map(w => sleeperFetch(`/league/${leagueId}/transactions/${w}`).catch(() => []))
    );
    const activity = results.flat()
      .filter(t => t && t.status === 'complete')
      .sort((a, b) => b.status_updated - a.status_updated)
      .slice(0, 60);
    res.json(activity);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sleeper/cache/clear — force-bust the player file cache
router.post('/cache/clear', (req, res) => {
  try { fs.unlinkSync(CACHE_FILE); } catch (_) {}
  res.json({ ok: true });
});

// GET /api/sleeper/players/nfl/slim — only fantasy-relevant fields for QB/RB/WR/TE
// (~300KB vs the 5MB full payload; the frontend only uses these fields)
router.get('/players/nfl/slim', async (req, res) => {
  try {
    let data = readPlayerCache();
    if (!data) {
      console.log('Fetching fresh player database from Sleeper (for slim)...');
      data = await sleeperFetch('/players/nfl');
      writePlayerCache(data);
    }
    const slim = {};
    const POS = ['QB', 'RB', 'WR', 'TE'];
    Object.keys(data).forEach(id => {
      const p = data[id];
      if (!p || !p.fantasy_positions) return;
      const skill = p.fantasy_positions.some(x => POS.includes(x));
      // Kickers and team defenses ride along (rostered only) so mock drafts
      // can finish a real lineup - K needs a team, DEF is the 32 team units.
      const kdst = (p.fantasy_positions.includes('K') && p.team && p.status === 'Active')
        || p.fantasy_positions.includes('DEF');
      if (skill || kdst) {
        slim[id] = {
          first_name: p.first_name, last_name: p.last_name,
          fantasy_positions: p.fantasy_positions, team: p.team,
          years_exp: p.years_exp, age: p.age,
          injury_status: p.injury_status || null, status: p.status || null,
        };
      }
    });
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.json(slim);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sleeper/players/nfl — file-cached for 24 hours (5MB payload)
router.get('/players/nfl', async (req, res) => {
  try {
    const cached = readPlayerCache();
    if (cached) {
      console.log('Serving players from file cache');
      res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      return res.json(cached);
    }
    console.log('Fetching fresh player database from Sleeper...');
    const data = await sleeperFetch('/players/nfl');
    writePlayerCache(data);
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// GET /api/sleeper/img?u=<sleepercdn url> - same-origin image proxy so canvas
// exports (roster cards) aren't tainted by cross-origin player photos.
router.get('/img', async (req, res) => {
  try {
    const u = String(req.query.u || '');
    if (!/^https:\/\/sleepercdn\.com\//.test(u)) return res.status(400).send('bad url');
    const r = await fetch(u);
    if (!r.ok) return res.status(404).send('not found');
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    r.body.pipe(res);
  } catch (e) { res.status(502).send('proxy error'); }
});

// ── Slug -> player, for the public /player/:slug pages ───────────────────────
// The page renderer has to know whether a slug is a real player before it can
// choose between honest meta tags and a 404, and it cannot ask the browser.
// It reuses the same /tmp player cache the endpoints above already keep warm.
// Same slug rule as playerSlug() in public/app.js: change one, change both.
const _slugify = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const _stripSlugSuffix = (s) => s.replace(/-(jr|sr|ii|iii|iv|v)$/, '');

let _slugIndex = null, _slugIndexTs = 0;

function buildSlugIndex(data) {
  const idx = Object.create(null);
  Object.keys(data).forEach(id => {
    const p = data[id];
    if (!p || !p.fantasy_positions) return;
    // Same population the app itself loads (see /players/nfl/slim above), so a
    // slug that opens a card in the app never 404s here, and an offensive
    // lineman never gets a page.
    const skill = p.fantasy_positions.some(x => ['QB', 'RB', 'WR', 'TE'].includes(x));
    const kdst = (p.fantasy_positions.includes('K') && p.team && p.status === 'Active')
      || p.fantasy_positions.includes('DEF');
    if (!skill && !kdst) return;

    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    const slug = _slugify(name);
    if (!slug) return;

    const entry = {
      id, name, slug,
      pos: (p.fantasy_positions || [])[0] || null,
      team: p.team || null,
      active: p.status === 'Active' && !!p.team,
    };
    // 37 slugs are shared by two or more players, almost always a current
    // player and a retired one. Whoever is on a roster today owns the URL, so
    // /player/kyle-williams opens the rookie, not the name that left in 2019.
    const prev = idx[slug];
    if (!prev || (entry.active && !prev.active)) idx[slug] = entry;
    // Sources disagree on suffixes: FantasyCalc writes "Marvin Harrison Jr",
    // Sleeper writes "Marvin Harrison". Index the suffix-free spelling too so
    // both links land on the same page instead of one of them 404ing.
    const bare = _stripSlugSuffix(slug);
    if (bare !== slug && !idx[bare]) idx[bare] = entry;
  });
  return idx;
}

async function playerBySlug(slug) {
  const key = _slugify(slug);
  if (!key) return null;
  if (!_slugIndex || Date.now() - _slugIndexTs > CACHE_TTL_MS) {
    let data = readPlayerCache();
    if (!data) { data = await sleeperFetch('/players/nfl'); writePlayerCache(data); }
    _slugIndex = buildSlugIndex(data);
    _slugIndexTs = Date.now();
  }
  return _slugIndex[key] || _slugIndex[_stripSlugSuffix(key)] || null;
}

// Shared with server/lib/roster.js: the live player master, file-cached for an
// hour. One writer, one TTL, so nothing else has to re-implement this cache.
async function getPlayers() {
  const cached = readPlayerCache();
  if (cached) return cached;
  const data = await sleeperFetch('/players/nfl');
  writePlayerCache(data);
  return data;
}

module.exports = router;
module.exports.playerBySlug = playerBySlug;
module.exports.getPlayers = getPlayers;
