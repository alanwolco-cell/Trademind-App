const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { allowCron } = require('../lib/identity');
const { put, list } = require('@vercel/blob');

// Matchup engine built on free nflverse data:
//  - stats_player_week_2025.csv  -> per-game fantasy production + defense-vs-position
//  - nfldata games.csv           -> 2026 schedule (who each team plays, by week)
// Condensed once into a compact JSON, cached in /tmp and mirrored to Blob so
// serverless instances don't re-download the 8MB CSV.

const STATS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2025.csv';
const GAMES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';
const TMP_FILE = path.join('/tmp', 'trademind_matchups.json');
const BLOB_PATH = 'stats/matchups_2026.json';
let mem = null;

function csvSplit(line) {
  // Minimal quote-aware CSV splitter
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function norm(name) { return String(name).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

async function buildDataset() {
  console.log('[stats] building matchup dataset from nflverse...');
  const [statsRes, gamesRes] = await Promise.all([fetch(STATS_URL), fetch(GAMES_URL)]);
  if (!statsRes.ok || !gamesRes.ok) throw new Error('nflverse fetch failed');
  const statsCsv = await statsRes.text();
  const gamesCsv = await gamesRes.text();

  // ── 2026 schedule: team -> [{week, opp, home}] ────────────────────────────
  const gLines = gamesCsv.split('\n');
  const gHead = csvSplit(gLines[0]);
  const gi = {}; gHead.forEach((h, i) => gi[h] = i);
  const schedule = {};
  for (let i = 1; i < gLines.length; i++) {
    const r = csvSplit(gLines[i]);
    if (r[gi.season] !== '2026' || r[gi.game_type] !== 'REG') continue;
    const wk = parseInt(r[gi.week]); const home = r[gi.home_team]; const away = r[gi.away_team];
    if (!wk || !home || !away) continue;
    (schedule[home] = schedule[home] || []).push({ week: wk, opp: away, home: true });
    (schedule[away] = schedule[away] || []).push({ week: wk, opp: home, home: false });
  }
  Object.values(schedule).forEach(arr => arr.sort((a, b) => a.week - b.week));

  // ── 2025 per-game production ──────────────────────────────────────────────
  const sLines = statsCsv.split('\n');
  const sHead = csvSplit(sLines[0]);
  const si = {}; sHead.forEach((h, i) => si[h] = i);
  const POS = new Set(['QB', 'RB', 'WR', 'TE']);
  const players = {}; // normName -> {pos, team, games:[[week, opp, pts]]}
  const defTotals = {}; // team -> pos -> {pts, games:Set}
  // Advanced season profile, straight from nflverse's own computed columns.
  // Name-keyed programmatically - the hand-typed-id disaster can never recur.
  const advAgg = {}; // normName -> accumulators
  const kick = {};   // normName -> kicker accumulators
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
  for (let i = 1; i < sLines.length; i++) {
    const r = csvSplit(sLines[i]);
    if (r[si.season_type] !== 'REG') continue;
    // Kickers: nflverse's fantasy_points column skips kicking, so score it
    // ourselves from the made kicks (3/FG, +1 for 50s, +2 for 60s, 1/PAT).
    if (r[si.position] === 'K') {
      const knm = norm(r[si.player_display_name]);
      if (!knm) continue;
      const k = (kick[knm] = kick[knm] || { g: 0, fgm: 0, fga: 0, patm: 0, fpts: 0, team: '' });
      k.g++; k.team = r[si.team];
      const fgm = num(r[si.fg_made]), fga = num(r[si.fg_att]), patm = num(r[si.pat_made]);
      k.fgm += fgm; k.fga += fga; k.patm += patm;
      k.fpts += fgm * 3 + num(r[si.fg_made_50_59]) * 1 + num(r[si.fg_made_60_]) * 2 + patm;
      continue;
    }
    if (!r[si.position] || !POS.has(r[si.position])) continue;
    const pts = parseFloat(r[si.fantasy_points_ppr]) || 0;
    const nm = norm(r[si.player_display_name]);
    const opp = r[si.opponent_team];
    const wk = parseInt(r[si.week]);
    if (!nm || !opp || !wk) continue;
    if (!players[nm]) players[nm] = { pos: r[si.position], team: r[si.team], games: [] };
    players[nm].team = r[si.team]; // last team of season
    players[nm].games.push([wk, opp, Math.round(pts * 10) / 10]);
    const d = (defTotals[opp] = defTotals[opp] || {});
    const dp = (d[r[si.position]] = d[r[si.position]] || { pts: 0, games: new Set() });
    dp.pts += pts;
    dp.games.add(r[si.game_id]);
    const a = (advAgg[nm] = advAgg[nm] || { pos: r[si.position], g: 0, tgt: 0, rec: 0, recY: 0, recTD: 0, yac: 0, ruAtt: 0, ruY: 0, tsSum: 0, tsN: 0, aySum: 0, ayN: 0 });
    a.pos = r[si.position];
    // a game only counts if he actually TOUCHED the ball chart - roster rows
    // with zero involvement were inflating games played ("played all 17")
    if (num(r[si.targets]) + num(r[si.carries]) + num(r[si.attempts]) + num(r[si.receptions]) > 0) a.g++;
    a.tgt += num(r[si.targets]); a.rec += num(r[si.receptions]);
    a.recY += num(r[si.receiving_yards]); a.recTD += num(r[si.receiving_tds]);
    a.yac += num(r[si.receiving_yards_after_catch]);
    a.ruAtt += num(r[si.carries]); a.ruY += num(r[si.rushing_yards]);
    const ts = parseFloat(r[si.target_share]); if (isFinite(ts)) { a.tsSum += ts; a.tsN++; }
    const ay = parseFloat(r[si.air_yards_share]); if (isFinite(ay)) { a.aySum += ay; a.ayN++; }
  }
  // Defense-vs-position: avg PPR points allowed per game, plus rank (1 = allows most)
  const defVsPos = {};
  Object.keys(defTotals).forEach(team => {
    defVsPos[team] = {};
    Object.keys(defTotals[team]).forEach(pos => {
      const dp = defTotals[team][pos];
      defVsPos[team][pos] = Math.round(dp.pts / Math.max(1, dp.games.size) * 10) / 10;
    });
  });
  const defRank = {};
  ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
    const teams = Object.keys(defVsPos).filter(t => defVsPos[t][pos] != null)
      .sort((a, b) => defVsPos[b][pos] - defVsPos[a][pos]); // most points allowed first
    teams.forEach((t, idx) => { (defRank[t] = defRank[t] || {})[pos] = idx + 1; });
  });

  // Drop fringe players to keep the payload small
  Object.keys(players).forEach(nm => {
    const total = players[nm].games.reduce((s, g) => s + g[2], 0);
    if (total < 20) delete players[nm];
  });

  // Finalize the advanced profiles (only for players kept above)
  const adv = {};
  Object.keys(players).forEach(nm => {
    const a = advAgg[nm]; if (!a || !a.g) return;
    const o = { pos: a.pos, g: a.g, team: (players[nm] && players[nm].team) || '' };
    if (a.tgt >= 20) {
      o.tgt = a.tgt; o.rec = a.rec;
      o.recY = Math.round(a.recY); o.recTD = a.recTD;
      o.tgtShare = a.tsN ? Math.round(a.tsSum / a.tsN * 1000) / 10 : null;   // %
      o.ayShare = a.ayN ? Math.round(a.aySum / a.ayN * 1000) / 10 : null;    // %
      o.catchPct = a.tgt ? Math.round(a.rec / a.tgt * 100) : null;
      o.ypt = a.tgt ? Math.round(a.recY / a.tgt * 10) / 10 : null;
      o.yacRec = a.rec ? Math.round(a.yac / a.rec * 10) / 10 : null;
    }
    if (a.ruAtt >= 30) { o.ruAtt = a.ruAtt; o.ruY = Math.round(a.ruY); o.ypc = Math.round(a.ruY / a.ruAtt * 10) / 10; }
    adv[nm] = o;
  });
  // Kickers into the same map (floor: 10 attempts)
  Object.keys(kick).forEach(nm => {
    const k = kick[nm];
    if (k.fga < 10) return;
    adv[nm] = { pos: 'K', g: k.g, fgm: k.fgm, fga: k.fga, fgPct: Math.round(k.fgm / k.fga * 100), fpts: Math.round(k.fpts) };
  });
  // DST quality proxy: total fantasy points allowed per game (lower = better)
  const dst = {};
  Object.keys(defTotals).forEach(team => {
    let pts = 0; let games = 0;
    ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
      const dp = defTotals[team][pos]; if (!dp) return;
      pts += dp.pts; games = Math.max(games, dp.games.size);
    });
    if (games) dst[team] = Math.round(pts / games * 10) / 10;
  });

  const data = { built: Date.now(), season: 2025, schedule, players, adv, dst, defVsPos, defRank, teams: Object.keys(defVsPos).length };
  try { fs.writeFileSync(TMP_FILE, JSON.stringify(data)); } catch (_) {}
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try { await put(BLOB_PATH, JSON.stringify(data), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 }); } catch (e) { console.error('[stats] blob save:', e.message); }
  }
  return data;
}

async function getData() {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8')); return mem; } catch (_) {}
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
      if (blobs.length) {
        const r = await fetch(blobs[0].url);
        mem = await r.json();
        try { fs.writeFileSync(TMP_FILE, JSON.stringify(mem)); } catch (_) {}
        return mem;
      }
    } catch (_) {}
  }
  mem = await buildDataset();
  return mem;
}

// GET /api/stats/matchup?name=Bijan%20Robinson&week=1
// -> {player, team, opp, week, defAvgAllowed, defRank, history:[{week,opp,pts}], vsOpp:[...]}
router.get('/matchup', async (req, res) => {
  try {
    const data = await getData();
    const nm = norm(req.query.name || '');
    if (!nm) return res.status(400).json({ error: 'name required' });
    let p = data.players[nm];
    if (!p) {
      // Loose match: first + last name
      const parts = nm.split(' ');
      if (parts.length >= 2) {
        const key = Object.keys(data.players).find(k => {
          const kp = k.split(' ');
          return kp[0] === parts[0] && kp[kp.length - 1] === parts[parts.length - 1];
        });
        if (key) p = data.players[key];
      }
    }
    if (!p) return res.json({ found: false });
    const week = parseInt(req.query.week) || 1;
    const sched = data.schedule[p.team] || [];
    const game = sched.find(g => g.week === week) || sched[0] || null;
    const opp = game ? game.opp : null;
    const out = {
      found: true, pos: p.pos, team: p.team, week: game ? game.week : null,
      opp, home: game ? game.home : null,
      defAvgAllowed: opp && data.defVsPos[opp] ? data.defVsPos[opp][p.pos] : null,
      defRank: opp && data.defRank[opp] ? data.defRank[opp][p.pos] : null,
      teamsRanked: data.teams,
      history: p.games.map(g => ({ week: g[0], opp: g[1], pts: g[2] })),
      vsOpp: opp ? p.games.filter(g => g[1] === opp).map(g => ({ week: g[0], opp: g[1], pts: g[2] })) : [],
      avgPts: Math.round(p.games.reduce((s, g) => s + g[2], 0) / Math.max(1, p.games.length) * 10) / 10,
    };
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/adv — verified advanced season profiles, keyed by normalized
// player name (2025 season, computed by nflverse - no hand-entered ids)
router.get('/adv', async (req, res) => {
  try {
    let data = await getData();
    if (!data.adv || !data.dst) { mem = await buildDataset(); data = mem; } // old cached build predates adv/dst
    res.set('Cache-Control', 'public, max-age=21600');
    res.json({ season: data.season, players: data.adv || {}, dst: data.dst || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/adp — real 2026 ADP. PRIMARY source is Sleeper's own market
// (the boards the user's league drafts on every day, keyed by Sleeper player
// id so no name matching can miss), FantasyFootballCalculator as fallback.
// Cached 12h per format.
const adpMem = {}; // format -> {ts, doc}
const SL_ADP_FIELD = { 'ppr': 'adp_ppr', 'half-ppr': 'adp_half_ppr', 'standard': 'adp_std', '2qb': 'adp_2qb' };
router.get('/adp', async (req, res) => {
  try {
    const fmt = ['ppr', 'half-ppr', 'standard', '2qb'].indexOf(req.query.format) >= 0 ? req.query.format : 'ppr';
    if (adpMem[fmt] && Date.now() - adpMem[fmt].ts < 12 * 60 * 60 * 1000) {
      res.set('Cache-Control', 'public, max-age=21600');
      return res.json(adpMem[fmt].doc);
    }
    const players = {}; const byId = {}; const q6 = {}; const qbTds = []; let source = 'sleeper';
    // Sleeper is the base. A single transient hiccup used to silently swap in
    // FantasyFootballCalculator - whose board ranks elite TEs a full round-plus
    // later - and 12h-cache that wrong board. Retry Sleeper hard before ever
    // falling back, and if FFC IS used, cache only briefly so we re-try Sleeper.
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const sr = await fetch('https://api.sleeper.com/projections/nfl/2026?season_type=regular&position%5B%5D=QB&position%5B%5D=RB&position%5B%5D=WR&position%5B%5D=TE&order_by=' + SL_ADP_FIELD[fmt]);
        if (!sr.ok) throw new Error('sleeper ' + sr.status);
        const rows = await sr.json();
        Object.keys(players).forEach(k => delete players[k]); qbTds.length = 0; // clear a partial prior attempt
        (rows || []).forEach(row => {
          const stt = row.stats || {}; const pl = row.player || {};
          const adp = Number(stt[SL_ADP_FIELD[fmt]]);
          if (!adp || adp <= 0 || adp > 400) return;
          const name = ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim();
          if (!name) return;
          players[norm(name)] = { adp, pos: pl.position || '', team: pl.team || '', name };
          byId[String(row.player_id)] = adp;
          if ((pl.position || '') === 'QB') {
            const ptd = Number(stt.pass_td) || 0;
            if (ptd) qbTds.push({ id: String(row.player_id), key: norm(name), ptd, adp });
          }
        });
        // 6pt repricing done RIGHT: the whole position gains points, so a QB's
        // real edge is his passing TDs OVER THE REPLACEMENT QB's (the ~QB12 by
        // ADP). Pocket passers with TD volume gain, rushing QBs gain ~nothing
        // (their rushing TDs were always worth 6). p6 = NET POINTS vs
        // replacement (2 pts per TD above/below), can be negative.
        if (qbTds.length >= 12) {
          const byAdp = qbTds.slice().sort((a, b) => a.adp - b.adp);
          const replTd = byAdp[11].ptd;
          qbTds.forEach(q => {
            const net = +(2 * (q.ptd - replTd)).toFixed(1);
            q6[q.id] = net;
            if (players[q.key]) players[q.key].p6 = net;
          });
        }
        if (Object.keys(players).length < 100) throw new Error('sleeper thin');
        ok = true;
      } catch (se) { /* retry */ }
    }
    if (!ok) {
      source = 'ffc';
      const r = await fetch('https://fantasyfootballcalculator.com/api/v1/adp/' + fmt + '?teams=12&year=2026');
      if (!r.ok) throw new Error('adp source ' + r.status);
      const raw = await r.json();
      (raw.players || []).forEach(p => {
        if (!p.name || p.adp == null) return;
        players[norm(p.name)] = { adp: p.adp, pos: p.position === 'PK' ? 'K' : p.position, team: p.team || '', name: p.name };
      });
    }
    const doc = { updated: Date.now(), count: Object.keys(players).length, format: fmt, source, players, byId, q6 };
    // only lock in the 12h cache for the real Sleeper base; a fallback board
    // is cached ~15 min so the next draft gets Sleeper back as soon as it heals
    adpMem[fmt] = { ts: source === 'ffc' ? Date.now() - (12 * 60 - 15) * 60 * 1000 : Date.now(), doc };
    res.set('Cache-Control', source === 'ffc' ? 'public, max-age=900' : 'public, max-age=21600');
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/aav — real auction values from ESPN's live 2026 drafts
// (ownership.auctionValueAverage on the undocumented kona_player_info view -
// verified 8/2026: 164 players priced >= $0.50, all positions, Gibbs $63.77).
// ESPN prices their default PPR $200 rooms only, so the response also carries
// a curve fit of AAV against ESPN's own ADP - refit on every rebuild, never
// hardcoded (8/2026 fit: ln(aav) = 4.13 - 0.0294*adp, R^2 0.984). The client
// evaluates that curve at the FORMAT's ADP to derive half/standard/2QB values,
// and labels anything curve-derived as such. Cached 12h; on total failure the
// client falls back to its own dated static fit and says so.
const aavMem = { ts: 0, doc: null };
router.get('/aav', async (req, res) => {
  try {
    if (aavMem.doc && Date.now() - aavMem.ts < 12 * 60 * 60 * 1000) {
      res.set('Cache-Control', 'public, max-age=21600');
      return res.json(aavMem.doc);
    }
    const POS_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
    const filter = { players: { limit: 400, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'PPR' } } };
    const r = await fetch('https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info',
      { headers: { 'x-fantasy-filter': JSON.stringify(filter) } });
    if (!r.ok) throw new Error('espn ' + r.status);
    const raw = await r.json();
    const players = {}; const fitPts = [];
    (raw.players || []).forEach(row => {
      const pl = row.player || {}; const own = pl.ownership || {};
      const aav = Number(own.auctionValueAverage) || 0;
      const pos = POS_ID[pl.defaultPositionId] || '';
      if (!pl.fullName || !pos || aav < 0.5) return;
      players[norm(pl.fullName)] = { aav: +aav.toFixed(1), pos, name: pl.fullName, adp: +(Number(own.averageDraftPosition) || 0).toFixed(1) };
      if (aav >= 1 && own.averageDraftPosition > 0 && own.averageDraftPosition <= 200) fitPts.push([own.averageDraftPosition, Math.log(aav)]);
    });
    if (Object.keys(players).length < 80) throw new Error('espn thin');
    // least-squares ln(aav) = a + b*adp over the priced pool
    let fit = null;
    if (fitPts.length >= 60) {
      const n = fitPts.length;
      const sx = fitPts.reduce((s, p) => s + p[0], 0), sy = fitPts.reduce((s, p) => s + p[1], 0);
      const sxx = fitPts.reduce((s, p) => s + p[0] * p[0], 0), sxy = fitPts.reduce((s, p) => s + p[0] * p[1], 0);
      const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
      const mean = sy / n; let ssr = 0, sst = 0;
      fitPts.forEach(p => { const e = a + b * p[0]; ssr += (p[1] - e) ** 2; sst += (p[1] - mean) ** 2; });
      fit = { a: +a.toFixed(4), b: +b.toFixed(5), r2: +(1 - ssr / sst).toFixed(3), n };
    }
    const doc = { updated: Date.now(), source: 'espn', budget: 200, scoring: 'ppr', count: Object.keys(players).length, players, fit };
    aavMem.ts = Date.now(); aavMem.doc = doc;
    res.set('Cache-Control', 'public, max-age=21600');
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/stats/build — warm/rebuild the dataset (also usable via cron)
router.get('/build', async (req, res) => {
  if (!allowCron(req, res)) return;
  try { mem = await buildDataset(); res.json({ ok: true, players: Object.keys(mem.players).length, teams: mem.teams }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
