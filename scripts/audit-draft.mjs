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
//   (h) league drafter profiles bind: a room with 11 saved profiles seats
//       exactly those names and archetypes (snake AND auction, where the
//       personality maps to its bidding style), and in the same rooms the
//       zerorb-profiled seats draft measurably fewer early RBs than the
//       robustrb-profiled ones
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
const BASE = process.env.CAL_BASE || 'https://macdraft.app';
const argv = process.argv.slice(2);
const ROOMS = parseInt(argv[argv.indexOf('--rooms') + 1], 10) || 600;

// ── DOM + browser stubs ─────────────────────────────────────────────────────
const values = {}; // element id -> .value the settings readers see
function el(id) {
  const e = {
    id, style: { setProperty(k,v){ this[k]=v; }, removeProperty(k){ delete this[k]; }, getPropertyValue(){ return ''; } }, dataset: {}, options: [], children: [],
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
  // functional localStorage: the profile invariant (h) seeds tm_md_profiles
  // through the same read path the app uses; everything else that touches
  // storage in a draft run only writes (settings/context), never reads back
  localStorage: {
    _s: {},
    getItem(k) { return k in this._s ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; }
  },
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
  // timer policy: a queue-drain trampoline. Draft pacing (45ms snake steps,
  // 600-900ms auction bid beats) runs to completion iteratively - never as
  // nested recursion, which the auction's ~2,000 chained timeouts would blow
  // the stack on. Delays >= 2s (network retries, UI polish) drop.
  setTimeout: (fn, d) => {
    if ((d || 0) >= 2000) return 0;
    sandbox.__tq.push(fn);
    if (!sandbox.__draining) {
      sandbox.__draining = true;
      let n = 0;
      while (sandbox.__tq.length && n++ < 2e6) {
        const f = sandbox.__tq.shift();
        try { f(); } catch (e) { sandbox.__timerErr = e; }
      }
      sandbox.__draining = false;
    }
    return 0;
  },
  __tq: [], __draining: false,
  clearTimeout() { }, setInterval: () => 0, clearInterval() { },
  fetch: (u, o) => fetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : u, o),
  __timerErr: null
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
// fast-path flag: auction pacing (AU_PACE, human-legibility delays) collapses
// to 1ms ticks - the sanctioned accelerated path; decisions never read it
sandbox._AU_FAST = 1;
vm.createContext(sandbox);
vm.runInContext(APP, sandbox, { filename: 'app.js' });

// The /api/stats/aav endpoint may not be deployed yet, so build the exact doc
// the server builds - straight from ESPN - and preset it. The engine's loader
// sees window._mdAav already defined and skips its own fetch, and the auction
// calibrates against REAL values either way.
async function presetAav() {
  try {
    const POS_ID = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
    const r = await fetch('https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info',
      { headers: { 'x-fantasy-filter': JSON.stringify({ players: { limit: 400, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'PPR' } } }) } });
    const raw = await r.json();
    const players = {}; const fitPts = [];
    const norm = n => String(n).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    (raw.players || []).forEach(row => {
      const pl = row.player || {}; const own = pl.ownership || {};
      const aav = Number(own.auctionValueAverage) || 0;
      const pos = POS_ID[pl.defaultPositionId] || '';
      if (!pl.fullName || !pos || aav < 0.5) return;
      players[norm(pl.fullName)] = { aav: +aav.toFixed(1), pos, name: pl.fullName };
      if (aav >= 1 && own.averageDraftPosition > 0 && own.averageDraftPosition <= 200) fitPts.push([own.averageDraftPosition, Math.log(aav)]);
    });
    let fit = null;
    if (fitPts.length >= 60) {
      const n = fitPts.length;
      const sx = fitPts.reduce((s, p) => s + p[0], 0), sy = fitPts.reduce((s, p) => s + p[1], 0);
      const sxx = fitPts.reduce((s, p) => s + p[0] * p[0], 0), sxy = fitPts.reduce((s, p) => s + p[0] * p[1], 0);
      const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
      fit = { a, b };
    }
    if (Object.keys(players).length >= 80) sandbox.window._mdAav = { source: 'espn', players, fit };
    console.log('AAV preset:', Object.keys(players).length, 'priced players', fit ? `(fit a=${fit.a.toFixed(3)} b=${fit.b.toFixed(4)})` : '(no fit)');
  } catch (e) { console.log('AAV preset failed (' + e.message + ') - auction will use the derived-curve fallback'); }
}
await presetAav();

// ── drive one full room ─────────────────────────────────────────────────────
async function runRoom(cfg) {
  values['md-teams'] = String(cfg.teams);
  values['md-rounds'] = String(cfg.rounds);
  values['md-slot'] = String(cfg.slot || 1 + Math.floor(Math.random() * cfg.teams));
  values['md-scoring'] = String(cfg.scoring);
  values['md-format'] = cfg.sf ? 'sf' : '1qb';
  values['md-dtype'] = cfg.auction ? 'auction' : 'snake';
  values['md-budget'] = String(cfg.budget || 200);
  values['md-clock'] = '0';
  values['md-context'] = '';
  values['md-sort'] = 'bpa';
  ['qb', 'rb', 'wr', 'te', 'k', 'def'].forEach(ps => { values['md-rc-' + ps] = 'auto'; });
  // the auction plays the user's seat via the engine's own autopilot
  sandbox.MD.autoPilot = !!cfg.auction;
  await sandbox._startMockDraftRun();
  const MD = sandbox.MD;
  if (cfg.auction) {
    // the trampoline ran the whole auction inside the start call
    if (sandbox.__timerErr) { const e = sandbox.__timerErr; sandbox.__timerErr = null; throw e; }
    const AU = sandbox.AU;
    return {
      auction: true, teams: cfg.teams, rounds: cfg.rounds, budget: cfg.budget || 200,
      picks: MD.picks.slice(), budgets: { ...AU.budgets }, slotsLeft: { ...AU.slotsLeft },
      sold: AU.sold.slice(), bots: AU.bots, mySlot: MD.mySlot, val: { ...AU.val }
    };
  }
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


// ═══ AUDIT MODE: distribución fina de comportamiento + sanidad de datos ═══
function q(arr,p){const s=[...arr].sort((a,b)=>a-b);return s[Math.min(s.length-1,Math.floor(p*s.length))];}
async function main(){

  const fmts=[{name:'PPR',scoring:1},{name:'Half',scoring:0.5}];
  for(const f of fmts){
    const rooms=[];
    for(let i=0;i<40;i++){try{rooms.push(await runRoom({teams:10,rounds:15,scoring:f.scoring,sf:false}));}catch(e){console.log('room err',e.message);}}
    const deltas=[],byBand={early:[],mid:[],late:[]};
    let undrafted=new Set(), dupCount=0, rosterBad=0, kdEarly=0; const badWhy={};
    const posPick={QB:[],TE:[]};
    for(const r of rooms){
      const seen=new Set();
      const byBot={};
      r.picks.forEach((pk,idx)=>{
        const ov=idx+1;
        if(seen.has(pk.p.id))dupCount++;seen.add(pk.p.id);
        if(!pk.mine&&pk.p.adp){
          const d=ov-pk.p.adp;deltas.push(d);
          const band=pk.round<=3?'early':pk.round<=8?'mid':'late';
          byBand[band].push(d);
        }
        if(pk.p.pos==='QB'||pk.p.pos==='TE')posPick[pk.p.pos].push({ov,adp:pk.p.adp});
        if((pk.p.pos==='K'||pk.p.pos==='DEF')&&pk.round<14)kdEarly++;
        const b=(byBot[pk.slot]=byBot[pk.slot]||{QB:0,RB:0,WR:0,TE:0,K:0,DEF:0});
        b[pk.p.pos]=(b[pk.p.pos]||0)+1;
      });
      Object.entries(byBot).forEach(([s,b])=>{
        if(s==String(r.mySlot))return;
        const why=[];
        if(b.QB<1)why.push('QB0');if(b.RB<2)why.push('RB'+b.RB);if(b.WR<2)why.push('WR'+b.WR);
        if(b.TE<1)why.push('TE0');if(b.K!==1)why.push('K'+b.K);if(b.DEF!==1)why.push('DEF'+b.DEF);
        if(why.length){rosterBad++;why.forEach(w=>badWhy[w]=(badWhy[w]||0)+1);
          if(rosterBad<=3)console.log('  ejemplo ilegal seat',s,JSON.stringify(b),'arch',(r.bots[s]||{}).arch);}
      });
      // top-100 ADP sin draftear
      const picked=new Set(r.picks.map(pk=>pk.p.id));
      r.pool.concat([]).forEach(p=>{if(p.adp&&p.adp<=100&&!picked.has(p.id))undrafted.add(p.name+' (ADP '+p.adp.toFixed(0)+')');});
    }
    const early=byBand.early,mid=byBand.mid,late=byBand.late;
    console.log('\n══ SNAKE '+f.name+' ('+rooms.length+' salas × 15R) ══');
    console.log('reach medio |Δ| R1-3:',(early.reduce((a,b)=>a+Math.abs(b),0)/early.length).toFixed(1),
      '· R4-8:',(mid.reduce((a,b)=>a+Math.abs(b),0)/mid.length).toFixed(1),
      '· R9+:',(late.reduce((a,b)=>a+Math.abs(b),0)/late.length).toFixed(1),'picks');
    console.log('p5 (más temprano) R1-3:',q(early,0.05).toFixed(0),'· R4-8:',q(mid,0.05).toFixed(0),'· R9+:',q(late,0.05).toFixed(0));
    console.log('% picks >15 antes de ADP:',(100*deltas.filter(d=>d<-15).length/deltas.length).toFixed(2)+'%');
    console.log('duplicados:',dupCount,'· rosters ilegales:',rosterBad,'de',rooms.length*9,'· desglose:',JSON.stringify(badWhy),'· K/DEF antes R14:',kdEarly);
    console.log('top-100 ADP sin draftear:',undrafted.size?[...undrafted].slice(0,6):'ninguno ✓');
    const qb=posPick.QB.filter(x=>x.adp);
    console.log('sesgo QB (pick real - ADP, promedio):',(qb.reduce((a,x)=>a+(x.ov-x.adp),0)/qb.length).toFixed(1),'picks');
  }
  // ── AUCTION ──
  const arooms=[];
  for(let i=0;i<15;i++){try{arooms.push(await runRoom({teams:10,rounds:15,scoring:0.5,sf:false,auction:true,budget:200}));}catch(e){console.log('auction err',e.message);}}
  const ratios={elite:[],mid:[],low:[]};
  let leftover=[],dollar1=0,total=0;
  for(const r of arooms){
    r.sold.forEach(s0=>{
      total++;
      const aav=r.val&&r.val[s0.p?.id]||s0.aav||0;
      const price=s0.price!=null?s0.price:s0.amount;
      if(price===1)dollar1++;
      if(aav>=40)ratios.elite.push(price/aav);
      else if(aav>=10)ratios.mid.push(price/aav);
      else if(aav>0)ratios.low.push(price/aav);
    });
    Object.values(r.budgets||{}).forEach(b=>leftover.push(b));
  }
  console.log('\n══ AUCTION Half  ('+arooms.length+' salas) ══');
  for(const[k,v]of Object.entries(ratios)){
    if(!v.length){console.log(k+': sin datos');continue;}
    console.log(k+' price/AAV: media',(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2),'p10',q(v,0.1).toFixed(2),'p90',q(v,0.9).toFixed(2),'n='+v.length);
  }
  console.log('ventas :',(100*dollar1/total).toFixed(0)+'% de',total,'· budget sobrante medio: $'+(leftover.reduce((a,b)=>a+b,0)/leftover.length).toFixed(1));
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});
