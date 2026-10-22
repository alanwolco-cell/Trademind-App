#!/usr/bin/env node
// GATE DEL TRADE GUARD (2026-10-21).
//
//   node scripts/qa-tradeguard.mjs
//
// El Trade Guard lee un trade como lo leeria el comisionado: brecha de valor
// relativa al paquete, alineacion titular antes y despues, la carrera por los
// playoffs (records) y el formato de la liga. Se mide sobre la liga REAL del
// dueno, Miami Boys Choir, congelada en la semana 7:
//   scripts/fixtures/miami-boys-choir-2026-wk7.json         (Sleeper)
//   scripts/fixtures/miami-boys-choir-2026-wk7-values.json  (FantasyCalc redraft
//     half PPR 1QB y el maestro de Sleeper, solo de sus 192 jugadores)
//
// Parte 1, motor puro (vm, sin red, mismo arnes que qa-trades): public/app.js y
// public/tradeguard.js corren juntos en un sandbox con el DOM de mentira.
// Parte 2, navegador real (estilo qa-faab): la liga del fixture entra por
// /api/sleeper interceptado, se llega a League Trades CLICANDO y se analiza un
// trade en el analizador.
'use strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/fixtures/miami-boys-choir-2026-wk7.json'), 'utf8'));
const VAL = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/fixtures/miami-boys-choir-2026-wk7-values.json'), 'utf8'));
const LID = FX.league.league_id;
const WOLCO = '359098099047628800';

let fails = 0, checks = 0;
const ok = (n, c, d) => { checks++; if (!c) fails++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (!c && d ? '\n      ' + d : '')); };
const LEVELS = ['even', 'lean', 'lopsided', 'flag', 'unknown'];

// ── Parte 1: el motor puro ───────────────────────────────────────────────────
console.log('=== motor (vm) ===');
const APP = fs.readFileSync(path.join(REPO, 'public/app.js'), 'utf8');
const TGP = path.join(REPO, 'public/tradeguard.js');
const TG = fs.existsSync(TGP) ? fs.readFileSync(TGP, 'utf8') : '';

function el(id) {
  return {
    id, style: { setProperty() { }, removeProperty() { }, getPropertyValue() { return ''; } },
    dataset: {}, options: [], children: [], value: '',
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
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
  createElement: tag => el('_' + tag), querySelector: () => null, querySelectorAll: () => [],
  addEventListener() { }, removeEventListener() { },
  body: el('body'), documentElement: el('html'), head: el('head'),
  createTextNode: t => ({ textContent: t }), title: ''
};
const sandbox = {
  document, console: { log() { }, warn() { }, error() { }, info() { } }, Math, Date, JSON, Object, Array, String, Number, Boolean,
  parseInt, parseFloat, isNaN, isFinite, RegExp, Error, Promise, Map, Set,
  encodeURIComponent, decodeURIComponent, URL, URLSearchParams,
  navigator: { userAgent: 'qa', clipboard: {} },
  location: { search: '', href: 'https://macdraft.app/', pathname: '/', hash: '', origin: 'https://macdraft.app' },
  history: { pushState() { }, replaceState() { } },
  localStorage: { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } },
  sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  alert() { }, confirm: () => true, prompt: () => null,
  requestAnimationFrame: fn => { fn(); return 0; }, cancelAnimationFrame() { },
  IntersectionObserver: class { observe() { } unobserve() { } disconnect() { } },
  MutationObserver: class { observe() { } disconnect() { } },
  ResizeObserver: class { observe() { } disconnect() { } },
  matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
  scrollTo() { }, scrollBy() { }, performance: { now: () => Date.now() },
  addEventListener() { }, removeEventListener() { }, dispatchEvent() { },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  innerWidth: 1280, innerHeight: 800, pageYOffset: 0, scrollY: 0,
  CustomEvent: class { }, Event: class { }, Audio: class { play() { } },
  setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
  fetch: () => Promise.reject(new Error('no network in the gate'))
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
let cargo = { app: false, tg: false };
try { vm.runInContext(APP, sandbox, { filename: 'app.js' }); cargo.app = true; } catch (e) { console.log('app.js no cargo: ' + e.message); }
try { if (TG) { vm.runInContext(TG, sandbox, { filename: 'tradeguard.js' }); cargo.tg = true; } } catch (e) { console.log('tradeguard.js no cargo: ' + e.message); }
ok('(0a) CONTROL: app.js carga en el sandbox', cargo.app);
ok('(0b) public/tradeguard.js existe, carga y expone tgEvaluate', cargo.tg && typeof sandbox.tgEvaluate === 'function',
  TG ? 'tgEvaluate: ' + typeof sandbox.tgEvaluate : 'no existe public/tradeguard.js');

// El FAAB se precia con la funcion REAL de app.js (tmFaabValue), con la liga de
// verdad: waivers FAAB, bote $1000, semana 7, redraft.
if (cargo.app) {
  vm.runInContext(`window._leagueWaiver={type:2,budget:${Number(FX.league.settings.waiver_budget) || 0}};
    window.leaguePlatform='sleeper'; NFL_WEEK=${FX.week}; NFL_SEASON_TYPE='regular'; leagueMode='redraft';`, sandbox);
}
const players = VAL.players;
const pos = id => { const p = players[id]; return p && p.fantasy_positions ? p.fantasy_positions[0] : null; };
const nombre = id => { const p = players[id]; return p ? (p.first_name + ' ' + p.last_name) : String(id); };
const usuario = rid => {
  const r = FX.rosters.find(x => x.roster_id === rid);
  const u = r && FX.users.find(x => x.user_id === r.owner_id);
  return u ? ((u.metadata && u.metadata.team_name) || u.display_name).trim() : 'Team ' + rid;
};
const ctxBase = (over = {}) => Object.assign({
  league: FX.league, week: FX.week, rosters: FX.rosters,
  valueOf: id => VAL.byId[id] != null ? VAL.byId[id] : null,
  posOf: pos, ageOf: id => (players[id] && players[id].age) || null, playerName: nombre,
  expOf: id => (players[id] && players[id].years_exp != null) ? players[id].years_exp : null,
  injuryOf: id => (players[id] && players[id].injury_status) || null,
  pickValue: () => null,
  faabValue: d => cargo.app ? sandbox.tmFaabValue(d) : null,
  nameOf: usuario
}, over);
const ev = (ctx, trade) => {
  try { return sandbox.tgEvaluate(ctx, trade); } catch (e) { return { _err: String(e).slice(0, 160), level: null, reasons: [], sides: [] }; }
};
const sideP = (rid, gives, extra = {}) => Object.assign({ rosterId: rid, gives: gives.map(String), givesPicks: [], givesFaab: 0 }, extra);
const rosterTop = rid => FX.rosters.find(r => r.roster_id === rid).players
  .filter(id => VAL.byId[id] != null).sort((a, b) => VAL.byId[b] - VAL.byId[a]);
const porNombre = (rid, apellido) => FX.rosters.find(r => r.roster_id === rid).players.find(id => players[id] && players[id].last_name === apellido);
const R = (r) => JSON.stringify(r && { level: r.level, favors: r.favors, gapPct: r.gapPct, reasons: r.reasons, err: r._err });
const hasDump = r => (r.reasons || []).some(t => /dumping pattern/.test(t));
// Fixture DERIVADO: la misma liga mas adelante en la temporada. Cada record se
// escala a los partidos jugados (semana N = N-1 jugados) y Alanta Falcons queda
// con el record que se le pida. El orden de la tabla se conserva.
const derivar = (semana, r1) => {
  const jug = semana - 1;
  const rosters = JSON.parse(JSON.stringify(FX.rosters)).map(r => {
    const w = r.roster_id === 1 ? r1[0] : Math.round(r.settings.wins * jug / 6);
    r.settings.wins = w; r.settings.losses = jug - w; return r;
  });
  return { week: semana, rosters };
};
const W13 = derivar(13, [2, 10]);   // 2-10 con la linea en 6 y 2 semanas: eliminado
const W11 = derivar(11, [2, 8]);    // 2-8, a 3 de la linea con 4 semanas: long shot

if (cargo.tg) {
  const tabla = sandbox.tgStandings(FX.rosters, FX.league.settings, FX.week);
  const st = rid => tabla.byRid[rid] || {};
  ok('(s1) la tabla real: Nabers in Paris 6-0 es 1o y contender; Alanta Falcons 1-5 esta a 2 juegos y es bubble',
    st(3).standing === 1 && st(3).record === '6-0' && st(3).status === 'contender' && st(1).record === '1-5' && st(1).gb === 2 && st(1).status === 'bubble',
    JSON.stringify({ r3: st(3), r1: st(1) }));
  ok('(s2) linea de playoffs en 6 de 12 y quedan 8 semanas de temporada regular', tabla.playoffTeams === 6 && tabla.teams === 12 && tabla.left === 8,
    JSON.stringify({ pt: tabla.playoffTeams, n: tabla.teams, left: tabla.left }));
  const f = sandbox.tgFacts(FX.league, FX.week);
  ok('(s3) hechos de la liga para el comisionado: fecha limite, veto, playoffs, formato',
    f.deadline === 'Trade deadline week 11 (4 weeks left)' && f.veto === 'Veto needs 8 of 12 votes, 1-day review' &&
    f.playoffs === 'Playoffs: 6 of 12 teams, from week 15' && f.format === 'Redraft', JSON.stringify(f));

  // (a) parejo: Zay Flowers (Alanta) por Drake London (Dallas Carbos), dos WR casi iguales
  const flowers = porNombre(1, 'Flowers'), london = porNombre(10, 'London');
  const ra = ev(ctxBase(), { sides: [sideP(1, [flowers]), sideP(10, [london])] });
  ok('(a) trade parejo (Flowers por London): even, sin favorito', ra.level === 'even' && ra.favors === null && ra.gapPct < 15, R(ra));

  // (b) el 1-5 manda su mejor jugador al 6-0 por relleno
  const jeanty = rosterTop(1)[0], relleno3 = rosterTop(3).slice(-1)[0];
  const tradeB = { sides: [sideP(1, [jeanty]), sideP(3, [relleno3])] };
  const rb = ev(ctxBase(W13), tradeB);
  const t13 = sandbox.tgStandings(W13.rosters, FX.league.settings, 13);
  ok('(b) semana 13, Alanta Falcons 2-10 ELIMINADO manda a ' + nombre(jeanty) + ', su mejor valor, al lider por ' + nombre(relleno3) + ': flag con la razon de dump',
    t13.byRid[1].status === 'out' && rb.level === 'flag' && rb.favors === 3 && hasDump(rb) && /its best value/.test(rb.reasons[0] || ''), R(rb) + ' ' + JSON.stringify(t13.byRid[1]));
  ok('(b2) y dice que la alineacion del que manda empeora sin nada que le juegue',
    (rb.reasons || []).some(t => /starting lineup gets weaker/.test(t)) && rb.sides[0].lineupDelta < 0, R(rb));

  // (c) la misma brecha entre dos 5-1 (Miami Octins y Khoudaddy)
  const top2 = rosterTop(2)[0];
  const gapB = rb.gapPct;
  const relleno5 = rosterTop(5).map(id => [id, Math.abs((VAL.byId[top2] - VAL.byId[id]) / VAL.byId[top2] * 100 - gapB)]).sort((x, y) => x[1] - y[1])[0][0];
  const rc = ev(ctxBase(), { sides: [sideP(2, [top2]), sideP(5, [relleno5])] });
  ok('(c) misma brecha entre dos 5-1 (' + nombre(top2) + ' por ' + nombre(relleno5) + ', ' + rc.gapPct + '% contra ' + gapB + '%): lopsided, sin dump, y lo aclara',
    rc.level === 'lopsided' && rc.favors === 5 && !hasDump(rc) && (rc.reasons || []).some(t => /bad trade, not a dump/.test(t)) && Math.abs(rc.gapPct - gapB) < 5, R(rc));

  // (l) 'out' es eliminacion practica, no juegos de diferencia
  const r7 = ev(ctxBase(), tradeB);
  ok('(l1) CONTROL semana 7 (real): el 1-5 NO esta eliminado y el mismo trade NO es flag (queda lopsided, sin dump)',
    tabla.byRid[1].status !== 'out' && r7.level === 'lopsided' && !hasDump(r7), R(r7));
  const t11 = sandbox.tgStandings(W11.rosters, FX.league.settings, 11);
  const r11 = ev(ctxBase(W11), tradeB);
  ok('(l2) semana 11, 2-8 a 3 de la linea con 4 por jugar: long shot, lopsided y "worth a look, not a veto"',
    t11.byRid[1].status === 'long_shot' && r11.level === 'lopsided' && !hasDump(r11) && (r11.reasons || []).some(t => /long shot is sending present value/.test(t)),
    R(r11) + ' ' + JSON.stringify(t11.byRid[1]));
  ok('(l3) eliminado = wins + semanas que quedan < wins de la linea (2 + 2 < ' + t13.lineWins + ')', t13.left === 2 && 2 + t13.left < t13.lineWins,
    JSON.stringify({ left: t13.left, lineWins: t13.lineWins }));

  // (k) piso absoluto: la misma brecha en porcentaje entre jugadores de banca
  const chico4 = FX.rosters.find(r => r.roster_id === 4).players.filter(id => VAL.byId[id] >= 300 && VAL.byId[id] <= 900)[0];
  const chico10 = rosterTop(10).slice(-1)[0];
  const rk = ev(ctxBase(), { sides: [sideP(4, [chico4]), sideP(10, [chico10])] });
  ok('(k1) ' + nombre(chico4) + ' por ' + nombre(chico10) + ': ' + rk.gapPct + '% de brecha pero menos que un titular tipico: lean como maximo, y lo dice',
    rk.gapPct >= 50 && rk.level === 'lean' && (rk.reasons || []).some(t => /Small stakes/.test(t)), R(rk));
  ok('(q2) brecha grande pero chica en valor: UNA sola frase, sin "less than half" ni "real but small" al lado',
    (rk.reasons || []).filter(t => /gets back/.test(t)).length === 1 && !(rk.reasons || []).some(t => /less than half|real but small/.test(t)), R(rk));

  // (q1) keeper SOLO con type 1: Sleeper trae max_keepers=1 en ligas redraft
  const joven3 = FX.rosters.find(r => r.roster_id === 3).players.find(id => {
    const p = players[id], v = VAL.byId[id];
    return p && v && ((p.age && p.age <= 24) || (p.years_exp != null && p.years_exp <= 2)) && v >= VAL.byId[jeanty] * 0.3 && v <= VAL.byId[jeanty] * 0.8;
  });
  const tradeQ = { sides: [sideP(1, [jeanty]), sideP(3, [joven3])] };
  const rq0 = ev(ctxBase(), tradeQ);
  const keepLeague = JSON.parse(JSON.stringify(FX.league)); keepLeague.settings.type = 1;
  const rq1 = ev(ctxBase({ league: keepLeague }), tradeQ);
  ok('(q1a) liga real (type 0, max_keepers 1): cero razones de keeper y el formato dice Redraft a secas (' + nombre(joven3) + ')',
    !!joven3 && rq0.level !== 'unknown' && !(rq0.reasons || []).some(t => /keeper/i.test(t)) && rq0.facts.format === 'Redraft', R(rq0) + ' ' + rq0.facts.format);
  ok('(q1b) CONTROL: el mismo trade en una liga keeper (type 1) si lo lee como keeper',
    (rq1.reasons || []).some(t => /Keeper league: /.test(t)) && /^Keeper league/.test(rq1.facts.format), R(rq1) + ' ' + rq1.facts.format);

  // (q3) temporada terminada: sin carrera ni dumping, hechos en pasado
  const overLeague = JSON.parse(JSON.stringify(FX.league)); overLeague.status = 'complete';
  const rq3 = ev(ctxBase(Object.assign({ league: overLeague }, W13)), tradeB);
  ok('(q3) liga con status complete: cero razones de carrera o dumping, standings finales y "Season over"',
    rq3.level !== 'flag' && !(rq3.reasons || []).some(t => /race|dump|long shot|contender|bubble/i.test(t)) &&
    rq3.sides.every(x => x.status === 'final') && rq3.facts.lines.includes('Season over') && !rq3.facts.deadline,
    R(rq3) + ' ' + JSON.stringify(rq3.facts.lines));

  // (q4) nombres con espacios sobrantes y revision de 0 dias
  const rq4 = ev(ctxBase(Object.assign({ nameOf: rid => '  ' + usuario(rid) + '  ' }, W13)), tradeB);
  ok('(q4a) los nombres se recortan antes de componer frases (sin " \'s" ni espacios dobles)',
    (rq4.reasons || []).length > 0 && !(rq4.reasons || []).some(t => /\s'|\s{2}|^\s/.test(t)) && rq4.sides[0].name === 'Alanta Falcons', R(rq4));
  const sinRev = JSON.parse(JSON.stringify(FX.league)); sinRev.settings.trade_review_days = 0;
  const fq = sandbox.tgFacts(sinRev, 7);
  ok('(q4b) trade_review_days 0 dice "no review period", no "0-day review"', /no review period$/.test(fq.veto || '') && !/0-day/.test(fq.veto || ''), fq.veto);
  ok('(k2) CONTROL: la brecha grande en valor de verdad (semana 7) si pasa de lean', r7.level === 'lopsided', R(r7));

  // (m) un lesionado no cuenta como titular usable
  const rm = ev(ctxBase({ injuryOf: id => id === String(london) ? 'IR' : null }), { sides: [sideP(1, [flowers]), sideP(10, [london])] });
  ok('(m) el trade parejo con ' + nombre(london) + ' en IR: no cuenta como titular, sube a lean y lo dice',
    rm.level === 'lean' && (rm.reasons || []).some(t => new RegExp(nombre(london) + ' is out \\(IR\\)').test(t)) &&
    (rm.reasons || []).some(t => /starting lineup gets weaker/.test(t)), R(rm));

  // (d) simetria
  const rbRev = ev(ctxBase(W13), { sides: [tradeB.sides[1], tradeB.sides[0]] });
  ok('(d1) el orden de los lados no cambia nada (mismo nivel, mismo favorito, misma brecha)',
    rbRev.level === rb.level && rbRev.favors === rb.favors && rbRev.gapPct === rb.gapPct, R(rbRev));
  const swift = porNombre(4, 'Swift');
  const rl = ev(ctxBase(), { sides: [sideP(4, [swift]), sideP(10, [london])] });
  const rlSwap = ev(ctxBase(), { sides: [sideP(4, [london]), sideP(10, [swift])] });
  ok('(d2) invertir los paquetes entre dos 3-3 invierte el favorito y deja la brecha igual (' + rl.level + ')',
    rl.favors === 4 && rlSwap.favors === 10 && rl.gapPct === rlSwap.gapPct && rl.level !== 'even' && rl.level !== 'unknown', R(rl) + ' / ' + R(rlSwap));

  // (e) control negativo: sin valores no hay nivel inventado
  const re = ev(ctxBase({ valueOf: () => null }), tradeB);
  ok('(e0) CONTROL: con valores el mismo trade si se gradua', r7.level !== 'unknown', R(r7));
  ok('(e1) sin ningun valor: unknown, sin favorito ni brecha, y lo declara',
    re.level === 'unknown' && re.favors === null && re.gapPct === null && /No market price/.test(re.reasons[0] || ''), R(re));
  const kicker = FX.rosters.find(r => r.roster_id === 1).players.find(id => pos(id) === 'K');
  const re2 = ev(ctxBase(), { sides: [sideP(1, [jeanty, kicker]), sideP(3, [relleno3])] });
  ok('(e2) con UN jugador sin precio (' + nombre(kicker) + ', K): unknown y lo nombra',
    re2.level === 'unknown' && new RegExp(nombre(kicker)).test(re2.reasons[0] || ''), R(re2));
  const re3 = ev(ctxBase({ faabValue: () => null }), { sides: [sideP(1, [flowers]), sideP(10, [london], { givesFaab: 50 })] });
  ok('(e3) FAAB sin precio (liga sin FAAB o Yahoo): unknown, no se trata como gratis', re3.level === 'unknown', R(re3));

  // (f) dynasty: un rebuild que recibe picks por un veterano no es dump
  const dynLeague = JSON.parse(JSON.stringify(FX.league)); dynLeague.settings.type = 2; dynLeague.settings.max_keepers = 0;
  let vet = null, vend = null;
  for (const rid of [1, 9]) {
    const t2 = rosterTop(rid).slice(0, 2).find(id => (players[id] && players[id].age) >= 27);
    if (t2) { vet = t2; vend = rid; break; }
  }
  const pick = { season: '2027', round: 1, label: '2027 Round 1' };
  const tradeF = { sides: [sideP(vend, [vet]), sideP(3, [], { givesPicks: [pick] })] };
  const pv = () => Math.round(VAL.byId[vet] * 0.45);
  const rf = ev(ctxBase(Object.assign({ league: dynLeague, pickValue: pv }, W13)), tradeF);
  const rfRed = ev(ctxBase(Object.assign({ pickValue: pv }, W13)), tradeF);
  ok('(f0) CONTROL: hay un veterano de 27+ entre los dos mejores de un equipo bubble (' + nombre(vet) + ')', !!vet, String(vet));
  ok('(f1) dynasty: ' + usuario(vend) + ' (rebuild) recibe una 1a por un veterano: sin dump, y lo explica como venta normal',
    !hasDump(rf) && (rf.reasons || []).some(t => /normal dynasty sell/.test(t)) && rf.level !== 'unknown', R(rf));
  ok('(f2) CONTROL: el MISMO trade en redraft si es dump (el formato es lo que cambia)', hasDump(rfRed) && rfRed.level === 'flag', R(rfRed));

  // (g) los 5 trades reales de la temporada
  const reales = FX.trades.map(t => {
    const r = ev(ctxBase(), sandbox.tgTradeFromSleeper(Object.assign({}, t)));
    const nums = [r.gapPct].concat((r.sides || []).flatMap(s => [s.valueOut, s.valueIn, s.lineupDelta]));
    return { week: t.week, level: r.level, favors: r.favors, gap: r.gapPct, nan: nums.some(x => typeof x !== 'number' || !isFinite(x)), r };
  });
  ok('(g1) los 5 trades reales evaluan con nivel graduado y sin NaN',
    reales.length === 5 && reales.every(x => LEVELS.slice(0, 4).includes(x.level) && !x.nan),
    JSON.stringify(reales.map(x => ({ w: x.week, l: x.level, f: x.favors, g: x.gap, nan: x.nan, err: x.r._err }))));
  console.log('      reales: ' + reales.map(x => 'sem ' + x.week + ' ' + x.level + (x.favors ? ' favorece ' + usuario(x.favors) : '') + ' (' + x.gap + '%)').join(' | '));
  const conFaab = FX.trades.findIndex(t => (t.waiver_budget || []).length);
  ok('(g2) el trade con $' + (FX.trades[conFaab] || { waiver_budget: [{}] }).waiver_budget[0].amount + ' de FAAB cuenta ese dinero en el lado que lo manda',
    conFaab >= 0 && reales[conFaab].r.sides.some(s => s.rosterId === 5 && s.valueOut > VAL.byId['8138']), JSON.stringify(reales[conFaab] && reales[conFaab].r.sides));

  // Regla del dueno: nada de numeros crudos del proveedor en las razones.
  const todas = [ra, rb, rc, rl, rf, rfRed, r7, r11, rk, rm, rq0, rq1, rq3, rq4].concat(reales.map(x => x.r)).flatMap(r => r.reasons || []);
  ok('(n1) ninguna razon lleva un numero crudo de valor (4 cifras o mas)', todas.length > 5 && !todas.some(t => /\d[\d,.]{3,}/.test(t)),
    todas.filter(t => /\d[\d,.]{3,}/.test(t)).join(' | '));
  ok('(n2) determinismo: la misma entrada da la misma salida', JSON.stringify(ev(ctxBase(W13), tradeB)) === JSON.stringify(rb));
  ok('(n5) "veto" nunca como accion: solo el dato de la liga o "not a veto"', !todas.some(t => /\bveto\b/i.test(t) && !/not a veto/.test(t)),
    todas.filter(t => /\bveto\b/i.test(t)).join(' | '));
  ok('(n6) byes: el dato no esta en el maestro, y se declara en vez de inventarse', (rb.facts.lines || []).includes('Bye weeks not counted'), JSON.stringify(rb.facts.lines));
} else {
  for (const n of ['(s1)', '(s2)', '(s3)', '(a)', '(b)', '(b2)', '(c)', '(l1)', '(l2)', '(l3)', '(k1)', '(q2)', '(q1a)', '(q1b)', '(q3)', '(q4a)', '(q4b)', '(k2)', '(m)', '(d1)', '(d2)', '(e0)', '(e1)', '(e2)', '(e3)', '(f0)', '(f1)', '(f2)', '(g1)', '(g2)', '(n1)', '(n2)', '(n5)', '(n6)']) {
    ok(n + ' motor del Trade Guard', false, 'sin tgEvaluate no hay nada que medir');
  }
}

// Reglas de la casa sobre los archivos tocados.
ok('(n3) cero em dashes en tradeguard.js y en el bloque .tg-* del CSS',
  !!TG && !/—/.test(TG) && !/—/.test((fs.readFileSync(path.join(REPO, 'public/styles.css'), 'utf8').split('TRADE GUARD (2026-10-21)')[1] || '—')));
ok('(n4) tradeguard.js no usa Math.random (el guard es determinista)', !!TG && !/Math\.random\(/.test(TG));

// (h) el bug del record: rosterRecord devuelve wins/losses y el analizador leia .w/.l
const leeW = (APP.match(/\b_?rec\.(w|l)\b/g) || []).length;
ok('(h1) nadie lee rec.w / rec.l de rosterRecord (son wins / losses)', leeW === 0, leeW + ' lecturas de .w/.l');

// ── Parte 2: navegador real ──────────────────────────────────────────────────
console.log('\n=== navegador ===');
const CANDIDATOS = [
  path.join(REPO, 'node_modules/playwright/index.mjs'),
  '/Users/wolco/Development/ernestocalvo/node_modules/playwright/index.mjs',
  '/Users/wolco/Development/mi-nuevo-website/node_modules/playwright/index.mjs'
];
const ruta = CANDIDATOS.find(p => fs.existsSync(p));
if (!ruta) { console.error('No encuentro playwright.'); process.exit(2); }
const { chromium } = await import(ruta);
const PORT = Number(process.env.QA_PORT || 3231);
const BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
let srv = null;
if (!process.env.QA_BASE) {
  try { await fetch(BASE + '/'); console.error('El puerto ' + PORT + ' ya contesta. Cierra ese proceso.'); process.exit(2); } catch (_) { }
  srv = spawn(process.execPath, [path.join(REPO, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
    await new Promise(r => setTimeout(r, 500));
  }
}
const eva = async (pg, fn, arg) => { try { return await pg.evaluate(fn, arg); } catch (e) { return { _err: String(e).slice(0, 200) }; } };

// La liga del fixture por la red de la pagina: nada de Sleeper de verdad.
const trades = FX.trades.map((t, i) => Object.assign({ transaction_id: 'qa' + (i + 1), type: 'trade' }, t));
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
async function servirLiga(ctx) {
  await ctx.route(/\/api\/sleeper\/.*/, route => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace('/api/sleeper', '');
    if (p === '/league/' + LID) return json(route, FX.league);
    if (p === '/league/' + LID + '/rosters') return json(route, FX.rosters);
    if (p === '/league/' + LID + '/users') return json(route, FX.users);
    if (p === '/league/' + LID + '/traded_picks') return json(route, []);
    if (p === '/league/' + LID + '/drafts') return json(route, [{ status: 'complete', season: '2026', settings: { rounds: 15 } }]);
    if (p === '/league/' + LID + '/all-transactions') return json(route, trades);
    if (p === '/players/nfl/slim') return json(route, VAL.players);
    if (p === '/state/nfl') return json(route, { week: 7, leg: 7, season: '2026', season_type: 'regular', display_week: 7 });
    return route.continue();
  });
  await ctx.route(/\/api\/ktc\/rankings.*/, route => json(route, { byId: VAL.byId, byName: VAL.byName, byIdFull: VAL.byIdFull }));
}
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /posthog/, /sleepercdn/, /Failed to load resource/];
const cargarLiga = pg => eva(pg, async ([lid, me]) => {
  userId = me; window._sleeperUserId = me;
  await loadLeague(lid, 'Miami Boys Choir', null, '2026');
  for (let i = 0; i < 40 && !Object.keys(ktcById).length; i++) await new Promise(r => setTimeout(r, 100));
  return { rosters: leagueRosters.length, trades: leagueTrades.length, valores: Object.keys(ktcById).length, info: !!(window._leagueInfo && window._leagueInfo.settings) };
}, [LID, WOLCO]);

const b = await chromium.launch();
try {
  // (i) El tab Trade Guard del analizador. Telefono (390): cajon > Trade
  // Analyzer > tab Trade Guard. Escritorio (1440, con sesion): rail > Trade
  // Analyzer > tab Trade Guard. Y League Trades ya no pinta chips.
  const abrirTabGuard = async (pg, via) => {
    const r = await eva(pg, async (via) => {
      const visible = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && !!e.offsetParent; };
      if (via === 'rail') {
        const it = [...document.querySelectorAll('#app-rail .rail-item')].find(x => /Trade Analyzer/.test(x.textContent) && visible(x));
        if (!it) return 'sin fila del rail';
        it.click(); await new Promise(r => setTimeout(r, 900));
        return 'rail';
      }
      const bt = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'More' && visible(x))
        || [...document.querySelectorAll('button')].find(x => /mobMenuToggle/.test(x.getAttribute('onclick') || '') && visible(x));
      if (!bt) return 'sin boton del cajon';
      bt.click(); await new Promise(r => setTimeout(r, 700));
      for (const p of [...document.querySelectorAll('#mob-menu .mob-parent')]) {
        const it = [...document.querySelectorAll('#mob-menu .mob-menu-item')].find(x => x.textContent.trim() === 'Trade Analyzer');
        if (it && it.offsetParent) break;
        p.click(); await new Promise(r => setTimeout(r, 260));
      }
      return 'cajon';
    }, via);
    if (via !== 'rail') {
      try { await pg.locator('#mob-menu .mob-menu-item', { hasText: /^Trade Analyzer$/ }).first().click({ timeout: 5000 }); } catch (_) { }
      await pg.waitForTimeout(1200);
    }
    try { await pg.locator('#atab-guard').click({ timeout: 5000 }); } catch (_) { }
    await pg.waitForTimeout(500);
    return r;
  };
  const leerPane = pg => eva(pg, () => {
    const p = document.getElementById('tab-guard');
    const pane = document.getElementById('tg-pane');
    return {
      pantalla: (document.querySelector('.screen.active') || {}).id,
      visible: !!(p && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0),
      ruta: location.pathname + location.hash,
      tabActivo: !!(document.getElementById('atab-guard') || {classList:{contains:()=>false}}).classList.contains('active'),
      vacio: pane ? !!pane.querySelector('.empty-state button') && /Load a league/.test(pane.textContent) : false,
      chips: pane ? [...pane.querySelectorAll('.tg-toggle')].map(x => x.getAttribute('data-level')) : null,
      hechos: ((pane && pane.querySelector('.tg-league-facts')) || {}).textContent || '',
      head: ((document.querySelector('#tab-guard .tg-pane-sub')) || {}).textContent || '',
      skel: pane ? pane.querySelectorAll('.tm-skel').length : 0
    };
  });
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await servirLiga(ctx);
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('console', m => { if (m.type() === 'error' && !RUIDO.some(r => r.test(m.text()) || r.test((m.location() || {}).url || ''))) errs.push(m.text().slice(0, 160)); });
    pg.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForFunction(() => typeof loadLeague === 'function' && typeof mobGo === 'function', { timeout: 30000 });
    // Sin liga: el tab lo dice y ofrece cargar una (sin callejon).
    const via0 = await abrirTabGuard(pg, 'cajon');
    const v0 = await leerPane(pg);
    ok('(i1) se llega al tab Trade Guard clicando (cajon > Trade Analyzer > Trade Guard) y la URL lo refleja (' + via0 + ')',
      v0.pantalla === 'screen-analyze' && v0.visible && v0.tabActivo && /#guard$/.test(v0.ruta), JSON.stringify(v0));
    ok('(i2) sin liga cargada el tab lo dice y ofrece cargar una', v0.vacio === true, JSON.stringify(v0));
    const c = await cargarLiga(pg);
    ok('(i0) CONTROL: la liga del fixture cargo (12 rosters, 5 trades, valores, reglamento entero)',
      c.rosters === 12 && c.trades === 5 && c.valores > 100 && c.info === true, JSON.stringify(c));
    await pg.waitForTimeout(600);
    const v1 = await leerPane(pg);
    ok('(i3) con la liga, el tab abierto se repinta: un chip por cada uno de los 5 trades',
      Array.isArray(v1.chips) && v1.chips.length === 5 && v1.chips.every(l => LEVELS.includes(l)) && v1.skel === 0, JSON.stringify(v1));
    ok('(i4) hechos de la liga arriba (fecha limite, veto, playoffs) y rotulo "for commissioner review"',
      /Trade deadline week 11 \(4 weeks left\)/.test(v1.hechos) && /Veto needs 8 of 12 votes/.test(v1.hechos) && /Playoffs: 6 of 12/.test(v1.hechos) && /for commissioner review/.test(v1.head),
      JSON.stringify({ hechos: v1.hechos, head: v1.head }));
    const fila = pg.locator('#tg-pane .tg-toggle').first();
    let antes = null, despues = null, alto = 0;
    try {
      await fila.scrollIntoViewIfNeeded({ timeout: 5000 });
      alto = (await fila.boundingBox() || {}).height || 0;
      antes = await fila.getAttribute('aria-expanded');
      await fila.tap({ timeout: 5000 });
      await pg.waitForTimeout(250);
      despues = await fila.getAttribute('aria-expanded');
    } catch (_) { }
    const panel = await eva(pg, () => {
      const t = document.querySelector('#tg-pane .tg-toggle');
      const p = t && document.getElementById(t.getAttribute('aria-controls'));
      return p ? { visible: getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0, razones: p.querySelectorAll('.tg-reasons li').length, lados: p.querySelectorAll('.tg-side').length, texto: p.textContent.slice(0, 300) } : null;
    });
    ok('(i5) tocar la fila despliega el porque (razones y los dos lados con record)',
      antes === 'false' && despues === 'true' && panel && panel.visible && panel.razones >= 1 && panel.lados === 2 && /\d-\d/.test(panel.texto), JSON.stringify({ antes, despues, panel }));
    ok('(i6) la fila tactil mide 44px o mas', alto >= 44, 'alto ' + alto);
    const ancho = await eva(pg, () => ({ sw: document.documentElement.scrollWidth, fuera: [...document.querySelectorAll('#tab-guard *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length,
      crudos: [...document.querySelectorAll('#tg-pane .tg-toggle, #tg-pane .tg-why')].map(e => e.textContent).filter(t => /\d[\d,.]{3,}/.test(t)) }));
    ok('(i7) 390px sin desborde', ancho.sw <= 390 && ancho.fuera === 0, JSON.stringify(ancho));
    ok('(i8) el guard no pinta numeros crudos del proveedor', Array.isArray(ancho.crudos) && ancho.crudos.length === 0, JSON.stringify(ancho.crudos).slice(0, 200));
    // League Trades vuelve a como estaba: sin hechos ni chips del guard.
    await eva(pg, () => { mobGo('league'); });
    await pg.waitForTimeout(1200);
    const lt = await eva(pg, () => ({ tab: (document.querySelector('#screen-league .tab-content.active') || {}).id,
      tarjetas: document.querySelectorAll('#league-trades-list .stand-table').length,
      chips: document.querySelectorAll('#league-trades-list .tg-toggle, #league-trades-list .tg-league-facts').length }));
    ok('(i9) League Trades vuelve a como estaba: su lista se pinta y no lleva chips ni hechos del guard',
      lt.tab === 'tab-league-trades' && lt.tarjetas === 1 && lt.chips === 0, JSON.stringify(lt));
    ok('(i10) consola limpia (telefono)', errs.length === 0, errs.join('\n      '));
    await ctx.close();
  }
  {
    // Escritorio con sesion: el rail lleva al analizador, y de ahi el tab.
    const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
    await servirLiga(ctx);
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { try { localStorage.setItem('tm_username', 'qa-tradeguard'); } catch (e) { } });
    const errs = [];
    pg.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForFunction(() => typeof loadLeague === 'function', { timeout: 30000 });
    await cargarLiga(pg);
    const via = await abrirTabGuard(pg, 'rail');
    await pg.waitForTimeout(600);
    const v = await leerPane(pg);
    ok('(i11) escritorio: rail > Trade Analyzer > tab Trade Guard, con los 5 chips (' + via + ')',
      via === 'rail' && v.pantalla === 'screen-analyze' && v.visible && Array.isArray(v.chips) && v.chips.length === 5, JSON.stringify(v));
    ok('(i12) escritorio sin errores de pagina', errs.length === 0, errs.join('\n      '));
    await ctx.close();
  }

  // (j) el analizador: Analyze pinta el bloque Trade Guard; (h2) el record mueve la lectura
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await servirLiga(ctx);
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('console', m => { if (m.type() === 'error' && !RUIDO.some(r => r.test(m.text()) || r.test((m.location() || {}).url || ''))) errs.push(m.text().slice(0, 160)); });
    pg.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForFunction(() => typeof loadLeague === 'function' && typeof runAnalysis === 'function', { timeout: 30000 });
    await cargarLiga(pg);
    const nabers = FX.rosters.find(r => r.roster_id === 3).owner_id;
    const jeanty = rosterTop(1)[0], relleno3 = rosterTop(3).slice(-1)[0];
    const armado = await eva(pg, async ([opp, give, get]) => {
      switchScreen('analyze');
      const s = document.getElementById('opp-select'); s.value = opp;
      await loadOppRoster(); renderTradeBoards();
      boardToggle('give', 'p' + give); boardToggle('get', 'p' + get);
      return {
        give: Array.from(document.querySelectorAll('#give-players input')).map(i => i.value).filter(Boolean),
        get: Array.from(document.querySelectorAll('#get-players input')).map(i => i.value).filter(Boolean)
      };
    }, [nabers, jeanty, relleno3]);
    ok('(j0) CONTROL: el trade quedo armado en los dos lados', armado.give && armado.give.length === 1 && armado.get.length === 1, JSON.stringify(armado));
    const boton = pg.locator('.analyze-btn').first();
    try { await boton.scrollIntoViewIfNeeded({ timeout: 5000 }); await boton.tap({ timeout: 5000 }); } catch (_) { }
    await pg.waitForFunction(() => { const g = document.getElementById('trade-guard'); return g && !g.hidden && g.textContent.length > 20; }, { timeout: 15000 }).catch(() => { });
    const g = await eva(pg, () => {
      const box = document.getElementById('trade-guard');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      return { head: (box.querySelector('.tg-head') || {}).textContent, visible: !box.hidden && r.height > 0, chip: (box.querySelector('.tg-chip') || {}).textContent, fav: (box.querySelector('.tg-fav') || {}).textContent,
        razones: Array.from(box.querySelectorAll('.tg-reasons li')).map(x => x.textContent), lados: Array.from(box.querySelectorAll('.tg-side')).map(x => x.textContent),
        hechos: (box.querySelector('.tg-facts') || {}).textContent, right: r.right, sw: document.documentElement.scrollWidth,
        debajo: (() => { const v = document.getElementById('verdict-card'); return v ? v.getBoundingClientRect().bottom <= r.top + 1 : false; })() };
    });
    ok('(j1) tras Analyze aparece el bloque Trade Guard debajo del veredicto', g && g.visible && g.debajo, JSON.stringify(g));
    ok('(j2) semana 7: Lopsided (no Flag: el 1-5 no esta eliminado), a quien favorece, sus razones y "for commissioner review"',
      g && g.chip === 'Lopsided' && /Favors Nabers in Paris/.test(g.fav || '') && (g.razones || []).some(t => /starting lineup gets weaker/.test(t)) &&
      !(g.razones || []).some(t => /dumping pattern/.test(t)) && /for commissioner review/.test(g.head || ''), JSON.stringify(g && { chip: g.chip, fav: g.fav, razones: g.razones, head: g.head }));
    ok('(j3) los dos lados con record y puesto (1-5 y 6-0), y los hechos de la liga',
      g && (g.lados || []).some(t => /1-5/.test(t)) && (g.lados || []).some(t => /6-0/.test(t) && /1st/.test(t)) && /Trade deadline week 11/.test(g.hechos || ''), JSON.stringify(g && { lados: g.lados, hechos: g.hechos }));
    ok('(j4) 390px sin desborde', g && g.sw <= 390 && g.right <= 391, JSON.stringify(g && { sw: g.sw, right: g.right }));

    // (h2) mismo rival, mismo trade: solo cambia su record. Con el bug (.w/.l)
    // la urgencia de "win now" salia identica.
    const urg = await eva(pg, async () => {
      const opp = _rosterForUser(document.getElementById('opp-select').value);
      const guarda = Object.assign({}, opp.settings);
      opp.settings.wins = 6; opp.settings.losses = 0; await runAnalysis();
      const alto = window._oppReadVals && window._oppReadVals.sig1;
      opp.settings.wins = 0; opp.settings.losses = 6; await runAnalysis();
      const bajo = window._oppReadVals && window._oppReadVals.sig1;
      opp.settings = guarda; await runAnalysis();
      return { alto, bajo };
    });
    ok('(h2) el record del rival mueve la lectura del analizador (6-0 contra 0-6 dan urgencias distintas)',
      typeof urg.alto === 'number' && typeof urg.bajo === 'number' && urg.bajo > urg.alto, JSON.stringify(urg));
    ok('(j5) consola limpia', errs.length === 0, errs.join('\n      '));
    await ctx.close();
  }
} catch (e) {
  ok('(!) el gate no reviento', false, String(e && e.stack || e).slice(0, 400));
}
await b.close();
if (srv) try { srv.kill(); } catch (_) { }
console.log('\n' + checks + ' checks. ' + (fails ? fails + ' FALLO(S)' : 'ALL GREEN'));
process.exit(fails ? 1 : 0);
