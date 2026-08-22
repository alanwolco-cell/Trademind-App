#!/usr/bin/env node
// Trades gate. Same sandbox recipe as qa-flows.mjs / calibrate-room.mjs: loads
// the real public/app.js, stubs the DOM, and asserts the hard invariants of the
// trade engine plus a handful of static rules that keep known regressions from
// walking back in.
//
//   node scripts/qa-trades.mjs            # audit public/app.js
//   node scripts/qa-trades.mjs --app PATH # audit a candidate build
//
// Exit 0 = ALL GREEN. Anything else fails the gate.
'use strict';
import fs from 'node:fs';
import vm from 'node:vm';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
// El repo se resuelve desde la ubicacion de ESTE script, no desde una ruta
// absoluta de la maquina de nadie: si no, el gate solo corre en un portatil.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argApp = (() => { const i = process.argv.indexOf('--app'); return i > 0 ? process.argv[i + 1] : null; })();
const APP_PATH = argApp || path.join(REPO, 'public/app.js');
const argHtml = (() => { const i = process.argv.indexOf('--html'); return i > 0 ? process.argv[i + 1] : null; })();
const HTML_PATH = argHtml || (argApp ? argApp.replace(/app\.js$/, 'index.html') : path.join(REPO, 'public/index.html'));
const APP = fs.readFileSync(APP_PATH, 'utf8');
const HTML = fs.existsSync(HTML_PATH) ? fs.readFileSync(HTML_PATH, 'utf8') : '';
const BASE = 'https://trademindff.com';

const values = {};
function el(id) {
  return {
    id, style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue() { return ''; } },
    dataset: {}, options: [], children: [],
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
  encodeURIComponent, decodeURIComponent, URL, URLSearchParams,
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
  setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
  fetch: () => Promise.reject(new Error('no network in the gate'))
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(APP, sandbox, { filename: 'app.js' });
// app.js declares its state with `let`, which lives in the realm's lexical scope
// and never lands on the sandbox object. A second script in the SAME context can
// see those bindings, so this is the bridge the gate reads and writes through.
vm.runInContext(`window.__qa = {
  get ktcValues(){ return ktcValues; },
  get ktcById(){ return ktcById; },
  get allPlayers(){ return allPlayers; },
  set leagueRosters(v){ leagueRosters = v; },
  get leagueRosters(){ return leagueRosters; },
  set userId(v){ userId = v; },
  set ACTIVE_SEASON(v){ ACTIVE_SEASON = v; },
  set _pickValCache(v){ _pickValCache = v; }
};`, sandbox, { filename: 'qa-bridge.js' });
const QA = sandbox.window.__qa;

let fails = 0, checks = 0, scenarios = 0;
const check = (label, ok, detail) => { checks++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '\n      ' + detail : ''}`); };
const num = v => typeof v === 'number' && isFinite(v);

// ── a market: rounds 1-4 priced like FantasyCalc prices them, 2026-2029 ──────
const SEASON = '2026';
QA.ACTIVE_SEASON = SEASON;
const ROUND_AVG = { 2026: [3211, 1513, 1008, 757], 2027: [3050, 1500, 1005, 770], 2028: [2013, 1274, 902, 755], 2029: [1791, 1213, 897, 746] };
Object.keys(ROUND_AVG).forEach(y => {
  ROUND_AVG[y].forEach((avg, i) => {
    const rd = i + 1;
    for (let slot = 1; slot <= 12; slot++) {
      // slot curve that averages back to the round price, like the real feed
      QA.ktcValues[`${y} pick ${rd}.${String(slot).padStart(2, '0')}`] = Math.round(avg * (1.45 - 0.9 * (slot - 1) / 11));
    }
    QA.ktcValues[`${y} round ${rd}`] = avg;
    QA.ktcValues[`${y} round ${rd} (via trade)`] = avg;
  });
});
QA._pickValCache = {};

console.log(`\n── invariants of tradeScore() ───────────────────────────────────`);
const ts = sandbox.tradeScore;
const MODES = ['dynasty', 'redraft'];
const ANS = [null, [null, null, null], [0, 0, 0], [0, 1, 1], [1, 2, 2], [2, 3, 3], [3, 3, 0], [0, 2, 2], [2, 1, 0], [1, 0, 3], [3, 0, 1], [2, 2, 2]];
const GAPS = [-6000, -3000, -2000, -1600, -1500, -1499, -1000, -500, -350, -100, 0, 100, 350, 500, 1000, 1500, 2000, 3000, 6000];
const BASES = [[0, 0], [500, 500], [2000, 2000], [5000, 5000], [9000, 9000], [300, 4000], [12000, 12000]];

// 1. never a NaN, never out of band
let bad = null;
for (const mode of MODES) for (const a of ANS) for (const g of GAPS) for (const [gi, ge] of BASES) for (const hk of [true, false]) {
  scenarios++;
  const r = ts(g, gi, ge, a, mode, hk);
  if (!r || !num(r.score) || r.score < 0 || r.score > 100 || !r.verdict) { bad = bad || JSON.stringify({ mode, a, g, gi, ge, hk, r }); }
}
check('no NaN / Infinity / undefined, score always inside [0,100]', !bad, bad);

// 2. the same asset on both sides is exactly neutral
bad = null;
for (const v of [0, 500, 1000, 3000, 6000, 12000, 20000]) for (const mode of MODES) {
  scenarios++;
  const s = ts(0, v, v, [null, null, null], mode, true).score;
  if (Math.round(s * 1e6) / 1e6 !== 50) bad = bad || `${mode} value=${v} -> ${s}`;
}
check('a 1-for-1 of the SAME asset scores exactly 50', !bad, bad);

// 3. adding value to your side can never lower your score
bad = null;
for (const mode of MODES) for (const a of ANS) for (const [gi, ge] of BASES) {
  let prev = -1, prevG = null;
  for (const g of GAPS) {
    scenarios++;
    const s = ts(g, gi, ge, a, mode, true).score;
    if (prev >= 0 && s < prev - 1e-9) bad = bad || `${mode} answers=${JSON.stringify(a)} base=${gi}/${ge}: effGap ${prevG} scored ${prev.toFixed(2)} but ${g} (a BETTER trade) scored ${s.toFixed(2)}`;
    prev = s; prevG = g;
  }
}
check('monotonic: a better gap never scores worse', !bad, bad);

// 4. the mirror: A's read and B's read add up to 100
bad = null;
for (const mode of MODES) for (const [gi, ge] of BASES) for (const g of GAPS) {
  scenarios++;
  const A = ts(g, gi, ge, [null, null, null], mode, true).score;
  const B = ts(-g, ge, gi, [null, null, null], mode, true).score;
  if (Math.abs(A + B - 100) > 1e-6) bad = bad || `${mode} base=${gi}/${ge} gap=${g}: A=${A.toFixed(2)} B=${B.toFixed(2)} sum=${(A + B).toFixed(2)}`;
}
check('symmetric: score(gap) + score(-gap) === 100 with neutral answers', !bad, bad);

// 5. an obvious robbery is called in the right direction, at any deal size
bad = null;
for (const mode of MODES) for (const [big, small] of [[7500, 500], [20000, 1000], [3000, 200]]) {
  scenarios += 2;
  const win = ts(big - small, small, big, [null, null, null], mode, true);
  const lose = ts(small - big, big, small, [null, null, null], mode, true);
  if (win.score < 72) bad = bad || `winning side of ${big}-for-${small} only scored ${win.score.toFixed(1)} (${win.verdict})`;
  if (lose.score > 32) bad = bad || `losing side of ${big}-for-${small} scored ${lose.score.toFixed(1)} (${lose.verdict})`;
}
check('an elite-for-junk fleece is marked hard, in the right direction', !bad, bad);

// 6. no answer to the three questions can rescue a real fleece
bad = null;
for (const mode of MODES) for (const a of ANS) {
  scenarios++;
  const r = ts(-7000, 7500, 500, a, mode, true);
  if (r.score > 32) bad = bad || `${mode} answers=${JSON.stringify(a)} talked a 7,000 loss up to ${r.score.toFixed(1)} (${r.verdict})`;
}
check('sentiment can nudge but never flips a real value edge', !bad, bad);

// 7. severity is relative to the size of the deal, not an absolute cliff
{
  scenarios += 2;
  const smallLoss = ts(-1500, 6000, 4500, [null, null, null], 'dynasty', true);   // 25% of the deal
  const bigLoss = ts(-1500, 20000, 18500, [null, null, null], 'dynasty', true);   // 7.5% of the deal
  check('the same raw gap reads worse on a small trade than on a blockbuster',
    smallLoss.score < bigLoss.score - 5,
    `6k-for-4.5k -> ${smallLoss.score.toFixed(1)} (${smallLoss.verdict}); 20k-for-18.5k -> ${bigLoss.score.toFixed(1)} (${bigLoss.verdict})`);
}

console.log(`\n── roster math (_tmEffGap) ──────────────────────────────────────`);
if (typeof sandbox._tmEffGap !== 'function') {
  check('_tmEffGap exists and is shared by both readouts', false, 'not defined: runAnalysis and showYouVerdict are still computing the gap separately, so the badge and the headline can disagree');
} else {
  const eg = (g, t, gap, sit) => sandbox._tmEffGap(g, t, gap, true, sit == null ? 0 : sit).effGap;
  check('same assets both sides stays exactly neutral (1-for-1)', eg([5000], [5000], 0) === 0);
  check('same assets both sides stays exactly neutral (3-for-3)', eg([5000, 3000, 1000], [5000, 3000, 1000], 0) === 0);
  const a13 = eg([9800], [4200, 4100, 1500], 0), b31 = eg([4200, 4100, 1500], [9800], 0);
  check('a split is charged and the mirroring consolidation is credited', a13 < 0 && b31 > 0, `1-for-3 ${a13}, 3-for-1 ${b31}`);
  check('the split charge is not double counted', Math.abs(a13) <= 460, `1-for-3 adjustment was ${a13}`);
  scenarios += 4;
}

console.log(`\n── draft picks ──────────────────────────────────────────────────`);
const gk = (n) => sandbox.getKtcValue(n, null);

// picks from a draft that already ran are worth nothing
sandbox.window._doneDraftSeasons = { 2024: 1, 2025: 1 };
QA._pickValCache = {};
bad = null;
for (const y of [2023, 2024, 2025]) for (const r of [1, 2, 3, 4]) {
  scenarios++;
  const v = gk(`${y} Round ${r}`);
  if (v > 0) bad = bad || `${y} Round ${r} is still priced at ${v} - that draft is over`;
}
check('picks from a draft that already happened are worth 0', !bad, bad);
QA._pickValCache = {};

// every round the league negotiates has a price
bad = null;
for (const y of [2026, 2027, 2028]) for (const r of [1, 2, 3, 4, 5, 6]) {
  scenarios++;
  const v = gk(`${y} Round ${r}`);
  if (!(v > 0)) bad = bad || `${y} Round ${r} priced at ${v}; leagues with 5- and 6-round rookie drafts exist and trade those picks`;
}
check('every round a league can run is priced, not just the four the feed ships', !bad, bad);

// order: later round cheaper, further year never dearer
bad = null;
for (const y of [2026, 2027, 2028, 2029]) for (let r = 1; r < 6; r++) {
  scenarios++;
  const a = gk(`${y} Round ${r}`), b = gk(`${y} Round ${r + 1}`);
  if (a > 0 && b > 0 && b >= a) bad = bad || `${y}: round ${r + 1} (${b}) is not cheaper than round ${r} (${a})`;
}
check('a later round is always cheaper than an earlier one', !bad, bad);
// Ordering across years is only ours to enforce BEYOND the last season the feed
// prices; inside it, the market says what it says (it really does put a 2027 4th
// a shade above a 2026 4th). What must never happen is the fallback inventing a
// far-future pick that costs more than the last one the market actually quotes.
bad = null;
const LAST_PRICED = 2029;
for (const r of [1, 2, 3, 4, 5]) {
  const anchor = gk(`${LAST_PRICED} Round ${r}`);
  let prev = anchor;
  for (let y = LAST_PRICED + 1; y <= LAST_PRICED + 3; y++) {
    scenarios++;
    const v = gk(`${y} Round ${r}`);
    if (anchor > 0 && v > anchor + 1) bad = bad || `${y} Round ${r} (${v}) costs more than the last season the market prices, ${LAST_PRICED} Round ${r} (${anchor})`;
    if (prev > 0 && v > prev + 1) bad = bad || `${y} Round ${r} (${v}) costs more than ${y - 1} Round ${r} (${prev})`;
    prev = v;
  }
}
check('an extrapolated far-future pick never costs more than a priced one', !bad, bad);

// the via-trade label must not change the price
bad = null;
for (const y of [2026, 2027, 2028]) for (const r of [1, 2, 3, 4]) {
  scenarios++;
  if (gk(`${y} Round ${r}`) !== gk(`${y} Round ${r} (via trade)`)) bad = bad || `${y} Round ${r}: plain ${gk(`${y} Round ${r}`)} vs via-trade ${gk(`${y} Round ${r} (via trade)`)}`;
}
check('a pick acquired in a trade is priced the same as your own', !bad, bad);

// junk in, zero out - never NaN
bad = null;
for (const s of ['', '   ', 'Zzz Nobody', '2026', 'Round 1', 'pick', '2026 Round 0', '2026 Round 99', '----']) {
  scenarios++;
  const v = sandbox.getKtcValue(s, null);
  if (!num(v)) bad = bad || `getKtcValue(${JSON.stringify(s)}) = ${v}`;
}
check('getKtcValue never returns NaN or undefined for junk input', !bad, bad);

// the inventory: three PENDING drafts, and all the rounds the league runs
{
  sandbox.window._doneDraftSeasons = { 2025: 1, 2026: 1 };   // this year's rookie draft is done
  sandbox.window._draftRounds = 5;
  QA.leagueRosters = [];
  const roster = { roster_id: 1, owner_id: 'u1', players: [] };
  const picks = sandbox.buildPicksForRoster(roster, [], SEASON);
  const seasons = [...new Set(picks.map(p => p.season))].sort();
  const rounds = [...new Set(picks.map(p => p.round))].sort((a, b) => a - b);
  scenarios += 2;
  check('three pending drafts are tradeable, not three calendar years',
    seasons.length === 3 && seasons.join(',') === '2027,2028,2029',
    `got seasons ${seasons.join(',') || '(none)'} after the ${SEASON} draft completed`);
  check("the league's real round count is honoured",
    rounds.length === 5 && rounds[4] === 5, `got rounds ${rounds.join(',')} for a 5-round league`);
  check('no dead season leaks into the inventory', !seasons.some(s => s <= 2026), `seasons: ${seasons.join(',')}`);
}

console.log(`\n── who am I in this league ──────────────────────────────────────`);
{
  scenarios += 3;
  QA.userId = 'me';
  QA.leagueRosters = [
    { roster_id: 1, owner_id: 'someone', co_owners: null, players: [] },
    { roster_id: 2, owner_id: 'primary', co_owners: ['me'], players: [] }
  ];
  const ok = typeof sandbox._isMyRoster === 'function' && typeof sandbox._myRosterObj === 'function';
  check('_isMyRoster / _myRosterObj exist', ok, 'the co-owner rule has to live in one place, not be re-derived per call site');
  if (ok) {
    check('a co-owned roster is recognised as mine', sandbox._isMyRoster(QA.leagueRosters[1]) === true);
    check('_myRosterObj finds the co-owned roster', (sandbox._myRosterObj() || {}).roster_id === 2,
      'Sleeper co-owners never appear in owner_id; matching owner_id alone left co-owned teams with no roster and no builder');
  }
}

console.log(`\n── source rules ─────────────────────────────────────────────────`);
{
  // Comments are documentation, not code: a rule that trips on the comment
  // explaining the rule is a rule nobody keeps.
  const CODE = APP.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  // site 17 of the co-owner bug, written by hand
  const rogue = (CODE.match(/leagueRosters[\s\S]{0,40}?owner_id\s*===?\s*userId/g) || []).length
    + (CODE.match(/oppRosterObj\.owner_id\s*===?\s*userId/g) || []).length
    + (CODE.match(/roster\.owner_id\s*===?\s*userId/g) || []).length;
  check('nobody re-derives "is this roster mine" by hand', rogue === 0,
    `${rogue} raw owner_id===userId comparison(s) outside the helper. Use _isMyRoster(r) / _myRosterObj().`);

  // the verdict must not be drawn from a clock
  const body = CODE.slice(CODE.indexOf('async function runAnalysis()'), CODE.indexOf('function sageStyleNote'));
  const rnd = (body.match(/Math\.random\(\)/g) || []).length;
  check('the verdict is deterministic: no Math.random() in runAnalysis', rnd === 0,
    `${rnd} Math.random() call(s) left. The same trade must read the same on every press; seed off the trade with _tmRand.`);

  // every player photo has to degrade. The URL is usually built by concatenation,
  // so scan from each thumb/ up to the tag's closing '>' and demand an onerror.
  // Scoped to INLINE <img ...> literals: a bare .src= assignment or a url helper
  // is consumed somewhere else and is not something this rule can judge.
  const noFallback = [];
  let ti = -1;
  while ((ti = APP.indexOf('players/thumb/', ti + 1)) >= 0) {
    const open = APP.lastIndexOf('<img', ti);
    if (open < 0 || APP.slice(open, ti).includes('>')) continue;   // not inside an img tag
    const end = APP.indexOf('>', ti);
    const tag = APP.slice(open, end < 0 ? ti + 300 : end + 1);
    if (!/onerror/.test(tag)) noFallback.push(`app.js:${APP.slice(0, open).split('\n').length}  ` + tag.replace(/\s+/g, ' ').slice(0, 110));
  }
  check('every player photo has an onerror fallback', noFallback.length === 0,
    `${noFallback.length} without one:\n      ` + noFallback.slice(0, 3).join('\n      '));

  // the balance meter is drawn from the number its own label uses
  check('the balance bar is positioned from effGap, not the raw gap',
    /balancePct=hasKtc[\s\S]{0,80}effGap\/3000/.test(APP),
    'bar drawn from ktcGap while its label comes from effGap: it sat on YOUR side of centre, in red, captioned "You\'re losing value"');

  // house rule: no em dashes anywhere in app.js, no emoji in the trade area
  // Un em dash DENTRO de una clase de caracteres de regex no es una violacion:
  // es el saneador que los elimina de la salida de Mac. Contarlo como fallo
  // convertiria el arreglo en el delito. Todo lo demas si cuenta.
  const emLines = APP.split('\n')
    .map((l, i) => l.replace(/\[[^\]\n]*\]/g, '').includes('\u2014')
      ? `app.js:${i + 1}  ${l.trim().slice(0, 110)}` : null)
    .filter(Boolean);
  check('no em dashes in app.js', emLines.length === 0, emLines.join('\n      '));
  // Dos declaraciones del mismo nombre en el ambito superior no dan error: la
  // segunda gana en silencio y los consumidores de la primera leen undefined.
  // Aparecio de verdad cuando dos revisiones definieron `_mdStarterGate` con
  // formas de retorno distintas: la puerta de titulares habria dejado de
  // existir sin que fallara nada. Solo cuentan las de columna 0 (las anidadas
  // tienen su propio ambito y son legitimas).
  const topFns = {};
  let fm; const fnRe = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  while ((fm = fnRe.exec(APP))) topFns[fm[1]] = (topFns[fm[1]] || 0) + 1;
  const dupFns = Object.entries(topFns).filter(([, n]) => n > 1);
  check('no top-level function is declared twice', dupFns.length === 0,
    dupFns.map(([n, k]) => `${n} declared ${k}x`).join('\n      '));

  const area = APP.slice(APP.indexOf('function tradeScore'), APP.indexOf('function renderPlayersDB'));
  const emoji = area.match(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}]/gu) || [];
  check('no emoji in the trade area', emoji.length === 0, [...new Set(emoji)].join(' '));

  if (HTML) {
    check('saved trades are reachable from the UI', /switchInnerTab\([^)]*'tab-history'/.test(HTML),
      "#tab-history had no nav entry at all: the only way in was the /league#tab-history hash");
    const sth = CODE.slice(CODE.indexOf('function saveToHistory()'), CODE.indexOf('function renderHistory()'));
    check('saveToHistory routes through the screen/tab helpers, not a phantom .tab node',
      /switchInnerTab\([^)]*'tab-history'/.test(sth) && !/switchTab\(/.test(sth),
      'index.html has zero elements with class="tab", so switchTab(querySelectorAll(".tab")[1], ...) got undefined for the button and stripped .active from every tab-content in the document');
  }
}

console.log(`\n${scenarios.toLocaleString()} scenarios, ${checks} checks`);
console.log(fails === 0 ? 'TRADES QA ALL GREEN' : `\n${fails} TRADES QA FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
