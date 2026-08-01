// Empirical derivations for the mock-engine value audit. Each section prints
// the math behind one constant so the number that lands in app.js carries a
// real derivation, not a vibe.
import fs from 'node:fs';

const J = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
const POS = ['QB', 'RB', 'WR', 'TE'];
const posQ = POS.map(p => 'position[]=' + p).join('&');

// 2026 season projections (full PPR) + the live PPR ADP the app drafts with
const proj = await J(`https://api.sleeper.com/projections/nfl/2026?season_type=regular&${posQ}&order_by=adp_ppr`);
const players = proj.map(e => ({
  id: e.player_id, name: (e.player.first_name || '') + ' ' + (e.player.last_name || ''),
  pos: e.player.position, adp: e.stats && e.stats.adp_ppr < 900 ? e.stats.adp_ppr : null,
  pts: e.stats && e.stats.pts_ppr != null ? e.stats.pts_ppr : null,
  rec: e.stats && e.stats.rec != null ? e.stats.rec : 0
})).filter(p => POS.includes(p.pos) && p.pts != null);
const drafted = players.filter(p => p.adp && p.adp <= 200).sort((a, b) => a.adp - b.adp);
console.log('players with proj:', players.length, '| drafted pool (adp<=200):', drafted.length);

// ── 1. The points-per-slot curve vs the linear dv (dv = 11000 - adp*40) ─────
// Median projected points in each 12-pick window of ADP: shows the convexity.
console.log('\n== 1. points curve by ADP slot (median proj pts per 12-pick round) ==');
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const roundMed = [];
for (let r = 1; r <= 16; r++) {
  const w = drafted.filter(p => Math.ceil(p.adp / 12) === r).map(p => p.pts);
  roundMed[r] = med(w);
  if (w.length) console.log(`R${String(r).padStart(2)}: median ${Math.round(roundMed[r])} pts (n=${w.length})  | pts-per-pick slope vs prev: ${r > 1 && roundMed[r - 1] ? ((roundMed[r - 1] - roundMed[r]) / 12).toFixed(1) : '-'}`);
}
console.log('=> dv says every pick is worth the same 40dv; real slope in pts/pick above.');

// What the current VORP word thresholds (2400/1200/400 dv = 60/30/10 picks)
// mean in POINTS at different zones:
for (const anchor of [12, 60, 120]) {
  const ptsAt = adp => { const near = drafted.filter(p => Math.abs(p.adp - adp) <= 8).map(p => p.pts); return med(near); };
  console.log(`at ADP ${anchor}: 60 picks of dv = ${Math.round((ptsAt(anchor) || 0) - (ptsAt(anchor + 60) || 0))} pts | 30 picks = ${Math.round((ptsAt(anchor) || 0) - (ptsAt(anchor + 30) || 0))} pts | 10 picks = ${Math.round((ptsAt(anchor) || 0) - (ptsAt(anchor + 10) || 0))} pts`);
}

// ── 2. Room-size QB/TE shift, derived from real VORP ────────────────────────
console.log('\n== 2. elite QB/TE advantage vs replacement, by room size (1QB) ==');
const byPos = pos => drafted.filter(p => p.pos === pos); // already adp-sorted
// pts→picks: local slope of the overall points curve around the player's ADP
const slopeAt = adp => {
  const a = med(drafted.filter(p => Math.abs(p.adp - adp) <= 10).map(p => p.pts));
  const b = med(drafted.filter(p => Math.abs(p.adp - (adp + 24)) <= 10).map(p => p.pts));
  return a != null && b != null && a > b ? (a - b) / 24 : 1; // pts per pick
};
for (const teams of [8, 10, 12, 14]) {
  for (const pos of ['QB', 'TE']) {
    const arr = byPos(pos);
    const repl = arr[Math.min(arr.length - 1, teams)]; // starters=1 → the (teams+1)-th is the wire
    const elite = arr.slice(0, 3);
    const adv = med(elite.map(p => p.pts)) - repl.pts;
    const mid = arr[Math.min(arr.length - 1, Math.floor(teams * 0.75))]; // a mid starter (e.g. QB9 of 12)
    const advMid = mid.pts - repl.pts;
    const sl = slopeAt(elite[2].adp);
    console.log(`${teams}t ${pos}: elite top-3 med ${Math.round(med(elite.map(p => p.pts)))} vs repl ${pos}${teams + 1} ${Math.round(repl.pts)} = +${Math.round(adv)} pts (~${(adv / sl).toFixed(0)} picks at slope ${sl.toFixed(1)}) | mid-starter +${Math.round(advMid)} pts`);
  }
}
console.log('current shift: 8t +10, 10t +5, 12t 0, 14t -4 picks (elite gets +0.4x in shallow)');

// ── 3. TE premium: +0.5 PPR per reception, re-ranked ────────────────────────
console.log('\n== 3. TE premium (+0.5/rec) — how many picks do TEs really move? ==');
const ranked = [...drafted].sort((a, b) => b.pts - a.pts);
const rankedTEP = [...drafted].map(p => ({ ...p, pts2: p.pos === 'TE' ? p.pts + 0.5 * p.rec : p.pts }))
  .sort((a, b) => b.pts2 - a.pts2);
const posOf = (arr, id) => arr.findIndex(p => p.id === id) + 1;
byPos('TE').slice(0, 12).forEach((te, i) => {
  const before = posOf(ranked, te.id), after = posOf(rankedTEP, te.id);
  if (i < 12) console.log(`TE${i + 1} ${te.name.trim()}: overall pts-rank ${before} -> ${after} (moves ${before - after} slots)`);
});
console.log('current MD.tep: bias 1.25 => +450dv (~11 picks) mid rounds, capped +200dv (~5) elite');

// ── 4+9. ADP deviation by round (FantasyFootballCalculator carries stdev) ──
console.log('\n== 4/9. real ADP stdev by round (FFC live drafts) ==');
const ffc = await J('https://fantasyfootballcalculator.com/api/v1/adp/ppr?year=2026&teams=12');
const fp = (ffc.players || []).filter(p => p.adp && p.stdev != null);
console.log('FFC players with stdev:', fp.length, '| drafts:', ffc.meta && ffc.meta.total_drafts);
for (let r = 1; r <= 14; r++) {
  const w = fp.filter(p => Math.ceil(p.adp / 12) === r).map(p => p.stdev);
  if (w.length >= 3) console.log(`R${String(r).padStart(2)}: median stdev ±${med(w).toFixed(1)} picks (n=${w.length})`);
}
// simple fit: stdev ≈ a + b*adp
{
  const xs = fp.map(p => p.adp), ys = fp.map(p => p.stdev);
  const n = xs.length, sx = xs.reduce((a, b) => a + b), sy = ys.reduce((a, b) => a + b);
  const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
  console.log(`linear fit: stdev ≈ ${a.toFixed(2)} + ${b.toFixed(4)}*adp  (e.g. adp 12 → ±${(a + b * 12).toFixed(1)}, adp 60 → ±${(a + b * 60).toFixed(1)}, adp 140 → ±${(a + b * 140).toFixed(1)})`);
}

// ── 6. effective starters per position with a FLEX (greedy lineup fill) ─────
console.log('\n== 6. effective WR/RB starters in a 1QB/2RB/2WR/1TE/1FLEX room ==');
{
  const teams = 12, lineup = { QB: 1, RB: 2, WR: 2, TE: 1 }, flex = 1;
  // every team drafts a balanced roster off the top of the board; the flex
  // goes to the best remaining RB/WR/TE by projected points
  const used = { RB: 0, WR: 0, TE: 0 };
  const pool = [...drafted];
  for (let t = 0; t < teams; t++) {
    for (const [ps, k] of Object.entries(lineup)) {
      for (let i = 0; i < k; i++) { const ix = pool.findIndex(p => p.pos === ps); if (ix >= 0) pool.splice(ix, 1); }
    }
  }
  // count dedicated starters used
  const dedicated = { QB: teams, RB: teams * 2, WR: teams * 2, TE: teams };
  for (let t = 0; t < teams * flex; t++) {
    const ix = pool.reduce((best, p, i) => (['RB', 'WR', 'TE'].includes(p.pos) && (best < 0 || p.pts > pool[best].pts)) ? i : best, -1);
    if (ix >= 0) { used[pool[ix].pos]++; pool.splice(ix, 1); }
  }
  console.log('flex slots taken by:', used, `=> effective starters: RB ${(dedicated.RB + used.RB) / teams}, WR ${(dedicated.WR + used.WR) / teams}, TE ${(dedicated.TE + used.TE) / teams}`);
  console.log('current replacement uses {QB:1(2 sf),RB:2,WR:ppr?3:2,TE:1} starters per team');
}

// ── 7. live value percentiles for tier labels ───────────────────────────────
console.log('\n== 7. FantasyCalc value distribution (redraft) vs fixed 7000/5500/4000/2500 ==');
{
  const kt = await J('https://trademindff.com/api/ktc/rankings?numQbs=1&ppr=1&isDynasty=false');
  const vals = Object.values(kt.byIdFull || {}).filter(v => POS.includes(v.position) && v.value > 100)
    .sort((a, b) => b.value - a.value);
  console.log('valued players:', vals.length);
  const pctOfVal = v => (vals.filter(x => x.value >= v).length / vals.length * 100).toFixed(1);
  for (const t of [7000, 5500, 4000, 2500]) console.log(`>=${t}: ${vals.filter(v => v.value >= t).length} players (top ${pctOfVal(t)}%) — e.g. ${vals.filter(v => v.value >= t).slice(-3).map(v => v.name).join(', ')}`);
  const atPct = q => vals[Math.floor(vals.length * q)] || vals[vals.length - 1];
  for (const q of [0.02, 0.06, 0.15, 0.35]) console.log(`p${q * 100} cutoff would be value ${atPct(q).value} (${atPct(q).name})`);
}

// ── 10. playoff SOS: distribution of week 15-17 defense-difficulty means ────
console.log('\n== 10. playoff SOS distribution ==');
{
  const games = await J('https://api.sleeper.app/schedule/nfl/regular/2026');
  const adv = await J('https://trademindff.com/api/stats/adv');
  const dst = adv.dst, sched = {};
  games.forEach(g => { if (g.week && g.home && g.away) { (sched[g.home] = sched[g.home] || {})[g.week] = g.away; (sched[g.away] = sched[g.away] || {})[g.week] = g.home; } });
  const scores = [];
  Object.keys(sched).forEach(t => { let s = 0, n = 0; [15, 16, 17].forEach(w => { const o = sched[t][w]; if (o && dst[o] != null) { s += dst[o]; n++; } }); if (n === 3) scores.push({ t, v: s / n }); });
  scores.sort((a, b) => b.v - a.v);
  const mean = scores.reduce((a, s) => a + s.v, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, s) => a + (s.v - mean) ** 2, 0) / scores.length);
  console.log(`teams ${scores.length}, mean ${mean.toFixed(1)}, sd ${sd.toFixed(1)}`);
  console.log('sorted:', scores.map(s => `${s.t} ${s.v.toFixed(1)}`).join(' | '));
  for (const z of [0.75, 1.0]) console.log(`±${z}σ cutoff (soft>${(mean + z * sd).toFixed(1)}, tough<${(mean - z * sd).toFixed(1)}): soft=${scores.filter(s => s.v > mean + z * sd).length}, tough=${scores.filter(s => s.v < mean - z * sd).length}`);
}
