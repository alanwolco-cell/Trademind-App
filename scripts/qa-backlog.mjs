#!/usr/bin/env node
// Gate del backlog del 2026-09-11 (los reportes en rafaga del dueno):
//   1. Las ligas Chopped de Sleeper se llaman Chopped, no "Best ball".
//   2. Las ligas de Yahoo por-dispositivo se DECLARAN en Leagues.
//   3. La cinta de added/dropped corre a ~150px/s con cola acotada.
//   4. Buy/Sell dice de que liga habla, y "Declining Veteran" solo etiqueta
//      a quien esta del lado malo de la curva de SU posicion.
//   5. Podas: Roster Grade y la parte social de Community escondidas; la
//      puerta del cajon dice League Trades / News & Learn y el clic llega.
//
//   node scripts/qa-backlog.mjs
//   QA_BASE=https://macdraft.app node scripts/qa-backlog.mjs
//
// Verificado el 2026-09-11 que este gate FALLA contra el codigo viejo
// (corrido contra produccion antes del deploy: 1, 2, 4 y 5 en rojo).
//
// Datos reales del dueno (QA_USER wolco): las dos ligas Chopped y una
// redraft para el modo del analizador. Si el las abandona, cambiar aqui.
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
if (!ruta) {
  console.error('No encuentro playwright. Instalalo fuera del repo:\n  npm i -g playwright && npx playwright install chromium');
  process.exit(2);
}
const { chromium } = await import(ruta);

const PORT = process.env.QA_PORT || 3217;
const BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
const USER = process.env.QA_USER || 'wolco';
const LIGA_REDRAFT = '1401312905621712896'; // "Gente seria"
let srv = null;
if (!process.env.QA_BASE) {
  srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
    { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
    await new Promise(r => setTimeout(r, 500));
  }
}
const cerrar = () => { if (srv) try { srv.kill(); } catch (_) { } };

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };

const errsConsola = [];
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /posthog/, /sleepercdn/];
const b = await chromium.launch();
async function nuevaPagina(w, h, movil) {
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    ...(movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {})
  });
  const pg = await ctx.newPage();
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    const url = (m.location() || {}).url || '';
    if (RUIDO.some(r => r.test(t) || r.test(url))) return;
    errsConsola.push(t.slice(0, 140) + (url ? '  <- ' + url.slice(0, 90) : ''));
  });
  pg.on('pageerror', e => errsConsola.push('PAGEERROR ' + String(e).slice(0, 200)));
  return pg;
}

/* ------------------------------------------------ 1 y 2: Leagues (movil) */
{
  const pg = await nuevaPagina(390, 844, true);
  await pg.addInitScript(u => { try { localStorage.setItem('tm_username', u); } catch (_) { } }, USER);
  await pg.goto(BASE + '/myleagues', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // La hidratacion de ~12 ligas tarda; se espera a que haya tarjetas.
  await pg.waitForSelector('.ml-card', { timeout: 90000 }).catch(() => { });
  await pg.waitForTimeout(2500);

  const ligas = await pg.evaluate(() => Array.from(document.querySelectorAll('.ml-card')).map(c => ({
    nombre: (c.querySelector('h3') || {}).textContent || '',
    formato: (c.querySelector('.ml-flags span') || {}).textContent || ''
  })));
  const chopped = ligas.filter(l => /chopped/i.test(l.nombre));
  ok('(1a) las ligas Chopped del dueno estan en la parrilla', chopped.length >= 2,
    'vistas: ' + ligas.length + ' | chopped: ' + JSON.stringify(chopped));
  ok('(1b) todas las Chopped dicen "Chopped", ninguna "Best ball"',
    chopped.length > 0 && chopped.every(l => l.formato === 'Chopped'),
    JSON.stringify(chopped));
  const bb = ligas.filter(l => l.formato === 'Best ball');
  ok('(1c) las best ball de verdad siguen diciendo Best ball', bb.length >= 4,
    'best ball vistas: ' + bb.length);

  const pie = await pg.evaluate(() => (document.querySelector('.ml-foot') || {}).textContent || '');
  ok('(2) sin token de Yahoo, Leagues declara que Yahoo va por dispositivo',
    /connect per device/i.test(pie), pie.slice(0, 180));
  await pg.close();
}

/* --------------------------- 3 y 4: cinta y Buy/Sell con liga conectada */
{
  const pg = await nuevaPagina(390, 844, true);
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => typeof loadUser === 'function', { timeout: 30000 });
  await pg.evaluate(([u, lid]) => {
    document.getElementById('sleeper-username').value = u;
    return loadUser(lid);
  }, [USER, LIGA_REDRAFT]);

  const hayCinta = await pg.waitForFunction(() => {
    const bar = document.getElementById('ticker-bar');
    return bar && getComputedStyle(bar).display !== 'none';
  }, { timeout: 40000 }).then(() => true).catch(() => false);
  await pg.waitForTimeout(2500); // los dos applyDur
  const cinta = await pg.evaluate(() => {
    const tk = document.getElementById('live-ticker');
    if (!tk) return null;
    return { dur: parseFloat(getComputedStyle(tk).animationDuration) || 0, w: tk.scrollWidth, n: tk.children.length };
  });
  const pxs = cinta && cinta.dur ? (cinta.w / 2) / cinta.dur : 0;
  ok('(3a) la cinta aparece y corre a ~150px/s (el "va muy lenta" del dueno)',
    hayCinta && pxs >= 140 && pxs <= 165, 'px/s: ' + Math.round(pxs) + ' | ' + JSON.stringify(cinta));
  ok('(3b) la cola de la cinta esta acotada (<=28 items, antes 52)',
    !!cinta && cinta.n > 0 && cinta.n / 2 <= 28, 'items unicos: ' + (cinta ? cinta.n / 2 : 'sin cinta'));

  // Buy/Sell por la puerta de verdad: el cajon -> Research -> Buy / Sell.
  await pg.evaluate(() => switchScreen('research'));
  await pg.waitForFunction(() => {
    const el = document.getElementById('buysell-content');
    return el && !el.querySelector('.tm-skel') && el.textContent.length > 40;
  }, { timeout: 30000 }).catch(() => { });
  const bs = await pg.evaluate(() => {
    const sub = (document.getElementById('bs-sub') || {}).textContent || '';
    const nombre = (typeof leagueName !== 'undefined' && leagueName) || '';
    // Filas bajo el pill "Sell Now - Declining Veteran": posicion y edad.
    const filas = [];
    document.querySelectorAll('#buysell-content .signal-pill').forEach(p => {
      if (!/Declining Veteran/i.test(p.textContent)) return;
      const seccion = p.closest('div[style*="margin-bottom"]') && p.parentElement.parentElement;
      if (!seccion) return;
      seccion.querySelectorAll('.bs-row').forEach(r => {
        // El chip de posicion va pegado al de edad: "...Cam Skattebo RBAge 24..."
        const m = r.textContent.match(/(QB|RB|WR|TE)\s*Age (\d+)/);
        if (m) filas.push({ pos: m[1], edad: Number(m[2]), quien: r.textContent.slice(0, 26) });
      });
    });
    return { sub, nombre, filas };
  });
  ok('(4a) Buy/Sell dice de que liga habla', !!bs.nombre && bs.sub.indexOf(bs.nombre) >= 0,
    'subtitulo: "' + bs.sub + '" | liga: "' + bs.nombre + '"');
  const UMBRAL = { QB: 33, RB: 27, WR: 29, TE: 30 };
  const malEtiquetados = bs.filas.filter(f => f.edad < (UMBRAL[f.pos] || 28));
  ok('(4b) "Declining Veteran" solo etiqueta veteranos de verdad (curva por posicion)',
    malEtiquetados.length === 0,
    bs.filas.length + ' filas en la seccion | mal: ' + JSON.stringify(malEtiquetados));
  await pg.close();
}

/* ------------------------------------- 5: podas, por el cajon y por URL */
{
  const pg = await nuevaPagina(390, 844, true);
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2000);
  // abrir el cajon como una persona: More de la barra o hamburguesa
  await pg.evaluate(() => {
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btns = [document.querySelector('#tabbar .tabbar-item[data-tab="more"]'),
      document.getElementById('nav-burger')].filter(e => e && visible(e));
    if (btns[0]) btns[0].click();
    else document.getElementById('mob-menu').classList.add('open');
  });
  await pg.waitForTimeout(600);
  const cajon = await pg.evaluate(() => {
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const items = Array.from(document.querySelectorAll('#mob-menu button')).filter(visible).map(e => e.textContent.trim());
    return items;
  });
  ok('(5a) el cajon ya no ofrece Roster Grade ni Trade Feed',
    !cajon.some(t => /Roster Grade|Trade Feed/i.test(t)), JSON.stringify(cajon).slice(0, 220));
  ok('(5b) el cajon ofrece League Trades y News & Learn',
    cajon.some(t => /League Trades/i.test(t)) && cajon.some(t => /News & Learn/i.test(t)),
    JSON.stringify(cajon).slice(0, 220));

  // el clic de verdad en la puerta nueva
  const clic = await pg.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('#mob-menu button'))
      .find(e => /League Trades/i.test(e.textContent));
    if (!btn) return { error: 'sin boton' };
    btn.click();
    return {};
  });
  await pg.waitForTimeout(1200);
  const tras = await pg.evaluate(() => ({
    pantalla: (document.querySelector('.screen.active') || {}).id,
    tab: (document.querySelector('.screen.active .tab-content.active') || {}).id,
    rgVisible: (() => { const t = document.querySelector('#screen-league .inner-tab.rostergrade-only'); return t ? t.getBoundingClientRect().width > 0 : false; })()
  }));
  ok('(5c) el clic en League Trades aterriza en la pantalla con ese tab activo',
    !clic.error && tras.pantalla === 'screen-league' && tras.tab === 'tab-league-trades',
    JSON.stringify(tras));
  ok('(5d) el tab Roster Grade no se ve', tras.rgVisible === false, JSON.stringify(tras));

  // /community directo cae en News, sin tabs sociales a la vista
  await pg.goto(BASE + '/community', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2500);
  const comm = await pg.evaluate(() => {
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const activo = document.querySelector('#community-tab-bar .inner-tab.active');
    const sociales = ['ctab-trades', 'ctab-mine', 'ctab-forum', 'ctab-feedback']
      .map(id => document.getElementById(id)).filter(e => e && visible(e)).map(e => e.id);
    const titulo = (document.querySelector('#screen-community .card') || {}).textContent || '';
    return { activo: activo ? activo.id : null, sociales, dice: /News & Learn/.test(titulo) };
  });
  ok('(5e) /community aterriza en News y sin tabs sociales visibles',
    comm.activo === 'ctab-news' && comm.sociales.length === 0, JSON.stringify(comm));
  ok('(5f) la cabecera dice News & Learn', comm.dice === true, JSON.stringify(comm));
  await pg.close();
}

ok('(z) consola limpia', errsConsola.length === 0, errsConsola.slice(0, 5).join(' | '));

await b.close();
cerrar();
console.log(fails ? '\n' + fails + ' FALLOS' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
