// ADP riser study — methodology per @ConnorAllenNFL's thread, our data.
// Source: Sleeper season feeds (api.sleeper.com), the same ADP family the app
// drafts with. Coverage is 2020-2025 (Sleeper keeps no ADP before 2020 — the
// 2017-2019 projection rows come back with empty stats; verified 2026-07-31).
//
// Definitions:
//   RISER   = final preseason ADP improved 36+ picks (3 rounds, 12-team) vs
//             the prior season's final ADP; destination inside 16 rounds.
//   Slot expectation = pooled actual PPR points of ALL drafted players at the
//             same position + destination round, across every covered season.
//   BOOM    = actual points >= p80 of the slot. BUST = <= p20. HIT = >= p50.
//
// Output: public/riser-rates.json — base rates per bucket (n>=15 only) plus
// last season's final ADP per Sleeper id (the app's riser detector).
//
// Rerun next summer with SEASONS extended one year; nothing else changes.
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025]; // verified ADP coverage
const TEAMS = 12, RISE = 36, MAXDEST = 192; // 3 rounds / 16 rounds, 12-team
const POS = ['QB', 'RB', 'WR', 'TE'];
const OUT = process.env.RISER_OUT || '/Users/wolco/Development/trademind-app/public/riser-rates.json';
const IDS_CSV = path.join(__dirname, 'db_playerids.csv');

function get(u) {
  return new Promise((res, rej) => {
    https.get(u, r => {
      if (r.statusCode !== 200) { rej(new Error(u + ' -> ' + r.statusCode)); return; }
      let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
}
const posQ = POS.map(p => 'position[]=' + p).join('&');

// db_playerids: sleeper_id -> {birth, draftYear} for age/experience at season
function loadIds() {
  const rows = fs.readFileSync(IDS_CSV, 'utf8').split('\n');
  const head = rows[0].split(',');
  const iSlp = head.indexOf('sleeper_id'), iBd = head.indexOf('birthdate'), iDy = head.indexOf('draft_year');
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].split(',');
    const id = c[iSlp];
    if (!id || id === 'NA' || !/^\d+$/.test(id)) continue;
    out[id] = { birth: c[iBd] !== 'NA' ? c[iBd] : null, draftYear: c[iDy] !== 'NA' ? parseInt(c[iDy], 10) : null };
  }
  return out;
}

async function main() {
  const ids = loadIds();
  const adpBy = {}, ptsBy = {}, metaBy = {}; // season -> id -> value
  for (const y of SEASONS) {
    const proj = await get('https://api.sleeper.com/projections/nfl/' + y + '?season_type=regular&' + posQ + '&order_by=adp_ppr');
    const adp = {}, meta = {};
    proj.forEach(e => {
      const s = e.stats || {};
      if (e.player_id && s.adp_ppr && s.adp_ppr < 900) {
        adp[e.player_id] = s.adp_ppr;
        meta[e.player_id] = { pos: e.player && e.player.position, rookieYear: e.player && e.player.metadata && parseInt(e.player.metadata.rookie_year, 10) || null };
      }
    });
    const st = await get('https://api.sleeper.com/stats/nfl/' + y + '?season_type=regular&' + posQ + '&order_by=pts_ppr');
    const pts = {};
    st.forEach(e => { const s = e.stats || {}; if (e.player_id && s.pts_ppr != null) pts[e.player_id] = s.pts_ppr; });
    adpBy[y] = adp; ptsBy[y] = pts; metaBy[y] = meta;
    console.log(y + ': ' + Object.keys(adp).length + ' with ADP, ' + Object.keys(pts).length + ' with stats');
  }

  // Slot expectation cells: pos x destination round, pooled across seasons.
  // A drafted player with no stats row scored 0 - that outcome counts.
  const cells = {}; // 'WR|5' -> [pts...]
  const band = adp => adp <= 72 ? 'early' : adp <= 120 ? 'mid' : 'late';
  for (const y of SEASONS) {
    Object.keys(adpBy[y]).forEach(id => {
      const adp = adpBy[y][id]; if (adp > MAXDEST) return;
      const pos = (metaBy[y][id] || {}).pos; if (POS.indexOf(pos) < 0) return;
      const rd = Math.ceil(adp / TEAMS);
      (cells[pos + '|' + rd] = cells[pos + '|' + rd] || []).push(ptsBy[y][id] || 0);
      (cells[pos + '|' + band(adp)] = cells[pos + '|' + band(adp)] || []).push(ptsBy[y][id] || 0);
    });
  }
  Object.keys(cells).forEach(k => cells[k].sort((a, b) => a - b));
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  // round cell when it has 20+ outcomes, else the wider early/mid/late band
  function slotPct(pos, adp, p) {
    const rc = cells[pos + '|' + Math.ceil(adp / TEAMS)];
    const use = (rc && rc.length >= 20) ? rc : cells[pos + '|' + band(adp)];
    return use && use.length ? pct(use, p) : null;
  }

  // Risers across each consecutive pair of seasons
  const risers = [];
  for (let i = 1; i < SEASONS.length; i++) {
    const y0 = SEASONS[i - 1], y = SEASONS[i];
    Object.keys(adpBy[y]).forEach(id => {
      const cur = adpBy[y][id], prev = adpBy[y0][id];
      if (prev == null || cur > MAXDEST || prev - cur < RISE) return;
      const m = metaBy[y][id] || {};
      if (POS.indexOf(m.pos) < 0) return;
      const p20 = slotPct(m.pos, cur, 0.2), p50 = slotPct(m.pos, cur, 0.5), p80 = slotPct(m.pos, cur, 0.8);
      if (p80 == null) return;
      const pts = ptsBy[y][id] || 0;
      const info = ids[id] || {};
      const age = info.birth ? Math.floor((Date.UTC(y, 8, 1) - Date.parse(info.birth)) / 31557600000) : null;
      const ry = m.rookieYear || info.draftYear;
      const expc = ry == null ? null : (y - ry === 1 ? 'soph' : y - ry === 2 ? 'third' : y - ry >= 3 ? 'vet' : null);
      risers.push({
        season: y, pos: m.pos, rise: Math.round(prev - cur), dest: band(cur),
        age: age, expc: expc,
        boom: pts >= p80 ? 1 : 0, hit: pts >= p50 ? 1 : 0, bust: pts <= p20 ? 1 : 0
      });
    });
  }
  console.log('\nrisers total: ' + risers.length);

  // Buckets: singles + the combos the draft bar can name. n>=15 or it stays out.
  const LABELS = {
    all: 'Risers overall',
    'pos:QB': 'QB risers', 'pos:RB': 'RB risers', 'pos:WR': 'WR risers', 'pos:TE': 'TE risers',
    'dest:early': 'risers going in rounds 1-6', 'dest:mid': 'risers going in rounds 7-10', 'dest:late': 'risers going in rounds 11-16',
    'age:le25': 'risers age 25 or younger', 'age:ge26': 'risers age 26 plus',
    'exp:soph': 'second-year risers', 'exp:third': 'third-year risers', 'exp:vet': 'veteran risers'
  };
  const DEST_TXT = { early: 'rounds 1-6', mid: 'rounds 7-10', late: 'rounds 11-16' };
  const EXP_TXT = { soph: 'second-year', third: 'third-year', vet: 'veteran' };
  const groups = {};
  const add = (k, r, label) => { const g = (groups[k] = groups[k] || { boom: 0, hit: 0, bust: 0, n: 0, label: label }); g.boom += r.boom; g.hit += r.hit; g.bust += r.bust; g.n++; };
  risers.forEach(r => {
    add('all', r, LABELS.all);
    add('pos:' + r.pos, r, LABELS['pos:' + r.pos]);
    add('dest:' + r.dest, r, LABELS['dest:' + r.dest]);
    if (r.age != null) add(r.age <= 25 ? 'age:le25' : 'age:ge26', r, LABELS[r.age <= 25 ? 'age:le25' : 'age:ge26']);
    if (r.expc) add('exp:' + r.expc, r, LABELS['exp:' + r.expc]);
    // combos, most specific first - what the draft bar line names
    if (r.expc) add(r.pos + '|' + r.expc + '|' + r.dest, r, EXP_TXT[r.expc] + ' ' + r.pos + ' risers into ' + DEST_TXT[r.dest]);
    if (r.expc) add(r.expc + '|' + r.dest, r, EXP_TXT[r.expc] + ' risers into ' + DEST_TXT[r.dest]);
    add(r.pos + '|' + r.dest, r, r.pos + ' risers into ' + DEST_TXT[r.dest]);
    if (r.age != null) add(r.pos + '|' + (r.age <= 25 ? 'le25' : 'ge26'), r, r.pos + ' risers age ' + (r.age <= 25 ? '25 or younger' : '26 plus'));
  });
  const buckets = {};
  Object.keys(groups).sort().forEach(k => {
    const g = groups[k];
    if (g.n < 15) return; // small sample: no read
    buckets[k] = { label: g.label, boom: Math.round(g.boom / g.n * 100), hit: Math.round(g.hit / g.n * 100), bust: Math.round(g.bust / g.n * 100), n: g.n };
    console.log(k.padEnd(22) + ' boom ' + buckets[k].boom + '%  hit ' + buckets[k].hit + '%  bust ' + buckets[k].bust + '%  n=' + g.n);
  });

  // Prior-season final ADP for the app's live detector (rounded, depth-capped)
  const last = SEASONS[SEASONS.length - 1];
  const prev = {};
  Object.keys(adpBy[last]).forEach(id => { const a = adpBy[last][id]; if (a <= 400) prev[id] = Math.round(a); });
  const out = {
    seasons: SEASONS[0] + '-' + last, pairs: SEASONS.length - 1, riseRounds: 3,
    source: 'sleeper-adp-ppr', prevSeason: last, built: new Date().toISOString().slice(0, 10),
    buckets: buckets, prev: prev
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('\nwrote ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes, prev players: ' + Object.keys(prev).length + ')');
}
main().catch(e => { console.error(e); process.exit(1); });
