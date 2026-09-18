#!/usr/bin/env node
// ESTUDIO: cuanto vale un dolar de FAAB en unidades de valor de FantasyCalc.
//
//   node scripts/faab-value-study.mjs            (usa la cache en disco)
//   node scripts/faab-value-study.mjs --refresh  (ignora la cache y vuelve a pedir)
//
// PARA QUE. El analizador de trades valora jugadores con FantasyCalc y no sabe
// que hacer con el FAAB metido en un trade. La regla del repo es no enseñar un
// numero que no se pueda defender, asi que el tipo de cambio se MIDE con datos
// publicos de Sleeper en vez de inventarse.
//
// QUE MIDE
//   1. Pujas de waiver completadas en 2026: puja como % del bote de ESA liga
//      contra el valor FantasyCalc del jugador que entro, en la escala que usa
//      el analizador para esa liga (redraft o dynasty, 1QB o superflex, su ppr).
//      Tipo de cambio = suma(valor) / suma(puja en % del bote).
//   2. Trades con FAAB dentro: el precio directo del FAAB en el mercado de trades.
//   3. Temporada 2025: que parte del gasto de FAAB de la temporada queda por
//      delante en cada semana. Es el factor de descuento del dinero guardado.
//
// DE DONDE SALE LA MUESTRA. Rastreo por amistad desde el usuario `wolco`: sus
// ligas, los usuarios de esas ligas, las ligas de esos usuarios, etc. No es una
// muestra aleatoria de Sleeper y eso se declara en el resumen.
//
// El directorio de cache se puede cambiar con FAAB_CACHE=/ruta.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REFRESH = process.argv.includes('--refresh');
const CACHE = process.env.FAAB_CACHE ||
  '/private/tmp/claude-501/-Users-wolco-Development-trademind-app/712e670b-c1a8-4d60-ba7c-05174f4275c7/scratchpad/faab-cache';
const SEED = 'wolco';
const TARGET_LEAGUES = 450;   // ligas FAAB 2026 que se estudian
const MAX_REQ = 7000;         // tope duro de peticiones a la red
const USERS_2025 = 250;       // usuarios cuyos 2025 se miran para la curva
const LEAGUES_2025 = 120;     // tope de ligas 2025
// Kickoff de la semana 1 de 2026 (jueves 10-sep, 8:20pm ET). Sleeper mete en la
// leg 1 TODO lo de pretemporada mas la corrida de waivers del martes 15/miercoles 16,
// asi que la fase se decide por la hora de la transaccion, no por la leg.
const KICKOFF = Date.parse('2026-09-11T00:20:00Z');
const CONC = 6;               // peticiones simultaneas
const GAP_MS = 40;            // respiro entre arranques
const S = 'https://api.sleeper.app/v1';

fs.mkdirSync(CACHE, { recursive: true });

// ---------- red con cache, semaforo y reintentos ----------
let netReq = 0, cacheHits = 0, active = 0, lastStart = 0;
const waiters = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function slot() {
  while (active >= CONC) await new Promise(r => waiters.push(r));
  active++;
  const wait = lastStart + GAP_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + GAP_MS);
  if (wait > 0) await sleep(wait);
}
function release() { active--; const w = waiters.shift(); if (w) w(); }

async function get(url) {
  const f = path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex') + '.json');
  if (!REFRESH && fs.existsSync(f)) { cacheHits++; return JSON.parse(fs.readFileSync(f, 'utf8')); }
  if (netReq >= MAX_REQ) return null;
  await slot();
  try {
    for (let i = 0; i < 4; i++) {
      netReq++;
      let r;
      try { r = await fetch(url, { headers: { 'User-Agent': 'MacDraft-faab-study/1.0' } }); }
      catch { await sleep(500 * (i + 1)); continue; }
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      if (!r.ok) { fs.writeFileSync(f, 'null'); return null; }
      const j = await r.json();
      fs.writeFileSync(f, JSON.stringify(j));
      return j;
    }
    return null;
  } finally { release(); }
}
const all = (xs, fn) => Promise.all(xs.map(fn));

// ---------- clasificacion de liga ----------
const isFaab = L => L && L.settings && L.settings.waiver_type === 2 && (L.settings.waiver_budget || 0) > 0 &&
  L.settings.best_ball !== 1 && L.settings.type !== 3;
const isDyn = L => L.settings.type === 2;
const pprOf = L => { const r = (L.scoring_settings && L.scoring_settings.rec) || 0; return r >= 0.75 ? 1 : r >= 0.25 ? 0.5 : 0; };
// Mismo criterio que el analizador (app.js fetchKtcValues): 2QB o superflex -> numQbs=2
const qbsOf = L => { const rp = L.roster_positions || []; return rp.includes('SUPER_FLEX') || rp.filter(p => p === 'QB').length >= 2 ? 2 : 1; };
const teamsOf = L => L.total_rosters || L.settings.num_teams || 0;
const sizeBucket = n => n <= 10 ? '<=10' : n <= 12 ? '11-12' : '13+';

// ---------- escalas de FantasyCalc ----------
const fcTables = {};
const NAMES = new Map();
async function fcTable(dyn, qbs, ppr) {
  const k = `${dyn}|${qbs}|${ppr}`;
  if (!fcTables[k]) {
    const a = await get(`https://api.fantasycalc.com/values/current?isDynasty=${dyn}&numQbs=${qbs}&ppr=${ppr}`) || [];
    const m = new Map();
    for (const p of a) if (p.player && p.player.sleeperId) { m.set(String(p.player.sleeperId), p.value || 0); NAMES.set(String(p.player.sleeperId), p.player.name); }
    fcTables[k] = m;
  }
  return fcTables[k];
}
const valTable = L => fcTable(isDyn(L), qbsOf(L), pprOf(L));

// ---------- estadistica ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const q = (arr, p) => { if (!arr.length) return NaN; const a = [...arr].sort((x, y) => x - y); const i = (a.length - 1) * p; const lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
const f0 = x => Number.isFinite(x) ? Math.round(x).toString() : '-';
const f1 = x => Number.isFinite(x) ? x.toFixed(1) : '-';
const pad = (s, n) => String(s).padEnd(n);
// Tipo de cambio agrupado y su dispersion con bootstrap POR LIGA (las pujas de
// una misma liga no son independientes, asi que se remuestrean ligas enteras)
function rateStats(bids) {
  const byL = new Map();
  for (const b of bids) { if (!byL.has(b.lid)) byL.set(b.lid, { v: 0, p: 0, n: 0 }); const g = byL.get(b.lid); g.v += b.value; g.p += b.pct; g.n++; }
  const groups = [...byL.values()];
  const V = groups.reduce((s, g) => s + g.v, 0), P = groups.reduce((s, g) => s + g.p, 0);
  const r = rng(12345), boots = [];
  for (let i = 0; i < 1000 && groups.length > 1; i++) {
    let v = 0, p = 0;
    for (let j = 0; j < groups.length; j++) { const g = groups[Math.floor(r() * groups.length)]; v += g.v; p += g.p; }
    if (p > 0) boots.push(v / p);
  }
  const perL = groups.filter(g => g.n >= 3 && g.p > 0).map(g => g.v / g.p);
  return { n: bids.length, leagues: groups.length, rate: P > 0 ? V / P : NaN, lo: q(boots, 0.05), hi: q(boots, 0.95), med: q(perL, 0.5), nL: perL.length };
}
const rateLine = (label, bids) => { const s = rateStats(bids); return `${pad(label, 26)} n=${pad(s.n, 5)} lg=${pad(s.leagues, 4)} rate=${pad(f0(s.rate), 5)} [${f0(s.lo)}-${f0(s.hi)}]  medLiga=${f0(s.med)} (${s.nL})`; };

// ================= 1. RASTREO =================
const state = await get(`${S}/state/nfl`);
const LEG = state.leg || state.week;
const seedUser = await get(`${S}/user/${SEED}`);
const seen = new Set([seedUser.user_id]);
const userOrder = [seedUser.user_id];
const leagues = new Map();     // todas las 2026 vistas
const faab = new Map();        // las FAAB elegibles, en orden de descubrimiento
const addLeagues = ls => { for (const L of ls || []) if (!leagues.has(L.league_id)) { leagues.set(L.league_id, L); if (isFaab(L) && ['in_season', 'post_season', 'complete'].includes(L.status) && faab.size < TARGET_LEAGUES) faab.set(L.league_id, L); } };
addLeagues(await get(`${S}/user/${seedUser.user_id}/leagues/nfl/2026`));
const lq = [...leagues.keys()];
let qi = 0;
while (faab.size < TARGET_LEAGUES && qi < lq.length && netReq < MAX_REQ * 0.5) {
  const batch = lq.slice(qi, qi + 6); qi += batch.length;
  const us = (await all(batch, id => get(`${S}/league/${id}/users`))).flat().filter(Boolean);
  const nuevos = [];
  for (const u of us) if (u.user_id && !seen.has(u.user_id)) { seen.add(u.user_id); userOrder.push(u.user_id); nuevos.push(u.user_id); }
  const ls = await all(nuevos, id => get(`${S}/user/${id}/leagues/nfl/2026`));
  for (const l of ls) { const antes = leagues.size; addLeagues(l); if (leagues.size > antes) for (const L of l) if (!lq.includes(L.league_id)) lq.push(L.league_id); }
}

// ================= 2. TRANSACCIONES 2026 =================
const bids = [], trades = [];
let txTotal = 0, claimsNoBid = 0, failedBids = 0, spent2026 = [];
const fL = [...faab.values()];
await all(fL, async L => {
  const tab = await valTable(L);
  const budget = L.settings.waiver_budget, lid = L.league_id;
  let spent = 0;
  for (let w = 1; w <= LEG; w++) {
    const txs = await get(`${S}/league/${lid}/transactions/${w}`) || [];
    txTotal += txs.length;
    for (const t of txs) {
      if (t.type === 'waiver') {
        if (t.status !== 'complete') { if (t.settings && t.settings.waiver_bid != null) failedBids++; continue; }
        const bid = t.settings && t.settings.waiver_bid;
        if (bid == null) { claimsNoBid++; continue; }
        const pids = Object.keys(t.adds || {});
        const value = pids.reduce((s, p) => s + (tab.get(p) || 0), 0);
        spent += bid;
        bids.push({ lid, dyn: isDyn(L), size: sizeBucket(teamsOf(L)), bid, pct: 100 * bid / budget, value, week: w, pre: (t.status_updated || 0) < KICKOFF, pids });
      } else if (t.type === 'trade' && t.status === 'complete' && Array.isArray(t.waiver_budget) && t.waiver_budget.length) {
        trades.push({ L, t, tab, budget });
      }
    }
  }
  spent2026.push(100 * spent / (budget * teamsOf(L)));
});

// ================= 3. CURVA 2025 =================
const l25 = new Map();
const users25 = userOrder.slice(0, USERS_2025);
for (const ls of await all(users25, id => get(`${S}/user/${id}/leagues/nfl/2025`)))
  for (const L of ls || []) if (isFaab(L) && L.status === 'complete' && !l25.has(L.league_id) && l25.size < LEAGUES_2025) l25.set(L.league_id, L);
const curves = [];
const W25 = 18;
const pooled = new Array(W25 + 1).fill(0);
await all([...l25.values()], async L => {
  const per = new Array(W25 + 1).fill(0); let n = 0;
  for (let w = 1; w <= W25; w++) {
    const txs = await get(`${S}/league/${L.league_id}/transactions/${w}`) || [];
    for (const t of txs) if (t.type === 'waiver' && t.status === 'complete' && t.settings && t.settings.waiver_bid > 0) { per[w] += t.settings.waiver_bid; n++; }
  }
  const tot = per.reduce((a, b) => a + b, 0);
  const pot = L.settings.waiver_budget * teamsOf(L);
  if (n >= 5 && tot > 0) { curves.push({ per, tot, pot }); for (let w = 1; w <= W25; w++) pooled[w] += 100 * per[w] / pot; }
});

// ================= RESUMEN =================
const out = [];
const P = s => out.push(s);
P(`FAAB VALUE STUDY  season ${state.season} leg ${LEG}  (${new Date().toISOString().slice(0, 10)})`);
P(`crawl: ${seen.size} users, ${leagues.size} leagues 2026, ${faab.size} FAAB elegibles (sin best ball ni chopped)`);
P(`  dynasty ${fL.filter(isDyn).length} / redraft-keeper ${fL.filter(L => !isDyn(L)).length}; superflex ${fL.filter(L => qbsOf(L) === 2).length}; budgets ${[...new Set(fL.map(L => L.settings.waiver_budget))].sort((a, b) => a - b).slice(0, 8).join(',')}`);
P(`  red: ${netReq} peticiones, ${cacheHits} de cache. tx leidas ${txTotal}`);
P('');
P(`1) PUJAS COMPLETADAS 2026 (${bids.length}; sin campo de puja ${claimsNoBid}; pujas perdidas ${failedBids})`);
P(`   rate = unidades FantasyCalc por 1% del bote; [p5-p95] bootstrap por liga`);
const nz = bids.filter(b => b.bid > 0), nzv = nz.filter(b => b.value > 0);
P('   ' + rateLine('todas', bids));
P('   ' + rateLine('puja>0', nz));
P('   ' + rateLine('puja>0 y valor>0', nzv));
P('   ' + rateLine('redraft puja>0', nz.filter(b => !b.dyn)));
P('   ' + rateLine('dynasty puja>0', nz.filter(b => b.dyn)));
P('   ' + rateLine('redraft puja>0 valor>0', nzv.filter(b => !b.dyn)));
P('   ' + rateLine('dynasty puja>0 valor>0', nzv.filter(b => b.dyn)));
for (const sz of ['<=10', '11-12', '13+']) P('   ' + rateLine(`tamano ${sz} puja>0`, nz.filter(b => b.size === sz)));
P('   ' + rateLine('pretemporada puja>0', nz.filter(b => b.pre)));
P('   ' + rateLine('en temporada puja>0', nz.filter(b => !b.pre)));
P('   ' + rateLine('  redraft en temporada', nz.filter(b => !b.pre && !b.dyn)));
P('   ' + rateLine('  dynasty en temporada', nz.filter(b => !b.pre && b.dyn)));
P(`   puja $0: ${bids.length - nz.length} (${f0(100 * (bids.length - nz.length) / bids.length)}%); jugador sin valor FC: ${f0(100 * nz.filter(b => !b.value).length / nz.length)}% de las pujas>0, ${f0(100 * nz.filter(b => !b.value).reduce((s, b) => s + b.pct, 0) / nz.reduce((s, b) => s + b.pct, 0))}% del dinero`);
P(`   curva EN TEMPORADA (puja>0): por tramo, puja media % -> valor medio; ajuste valor = k * pct^a`);
const bands = [[0, 2], [2, 5], [5, 10], [10, 20], [20, 101]];
const V0 = {};
for (const dyn of [false, true]) {
  const xs = nz.filter(x => x.dyn === dyn && !x.pre);
  const z = bids.filter(x => x.dyn === dyn && x.bid === 0 && !x.pre), v0 = z.reduce((s, x) => s + x.value, 0) / z.length;
  const bm = bands.map(([a, b]) => { const g = xs.filter(x => x.pct > a && x.pct <= b); return [Math.log(g.reduce((s, x) => s + x.pct, 0) / g.length), Math.log(g.reduce((s, x) => s + x.value, 0) / g.length), g.length]; });
  const W = bm.reduce((s, v) => s + v[2], 0), bx = bm.reduce((s, v) => s + v[0] * v[2], 0) / W, by = bm.reduce((s, v) => s + v[1] * v[2], 0) / W;
  const ba = bm.reduce((s, v) => s + v[2] * (v[0] - bx) * (v[1] - by), 0) / bm.reduce((s, v) => s + v[2] * (v[0] - bx) ** 2, 0), bk = Math.exp(by - ba * bx);
  P(`     ${dyn ? 'dyn' : 'red'} puja $0 en temporada: valor medio ${f0(v0)} (n=${z.length}); ajuste por tramos CON valor 0: a=${ba.toFixed(2)} k=${f0(bk)} -> 5%:${f0(bk * 5 ** ba)} 10%:${f0(bk * 10 ** ba)} 25%:${f0(bk * 25 ** ba)}`);
  V0[dyn] = v0;
  P('     ' + (dyn ? 'dyn ' : 'red ') + bands.map(([a, b]) => { const g = xs.filter(x => x.pct > a && x.pct <= b); const mp = g.reduce((s, x) => s + x.pct, 0) / g.length, mv = g.reduce((s, x) => s + x.value, 0) / g.length; return `${f1(mp)}%:${f0(mv)}`; }).join('  '));
  const lv = xs.filter(x => x.value > 0).map(x => [Math.log(x.pct), Math.log(x.value)]);
  const mx = lv.reduce((s, v) => s + v[0], 0) / lv.length, my = lv.reduce((s, v) => s + v[1], 0) / lv.length;
  const a = lv.reduce((s, v) => s + (v[0] - mx) * (v[1] - my), 0) / lv.reduce((s, v) => s + (v[0] - mx) ** 2, 0), k = Math.exp(my - a * mx);
  P(`          ajuste: a=${a.toFixed(2)} k=${f0(k)} -> 1%:${f0(k)} 5%:${f0(k * 5 ** a)} 10%:${f0(k * 10 ** a)} 25%:${f0(k * 25 ** a)} 50%:${f0(k * 50 ** a)}  (sesgo: excluye valor 0)`);
}
P(`   MARGINAL = valor por encima de lo que compra una puja de $0 (lo que el dinero anade de verdad)`);
for (const dyn of [false, true]) P('   ' + rateLine(`${dyn ? 'dynasty' : 'redraft'} marginal en temp.`, nz.filter(b => b.dyn === dyn && !b.pre).map(b => ({ ...b, value: b.value - V0[dyn] }))));
P(`   gasto 2026 hasta leg ${LEG}, % del dinero TOTAL de la liga (bote x equipos): p25 ${f1(q(spent2026, .25))} med ${f1(q(spent2026, .5))} p75 ${f1(q(spent2026, .75))}`);
P('');

// ---- trades ----
let withPicks = 0, multi = 0, pure = [], mixed = [], neg = 0; const ex = [];
for (const { L, t, tab, budget } of trades) {
  if ((t.draft_picks || []).length) { withPicks++; continue; }
  if ((t.roster_ids || []).length !== 2) { multi++; continue; }
  const [a, b] = t.roster_ids, side = {};
  for (const r of [a, b]) side[r] = { vIn: 0, nIn: 0, fNet: 0, names: [] };
  for (const [pid, r] of Object.entries(t.adds || {})) if (side[r]) { side[r].vIn += tab.get(pid) || 0; side[r].nIn++; side[r].names.push(pid); }
  for (const x of t.waiver_budget) { if (side[x.receiver]) side[x.receiver].fNet += x.amount; if (side[x.sender]) side[x.sender].fNet -= x.amount; }
  const payer = side[a].fNet < 0 ? a : side[b].fNet < 0 ? b : null;
  if (!payer) continue;
  const other = payer === a ? b : a, pct = 100 * (-side[payer].fNet) / budget;
  const gap = side[payer].vIn - side[other].vIn, rate = gap / pct;
  const rec = { rate, pct, gap, dyn: isDyn(L), pure: side[other].nIn === 0, vPay: side[payer].vIn, vOth: side[other].vIn, amt: -side[payer].fNet, budget, pids: side[payer].names, oth: side[other].names };
  if (gap <= 0) neg++;
  (rec.pure ? pure : mixed).push(rec);
}
const tLine = (label, xs) => { const r = xs.map(x => x.rate); const V = xs.reduce((s, x) => s + x.gap, 0), Pp = xs.reduce((s, x) => s + x.pct, 0); return `${pad(label, 26)} n=${pad(xs.length, 4)} agrupado=${pad(f0(V / Pp), 6)} med=${pad(f0(q(r, .5)), 6)} p25-p75=[${f0(q(r, .25))},${f0(q(r, .75))}]`; };
P(`2) TRADES CON FAAB: ${trades.length} (con picks ${withPicks}, 3+ equipos ${multi}, 2 equipos sin picks ${pure.length + mixed.length})`);
P(`   implicito = (valor que recibe quien paga FAAB - valor que recibe el otro) / % del bote pagado`);
P('   ' + tLine('solo FAAB contra jugadores', pure));
P('   ' + tLine('  de ellos valor>0', pure.filter(x => x.vPay > 0)));
P('   ' + tLine('jugadores+FAAB (mixtos)', mixed));
P('   ' + tLine('  redraft todos', [...pure, ...mixed].filter(x => !x.dyn)));
P('   ' + tLine('  dynasty todos', [...pure, ...mixed].filter(x => x.dyn)));
P(`   con brecha <=0 (quien paga FAAB recibe menos valor): ${neg}`);
const nm = id => NAMES.get(id) || id;
for (const x of [...pure].sort((u, v) => v.vPay - u.vPay).filter(x => x.vPay > 0).slice(0, 5))
  P(`   ej: $${x.amt}/$${x.budget} (${f1(x.pct)}%) por ${x.pids.map(nm).join('+')} val ${f0(x.vPay)} -> ${f0(x.rate)}/1% ${x.dyn ? 'dyn' : 'red'}`);
P('');

// ---- curva 2025 ----
P(`3) CURVA DE GASTO 2025: ${curves.length} ligas (de ${l25.size} FAAB completas, ${users25.length} usuarios)`);
const meanCum = w => curves.reduce((s, c) => s + c.per.slice(1, w + 1).reduce((a, b) => a + b, 0) / c.tot, 0) / curves.length;
const totPool = pooled.reduce((a, b) => a + b, 0);
P(`   gasto medio de la temporada: ${f0(totPool / curves.length)}% del dinero total de la liga (bote x equipos); sem 1 incluye pretemporada`);
P(`   sem  semanal%  acumulado%  PorDelante%  (media por liga: PorDelante%)   agrupado por % del bote`);
let acc = 0;
for (let w = 1; w <= W25; w++) {
  const sh = 100 * pooled[w] / totPool, ahead = 100 - acc;
  acc += sh;
  P(`   ${pad(w, 4)} ${pad(f1(sh), 9)} ${pad(f1(acc), 11)} ${pad(f1(ahead), 12)} (${f1(100 - 100 * meanCum(w - 1))})`);
}
P(`   PorDelante% en la semana w = parte del gasto de la temporada que ocurre en w o despues`);
console.log(out.join('\n'));
