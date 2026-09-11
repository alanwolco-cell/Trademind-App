#!/usr/bin/env node
// Gate de la HOJA SEMANAL (Mac's weekly sheet, 2026-09-11): el panel del dueno
// que edita rankings semanales por posicion, publicos para todos, citados por
// Start/Sit. Cubre el contrato del servidor (quien puede escribir, que ve el
// publico), la pantalla por donde entra el usuario, la edicion del dueno con
// confirmacion en el almacen, y la cita.
//
//   node scripts/qa-weekly.mjs
//
// Este gate SIEMPRE levanta su propio servidor con un almacen de archivo y una
// cuenta de dueno de mentira (PERFIL_ACCTS): no toca el Blob real ni depende
// de la cuenta del dueno. OJO (trampa ya pagada en qa-push): PERFIL_ACCTS
// lleva el acctId HASHEADO (sha256 de la llave, recortado a 32), no la llave.
'use strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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

const PORT = process.env.QA_PORT || 3219;
const BASE = 'http://localhost:' + PORT;
// La llave del dueno de mentira (lo que viaja en x-tm-acct) y su hash (lo que
// va en PERFIL_ACCTS), espejo exacto de server/lib/identity.js.
const OWNER_KEY = 'qa-weekly-owner-key-0000000000000000';
const OTRA_KEY = 'qa-weekly-stranger-key-000000000000';
const hash = k => crypto.createHash('sha256').update(k).digest('hex').slice(0, 32);
const WK_FILE = path.join(os.tmpdir(), 'qa-weekly-sheet-' + Date.now() + '.json');

const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: {
    ...process.env, PORT: String(PORT),
    PERFIL_ACCTS: hash(OWNER_KEY),
    PERFIL_WK_FILE: WK_FILE,
    PERFIL_RK_STORE: 'local'
  }, stdio: 'ignore'
});
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
  await new Promise(r => setTimeout(r, 500));
}
const cerrar = () => { try { srv.kill(); } catch (_) { } try { fs.unlinkSync(WK_FILE); } catch (_) { } };

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };

/* ── el contrato del servidor ────────────────────────────────────────────── */
const st = await (await fetch(BASE + '/api/sleeper/state/nfl')).json().catch(() => ({}));
const WEEK = Math.max(1, Number(st.week) || 1);

// Semilla REAL: los mejores por posicion del feed oficial de esta semana, que
// es exactamente lo que siembra el boton Edit del dueno.
const [proy, slim] = await Promise.all([
  (await fetch(BASE + '/api/sleeper/projections/' + WEEK)).json(),
  (await fetch(BASE + '/api/sleeper/players/nfl/slim')).json()
]);
const porPos = { QB: [], RB: [], WR: [], TE: [] };
Object.keys(proy.players || {}).forEach(id => {
  const p = slim[id];
  const pos = p && (p.fantasy_positions || []).find(x => porPos[x]);
  const s = proy.players[id];
  const pts = s.pts_half_ppr != null ? s.pts_half_ppr : s.pts_std;
  if (pos && typeof pts === 'number') porPos[pos].push({ id, pts });
});
Object.keys(porPos).forEach(p => {
  porPos[p].sort((a, b) => b.pts - a.pts);
  porPos[p] = porPos[p].map(x => x.id).slice(0, { QB: 25, RB: 40, WR: 45, TE: 25 }[p]);
});
ok('(0) la semilla del feed tiene cuerpo (30+ RBs, 20+ QBs)',
  porPos.RB.length >= 30 && porPos.QB.length >= 20,
  'QB ' + porPos.QB.length + ' RB ' + porPos.RB.length + ' WR ' + porPos.WR.length + ' TE ' + porPos.TE.length);

const DOC = {
  v: 1, season: String(st.season || ''), updatedAt: Date.now(),
  weeks: {
    [String(WEEK)]: { pos: porPos, publishedAt: Date.now() },       // publicada
    [String(WEEK + 1)]: { pos: { QB: porPos.QB.slice(0, 5) } }      // borrador
  }
};
const put = (body, key) => fetch(BASE + '/api/perfil/weekly', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...(key ? { 'x-tm-acct': key } : {}) },
  body: JSON.stringify(body)
});

let r = await put(DOC);
ok('(a1) escribir sin cuenta rebota 401', r.status === 401, 'status ' + r.status);
r = await put(DOC, OTRA_KEY);
ok('(a2) escribir con cuenta ajena rebota 403', r.status === 403, 'status ' + r.status);
r = await put({ v: 1, weeks: { 2: { pos: { K: ['1'] } } } }, OWNER_KEY);
ok('(a3) una posicion que no es QB/RB/WR/TE rebota 400', r.status === 400, 'status ' + r.status);
r = await put(DOC, OWNER_KEY);
ok('(a4) el dueno escribe y el almacen lo declara', r.ok && (await r.json()).store === 'file', 'status ' + r.status);

const pub = await (await fetch(BASE + '/api/perfil/weekly')).json();
ok('(b1) el publico ve la semana publicada y NO el borrador',
  pub && pub.owner === false && pub.doc && pub.doc.weeks[String(WEEK)] && !pub.doc.weeks[String(WEEK + 1)],
  JSON.stringify(Object.keys((pub.doc || {}).weeks || {})));
const propio = await (await fetch(BASE + '/api/perfil/weekly', { headers: { 'x-tm-acct': OWNER_KEY } })).json();
ok('(b2) el dueno ve tambien su borrador', propio.owner === true && !!propio.doc.weeks[String(WEEK + 1)],
  JSON.stringify(Object.keys((propio.doc || {}).weeks || {})));

/* ── la pantalla, por donde entra cada uno ───────────────────────────────── */
const errsConsola = [];
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /posthog/, /sleepercdn/];
const b = await chromium.launch();
async function pagina(acctKey) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  if (acctKey) await pg.addInitScript(k => { try { localStorage.setItem('tm_acct', k); } catch (_) { } }, acctKey);
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text(), url = (m.location() || {}).url || '';
    if (RUIDO.some(x => x.test(t) || x.test(url))) return;
    errsConsola.push(t.slice(0, 140));
  });
  pg.on('pageerror', e => errsConsola.push('PAGEERROR ' + String(e).slice(0, 200)));
  await pg.goto(BASE + '/research', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => {
    const t = Array.from(document.querySelectorAll('#screen-research .inner-tab'))
      .find(e => /Weekly Rankings/.test(e.textContent));
    if (t) t.click();
  });
  await pg.waitForFunction(() => {
    const b2 = document.getElementById('wk-body');
    return b2 && (b2.querySelector('.wk-row') || b2.querySelector('.rk-empty'));
  }, { timeout: 30000 }).catch(() => { });
  return { ctx, pg };
}

{
  const { ctx, pg } = await pagina(null);
  const vista = await pg.evaluate(() => ({
    filas: document.querySelectorAll('#wk-body .wk-row').length,
    cab: (document.querySelector('#wk-body .wk-sub') || {}).textContent || '',
    edita: /Edit week/.test((document.querySelector('#wk-body .wk-tools') || {}).textContent || '')
  }));
  ok('(c1) el publico ve la hoja de la semana con filas', vista.filas >= 20 && vista.cab.indexOf('Week ' + WEEK) >= 0,
    JSON.stringify(vista).slice(0, 140));
  ok('(c2) el publico NO ve el boton de editar', vista.edita === false, JSON.stringify(vista.edita));
  // el selector de posicion cambia la lista
  await pg.evaluate(() => {
    const bts = Array.from(document.querySelectorAll('#wk-body .ctx-seg-btn'));
    const qb = bts.find(x => x.textContent.trim() === 'QB'); if (qb) qb.click();
  });
  await pg.waitForTimeout(400);
  const qbs = await pg.evaluate(() => document.querySelectorAll('#wk-body .wk-row').length);
  ok('(c3) cambiar a QB pinta la lista de QBs', qbs >= 15 && qbs <= 30, qbs + ' filas');
  // la cita que usa Start/Sit, con dos nombres reales de la hoja y uno ajeno
  const cita = await pg.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('#wk-body .wk-row .wk-name'));
    const n1 = filas[0] && filas[0].firstChild.textContent, n2 = filas[2] && filas[2].firstChild.textContent;
    return Promise.all([wkCite([n1, n2]), wkCite(['Nobody Fakename'])]).then(rs => ({ con: rs[0], sin: rs[1], n1, n2 }));
  });
  ok('(c4) wkCite cita la hoja por nombre y semana para jugadores rankeados',
    /Mac's weekly sheet/.test(cita.con) && cita.con.indexOf('week ' + WEEK) >= 0 && cita.con.indexOf('QB1') >= 0,
    (cita.con || '(vacia)').slice(0, 160));
  ok('(c5) wkCite calla cuando nadie esta en la hoja', cita.sin === '', JSON.stringify(cita.sin));
  await ctx.close();
}

/* ── el dueno edita y el almacen lo confirma ─────────────────────────────── */
{
  const { ctx, pg } = await pagina(OWNER_KEY);
  const hayEdit = await pg.evaluate(() => /Edit week/.test((document.querySelector('#wk-body .wk-tools') || {}).textContent || ''));
  ok('(d1) el dueno SI ve el boton de editar', hayEdit === true, String(hayEdit));
  await pg.evaluate(() => {
    const bt = Array.from(document.querySelectorAll('#wk-body button')).find(x => /Edit week/.test(x.textContent));
    if (bt) bt.click();
  });
  await pg.waitForTimeout(600);
  const antes = await pg.evaluate(() => Array.from(document.querySelectorAll('#wk-body .wk-row')).slice(0, 2).map(r => r.dataset.id));
  await pg.evaluate(() => {
    const fila = document.querySelector('#wk-body .wk-row');
    const bajar = fila && Array.from(fila.querySelectorAll('button')).find(x => (x.title || '') === 'Move down');
    if (bajar) bajar.click();
  });
  await pg.waitForTimeout(300);
  const despues = await pg.evaluate(() => Array.from(document.querySelectorAll('#wk-body .wk-row')).slice(0, 2).map(r => r.dataset.id));
  ok('(d2) bajar al primero lo intercambia con el segundo, al instante',
    antes[0] === despues[1] && antes[1] === despues[0], antes + ' -> ' + despues);
  // el PUT con debounce tiene que aterrizar en el almacen
  let enDisco = null;
  for (let i = 0; i < 20; i++) {
    await pg.waitForTimeout(400);
    try {
      const d = JSON.parse(fs.readFileSync(WK_FILE, 'utf8'));
      const ids = d.weeks[String(WEEK)].pos.RB;
      if (ids[0] === despues[0] && ids[1] === despues[1]) { enDisco = ids.slice(0, 2); break; }
    } catch (_) { }
  }
  ok('(d3) el cambio aterriza en el almacen del servidor', !!enDisco, JSON.stringify(enDisco));
  // publicar re-sella publishedAt
  const selloAntes = JSON.parse(fs.readFileSync(WK_FILE, 'utf8')).weeks[String(WEEK)].publishedAt;
  await pg.evaluate(() => {
    const bt = Array.from(document.querySelectorAll('#wk-body button')).find(x => /Publish week/.test(x.textContent));
    if (bt) bt.click();
  });
  let selloDespues = selloAntes;
  for (let i = 0; i < 15; i++) {
    await pg.waitForTimeout(400);
    try { selloDespues = JSON.parse(fs.readFileSync(WK_FILE, 'utf8')).weeks[String(WEEK)].publishedAt; } catch (_) { }
    if (selloDespues > selloAntes) break;
  }
  ok('(d4) Publish re-sella publishedAt en el almacen', selloDespues > selloAntes,
    selloAntes + ' -> ' + selloDespues);
  await ctx.close();
}

ok('(z) consola limpia', errsConsola.length === 0, errsConsola.slice(0, 5).join(' | '));

await b.close();
cerrar();
console.log(fails ? '\n' + fails + ' FALLOS' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
