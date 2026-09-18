#!/usr/bin/env node
// GATE DEL FAAB EN EL ANALIZADOR (2026-09-18).
//
//   node scripts/qa-faab.mjs
//
// El FAAB entra al trade como una fila mas ("$25 FAAB") y se precia con las
// tasas medidas en scripts/faab-value-study.mjs. Aqui se mide, con una liga
// armada a mano (sin red: el resultado no puede depender de Sleeper):
//   - la aritmetica exacta de la tasa y del decaimiento por semana
//   - los controles negativos: liga de orden, Yahoo, fin de temporada
//   - el tope por lo que el equipo TIENE (que puede pasar del bote)
//   - que la fila viaja al contador y vuelve del constructor clasico
//   - que el FAAB no cuenta como un cuerpo en la cuenta de plazas de roster
'use strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATOS = [
  path.join(ROOT, 'node_modules/playwright/index.mjs'),
  '/Users/wolco/Development/ernestocalvo/node_modules/playwright/index.mjs',
  '/Users/wolco/Development/mi-nuevo-website/node_modules/playwright/index.mjs'
];
const ruta = CANDIDATOS.find(p => fs.existsSync(p));
if (!ruta) { console.error('No encuentro playwright.'); process.exit(2); }
const { chromium } = await import(ruta);

const PORT = Number(process.env.QA_PORT || 3226);
const BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
let srv = null;
if (!process.env.QA_BASE) {
  try { await fetch(BASE + '/'); console.error('El puerto ' + PORT + ' ya contesta. Cierra ese proceso.'); process.exit(2); } catch (_) { }
  srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
    await new Promise(r => setTimeout(r, 500));
  }
}
let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };
// Todo lo que sale de la pagina pasa por aqui: contra el codigo viejo una
// funcion que no existe devuelve {_err} y el gate sigue midiendo.
// Teclear como una persona; si la casilla no existe (codigo viejo) no revienta.
const teclear = async (pg, sel, v) => { try { await pg.locator(sel).fill(v, { timeout: 5000 }); } catch (_) { } };
const eva = async (pg, fn, arg) => { try { return await pg.evaluate(fn, arg); } catch (e) { return { _err: String(e).slice(0, 160) }; } };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const pg = await ctx.newPage();
const errs = [];
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /posthog/, /sleepercdn/, /api\/sleeper/, /api\/ktc/, /Failed to load resource/];
pg.on('console', m => { if (m.type() === 'error' && !RUIDO.some(r => r.test(m.text()) || r.test((m.location() || {}).url || ''))) errs.push(m.text().slice(0, 160)); });
pg.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));

try {
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => typeof renderTradeBoards === 'function' && typeof getKtcValue === 'function', { timeout: 30000 });

  // Una liga FAAB de 10 equipos, bote $100, semana 2, redraft. Yo gaste $20;
  // el rival COMPRO $33 de FAAB en un trade (waiver_budget_used negativo).
  const armar = () => eva(pg, () => {
    switchScreen('analyze');
    document.getElementById('builder-panel').style.display = 'block';
    document.getElementById('board-builder').style.display = 'block';
    window.leaguePlatform = 'sleeper';
    window._leagueWaiver = { type: 2, budget: 100 };
    NFL_WEEK = 2; NFL_SEASON_TYPE = 'regular';
    leagueMode = 'redraft';
    userId = 'u1';
    myRoster = [{ id: 'qa1', name: 'QA Uno', pos: 'RB', team: 'DET' }, { id: 'qa2', name: 'QA Dos', pos: 'WR', team: 'MIN' }];
    oppRoster = [{ id: 'qa3', name: 'QA Tres', pos: 'RB', team: 'ATL' }];
    myPicks = []; oppPicks = [];
    leagueRosters = Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1, owner_id: 'u' + (i + 1), players: [],
      settings: { waiver_budget_used: i === 0 ? 20 : i === 1 ? -33 : 0 } }));
    ktcById.qa1 = 3000; ktcById.qa2 = 1000; ktcById.qa3 = 2500;
    const s = document.getElementById('opp-select');
    s.innerHTML = '<option value="">Select opponent...</option><option value="u2">Rival</option>';
    s.value = 'u2';
    _boardFaab = { give: 0, get: 0 };
    _boardSel = { give: {}, get: {} };
    clearTradeSide('give-players', 'give'); clearTradeSide('get-players', 'get');
    renderTradeBoards();
    return true;
  });
  const a0 = await armar();
  ok('(0) CONTROL: la liga de prueba se armo (si no, no se mide nada)', a0 === true, JSON.stringify(a0));

  // ── 1. la aritmetica: tasa x %bote x lo que queda de mercado / 0.9
  const f1 = await eva(pg, () => {
    const r = { red: tmFaabValue(25) };
    leagueMode = 'dynasty'; r.dyn = tmFaabValue(25); leagueMode = 'redraft';
    r.texto = getKtcValue('$25 FAAB');
    NFL_WEEK = 10; r.w10 = tmFaabValue(25);
    NFL_SEASON_TYPE = 'post'; r.post = tmFaabValue(25);
    NFL_SEASON_TYPE = 'pre'; NFL_WEEK = 0; r.pre = tmFaabValue(25);
    NFL_SEASON_TYPE = 'regular'; NFL_WEEK = 2;
    return r;
  });
  const esp = (tasa, adelante) => Math.round(tasa * 25 * Math.min(1, adelante / 0.9));
  ok('(1a) redraft, semana 2: 11 por cada 1% del bote, por .84/.9 de mercado por delante',
    f1.red === esp(11, 0.84), JSON.stringify(f1) + ' esperado ' + esp(11, 0.84));
  ok('(1b) dynasty vale casi el doble (21 por 1%)', f1.dyn === esp(21, 0.84), 'esperado ' + esp(21, 0.84));
  ok('(1c) la fila "$25 FAAB" se precia igual por el camino de getKtcValue', typeof f1.texto === 'number' && f1.texto > 0 && f1.texto === f1.red, String(f1.texto));
  ok('(1d) semana 10 vale menos: queda 26% del mercado', f1.w10 === esp(11, 0.26), 'esperado ' + esp(11, 0.26));
  ok('(1e) en playoffs ya no hay nada que comprar: 0', f1.post === 0, String(f1.post));
  ok('(1f) antes de la temporada vale entero', f1.pre === Math.round(11 * 25), String(f1.pre));

  // ── 2. controles negativos: sin FAAB no hay nada que pintar ni que preciar
  const f2 = await eva(pg, () => {
    // Lo que se VE, no el atributo: un display del CSS le gana a [hidden].
    const oculto = id => getComputedStyle(document.getElementById(id)).display === 'none';
    const r = {};
    window._leagueWaiver = { type: 1, budget: 100 }; renderTradeBoards();
    r.orden = { v: getKtcValue('$25 FAAB'), give: oculto('bb-faab-give'), get: oculto('bb-faab-get') };
    window._leagueWaiver = { type: 2, budget: 100 }; window.leaguePlatform = 'yahoo'; renderTradeBoards();
    r.yahoo = { v: getKtcValue('$25 FAAB'), give: oculto('bb-faab-give') };
    window.leaguePlatform = 'sleeper'; renderTradeBoards();
    r.vuelta = { give: oculto('bb-faab-give'), get: oculto('bb-faab-get') };
    const s = document.getElementById('opp-select'); s.value = ''; renderTradeBoards();
    r.sinRival = oculto('bb-faab-get');
    s.value = 'u2'; renderTradeBoards();
    return r;
  });
  ok('(2a) liga de waivers por orden: no se ofrece FAAB y no vale nada',
    f2.orden && f2.orden.v === 0 && f2.orden.give === true && f2.orden.get === true, JSON.stringify(f2.orden));
  ok('(2b) Yahoo (sin el dato): tampoco', f2.yahoo && f2.yahoo.v === 0 && f2.yahoo.give === true, JSON.stringify(f2.yahoo));
  ok('(2c) CONTROL: en la liga FAAB los dos lados SI se ofrecen', f2.vuelta && f2.vuelta.give === false && f2.vuelta.get === false, JSON.stringify(f2.vuelta));
  ok('(2d) sin rival elegido, su lado no ofrece FAAB (no se sabe cuanto tiene)', f2.sinRival === true, JSON.stringify(f2.sinRival));

  // ── 3. se teclea en el tablero y viaja como fila
  await teclear(pg, '#bb-faab-in-get', '40');
  await pg.waitForTimeout(150);
  const f3 = await eva(pg, () => ({
    filas: Array.from(document.querySelectorAll('#get-players input')).map(i => i.value).filter(Boolean),
    vivo: document.getElementById('ktc-get-live').textContent,
    valor: tmFaabValue(40),
    pista: document.getElementById('bb-faab-hint-get').textContent,
    alto: Math.round(document.querySelector('#bb-faab-get .bb-faab-box').getBoundingClientRect().height),
    ancho: document.documentElement.scrollWidth
  }));
  ok('(3a) teclear 40 deja la fila "$40 FAAB" en el lado que recibes', JSON.stringify(f3.filas) === '["$40 FAAB"]', JSON.stringify(f3.filas));
  ok('(3b) el contador en vivo la suma', f3.vivo === Number(f3.valor).toLocaleString('en-US'), JSON.stringify({ vivo: f3.vivo, valor: f3.valor }));
  ok('(3c) la pista dice cuanto tienen y cuanto vale', /\$133 of \$100/.test(f3.pista || '') && new RegExp('worth ' + f3.valor).test(f3.pista || ''), f3.pista);
  ok('(3d) la casilla mide 44px y la pagina no desborda a 390', f3.alto >= 44 && f3.ancho <= 390, JSON.stringify({ alto: f3.alto, ancho: f3.ancho }));

  // ── 4. el tope es lo que el equipo TIENE, que puede pasar del bote
  await teclear(pg, '#bb-faab-in-give', '500');
  await teclear(pg, '#bb-faab-in-get', '120');
  await pg.waitForTimeout(150);
  const f4 = await eva(pg, () => ({
    give: Array.from(document.querySelectorAll('#give-players input')).map(i => i.value).filter(Boolean),
    get: Array.from(document.querySelectorAll('#get-players input')).map(i => i.value).filter(Boolean)
  }));
  ok('(4a) yo tengo $80: pedir $500 se queda en $80', JSON.stringify(f4.give) === '["$80 FAAB"]', JSON.stringify(f4.give));
  ok('(4b) el rival compro FAAB y tiene $133: $120 pasa aunque supere el bote de $100', JSON.stringify(f4.get) === '["$120 FAAB"]', JSON.stringify(f4.get));

  // ── 5. con jugadores: el FAAB suma valor pero NO es un cuerpo
  const f5 = await eva(pg, () => {
    boardToggle('give', 'pqa1');
    boardToggle('get', 'pqa3');
    const give = Array.from(document.querySelectorAll('#give-players input')).map(i => i.value).filter(Boolean);
    const get = Array.from(document.querySelectorAll('#get-players input')).map(i => i.value).filter(Boolean);
    const els = Array.from(document.querySelectorAll('#get-players input')).filter(i => i.value.trim());
    return { give, get, sinFaab: _tmNoFaab(els).map(i => i.value) };
  });
  ok('(5a) jugador + FAAB conviven en el mismo lado', JSON.stringify(f5.give) === '["QA Uno","$80 FAAB"]' && JSON.stringify(f5.get) === '["QA Tres","$120 FAAB"]',
    JSON.stringify(f5));
  ok('(5b) la cuenta de plazas de roster no lo ve como jugador', JSON.stringify(f5.sinFaab) === '["QA Tres"]', JSON.stringify(f5.sinFaab));
  // Candado estatico: las DOS llamadas a la cuenta de plazas quitan el FAAB.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const llamadas = (src.match(/_tmEffGap\(\s*\n\s*_tmNoFaab\(/g) || []).length;
  const todas = (src.match(/_tmEffGap\(\s*\n/g) || []).length;
  ok('(5c) las dos llamadas a _tmEffGap filtran el FAAB', llamadas === 2 && todas === 2, 'filtran ' + llamadas + ' de ' + todas);

  // ── 6. ida y vuelta con el constructor clasico, y limpieza
  const f6 = await eva(pg, () => {
    _boardFaab = { give: 0, get: 0 };
    _boardSyncFromRows('get');
    const leido = _boardFaab.get;
    const caja = document.getElementById('bb-faab-in-get').value;
    boardClearAll();
    const tras = { faab: _boardFaab.get, filas: Array.from(document.querySelectorAll('#get-players input')).map(i => i.value).filter(Boolean) };
    return { leido, caja, tras };
  });
  ok('(6a) una fila "$120 FAAB" escrita a mano vuelve al tablero', f6.leido === 120 && f6.caja === '120', JSON.stringify(f6));
  ok('(6b) Clear trade la borra', f6.tras && f6.tras.faab === 0 && f6.tras.filas.length === 0, JSON.stringify(f6.tras));

  // ── 7. el veredicto explica el numero
  const f7 = await eva(pg, () => {
    document.getElementById('get-players').querySelector('input').value = '$30 FAAB';
    return tmFaabNote();
  });
  ok('(7) la nota dice cuanto vale, de donde sale y que baja cada semana',
    typeof f7 === 'string' && /\$30 of \$100 FAAB = \d+/.test(f7) && /7,976 winning bids/.test(f7) && /less every week/.test(f7), String(f7).slice(0, 200));

  ok('(z) consola limpia', errs.length === 0, errs.join('\n      '));
} catch (e) {
  ok('(!) el gate no reviento', false, String(e && e.stack || e).slice(0, 400));
}
await b.close();
if (srv) try { srv.kill(); } catch (_) { }
console.log(fails ? '\n' + fails + ' FALLO(S)' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
