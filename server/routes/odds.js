// Vegas layer via The Odds API - CREDIT-SAFE DESIGN:
// - The snapshot persists on Vercel Blob, so serverless cold starts NEVER
//   trigger an upstream call of their own.
// - One upstream refresh per 7 DAYS, max. July lines barely move; during the
//   season we can shorten the window deliberately.
// - Player props are the signal (per his call), team totals kept only as a
//   derived fallback field.
const express = require('express');
const router = express.Router();
const { put, list } = require('@vercel/blob');

const DOC = 'odds/snapshot.json';
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;   // one week
const PROP_MARKETS = 'player_pass_yds,player_rush_yds,player_reception_yds,player_receptions,player_anytime_td';
let mem = null;

async function readSnap() {
  if (mem) return mem;
  try {
    const { blobs } = await list({ prefix: DOC, limit: 1 });
    if (!blobs.length) return null;
    const r = await fetch(blobs[0].url + '?t=' + Date.now());
    mem = await r.json();
    return mem;
  } catch (_) { return null; }
}
async function writeSnap(doc) {
  mem = doc;
  await put(DOC, JSON.stringify(doc), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
}

const NAME_TO_ABBR = {
  'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL','Buffalo Bills':'BUF',
  'Carolina Panthers':'CAR','Chicago Bears':'CHI','Cincinnati Bengals':'CIN','Cleveland Browns':'CLE',
  'Dallas Cowboys':'DAL','Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB',
  'Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX','Kansas City Chiefs':'KC',
  'Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC','Los Angeles Rams':'LAR','Miami Dolphins':'MIA',
  'Minnesota Vikings':'MIN','New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG',
  'New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT','San Francisco 49ers':'SF',
  'Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB','Tennessee Titans':'TEN','Washington Commanders':'WAS',
};

async function refreshSnapshot() {
  const key = process.env.ODDS_API_KEY;
  const base = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl';
  // 1. implied team totals (cheap: 1 call) - kept as fallback context only
  const implied = {};
  try {
    const r = await fetch(`${base}/odds?apiKey=${key}&regions=us&markets=spreads,totals&oddsFormat=american`);
    if (r.ok) {
      (await r.json() || []).forEach(g => {
        const book = (g.bookmakers || [])[0]; if (!book) return;
        const totals = (book.markets || []).find(m => m.key === 'totals');
        const spreads = (book.markets || []).find(m => m.key === 'spreads');
        const total = totals && totals.outcomes && totals.outcomes[0] ? totals.outcomes[0].point : null;
        if (total == null || !spreads) return;
        (spreads.outcomes || []).forEach(o => {
          const abbr = NAME_TO_ABBR[o.name];
          if (abbr && o.point != null) implied[abbr] = Math.round((total / 2 - o.point / 2) * 10) / 10;
        });
      });
    }
  } catch (_) {}
  // 2. player props per event (the real signal). Capped at 16 events per refresh.
  const props = {};
  let eventsScanned = 0;
  try {
    const er = await fetch(`${base}/events?apiKey=${key}`);
    const events = er.ok ? await er.json() : [];
    for (const ev of (events || []).slice(0, 16)) {
      const pr = await fetch(`${base}/events/${ev.id}/odds?apiKey=${key}&regions=us&markets=${PROP_MARKETS}&oddsFormat=american`);
      if (!pr.ok) continue;
      eventsScanned++;
      const data = await pr.json();
      (data.bookmakers || []).slice(0, 1).forEach(book => {
        (book.markets || []).forEach(m => {
          (m.outcomes || []).forEach(o => {
            if (!o.description || o.point == null) return;
            const nm = o.description.toLowerCase();
            props[nm] = props[nm] || {};
            // keep the Over line as the projection anchor
            if (o.name === 'Over' || m.key === 'player_anytime_td') props[nm][m.key] = o.point != null ? o.point : null;
            if (m.key === 'player_anytime_td' && o.price != null) props[nm].td_price = o.price;
          });
        });
      });
    }
  } catch (_) {}
  // fantasy-point projection from the prop lines (PPR):
  // pass yds/25 + rush yds/10 + rec yds/10 + receptions + TD probability * 6
  const proj = {};
  Object.keys(props).forEach(nm => {
    const p = props[nm];
    let pts = 0, has = false;
    if (p.player_pass_yds != null) { pts += p.player_pass_yds / 25; has = true; }
    if (p.player_rush_yds != null) { pts += p.player_rush_yds / 10; has = true; }
    if (p.player_reception_yds != null) { pts += p.player_reception_yds / 10; has = true; }
    if (p.player_receptions != null) { pts += p.player_receptions; has = true; }
    if (p.td_price != null) {
      const am = p.td_price;
      const prob = am < 0 ? (-am) / ((-am) + 100) : 100 / (am + 100);
      pts += prob * 6; has = true;
    }
    if (has) proj[nm] = Math.round(pts * 10) / 10;
  });
  return { updated: Date.now(), implied, props, projections: proj, eventsScanned };
}

router.get('/implied', async (req, res) => {
  try {
    if (!process.env.ODDS_API_KEY) return res.status(503).json({ error: 'ODDS_API_KEY not configured' });
    let snap = await readSnap();
    if (!snap || Date.now() - (snap.updated || 0) > REFRESH_MS) {
      snap = await refreshSnapshot();
      await writeSnap(snap);
    }
    res.set('Cache-Control', 'public, max-age=21600');   // browsers/edge: 6h
    res.json(snap);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
