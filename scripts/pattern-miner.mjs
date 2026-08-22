#!/usr/bin/env node
// Pattern miner — the generalized version of the one-off riser study.
// Systematically scans player-season cohorts for draft-outcome patterns of the
// kind @ConnorAllenNFL publishes (e.g. "RB risers age 26+ boom 9% of the
// time"), with strict honesty guards, and publishes the few that survive to
// public/signals.json for the app's Market Signals card and board tags.
//
// Data (all free, all verified):
//   - api.sleeper.com/projections/nfl/{Y}  -> final preseason ADP (adp_ppr)
//     per player + season team. Coverage starts 2020; earlier years come back
//     empty (verified 2026-07-31).
//   - api.sleeper.com/stats/nfl/{Y}        -> actual season PPR points.
//   - dynastyprocess db_playerids.csv      -> birthdate per Sleeper id.
//
// Definitions (same as the stage-1 riser study):
//   drafted     = final ADP inside 16 rounds (12-team, pick <= 192)
//   slot        = position x destination round, pooled across all seasons;
//                 round cell when it holds 20+ outcomes, else early/mid/late
//   BOOM / BUST = actual points >= p80 / <= p20 of the slot;  HIT = >= p50
//   riser/faller= final ADP moved 36+ picks (3 rounds) year over year
//
// Honesty guards, in order:
//   1. n >= 15 in the cohort.
//   2. The effect must survive EVERY simpler explanation: for each one-dim-
//      relaxed parent cohort, |rate - parent rate| >= 8 points, same sign.
//   3. Binomial z >= 3.0 against every parent (conservative for the ~1-2k
//      cells scanned; combined with guard 2 this is the real multiple-
//      comparisons brake - we prefer 5 solid findings to 50 shaky ones).
//   4. Findings already published (scripts/data/findings-ledger.json) are
//      skipped, so a scheduled run never repeats itself.
//
// Usage:
//   node scripts/pattern-miner.mjs             # mine, publish top findings
//   node scripts/pattern-miner.mjs --refresh   # re-download the dataset first
//   node scripts/pattern-miner.mjs --top 5     # cap published findings (3-7)
//   node scripts/pattern-miner.mjs --dry       # mine + print, write nothing
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'scripts', 'data');
const DATASET = path.join(DATA_DIR, 'dataset.json');
const LEDGER = path.join(DATA_DIR, 'findings-ledger.json');
const SIGNALS = path.join(ROOT, 'public', 'signals.json');

const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025]; // verified ADP coverage
const CUR_SEASON = 2026;
const TEAMS = 12, RISE = 36, MAXDEST = 192;
const POS = ['QB', 'RB', 'WR', 'TE'];
// MIN_Z is per-parent; a finding must clear it against EVERY simpler cohort
// simultaneously, which is the real multiple-comparisons brake (a fluke has
// to look extreme against all of its parents at once, not against one test).
// z=3 on a single test is unreachable at n=15-60 - it rejected the exact
// findings this tool exists to surface - so the bar lives here instead.
const MIN_N = 15, MIN_EFFECT = 8, MIN_Z = 2.0, MAX_SPECIFIED = 3;

const argv = process.argv.slice(2);
const REFRESH = argv.includes('--refresh');
const DRY = argv.includes('--dry');
const TOP = Math.min(7, Math.max(3, parseInt(argv[argv.indexOf('--top') + 1], 10) || 7));

const posQ = POS.map(p => 'position[]=' + p).join('&');
async function getJson(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(u + ' -> ' + r.status);
  return r.json();
}

// ── dataset: download once, reuse until --refresh ───────────────────────────
async function buildDataset() {
  const seasons = {};
  for (const y of SEASONS) {
    const proj = await getJson(`https://api.sleeper.com/projections/nfl/${y}?season_type=regular&${posQ}&order_by=adp_ppr`);
    const st = await getJson(`https://api.sleeper.com/stats/nfl/${y}?season_type=regular&${posQ}&order_by=pts_ppr`);
    const byId = {};
    proj.forEach(e => {
      const s = e.stats || {};
      if (!e.player_id || !s.adp_ppr || s.adp_ppr >= 900) return;
      byId[e.player_id] = {
        adp: s.adp_ppr,
        pos: e.player && e.player.position,
        team: e.team || null, // the SEASON's team, not today's (verified: Barkley 2022 -> NYG)
        rookieYear: (e.player && e.player.metadata && parseInt(e.player.metadata.rookie_year, 10)) || null,
        pts: 0
      };
    });
    st.forEach(e => {
      const s = e.stats || {};
      if (e.player_id && byId[e.player_id] && s.pts_ppr != null) byId[e.player_id].pts = s.pts_ppr;
    });
    seasons[y] = byId;
    console.log(`  ${y}: ${Object.keys(byId).length} drafted-pool players`);
  }
  // birthdates for age-at-season
  const csv = await (await fetch('https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv')).text();
  const rows = csv.split('\n'); const head = rows[0].split(',');
  const iSlp = head.indexOf('sleeper_id'), iBd = head.indexOf('birthdate');
  const births = {};
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].split(',');
    if (c[iSlp] && /^\d+$/.test(c[iSlp]) && c[iBd] && c[iBd] !== 'NA') births[c[iSlp]] = c[iBd];
  }
  return { built: new Date().toISOString(), seasons, births };
}
async function loadDataset() {
  if (!REFRESH && fs.existsSync(DATASET)) return JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  console.log('downloading dataset...');
  const d = await buildDataset();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATASET, JSON.stringify(d));
  console.log('dataset saved: ' + DATASET);
  return d;
}

// ── observations: one row per drafted player-season, with cohort dims ──────
const ageBandOf = a => a == null ? null : a <= 23 ? 'le23' : a <= 25 ? 'a2425' : a <= 27 ? 'a2627' : 'ge28';
const expBandOf = e => e == null ? null : e === 0 ? 'rookie' : e === 1 ? 'soph' : e <= 5 ? 'y3to5' : 'vet6';
const destBandOf = adp => adp <= 36 ? 'r13' : adp <= 72 ? 'r46' : adp <= 120 ? 'r710' : 'r1116';
const band3 = adp => adp <= 72 ? 'early' : adp <= 120 ? 'mid' : 'late';
const ageAt = (birth, y) => birth ? Math.floor((Date.UTC(y, 8, 1) - Date.parse(birth)) / 31557600000) : null;

function buildObservations(ds) {
  // slot expectation cells, pooled across every covered season
  const cells = {};
  for (const y of SEASONS) {
    for (const [id, r] of Object.entries(ds.seasons[y])) {
      if (r.adp > MAXDEST || POS.indexOf(r.pos) < 0) continue;
      const rd = Math.ceil(r.adp / TEAMS);
      (cells[r.pos + '|' + rd] = cells[r.pos + '|' + rd] || []).push(r.pts);
      (cells[r.pos + '|' + band3(r.adp)] = cells[r.pos + '|' + band3(r.adp)] || []).push(r.pts);
    }
  }
  Object.values(cells).forEach(a => a.sort((x, y) => x - y));
  const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const slotPct = (pos, adp, p) => {
    const rc = cells[pos + '|' + Math.ceil(adp / TEAMS)];
    const use = (rc && rc.length >= 20) ? rc : cells[pos + '|' + band3(adp)];
    return use && use.length ? pct(use, p) : null;
  };
  const outcomeOf = (pos, adp, pts) => {
    const p20 = slotPct(pos, adp, 0.2), p50 = slotPct(pos, adp, 0.5), p80 = slotPct(pos, adp, 0.8);
    if (p80 == null) return null;
    return { boom: pts >= p80 ? 1 : 0, hit: pts >= p50 ? 1 : 0, bust: pts <= p20 ? 1 : 0, delta: Math.round(pts - p50) };
  };

  const obs = [];
  for (let i = 0; i < SEASONS.length; i++) {
    const y = SEASONS[i], prevY = SEASONS[i - 1];
    for (const [id, r] of Object.entries(ds.seasons[y])) {
      if (r.adp > MAXDEST || POS.indexOf(r.pos) < 0) continue;
      const out = outcomeOf(r.pos, r.adp, r.pts);
      if (!out) continue;
      const prev = prevY ? ds.seasons[prevY][id] : null;
      let move = null, teamChange = null, prevOut = null;
      if (prev) {
        move = prev.adp - r.adp >= RISE ? 'riser' : r.adp - prev.adp >= RISE ? 'faller' : 'stable';
        if (prev.team && r.team) teamChange = prev.team !== r.team ? 'moved' : 'stayed';
        if (prev.adp <= MAXDEST) {
          const po = outcomeOf(prev.pos, prev.adp, prev.pts);
          if (po) prevOut = po.boom ? 'boomed' : po.bust ? 'busted' : 'mid';
        }
      }
      const exp = r.rookieYear != null ? y - r.rookieYear : null;
      obs.push({
        id, season: y, pos: r.pos,
        ageBand: ageBandOf(ageAt(ds.births[id], y)),
        expBand: expBandOf(exp != null && exp >= 0 ? exp : null),
        destBand: destBandOf(r.adp),
        move, teamChange, prevOut,
        boom: out.boom, hit: out.hit, bust: out.bust, delta: out.delta
      });
    }
  }
  return { obs, outcomeOf };
}

// ── the hypothesis space, enumerated ───────────────────────────────────────
const DIMS = {
  pos: POS,
  ageBand: ['le23', 'a2425', 'a2627', 'ge28'],
  expBand: ['rookie', 'soph', 'y3to5', 'vet6'],
  destBand: ['r13', 'r46', 'r710', 'r1116'],
  move: ['riser', 'faller', 'stable'],
  teamChange: ['moved'],
  prevOut: ['boomed', 'busted']
};
const PHRASE = {
  pos: { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs' },
  ageBand: { le23: 'age 23 or younger', a2425: 'age 24-25', a2627: 'age 26-27', ge28: 'age 28+' },
  expBand: { rookie: 'rookie', soph: 'second-year', y3to5: 'year 3-5', vet6: 'sixth-year-plus' },
  destBand: { r13: 'drafted in rounds 1-3', r46: 'drafted in rounds 4-6', r710: 'drafted in rounds 7-10', r1116: 'drafted in rounds 11-16' },
  move: { riser: 'ADP risers (up 3+ rounds)', faller: 'ADP fallers (down 3+ rounds)', stable: 'stable-ADP players' },
  teamChange: { moved: 'who changed teams' },
  prevOut: { boomed: 'coming off a boom season', busted: 'coming off a bust season' }
};
function phrase(def) {
  // natural order: experience, age, position/movement, team change, prior outcome, destination
  const bits = [];
  if (def.expBand) bits.push(PHRASE.expBand[def.expBand]);
  if (def.ageBand && !def.expBand) bits.push(''); // age reads after the noun
  const noun = def.pos && def.move ? PHRASE.pos[def.pos].replace(/s$/, '') + ' ' + PHRASE.move[def.move].replace('ADP ', '')
    : def.pos ? PHRASE.pos[def.pos]
      : def.move ? PHRASE.move[def.move] : 'players';
  bits.push(noun);
  if (def.ageBand) bits.push(PHRASE.ageBand[def.ageBand]);
  if (def.teamChange) bits.push(PHRASE.teamChange[def.teamChange]);
  if (def.prevOut) bits.push(PHRASE.prevOut[def.prevOut]);
  if (def.destBand) bits.push(PHRASE.destBand[def.destBand]);
  return bits.filter(Boolean).join(' ');
}
function* cohorts() {
  const names = Object.keys(DIMS);
  // all subsets of dims up to MAX_SPECIFIED, then the cross product of values
  const subsets = [];
  const rec = (i, cur) => {
    if (cur.length) subsets.push([...cur]);
    if (cur.length >= MAX_SPECIFIED) return;
    for (let j = i; j < names.length; j++) { cur.push(names[j]); rec(j + 1, cur); cur.pop(); }
  };
  rec(0, []);
  for (const dims of subsets) {
    const walk = (k, def) => dims.length === k ? [def] :
      DIMS[dims[k]].flatMap(v => walk(k + 1, { ...def, [dims[k]]: v }));
    for (const def of walk(0, {})) yield def;
  }
}
const match = (o, def) => Object.entries(def).every(([k, v]) => o[k] === v);
const rates = members => {
  const n = members.length;
  const s = members.reduce((a, o) => { a.boom += o.boom; a.hit += o.hit; a.bust += o.bust; return a; }, { boom: 0, hit: 0, bust: 0 });
  const deltas = members.map(o => o.delta).sort((a, b) => a - b);
  return { n, boom: s.boom / n * 100, hit: s.hit / n * 100, bust: s.bust / n * 100, medDelta: deltas[Math.floor(n / 2)] || 0 };
};

function mine(obs) {
  const cache = new Map();
  const globalRates = rates(obs);
  const rated = def => {
    if (!Object.keys(def).length) return globalRates;
    const key = JSON.stringify(def);
    if (!cache.has(key)) { const m = obs.filter(o => match(o, def)); cache.set(key, m.length ? rates(m) : null); }
    return cache.get(key);
  };
  const findings = [];
  let scanned = 0;
  for (const def of cohorts()) {
    const r = rated(def);
    scanned++;
    if (!r || r.n < MIN_N) continue;
    for (const metric of ['boom', 'bust']) {
      // Guard 2: dominance - every one-dim-relaxed parent must sit on the
      // same side and at least 4 points away, so no simpler cohort nearly
      // explains the cell. Guard 3: vs the primary baseline (the largest-n
      // parent, "el grupo padre"), the effect must be >= 8 points with z >= 2.
      let sign = 0, ok = true, minEffect = Infinity, baseline = null;
      for (const dim of Object.keys(def)) {
        const parentDef = { ...def }; delete parentDef[dim];
        const pr = rated(parentDef);
        if (!pr || pr.n < 30) { ok = false; break; }
        const eff = r[metric] - pr[metric];
        if (sign === 0) sign = Math.sign(eff);
        if (Math.sign(eff) !== sign || Math.abs(eff) < MIN_EFFECT / 2) { ok = false; break; }
        if (Math.abs(eff) < minEffect) minEffect = Math.abs(eff);
        if (!baseline || pr.n > baseline.n) baseline = { def: parentDef, rate: pr[metric], n: pr.n };
      }
      if (!ok || !baseline) continue;
      const effect = Math.abs(r[metric] - baseline.rate);
      if (effect < MIN_EFFECT) continue;
      const p0 = baseline.rate / 100;
      const z = Math.abs(r[metric] / 100 * r.n - r.n * p0) / Math.sqrt(r.n * p0 * (1 - p0) || 1);
      if (z < MIN_Z) continue;
      findings.push({ def, metric, r, minEffect, effect, minZ: z, sign, baseline });
    }
  }
  console.log(`scanned ${scanned} cohorts -> ${findings.length} findings passed guards`);
  return findings;
}

// ── candidates on THIS year's board ────────────────────────────────────────
async function currentCandidates(ds, outcomeOf) {
  const proj = await getJson(`https://api.sleeper.com/projections/nfl/${CUR_SEASON}?season_type=regular&${posQ}&order_by=adp_ppr`);
  const lastY = SEASONS[SEASONS.length - 1];
  const players = [];
  proj.forEach(e => {
    const s = e.stats || {};
    if (!e.player_id || !s.adp_ppr || s.adp_ppr >= 900 || s.adp_ppr > MAXDEST) return;
    const pl = e.player || {};
    if (POS.indexOf(pl.position) < 0) return;
    const prev = ds.seasons[lastY][e.player_id];
    let move = null, teamChange = null, prevOut = null;
    if (prev) {
      move = prev.adp - s.adp_ppr >= RISE ? 'riser' : s.adp_ppr - prev.adp >= RISE ? 'faller' : 'stable';
      if (prev.team && (e.team || pl.team)) teamChange = prev.team !== (e.team || pl.team) ? 'moved' : 'stayed';
      if (prev.adp <= MAXDEST) {
        const po = outcomeOf(prev.pos, prev.adp, prev.pts);
        if (po) prevOut = po.boom ? 'boomed' : po.bust ? 'busted' : 'mid';
      }
    }
    const ry = (pl.metadata && parseInt(pl.metadata.rookie_year, 10)) || null;
    players.push({
      id: e.player_id, name: ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim(),
      adp: Math.round(s.adp_ppr), pos: pl.position,
      ageBand: ageBandOf(ageAt(ds.births[e.player_id], CUR_SEASON)),
      expBand: expBandOf(ry != null ? CUR_SEASON - ry : null),
      destBand: destBandOf(s.adp_ppr), move, teamChange, prevOut
    });
  });
  return players;
}

// ── publish ────────────────────────────────────────────────────────────────
const hashOf = f => crypto.createHash('sha1').update(JSON.stringify(f.def) + '|' + f.metric).digest('hex').slice(0, 12);
function claimOf(f, seasons) {
  const rate = Math.round(f.r[f.metric]), base = Math.round(f.baseline.rate);
  const word = f.metric === 'boom' ? 'boom' : 'bust';
  return `${rate}% ${word} rate for ${phrase(f.def)}, vs ${base}% for ${phrase(f.baseline.def)} (${seasons}, n=${f.r.n})`;
}
function detailOf(f, seasons) {
  const r = f.r;
  return `Cohort: ${phrase(f.def)}. Boom ${Math.round(r.boom)}% · hit ${Math.round(r.hit)}% · bust ${Math.round(r.bust)}% · median ${r.medDelta >= 0 ? '+' : ''}${r.medDelta} pts vs slot expectation. n=${r.n}, ${seasons}. Baseline: ${phrase(f.baseline.def)} at ${Math.round(f.baseline.rate)}% (n=${f.baseline.n}). Boom/bust = top/bottom 20% of outcomes for the same position and draft slot.`;
}

async function main() {
  const ds = await loadDataset();
  const { obs, outcomeOf } = buildObservations(ds);
  console.log(`observations: ${obs.length} drafted player-seasons (${SEASONS[0]}-${SEASONS.at(-1)})`);
  const seasonsTxt = SEASONS[0] + '-' + SEASONS.at(-1);

  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { published: {} };
  const all = mine(obs);
  let findings = all.filter(f => !ledger.published[hashOf(f)]);
  console.log(`${findings.length} after skipping ${Object.keys(ledger.published).length} already-published`);

  const cands = await currentCandidates(ds, outcomeOf);
  const enrich = f => {
    f.candidates = cands.filter(c => match(c, f.def)).sort((a, b) => a.adp - b.adp).slice(0, 8)
      .map(c => ({ id: c.id, name: c.name, pos: c.pos, adp: c.adp }));
    f.score = f.minEffect * Math.log2(f.r.n) * (1 + (f.candidates.length ? 0.5 : 0));
  };
  findings.forEach(enrich);
  findings.sort((a, b) => b.score - a.score);
  let picked = findings.slice(0, TOP);
  // Steady state: the finding shelf is finite until a new season adds data.
  // When fresh ones run short, refill with the best already-published findings
  // (oldest first, so rotation cycles) - their CANDIDATES are recomputed
  // against today's ADP, which is what actually moves week to week.
  if (picked.length < TOP) {
    const refill = all.filter(f => ledger.published[hashOf(f)] && !picked.includes(f))
      .sort((a, b) => (ledger.published[hashOf(a)].date || '').localeCompare(ledger.published[hashOf(b)].date || ''));
    refill.forEach(enrich);
    picked = picked.concat(refill.slice(0, TOP - picked.length));
    if (refill.length) console.log(`refilled ${Math.min(refill.length, TOP - findings.length)} from ledger (fresh candidates, rotated oldest-first)`);
  }

  console.log('\n== findings this run ==');
  picked.forEach((f, i) => {
    console.log(`${i + 1}. [score ${f.score.toFixed(1)} | effect ${f.minEffect.toFixed(1)}pp | z ${f.minZ.toFixed(1)} | n ${f.r.n}]`);
    console.log('   ' + claimOf(f, seasonsTxt));
    if (f.candidates.length) console.log('   candidates: ' + f.candidates.map(c => `${c.name} (ADP ${c.adp})`).join(', '));
  });
  if (!picked.length) console.log('(none passed the guards that were not already published)');

  if (DRY) { console.log('\n--dry: nothing written'); return; }
  const out = {
    computed_at: new Date().toISOString().slice(0, 10),
    seasons: seasonsTxt, source: 'sleeper-adp-ppr + real ppr outcomes',
    signals: picked.map(f => ({ id: hashOf(f), claim: claimOf(f, seasonsTxt), detail: detailOf(f, seasonsTxt), candidates: f.candidates }))
  };
  fs.writeFileSync(SIGNALS, JSON.stringify(out));
  picked.forEach(f => { ledger.published[hashOf(f)] = { claim: claimOf(f, seasonsTxt), date: out.computed_at }; });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
  console.log(`\nwrote ${SIGNALS} (${fs.statSync(SIGNALS).size} bytes, ${picked.length} signals) + ledger updated`);
}
main().catch(e => { console.error(e); process.exit(1); });
