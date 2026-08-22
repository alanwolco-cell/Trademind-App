#!/usr/bin/env node
// QA driver: loads the real engine (same sandbox recipe as calibrate-room.mjs)
// and exercises undo / edit-pick / filter / profile-UI paths that the
// calibration harness does not touch.
'use strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// El repo se resuelve desde la ubicacion de ESTE script, no desde una ruta
// absoluta de la maquina de nadie: si no, el gate solo corre en un portatil.
// --app / --html siguen permitiendo auditar un build candidato.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const _arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i+1] ? process.argv[i+1] : d; };
const APP_PATH = _arg('--app', path.join(REPO, 'public/app.js'));
const HTML_PATH = _arg('--html', path.join(REPO, 'public/index.html'));

const APP = fs.readFileSync(APP_PATH, 'utf8');
const BASE = 'https://trademindff.com';

const values = {};
function el(id) {
  return {
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
  navigator: { userAgent: 'qa', clipboard: {} },
  location: { search: '', href: BASE + '/', pathname: '/', hash: '', origin: BASE },
  history: { pushState() { }, replaceState() { } },
  localStorage: { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } },
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
sandbox._AU_FAST = 1; // pacing collapses to ticks; decisions unaffected
vm.createContext(sandbox);
vm.runInContext(APP, sandbox, { filename: 'app.js' });

let fails = 0;
const check = (label, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '\n      ' + detail : ''}`); };

// ── helpers ─────────────────────────────────────────────────────────────────
function rosterAudit() {
  // aiRosters must exactly mirror the picks list for every bot slot
  const MD = sandbox.MD;
  const counts = {};
  MD.picks.forEach(pk => {
    if (pk.mine) return;
    counts[pk.slot] = counts[pk.slot] || { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    counts[pk.slot][pk.p.pos]++;
  });
  for (const s of Object.keys(MD.aiRosters)) {
    const ros = MD.aiRosters[s];
    const c = counts[s] || { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
      if ((ros[pos] || 0) !== c[pos]) return `slot ${s} ${pos}: aiRosters=${ros[pos] || 0} picks=${c[pos]}`;
    }
    if (ros.list.length !== Object.values(c).reduce((a, b) => a + b, 0)) return `slot ${s} list length mismatch`;
  }
  return null;
}

// start a snake room, user seat 3
values['md-teams'] = '12'; values['md-rounds'] = '15'; values['md-slot'] = '3';
values['md-scoring'] = '1'; values['md-format'] = '1qb'; values['md-dtype'] = 'snake';
values['md-budget'] = '200'; values['md-clock'] = '0'; values['md-context'] = ''; values['md-sort'] = 'bpa';
['qb', 'rb', 'wr', 'te', 'k', 'def'].forEach(ps => { values['md-rc-' + ps] = 'auto'; });
sandbox.MD.autoPilot = false;

// profile UI: set profiles through the real setters before the draft
sandbox.mdProfileSet(2, 'name', 'Rafa <b>"x"</b>');
sandbox.mdProfileSet(2, 'arch', 'homer');
sandbox.mdProfileSet(2, 'team', 'KC');
sandbox.mdProfileSet(4, 'arch', 'tehunter');
const savedName = JSON.parse(sandbox.localStorage.getItem('tm_md_profiles'))['2'].name;
check('profile name sanitized on save', !/[<>&"']/.test(savedName), savedName);

await sandbox._startMockDraftRun();
const MD = sandbox.MD;
check('homer profile carries its NFL team', MD.bots[2] && MD.bots[2].arch === 'homer' && MD.bots[2].homeTeam === 'KC', JSON.stringify(MD.bots[2]));
check('tehunter profile gets teCap 2', MD.bots[4] && MD.bots[4].arch === 'tehunter' && MD.bots[4].teCap === 2, JSON.stringify(MD.bots[4]));
check('unprofiled seats stay random-dealt', !!MD.bots[5] && !!MD.bots[5].arch);

// draft two of my picks, then undo, then audit bot bookkeeping
const pickBPA = () => {
  const p = MD.pool.filter(x => x.pos !== 'K' && x.pos !== 'DEF')[0];
  sandbox.mdUserPick(p);
  return p;
};
pickBPA(); // my R1 (bots chain to my R2... actually to my next turn)
check('on the clock after bot chain', MD.onClock === true, `pickIdx=${MD.pickIdx}`);
const beforeUndoIdx = MD.pickIdx;
const audit0 = rosterAudit();
check('aiRosters consistent mid-draft', !audit0, audit0);
sandbox.mdUndo();
check('undo rewinds to my pick', MD.onClock && MD.pickIdx < beforeUndoIdx, `pickIdx ${beforeUndoIdx} -> ${MD.pickIdx}`);
const audit1 = rosterAudit();
check('aiRosters consistent after undo', !audit1, audit1);
check('undone players back in pool', MD.pool.length > 0 && !MD.picks.some(pk => MD.pool.includes(pk.p)));

// re-pick and let a few rounds run, then edit a bot pick
pickBPA();
const botPk = MD.picks.find(pk => !pk.mine);
const cand = MD.pool.find(p => p.pos !== botPk.p.pos && p.pos !== 'K' && p.pos !== 'DEF');
sandbox.mdApplyEdit(botPk, cand);
const audit2 = rosterAudit();
check('aiRosters consistent after edit-pick swap', !audit2, audit2);
check('edit-pick swapped the player', botPk.p === cand && MD.pool.indexOf(cand) < 0);

// filters off-clock: board live, not my turn -> list still repaints
const board = document.getElementById('md-board');
board.dataset.live = '1';
MD.onClock = false;
const box = document.getElementById('md-choices');
box.innerHTML = 'STALE';
sandbox.MD.posFilter = 'RB';
sandbox.mdFilterChoices();
// stub DOM: appendChild never touches innerHTML, so "repainted" = the stale
// marker was cleared by the render pass
check('filter repaints list off-clock', box.innerHTML !== 'STALE');
const sage = document.getElementById('md-sage');
sage.innerHTML = 'SAGE-KEEP';
sandbox.mdFilterChoices();
check('off-clock repaint leaves Sage box alone', sage.innerHTML === 'SAGE-KEEP');
MD.onClock = true; // back on the clock: rec renders again
sandbox.mdFilterChoices();
check('on-clock repaint refreshes Sage rec', sage.innerHTML !== 'SAGE-KEEP');

// search + drafted + rookies combined never throws and only lists matches
values['md-avail-search'] = 'a';
MD.rookiesOnly = true; MD.showTaken = true; MD.availSort = { k: 'proj', d: -1 };
try { sandbox.mdShowChoices(MD.curRound || 1); check('filter combo (search+rookies+drafted+sort) renders', true); }
catch (e) { check('filter combo (search+rookies+drafted+sort) renders', false, e.message); }
MD.rookiesOnly = false; MD.showTaken = false; MD.availSort = null; values['md-avail-search'] = '';

// finish the draft on autopilot-ish loop, then verify undo is refused
let guard = 0;
while (MD.pickIdx < MD.order.length && guard++ < 400) {
  if (!MD.onClock) break;
  const p = MD.pool.filter(x => x.pos !== 'K' && x.pos !== 'DEF')[0] || MD.pool[0];
  if (!p) break;
  sandbox.mdUserPick(p);
}
check('draft ran to completion', MD.pickIdx >= MD.order.length, `pickIdx=${MD.pickIdx}/${MD.order.length}`);
// ── el cierre del draft TIENE que verse ─────────────────────────────────────
// mdFinish calcula nota, agujeros, steal/reach, ranking de sala y "Mac on
// every pick" y hasta ahora los entregaba por mdMacSay, que esta muda por
// regla del dueno y ademas VACIA su contenedor: todo eso se calculaba y se
// tiraba. El usuario terminaba 15 rondas viendo "Mac grades your board:" y
// nada debajo. Este check mira el contenedor propio del veredicto.
const _vd = document.getElementById('md-verdict').innerHTML || '';
check('verdict: the closing card actually renders', _vd.length > 200, `innerHTML length=${_vd.length}`);
check('verdict: carries the letter grade', /Value grade/i.test(_vd) && /grade [A-D]/.test(_vd), _vd.slice(0, 160));
check('verdict: carries the roster shape', /\d+ QB \/ \d+ RB \/ \d+ WR \/ \d+ TE/.test(_vd));
// La lectura del roster tiene CINCO ramas en mdFinish, y "Balanced board" solo
// sale si ninguna otra hablo: con un roster WR-heavy salen los WR y no aparece
// ni "Holes to fix" ni "Balanced board". Comprobar solo esas dos hacia el check
// inestable (fallaba 3 de cada 10 corridas, por la aleatoriedad con la que se
// reparten los arquetipos). Se comprueban las cinco ramas.
check('verdict: carries a roster read', /Holes to fix|Balanced board|WR-heavy build|is a luxury you can flip|You waited on QB until Round/.test(_vd), _vd.slice(0, 200));
check('verdict: hands over the two closing actions', /mdDownloadRoster\(0\)/.test(_vd) && /How did I do in my last mock draft/.test(_vd));
check('verdict: Mac stays silent in his own box', (document.getElementById('md-sage').innerHTML || '') === '');
const strip = document.getElementById('md-rstrip').innerHTML;
check('mobile: roster strip renders slots with filled faces', strip.indexOf('rs-slot') >= 0 && strip.indexOf('rs-slot filled') >= 0 && strip.indexOf('BN') >= 0, strip.slice(0, 120));
const picksAtEnd = MD.picks.length;
sandbox.mdUndo();
check('undo refused after the draft is graded', MD.picks.length === picksAtEnd);

// profiles UI render on a stub: randomize-all sets an arch on every bot seat
sandbox.mdProfilesRandomizeAll();
const profs = JSON.parse(sandbox.localStorage.getItem('tm_md_profiles'));
let allSet = true;
for (let s = 1; s <= 12; s++) { if (s === 3) continue; if (!profs[s] || !profs[s].arch) allSet = false; }
check('randomize-all deals every seat a personality', allSet, JSON.stringify(profs));
check('randomize-all skips the user seat', !profs[3] || !profs[3].arch);
sandbox.mdProfilesClear();
check('clear wipes the saved profiles', sandbox.localStorage.getItem('tm_md_profiles') == null);

// ── el roster que el AUTO-DRAFT arma tiene que ser legal ────────────────────
// Los bots tienen un STARTER-FILL GATE en mdAdvance y llevan 6600 rosters sin
// un fallo. El asiento del usuario no lo tenia: mdRecommend solo tenia TOPES
// (qbCap/teCap), nunca un piso. Con los ajustes por defecto (12 equipos, 8
// rondas) el auto-draft terminaba RB4/WR4 - cero QB y cero TE - mientras los
// 12 bots terminaban legales. Y mdRecommend es tambien lo que Mac le muestra
// a un humano, asi que el que le hacia caso llegaba al mismo roster ilegal.
// (va justo antes del bloque de subasta, que fija sus propios `values`: asi
// estas salas extra no le mueven el asiento del usuario a los checks de perfiles)
for (const _room of [{ r: '8', sf: '1qb' }, { r: '10', sf: '1qb' }, { r: '15', sf: 'sf' }]) {
  values['md-rounds'] = _room.r; values['md-format'] = _room.sf; values['md-teams'] = '12'; values['md-slot'] = '5';
  await sandbox._startMockDraftRun();
  const M2 = sandbox.MD;
  let g2 = 0;
  // exactamente lo que hace _mdAutoPick: la cola, si no MD.lastRec (o sea
  // mdRecommend), si no el mejor disponible
  while (M2.pickIdx < M2.order.length && g2++ < 400) {
    if (!M2.onClock) break;
    let p2 = (M2.lastRec && M2.pool.indexOf(M2.lastRec) >= 0) ? M2.lastRec : null;
    if (!p2) p2 = M2.pool.filter(x => x.pos !== 'K' && x.pos !== 'DEF')[0] || M2.pool[0];
    if (!p2) break;
    sandbox.mdUserPick(p2);
  }
  const _cnt = {}; (M2.mine || []).forEach(p => { _cnt[p.pos] = (_cnt[p.pos] || 0) + 1; });
  const _need = M2.sf ? { QB: 2, RB: 2, WR: 2, TE: 1 } : { QB: 1, RB: 2, WR: 2, TE: 1 };
  const _miss = Object.keys(_need).filter(k => (_cnt[k] || 0) < _need[k]);
  check(`autodraft: ${_room.r}-round ${_room.sf} roster is startable`, _miss.length === 0,
    `missing ${_miss.join(',') || 'nothing'} - got ${JSON.stringify(_cnt)}`);
}

// AUCTION: exit mid-room then restart must not double-run timer chains
values['md-dtype'] = 'auction';
sandbox.MD.autoPilot = true;
await sandbox._startMockDraftRun(); // trampoline runs the full auction
if (sandbox.__timerErr) { check('auction run clean', false, sandbox.__timerErr.message); sandbox.__timerErr = null; }
const AU = sandbox.AU;
const neg = Object.values(AU.budgets).some(b => b < 0);
const unfilled = Object.values(AU.slotsLeft).some(s => s > 0);
check('auction: budgets never negative, roster exact', !neg && !unfilled, JSON.stringify(AU.budgets));
// immediately restart (simulates Restart draft clicked mid/after auction)
await sandbox._startMockDraftRun();
if (sandbox.__timerErr) { check('auction restart clean', false, sandbox.__timerErr.message); sandbox.__timerErr = null; }
else {
  const dup = {};
  let dupFound = null;
  sandbox.MD.picks.forEach(pk => { if (dup[pk.p.id]) dupFound = pk.p.name; dup[pk.p.id] = 1; });
  check('auction restart: no duplicate sales / stale chain bleed', !dupFound, dupFound || '');
  const total = Object.values(sandbox.AU.slotsLeft).reduce((a, b) => a + b, 0);
  check('restarted auction also completes', total === 0, `slotsLeft sum=${total}`);
}

// ── FANTAZY 2026 preset: on -> settings + names; off -> faithful restore ────
values['md-teams'] = '12'; values['md-scoring'] = '1'; values['md-format'] = 'sf';
values['md-rounds'] = '8'; values['md-slot'] = '5'; values['md-dtype'] = 'snake';
document.getElementById('md-6pt').checked = false;
sandbox.mdFantazy26Toggle(true);
check('fz26: preset settings applied',
  values['md-teams'] === '10' && values['md-scoring'] === '0.5' && values['md-format'] === '1qb'
  && values['md-rounds'] === '15' && values['md-slot'] === '9',
  JSON.stringify({ t: values['md-teams'], sc: values['md-scoring'], f: values['md-format'], r: values['md-rounds'], sl: values['md-slot'] }));
check('fz26: 6pt passing TDs flipped on', document.getElementById('md-6pt').checked === true);
// the seed is authoritative in app.js (lead's v2: real Yahoo names +
// inferred personalities + per-seat mods); assert against FZ26_NAMES itself
const FZN = sandbox.FZ26_NAMES;
const fzProfs = JSON.parse(sandbox.localStorage.getItem('tm_md_profiles_fantazy26'));
check('fz26: all ten league teams seeded (you pick which one is you)',
  fzProfs && Object.keys(FZN).length === 10 && Object.keys(FZN).every(s => fzProfs[s] && fzProfs[s].name === FZN[s]),
  JSON.stringify(fzProfs));
sandbox.MD.autoPilot = false;
await sandbox._startMockDraftRun();
check('fz26: room is 10-team half-PPR 1QB 15R, owner seat 9',
  sandbox.MD.teams === 10 && sandbox.MD.scoring === 0.5 && !sandbox.MD.sf
  && sandbox.MD.rounds === 15 && sandbox.MD.mySlot === 9);
check('fz26: bots carry the real league names',
  !sandbox.MD.bots[sandbox.MD.mySlot] && Object.keys(FZN).filter(s => +s !== sandbox.MD.mySlot).every(s => sandbox.MD.bots[s] && sandbox.MD.bots[s].name === sandbox._mdProfName(FZN[s])),
  JSON.stringify(Object.keys(sandbox.MD.bots).map(s => sandbox.MD.bots[s].name)));
check('fz26: 6pt engine flag live', sandbox.MD.sixPt === 1);
check('fz26: QB bias applied without claiming userPos',
  sandbox.MD.bias.QB >= 1.06 && !sandbox.MD.userPos.QB,
  JSON.stringify({ bias: sandbox.MD.bias.QB, userPos: sandbox.MD.userPos }));
// owner moves seats: the displaced rival takes the vacated seat
values['md-slot'] = '3';
sandbox._mdFz26SeatMoved(3);
const fz2 = JSON.parse(sandbox.localStorage.getItem('tm_md_profiles_fantazy26'));
check('fz26: seat move sends displaced rival to the vacated seat',
  fz2['9'] && fz2['9'].name === FZN['3'] && !fz2['3'], JSON.stringify(fz2));
// off restores the snapshot and keeps the named bucket for next time
sandbox.mdFantazy26Toggle(false);
check('fz26: OFF restores the previous setup',
  values['md-teams'] === '12' && values['md-scoring'] === '1' && values['md-format'] === 'sf'
  && values['md-rounds'] === '8' && values['md-slot'] === '5'
  && document.getElementById('md-6pt').checked === false,
  JSON.stringify({ t: values['md-teams'], sc: values['md-scoring'], f: values['md-format'], r: values['md-rounds'], sl: values['md-slot'] }));
check('fz26: flags cleared', sandbox.localStorage.getItem('tm_md_fantazy26') == null
  && sandbox.localStorage.getItem('tm_md_fantazy26_prev') == null);
check('fz26: named bucket kept for the next enable', !!sandbox.localStorage.getItem('tm_md_profiles_fantazy26'));
check('fz26: profile key back to normal', sandbox._mdProfilesKey() === 'tm_md_profiles');
// v1->v2 migration at the READ point: toggle persisted ON, stale bucket (old
// owner names, no _v) - the first read must reseed, not the next toggle
sandbox.localStorage.setItem('tm_md_fantazy26', '1');
sandbox.localStorage.setItem('tm_md_profiles_fantazy26', JSON.stringify({ 1: { name: 'Adam Misstress', arch: 'zerorb' }, 2: { name: 'elias y sultan', arch: '' } }));
const mig = sandbox.mdGetProfiles();
check('fz26 fix: stale v1 bucket reseeds on read', mig._v === 3 && mig['1'].name === sandbox.FZ26_NAMES['1'] && mig['3'].name === sandbox.FZ26_NAMES['3'] && mig['9'].name === sandbox.FZ26_NAMES['9'], JSON.stringify(mig).slice(0, 160));
const persisted2 = JSON.parse(sandbox.localStorage.getItem('tm_md_profiles_fantazy26'));
check('fz26 fix: reseed persisted with the version tag', persisted2._v === 3 && persisted2['1'].name === sandbox.FZ26_NAMES['1']);
sandbox.mdProfileSet(1, 'arch', 'hype');
check('fz26 fix: idempotent - v3 tweaks survive later reads', sandbox.mdGetProfiles()['1'].arch === 'hype' && sandbox.mdGetProfiles()._v === 3);
sandbox.localStorage.removeItem('tm_md_fantazy26');
sandbox.localStorage.removeItem('tm_md_profiles_fantazy26');

// ── ADENDA 2: strategy picker gone -> label + panel fall back to BPA ────────
const h0 = JSON.parse(sandbox.localStorage.getItem('tm_mock_history') || '[]')[0];
check('a2: history label defaults to Best Available', h0 && /best available/i.test(h0.strat), h0 && h0.strat);

// ── ADENDA 3: adaptive advisor reads (display-only, synthetic room) ─────────
// the fz26 auction above parks waiting for a nomination; the synthetic room
// is a SNAKE - close the auction or the redesigned bar renders its compact
// auction confirm instead of the room-read layer
sandbox.AU.active = false; sandbox.AU.lot = null;
const M = sandbox.MD;
M.teams = 10; M.mySlot = 1; M.sf = false; M.rounds = 15;
M.order = [1, 2, 3, 1]; M.pickIdx = 0; M.onClock = true; M.curRound = 1;
M.bots = {
  2: { name: 'Kopel', profiled: 1, arch: 'robustrb', posAdj: { RB: 340, WR: -80 }, eliteAdj: { RB: 200 } },
  3: { name: 'Eli Gabay', profiled: 1, arch: 'robustrb', posAdj: { RB: 340, WR: -80 }, eliteAdj: { RB: 200 } }
};
M.aiRosters = {
  2: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, list: [] },
  3: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, list: [] }
};
const t1 = sandbox.mdThreatRead('RB');
check('a3: two need+lean seats kill the top RB', t1.gone > 0.85 && t1.threats.length === 2 && t1.threats.every(x => x.profiled), JSON.stringify(t1));
M.aiRosters[2].RB = 2; M.aiRosters[3].RB = 2;
const t2 = sandbox.mdThreatRead('RB');
check('a3: sated seats stay quiet', t2.gone < 0.4, JSON.stringify(t2));
M.picks = [{ p: { pos: 'RB' } }, { p: { pos: 'WR' } }, { p: { pos: 'RB' } }, { p: { pos: 'RB' } }, { p: { pos: 'QB' } }];
const r1 = sandbox.mdRunRead();
check('a3: run detected (3 RB in last 5)', r1 && r1.pos === 'RB' && r1.count === 3, JSON.stringify(r1));

// tendencies: n>=3 drafts computes, short history is silent
sandbox.localStorage.setItem('tm_mock_history', JSON.stringify([1, 2, 3].map(() => ({ picksAll: [{ me: true, pos: 'QB', adp: 60, delta: -10 }, { me: false, pos: 'RB', adp: 5, delta: 0 }] }))));
const td = sandbox.mdMyTendencies();
check('a3: tendency computed with n>=3 drafts', td && td.pos.QB && Math.round(td.pos.QB.mean) === -10, JSON.stringify(td));
sandbox.localStorage.setItem('tm_mock_history', JSON.stringify([{ picksAll: [{ me: true, pos: 'QB', adp: 60, delta: -10 }] }, { picksAll: [{ me: true, pos: 'QB', adp: 60, delta: -10 }] }]));
check('a3: short history stays silent', sandbox.mdMyTendencies() == null);

// draft bar integration: run line + named kill-call + one history mention
sandbox.localStorage.setItem('tm_mock_history', JSON.stringify([1, 2, 3].map(() => ({ picksAll: [{ me: true, pos: 'RB', adp: 60, delta: -9 }] }))));
M._histSaid = 0; M._shapeSaid = {}; M.mine = []; M.queue = [];
M.aiRosters[2].RB = 0; M.aiRosters[3].RB = 0;
M.pool = [
  { id: 'r1', name: 'Top RB', pos: 'RB', team: 'KC', dv: 9000, adp: 12, exp: 2 },
  { id: 'r2', name: 'Next RB', pos: 'RB', team: 'SF', dv: 8000, adp: 14, exp: 3 }
];
M.picks = [{ p: { pos: 'RB' } }, { p: { pos: 'RB' } }, { p: { pos: 'RB' } }];
M.selChoice = M.pool[0];
M.strat = undefined; // a2: no strategy selection anywhere
let a2ok = true, a2err = '';
try { sandbox.mdShowChoices(1); } catch (e) { a2ok = false; a2err = e.message; }
check('a2: rec panel safe without a strategy selection', a2ok, a2err);
// mdShowChoices already rendered the bar once (and rightly consumed the
// one-per-draft history mention) - rearm it to assert the line's content
M._histSaid = 0;
let barOk = true, barErr = '';
try { sandbox.mdRenderDraftBar(); } catch (e) { barOk = false; barErr = e.message; }
check('a3: draft bar renders with advisor reads', barOk, barErr);
const barHtml = document.getElementById('md-draftbar').innerHTML;
check('a3: room read block present', barHtml.indexOf('Room read') >= 0);
check('a3: run line surfaced', barHtml.indexOf('the run is on') >= 0);
check('a3: profiled names cited in the kill-call', barHtml.indexOf('Kopel and Eli Gabay') >= 0);
check('a3: one history-coaching mention fired', barHtml.indexOf('picks early on average') >= 0 && M._histSaid === 1);
// silence guards: unprofiled seats -> no names; second render -> no second history line
M.bots[2].profiled = 0; M.bots[3].profiled = 0;
sandbox.mdRenderDraftBar();
const barHtml2 = document.getElementById('md-draftbar').innerHTML;
check('a3: without profiles the read stays generic (no names)', barHtml2.indexOf('Kopel') < 0 && barHtml2.indexOf('seats before your next pick') >= 0);
check('a3: history coaching never repeats', barHtml2.indexOf('picks early on average') < 0);

// ── ADENDA 4: Sim this lot / Sim to my turn ─────────────────────────────────
// fresh auction, user seat 1 nominates first; then FREEZE the timer
// trampoline so only the instant path can resolve lots
values['md-teams'] = '12'; values['md-rounds'] = '16'; values['md-slot'] = '1';
values['md-scoring'] = '1'; values['md-format'] = '1qb'; values['md-dtype'] = 'auction';
values['md-budget'] = '200';
sandbox.MD.autoPilot = false;
await sandbox._startMockDraftRun(); // halts at YOUR nomination (seat 1 goes first)
check('a4: room waits on your nomination', sandbox.AU.active && !sandbox.AU.lot && sandbox.AU.nominator === 1);
sandbox.auRenderLot();
const nomHtml = document.getElementById('au-lot').innerHTML;
check('a4: no Sim button while YOU are nominating', nomHtml.indexOf('auSimLot') < 0, nomHtml.slice(0, 80));
check('redesign: nomination state is loud', nomHtml.indexOf('Your turn to nominate') >= 0);
const realST = sandbox.setTimeout;
sandbox.setTimeout = () => 0; // freeze the clocked path
const AU2 = sandbox.AU, M2 = sandbox.MD;
const budget0 = { ...AU2.budgets };
// the nomination confirm bar: one giant unambiguous action
M2.selChoice = M2.pool[0];
sandbox.mdRenderDraftBar();
check('redesign: confirm bar says Nominate for $1', document.getElementById('md-draftbar').innerHTML.indexOf('Nominate for $1') >= 0);
M2.selChoice = null;
// 1. nominate, then sim the lot away (no max bid: you sit it out)
sandbox.auUserNominate(M2.pool[0]);
check('a4: lot open and frozen', !!AU2.lot && AU2.lot.bid === 1);
sandbox.auRenderLot();
// you hold your own nomination at $1: the holder card carries Sim only
check('a4: Sim available on your own held lot', document.getElementById('au-lot').innerHTML.indexOf('auSimLot') >= 0);
const poolBefore = M2.pool.length;
sandbox.auSimLot();
check('a4: simmed lot SOLD instantly', !AU2.lot && AU2.sold.length === 1 && M2.pool.length === poolBefore - 1,
  JSON.stringify(AU2.sold[0] && { p: AU2.sold[0].p.name, price: AU2.sold[0].price, value: AU2.sold[0].value }));
const s0 = AU2.sold[0];
check('a4: sale price sane vs room value', s0.price >= 1 && s0.price <= 200 - 15, `$${s0.price} (AAV $${s0.value})`);
const spent = Object.keys(AU2.budgets).reduce((a, k) => a + (budget0[k] - AU2.budgets[k]), 0);
check('a4: exactly the sale price left the room', spent === s0.price, `spent=${spent} price=${s0.price}`);
// 2. next lot: a standing max keeps proxy-bidding for you through the sim
sandbox.auAdvance(); // bot seat 2 nominates (frozen)
check('a4: bot lot open', !!AU2.lot && AU2.nominator === 2);
sandbox.auRenderLot();
const bidCard = document.getElementById('au-lot').innerHTML;
check('a4: bidding card carries Sim and Sim-to-my-turn', bidCard.indexOf('auSimLot') >= 0 && bidCard.indexOf('auSimToMyTurn') >= 0);
check('redesign: one primary OFFER button at the next increment', bidCard.indexOf('au-bid-btn') >= 0 && bidCard.indexOf('OFFER $' + (AU2.lot.bid + 1)) >= 0);
check('redesign: offer stepper present', bidCard.indexOf('au-step') >= 0 && bidCard.indexOf('auBumpCustom') >= 0);
check('redesign: money line pre-chews the budget law (Max offer · Budget)', bidCard.indexOf('Max offer <b>$') >= 0 && bidCard.indexOf('Budget $') >= 0);
check('redesign: big-number markup on the price', bidCard.indexOf('au-bid-num') >= 0 && bidCard.indexOf('au-going') >= 0);
sandbox.auRenderBudgets();
const bud = document.getElementById('au-budgets').innerHTML;
check('yahoo: budgets are compact rows, live bid badged on the high bidder',
  bud.indexOf('au-brow') >= 0 && bud.indexOf('au-bbadge">$' + AU2.lot.bid) >= 0, bud.slice(0, 200));
// stepper math: bump up twice, down once, floor at bid+1, cap at budget law
sandbox.auBumpCustom(1); sandbox.auBumpCustom(1); sandbox.auBumpCustom(-1);
check('yahoo: stepper lands at next+1', Math.max(AU2.lot.bid + 1, AU2.custom) === AU2.lot.bid + 2, String(AU2.custom));
AU2.custom = null; sandbox.auRenderLot();
let spOk = true; try { sandbox.auSoldSplash({ id: 'x', name: 'Test Player', pos: 'RB' }, 10, 'YOU'); } catch (e) { spOk = false; }
check('redesign: SOLD splash renders without error', spOk);
check('yahoo: nomination countdown in the header', document.getElementById('md-status').innerHTML.indexOf('your nomination in') >= 0 || document.getElementById('md-status').innerHTML.indexOf('you nominate next') >= 0, document.getElementById('md-status').innerHTML);
AU2.lot.myMax = 1000; // proxy clamps at your budget-law cap
sandbox.auRenderLot();
check('a4: Sim label discloses the standing max', document.getElementById('au-lot').innerHTML.indexOf('keeps your $1000 max') >= 0);
const myCap = AU2.budgets[1] - (AU2.slotsLeft[1] - 1);
sandbox.auSimLot();
const s1 = AU2.sold[0];
check('a4: sim honors your max bid (you won the lot)', s1.slot === 1 && s1.price <= myCap,
  `winner seat ${s1.slot} at $${s1.price} (cap $${myCap})`);
check('a4: your roster took the player', M2.mine.length === 1 && M2.mine[0].id === s1.p.id);
check('yahoo: the Last line records the sale', document.getElementById('au-last').innerHTML.indexOf('Last:') >= 0
  && document.getElementById('au-last').innerHTML.indexOf('$' + s1.price) >= 0, document.getElementById('au-last').innerHTML);
// 3. sim-to-my-turn stops cold on a queued player
sandbox.auAdvance();
check('a4: third lot open', !!AU2.lot);
M2.queue = [AU2.lot.p.id];
const soldN = AU2.sold.length;
sandbox.auSimToMyTurn();
check('a4: queued player on the block halts the sim untouched', !!AU2.lot && AU2.sold.length === soldN
  && M2.queue[0] === AU2.lot.p.id);
// 4. unqueued: sim rolls lots until YOUR nomination comes around
M2.queue = [];
sandbox.auSimToMyTurn();
check('a4: sim-to-my-turn lands on your nomination', AU2.active && !AU2.lot && AU2.nominator === 1
  && AU2.sold.length > soldN, `sold ${AU2.sold.length - soldN} lots on the way`);
let negB = Object.values(AU2.budgets).some(b => b < 0);
check('a4: budgets never negative through the sims', !negB, JSON.stringify(AU2.budgets));
// ── FINAL SPEC: grades, Results, Board, interlude, countdown, strip badges ──
check('grade: deadband keeps small lots fair', sandbox.auGradeBuy(1, 1) === 'B' && sandbox.auGradeBuy(3, 1) === 'B');
check('grade: steal/value/fair/overpay/bust bands',
  sandbox.auGradeBuy(30, 45) === 'A' && sandbox.auGradeBuy(40, 47) === 'B+' && sandbox.auGradeBuy(50, 50) === 'B'
  && sandbox.auGradeBuy(58, 48) === 'C+' && sandbox.auGradeBuy(70, 48) === 'D');
check('grade: every sale carries its grade', AU2.sold.length > 0 && AU2.sold.every(s => !!s.grade));
sandbox._auRenderResults();
const resHtml = document.getElementById('au-results').innerHTML;
check('results: picks view has rows, round badges and grades', resHtml.indexOf('au-pkrow') >= 0 && resHtml.indexOf('ROUND 1') >= 0 && resHtml.indexOf('au-grade') >= 0, resHtml.slice(0, 120));
AU2.rview = 'rosters'; sandbox._auRenderResults();
const rosHtml = document.getElementById('au-results').innerHTML;
check('results: rosters view shows slots with empties visible', rosHtml.indexOf('au-slotchip') >= 0 && rosHtml.indexOf('Empty') >= 0);
check('results: aggregate team grade computed', sandbox._auTeamGrade(1) !== '', sandbox._auTeamGrade(1));
sandbox._auRenderBoardTab();
const bHtml = document.getElementById('au-board').innerHTML;
check('board: manager columns, tinted cards, Max/budget line', bHtml.indexOf('au-boardrow') >= 0 && bHtml.indexOf('au-bcard pos-') >= 0 && bHtml.indexOf('Max $') >= 0);
sandbox.AU.lot = null; sandbox._auRenderInterlude();
check('mobile: interlude narrates the between-lots gap', document.getElementById('au-lot').innerHTML.indexOf('nominat') >= 0, document.getElementById('au-lot').innerHTML.slice(0, 100));
sandbox.AU.phaseEnd = Date.now() + 1800; sandbox._auTickPill();
check('mobile: countdown number above the pill ticks', document.getElementById('au-mnum').textContent === '2', document.getElementById('au-mnum').textContent);
sandbox.mdRenderMine();
check('mobile: roster strip carries buy-grade badges', document.getElementById('md-rstrip').innerHTML.indexOf('rs-g') >= 0, document.getElementById('md-rstrip').innerHTML.slice(0, 150));
// ── desktop-final details ───────────────────────────────────────────────────
sandbox._auRenderMyTeam();
const mtHtml = document.getElementById('au-myteam').innerHTML;
check('rail Team: slot rows with visible empties + $cost', mtHtml.indexOf('au-slotchip') >= 0 && mtHtml.indexOf('Empty') >= 0 && mtHtml.indexOf('au-rprice') >= 0, mtHtml.slice(0, 120));
sandbox._auRenderFeed();
const feedHtml = document.getElementById('au-rfeed').innerHTML;
// the feed is a SALES LEDGER: prices, players, buyers - plus room events.
// "X is nominating" was removed on purpose (owner: it buried the actual
// sales, and the lot card already says who is nominating).
check('rail Picks feed: a clean sales ledger (no nomination chatter)',
  feedHtml.indexOf('au-feedrow') >= 0 && feedHtml.indexOf('au-fprice') >= 0 && feedHtml.indexOf('au-fwho') >= 0
  && feedHtml.indexOf('Sim:') >= 0 && feedHtml.indexOf('Auction started') >= 0 && feedHtml.indexOf('is nominating') < 0,
  feedHtml.slice(0, 200));
AU2.rview = 'pos'; sandbox._auRenderResults();
const posHtml = document.getElementById('au-results').innerHTML;
check('results Positions: teams x positions counts', posHtml.indexOf('au-posrow') >= 0 && posHtml.indexOf('au-poscell') >= 0 && posHtml.indexOf('Positions') >= 0, posHtml.slice(0, 120));
sandbox.auRenderBudgets();
const budF = document.getElementById('au-budgets').innerHTML;
check('budgets: You first, highlighted, with picks count', budF.indexOf('au-brow me') < budF.indexOf('au-brow"') && budF.indexOf('au-bcount') >= 0, budF.slice(0, 160));
check('waiting card: dead controls while another manager nominates',
  document.getElementById('au-lot').innerHTML.indexOf('au-waitcard') >= 0 && document.getElementById('au-lot').innerHTML.indexOf('OFFER $&ndash;') >= 0 || (() => { sandbox.AU.lot = null; sandbox._auRenderInterlude(); const h = document.getElementById('au-lot').innerHTML; return h.indexOf('au-waitcard') >= 0 && h.indexOf('OFFER $&ndash;') >= 0; })(), document.getElementById('au-lot').innerHTML.slice(0, 140));
// cleanup: stop the frozen room
sandbox.AU.active = false; sandbox.AU.lot = null;
sandbox.setTimeout = realST;

// ── PACING + MAC DISCRETO ───────────────────────────────────────────────────
check('pace: named constants live in render layer', sandbox.AU_PACE && sandbox.AU_PACE.BID_MIN === 1400 && sandbox.AU_PACE.BID_MAX === 2200 && sandbox.AU_PACE.GOING_2 === 2000 && sandbox.AU_PACE.HAMMER === 1500);
check('pace: fast-path hook honors _AU_FAST', sandbox._auDelay(2000) === 1);
sandbox._AU_FAST = 0;
check('pace: real delays without the flag', sandbox._auDelay(2000) === 2000 && sandbox._auBeatMs() >= 1400 && sandbox._auBeatMs() <= 2200);
sandbox._AU_FAST = 1;
// decision beat never touches pacing: source-level assertion
const src = (await import('node:fs')).default.readFileSync(APP_PATH, 'utf8');
const beatBody = src.slice(src.indexOf('function _auBidOnce'), src.indexOf('function auBidStep'));
check('pace: _auBidOnce never reads AU_PACE or timers', beatBody.indexOf('AU_PACE') < 0 && beatBody.indexOf('setTimeout') < 0);
// GOING banner renders in the lot card at going>=1
sandbox.AU.active = true; sandbox.AU.nominator = 2;
sandbox.AU.budgets = sandbox.AU.budgets || { 1: 200 }; sandbox.AU.slotsLeft = sandbox.AU.slotsLeft || { 1: 5 };
sandbox.AU.budgets[1] = 100; sandbox.AU.slotsLeft[1] = 5; sandbox.MD.mySlot = 1;
sandbox.AU.lot = { p: { id: 'g1', name: 'Going Guy', pos: 'WR', team: 'KC' }, bid: 7, holder: 2, going: 1, myMax: 0 };
sandbox.auRenderLot();
const goCard = document.getElementById('au-lot').innerHTML;
check('pace: GOING ONCE banner big in the card', goCard.indexOf('GOING ONCE') >= 0 && goCard.indexOf('au-goingtxt') >= 0);
sandbox.AU.lot.going = 2; sandbox.auRenderLot();
check('pace: GOING TWICE at the second beat', document.getElementById('au-lot').innerHTML.indexOf('GOING TWICE') >= 0);
check('pace: BID button still actionable through the window', document.getElementById('au-lot').innerHTML.indexOf('au-bid-btn') >= 0);
// mobile header pill mirrors the pacing state
const pill = document.getElementById('au-mpill');
check('mobile: pill shows price + going twice', pill.innerHTML.indexOf('$' + sandbox.AU.lot.bid) >= 0 && pill.innerHTML.indexOf('going twice') >= 0 && String(pill.className).indexOf('g2') >= 0, pill.innerHTML + ' / ' + pill.className);
sandbox.AU.lot.going = 0; sandbox.auRenderLot();
check('mobile: pill names the leader between raises', pill.innerHTML.indexOf('leads') >= 0, pill.innerHTML);
sandbox.AU.lot = null; sandbox.AU.nominator = sandbox.MD.mySlot; sandbox._auRenderMHead();
check('mobile: pill hands you the nomination', pill.innerHTML.indexOf('Your nomination') >= 0);
sandbox.AU.active = false; sandbox.AU.lot = null;

// Mac discreto: default collapsed, face is the toggle, gesture persists
sandbox.localStorage.removeItem('tm_mac_collapsed');
// OWNER'S RULE (8/2026): Mac does not speak inside a live room at all - his
// read lives in the player card, opened on demand. mdMacSay is a no-op that
// keeps the box empty and hidden, whatever any caller passes it.
sandbox.mdMacSay('essence', '<div>THE-FULL-READ</div>', {});
const sageEl = document.getElementById('md-sage');
check('mac: silent inside the room (no in-draft voice)',
  sageEl.innerHTML.indexOf('THE-FULL-READ') < 0 && sageEl.innerHTML === '' && sageEl.style.display === 'none',
  JSON.stringify({ html: sageEl.innerHTML.slice(0, 40), display: sageEl.style.display }));
check('mac: the room read still exists for the player card',
  typeof sandbox.mdDraftRead === 'function');
// auction advisor gating: irrelevant lot -> silence
sandbox.AU.active = true; sandbox.AU.inflation = 1;
sandbox.MD.mine = [{ pos: 'TE', id: 't1', name: 'T', team: 'KC' }];
sandbox.AU.budgets[1] = 6; sandbox.AU.slotsLeft[1] = 5; // broke: cap $2
sandbox.AU.val = { xx: 40 };
const silentLine = sandbox.auSageLine({ id: 'xx', name: 'Rich Guy', pos: 'TE', team: 'KC' }, { bid: 30, holder: 2, going: 2, myMax: 0 });
check('mac: no worth line on an irrelevant lot (starter set + out of reach)', silentLine === '', silentLine);
sandbox.AU.budgets[1] = 200; sandbox.MD.mine = [];
const loudLine = sandbox.auSageLine({ id: 'xx', name: 'Rich Guy', pos: 'TE', team: 'KC' }, { bid: 30, holder: 2, going: 1, myMax: 0 });
check('mac: worth line at the entry window on a relevant lot', loudLine.indexOf('Worth up to') >= 0, loudLine);
const quietBid = sandbox.auSageLine({ id: 'xx', name: 'Rich Guy', pos: 'TE', team: 'KC' }, { bid: 3, holder: 2, going: 0, myMax: 0 });
check('mac: mute mid bot-vs-bot bidding far from his number', quietBid === '', quietBid);
sandbox.AU.active = false;

// ── FZ26 RB premium: Mac anticipates with the bots' own multiplier ─────────
sandbox.localStorage.setItem('tm_md_fantazy26', '1');
sandbox.AU.active = true; sandbox.AU.inflation = 1; sandbox.MD.mine = [];
sandbox.MD.mySlot = 1; sandbox.AU.budgets[1] = 200; sandbox.AU.slotsLeft[1] = 15;
sandbox.AU.val = { rbx: 63 };
const rbLine = sandbox.auSageLine({ id: 'rbx', name: 'Bijan Robinson', pos: 'RB', team: 'ATL' }, { bid: 40, holder: 2, going: 1, myMax: 0 });
check('fz26 premium: Mac anticipates the RB market ($74ish on $63 AAV)', rbLine.indexOf('pays up for RBs') >= 0 && rbLine.indexOf('$74ish') >= 0, rbLine);
const wrLine = sandbox.auSageLine({ id: 'rbx', name: 'Some WR', pos: 'WR', team: 'ATL' }, { bid: 40, holder: 2, going: 1, myMax: 0 });
check('fz26 premium: non-RB lots carry no market clause', wrLine.indexOf('pays up') < 0, wrLine);
check('fz26 premium: named constants calibrated', sandbox.FZ26_RB_PREM_ELITE === 1.18 && sandbox.FZ26_RB_PREM === 1.10 && sandbox.FZ26_BID_CAP === 1.15 && sandbox.AU_BID_CAP === 1.15);
// bot willingness wears the premium and the cap; the user's worth does not
sandbox.MD.teams = 10; sandbox.MD.rounds = 15;
for (let s = 1; s <= 10; s++) { sandbox.AU.budgets[s] = 200; sandbox.AU.slotsLeft[s] = 15; sandbox.MD.aiRosters[s] = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0, list: [] }; }
sandbox.AU.bots[2] = { k: 'balanced', name: 'B2' };
sandbox.AU.eliteLine = 40;
const mx = sandbox.auBotMax(2, { id: 'rbx', name: 'Bijan Robinson', pos: 'RB', team: 'ATL' });
check('fz26 premium: bot max respects the banded 1.15x ceiling',  mx >= 58 && mx <= 72, '$' + mx);
// upward inflation below the (separate, pre-existing) endgame-blowout
// threshold: real rooms only reach 1.1+ inflation when money outweighs the
// value left, never at full budgets - the blowout is out of scope here
sandbox.AU.inflation = 1.05;
const mx2 = sandbox.auBotMax(2, { id: 'rbx', name: 'Bijan Robinson', pos: 'RB', team: 'ATL' });
check('fz26 premium: no compounding with upward inflation (max, not product)', mx2 <= Math.round(63 * 1.25), '$' + mx2);
sandbox.AU.inflation = 1;
const wUser = sandbox.auMyWorth({ id: 'rbx', name: 'Bijan Robinson', pos: 'RB', team: 'ATL' }).worth;
check('fz26 premium: user worth stays premium-free', wUser <= Math.round(63 * 1.1) + 1, '$' + wUser);
check('fz26 premium: grades still compare against real value', sandbox.auGradeBuy(74, 63) === 'C+' || sandbox.auGradeBuy(74, 63) === 'B', sandbox.auGradeBuy(74, 63));
sandbox.AU.inflation = 1;
sandbox.localStorage.removeItem('tm_md_fantazy26');
sandbox.localStorage.removeItem('tm_md_profiles_fantazy26');
sandbox.AU.active = false;

console.log(fails === 0 ? '\nQA ALL GREEN' : `\n${fails} QA FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
