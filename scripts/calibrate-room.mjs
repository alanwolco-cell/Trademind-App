#!/usr/bin/env node
// Room calibration harness — runs the REAL mock-draft engine (public/app.js,
// loaded whole into a DOM-stubbed sandbox) against the LIVE boards the app
// drafts with, then checks realism invariants over hundreds of simulated
// rooms. Any change to an engine value should pass this before it deploys:
//
//   node scripts/calibrate-room.mjs             # full run (600 rooms/format)
//   node scripts/calibrate-room.mjs --rooms 100 # quicker sanity pass
//
// Invariants (each prints PASS/FAIL with evidence):
//   (a) no bot reach beyond +6 picks in R1 / +10 in R2 vs its own board
//   (b) 1QB rooms: 2-7 QBs drafted by the end of round 5
//   (c) first K/DEF never before the final two rounds
//   (d) elite TEs (top-3 by board) go within ±1.5 rounds of their ADP
//   (e) superflex rooms: 8+ QBs drafted by the end of round 4
//   (f) no single 1QB bot drafts his QB2 before round 8
//   (g) archetypes measurably diverge (zerorb < bpa < robustrb on early RBs;
//       earlyqb takes his QB1 clearly before lateqb)
//
// The sandbox rewrites every relative /api/* fetch to the production host, so
// the engine drafts off the same ADP/value feeds users get.
'use strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const BASE = process.env.CAL_BASE || 'https://trademindff.com';
const argv = process.argv.slice(2);
const ROOMS = parseInt(argv[argv.indexOf('--rooms') + 1], 10) || 600;

// ── DOM + browser stubs ─────────────────────────────────────────────────────
const values = {}; // element id -> .value the settings readers see
function el(id) {
  const e = {
    id, style: {}, dataset: {}, options: [], children: [],
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    get value() { return values[id] != null ? values[id] : ''; },
    set value(v) { values[id] = v; },
    checked: false, innerHTML: '', textContent: '', disabled: false,
    appendChild(c) { return c; }, insertBefore(a) { return a; }, removeChild() { }, remove() { },
    closest: () => ({ style: { display: 'none' } }),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    scrollIntoView() { }, focus() { }, blur() { }, click() { },
    addEventListener() { }, removeEventListener() { },
    querySelector: () => null, querySelectorAll: () => [],
    setAttribute() { }, getAttribute: () => null, parentElement: null
  };
  return e;
}
const elCache = {};
const document = {
  getElementById: id => (elCache[id] = elCache[id] || el(id)),
  createElement: tag => el('_' + tag + Math.random()),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { },
  body: el('body'), documentElement: el('html'), head: el('head'),
  createTextNode: t => ({ textContent: t }), title: ''
};
const sandbox = {
  document, console, Math, Date, JSON, Object, Array, String, Number, Boolean,
  parseInt, parseFloat, isNaN, isFinite, RegExp, Error, Promise, Map, Set,
  encodeURIComponent, decodeURIComponent, escape, unescape, URL, URLSearchParams,
  navigator: { userAgent: 'calibrate', clipboard: {} },
  location: { search: '', href: BASE + '/', pathname: '/', hash: '', origin: BASE },
  history: { pushState() { }, replaceState() { } },
  localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  alert() { }, confirm: () => true, prompt: () => null,
  requestAnimationFrame: fn => { fn(); return 0; }, cancelAnimationFrame() { },
  IntersectionObserver: class { observe() { } unobserve() { } disconnect() { } },
  MutationObserver: class { observe() { } disconnect() { } },
  matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
  scrollTo() { }, scrollBy() { }, performance: { now: () => Date.now() },
  addEventListener() { }, removeEventListener() { }, dispatchEvent() { },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  innerWidth: 1280, innerHeight: 800, pageYOffset: 0, scrollY: 0,
  CustomEvent: class { }, Event: class { }, Audio: class { play() { } },
  // timer policy: short delays (the draft's own pacing) run synchronously so a
  // room finishes in one call stack; long delays (retries, UI polish) drop.
  setTimeout: (fn, d) => { if ((d || 0) <= 200) { try { fn(); } catch (e) { sandbox.__timerErr = e; } } return 0; },
  clearTimeout() { }, setInterval: () => 0, clearInterval() { },
  fetch: (u, o) => fetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o),
  __timerErr: null
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP, sandbox, { filename: 'app.js' });

// ── drive one full room ─────────────────────────────────────────────────────
async function runRoom(cfg) {
  values['md-teams'] = String(cfg.teams);
  values['md-rounds'] = String(cfg.rounds);
  values['md-slot'] = String(1 + Math.floor(Math.random() * cfg.teams));
  values['md-scoring'] = String(cfg.scoring);
  values['md-format'] = cfg.sf ? 'sf' : '1qb';
  values['md-clock'] = '0';
  values['md-context'] = '';
  values['md-sort'] = 'bpa';
  ['qb', 'rb', 'wr', 'te', 'k', 'def'].forEach(ps => { values['md-rc-' + ps] = 'auto'; });
  await sandbox._startMockDraftRun();
  const MD = sandbox.MD;
  // play the user's seat like autopick does: the engine's own rec, else BPA
  let guard = 0;
  while (MD.pickIdx < MD.order.length && guard++ < cfg.rounds * cfg.teams + 5) {
    if (!MD.onClock) break; // engine stalled - surfaced by the invariant totals
    let p = MD.lastRec && MD.pool.indexOf(MD.lastRec) >= 0 ? MD.lastRec : null;
    if (!p) p = MD.pool.filter(x => x.pos !== 'K' && x.pos !== 'DEF')[0] || MD.pool[0];
    if (!p) break;
    sandbox.mdUserPick(p);
  }
  if (sandbox.__timerErr) { const e = sandbox.__timerErr; sandbox.__timerErr = null; throw e; }
  return { picks: MD.picks.slice(), bots: MD.bots, mySlot: MD.mySlot, teams: cfg.teams, rounds: cfg.rounds, pool: MD.pool.slice() };
}

// ── invariants ──────────────────────────────────────────────────────────────
function checkFormat(name, rooms, opts) {
  const teams = opts.teams, R = n => n * teams;
  const res = [];
  const pct = (ok, n) => n ? (ok / n * 100) : 100;

  // (a) early reaches vs the room's own board (bots only; ctx rules unused)
  let reachN = 0, reachBad = [], reachTotal = 0;
  rooms.forEach(r => r.picks.forEach(pk => {
    if (pk.mine || !pk.p.adp) return;
    const overall = (pk.round - 1) * teams + pk.pickNo;
    if (pk.round <= 2) {
      reachTotal++;
      const cap = pk.round === 1 ? 6 : 10;
      if (pk.p.adp > overall + cap) { reachN++; if (reachBad.length < 3) reachBad.push(`${pk.p.name} adp ${pk.p.adp} at #${overall}`); }
    }
  }));
  res.push([`(a) R1/R2 reach cap (+6/+10)`, reachN === 0, `${reachN}/${reachTotal} violations${reachBad.length ? ' e.g. ' + reachBad.join('; ') : ''}`]);

  // (b)/(e) QB counts by a round marker
  if (opts.qbBy) {
    const [byRound, lo, hi] = opts.qbBy;
    let ok = 0; const dist = {};
    rooms.forEach(r => {
      const n = r.picks.filter(pk => pk.p.pos === 'QB' && (pk.round - 1) * teams + pk.pickNo <= R(byRound)).length;
      dist[n] = (dist[n] || 0) + 1;
      if (n >= lo && n <= hi) ok++;
    });
    res.push([`(${opts.sf ? 'e' : 'b'}) QBs by end R${byRound} in [${lo},${hi}]`, pct(ok, rooms.length) >= 95,
      `${pct(ok, rooms.length).toFixed(1)}% of rooms comply; dist ${JSON.stringify(dist)}`]);
  }

  // (c) first K/DEF round
  let kdBad = 0, kdFirst = [];
  rooms.forEach(r => {
    const f = r.picks.find(pk => pk.p.pos === 'K' || pk.p.pos === 'DEF');
    if (f) { kdFirst.push(f.round); if (f.round < r.rounds - 1) kdBad++; }
  });
  res.push([`(c) first K/DEF in final 2 rounds`, kdBad === 0, `${kdBad} early K/DEF; earliest seen R${kdFirst.length ? Math.min(...kdFirst) : '-'}`]);

  // (d) elite TEs land within ±1.5 rounds of ADP
  let teN = 0, teOk = 0, teWorst = 0;
  rooms.forEach(r => {
    const tes = r.picks.filter(pk => pk.p.pos === 'TE' && pk.p.adp).concat(r.pool.filter(p => p.pos === 'TE' && p.adp).map(p => ({ p, round: 99, pickNo: 0 })));
    const top3 = tes.sort((x, y) => x.p.adp - y.p.adp).slice(0, 3);
    top3.forEach(pk => {
      if (pk.round === 99) { teN++; teWorst = Math.max(teWorst, 99); return; } // undrafted elite TE = violation
      const overall = (pk.round - 1) * teams + pk.pickNo;
      const dev = Math.abs(overall - pk.p.adp) / teams;
      teN++; if (dev <= 1.5) teOk++; teWorst = Math.max(teWorst, dev);
    });
  });
  res.push([`(d) elite TEs within ±1.5 rounds of ADP`, pct(teOk, teN) >= 92, `${pct(teOk, teN).toFixed(1)}% within (n=${teN}), worst ${teWorst.toFixed(1)} rounds`]);

  // (f) a bot's QB2 never before R8 (1QB only)
  if (!opts.sf) {
    let qb2Bad = 0, earliest = 99;
    rooms.forEach(r => {
      const seen = {};
      r.picks.forEach(pk => {
        if (pk.mine || pk.p.pos !== 'QB') return;
        seen[pk.slot] = (seen[pk.slot] || 0) + 1;
        if (seen[pk.slot] === 2) { earliest = Math.min(earliest, pk.round); if (pk.round < 8) qb2Bad++; }
      });
    });
    res.push([`(f) bot QB2 never before R8`, qb2Bad === 0, `${qb2Bad} violations; earliest QB2 R${earliest === 99 ? '-' : earliest}`]);
  }

  // (g) archetypes diverge (1QB only, needs the full spread of archs)
  if (!opts.sf) {
    const agg = {}; // arch -> {rb16:[], qbRound:[]}
    rooms.forEach(r => {
      const perSlot = {};
      r.picks.forEach(pk => {
        if (pk.mine) return;
        const a = (perSlot[pk.slot] = perSlot[pk.slot] || { rb: 0, qbR: null });
        if (pk.p.pos === 'RB' && pk.round <= 6) a.rb++;
        if (pk.p.pos === 'QB' && a.qbR == null) a.qbR = pk.round;
      });
      Object.entries(r.bots || {}).forEach(([slot, b]) => {
        const s = perSlot[slot]; if (!s) return;
        const g = (agg[b.arch] = agg[b.arch] || { rb: [], qbR: [] });
        g.rb.push(s.rb); if (s.qbR != null) g.qbR.push(s.qbR);
      });
    });
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const rbZ = avg((agg.zerorb || {}).rb || []), rbB = avg((agg.bpa || {}).rb || []), rbR = avg((agg.robustrb || {}).rb || []);
    const qE = avg((agg.earlyqb || {}).qbR || []), qL = avg((agg.lateqb || {}).qbR || []);
    const ok = rbZ != null && rbB != null && rbR != null && qE != null && qL != null
      && rbZ < rbB - 0.4 && rbR > rbB + 0.4 && qE < qL - 1.5;
    res.push([`(g) archetypes diverge`, !!ok,
      `RBs by R6: zerorb ${rbZ && rbZ.toFixed(2)} < bpa ${rbB && rbB.toFixed(2)} < robustrb ${rbR && rbR.toFixed(2)} | QB1 round: earlyqb ${qE && qE.toFixed(2)} vs lateqb ${qL && qL.toFixed(2)}`]);
  }

  console.log(`\n=== ${name} (${rooms.length} rooms) ===`);
  let fails = 0;
  res.forEach(([label, ok, detail]) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`); });
  return fails;
}

// ── run ─────────────────────────────────────────────────────────────────────
const FORMATS = [
  { name: '1QB full PPR', cfg: { teams: 12, rounds: 15, scoring: 1, sf: false }, qbBy: [5, 2, 7] },
  { name: 'Superflex PPR', cfg: { teams: 12, rounds: 15, scoring: 1, sf: true }, qbBy: [4, 8, 24] },
  { name: '1QB half PPR', cfg: { teams: 12, rounds: 15, scoring: 0.5, sf: false }, qbBy: [5, 2, 7] },
  { name: '1QB standard', cfg: { teams: 12, rounds: 15, scoring: 0, sf: false }, qbBy: [5, 2, 7] }
];
let totalFails = 0;
for (const f of FORMATS) {
  const rooms = [];
  for (let i = 0; i < ROOMS; i++) {
    try { rooms.push(await runRoom(f.cfg)); }
    catch (e) { console.error(`room error (${f.name} #${i}):`, e.message); totalFails++; break; }
  }
  if (rooms.length) totalFails += checkFormat(f.name, rooms, { teams: f.cfg.teams, sf: f.cfg.sf, qbBy: f.qbBy });
}
console.log(`\n${totalFails === 0 ? 'ALL GREEN' : totalFails + ' FAILURE(S)'} — engine values ${totalFails === 0 ? 'hold up against' : 'need another look vs'} live boards.`);
process.exit(totalFails === 0 ? 0 : 1);
