#!/usr/bin/env node
// Gate del tablero de disponibles del mock draft, en navegador REAL.
//
//   node scripts/qa-board.mjs
//   QA_BASE=http://localhost:3210 node scripts/qa-board.mjs
//
// Protege UNA cosa: que el nombre del jugador nunca se desmenuce. El bug que
// motiva este gate (2026-08-25) es que mdBoardCols() elegia las columnas por
// window.innerWidth y no por el ancho del CONTENEDOR. En subasta la tabla vive
// en una columna estrecha, asi que a 1280px de viewport armaba la plantilla de
// escritorio (286px entre columnas fijas y gaps) dentro de un contenedor de
// 220px: la pista del nombre colapsaba a 0 y overflow-wrap:anywhere partia
// "Jahmyr Gibbs" en once renglones de una letra.
//
// El barrido de anchos ES el control: snake pasaba a todos ellos con el codigo
// roto, subasta fallaba de 1500px para abajo. Un gate que solo mirara 1920 o
// 390 (los dos anchos que el repo ya vigilaba) habria dado verde con la app
// rota en toda la franja de un MacBook.
//
// Playwright NO esta en package.json a proposito: su postinstall se baja los
// navegadores y eso entraria en cada build de Vercel. El script lo resuelve de
// donde ya exista en la maquina.
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

const PORT = process.env.QA_PORT || 3215;
const BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
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

// El piso va sobre la CELDA (.md-bd-who), no sobre el texto: el texto se
// encoge solo al nombre y medirlo daria falsos rojos a 1920px, donde "Jahmyr
// Gibbs" ocupa 83px y esta perfecto. Lo que no puede pasar es que la PISTA de
// la rejilla se quede sin ancho. 120px = la foto de 30px, su hueco de 8, y lo
// justo para que un nombre medio entre en dos renglones.
const PISO = 120;
const MAX_LINEAS = 2;

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };

const b = await chromium.launch();

// Mide las filas del tablero: ancho de la celda del nombre, cuantos renglones
// ocupa, y si cabecera y filas comparten plantilla de rejilla.
const medirTablero = pg => pg.evaluate(() => {
  const filas = [];
  document.querySelectorAll('#md-choices .md-bd-row').forEach(row => {
    const n = row.querySelector('.md-bd-name');
    const celda = row.querySelector('.md-bd-who') || n;
    if (!n) return;
    const cs = getComputedStyle(n);
    const lh = parseFloat(cs.lineHeight) || 16;
    const r = n.getBoundingClientRect();
    filas.push({
      t: (n.textContent || '').trim(),
      w: Math.round(celda.getBoundingClientRect().width),
      wTexto: Math.round(r.width),
      lineas: Math.max(1, Math.round(r.height / lh)),
      wrap: cs.overflowWrap || cs.wordWrap
    });
  });
  const head = document.querySelector('#md-choices .md-bd-head');
  const row0 = document.querySelector('#md-choices .md-bd-row');
  const cols = document.querySelectorAll('#md-choices .md-bd-head > span').length;
  return {
    filas: filas.slice(0, 40),
    plantillaHead: head ? getComputedStyle(head).gridTemplateColumns : null,
    plantillaRow: row0 ? getComputedStyle(row0).gridTemplateColumns : null,
    nCols: cols,
    rotulos: Array.from(document.querySelectorAll('#md-choices .md-bd-head > span')).map(s => s.textContent.trim()).filter(Boolean),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    anchoCaja: Math.round((document.getElementById('md-choices') || {}).clientWidth || 0)
  };
});

const arrancar = async (pg, dtype) => {
  await pg.evaluate(() => goMock('solo'));
  await pg.waitForTimeout(300);
  await pg.selectOption('#md-dtype', dtype);
  await pg.selectOption('#md-teams', '12');
  await pg.selectOption('#md-budget', dtype === 'auction' ? '200' : '200').catch(() => { });
  await pg.click('#md-start-btn');
  await pg.waitForFunction(() => document.querySelector('#md-choices .md-bd-row'), { timeout: 90000 });
  await pg.waitForTimeout(900);
};

const evaluar = (etiqueta, r) => {
  const rotos = r.filas.filter(f => f.w > 0 && f.w < PISO);
  const cero = r.filas.filter(f => f.w === 0);
  const largos = r.filas.filter(f => f.lineas > MAX_LINEAS);
  const peor = r.filas.slice().sort((a, b) => b.lineas - a.lineas)[0];
  ok(etiqueta + ' la celda del nombre nunca queda a 0px', cero.length === 0,
    cero.length ? cero.length + ' de ' + r.filas.length + ' a 0px, p.ej. "' + cero[0].t + '"' : r.filas.length + ' filas, caja ' + r.anchoCaja + 'px');
  ok(etiqueta + ' la celda respeta el piso de ' + PISO + 'px', rotos.length === 0,
    rotos.length ? rotos.length + ' por debajo, el peor "' + rotos[0].t + '" con celda de ' + rotos[0].w + 'px' : '');
  // Check estructural: overflow-wrap:anywhere hace que el ancho minimo de
  // contenido del nombre sea UNA LETRA, y eso es lo que autoriza a la rejilla
  // a colapsar la pista a cero. Con break-word el minimo es la palabra mas
  // larga, que es un suelo de verdad.
  const anywhere = r.filas.filter(f => f.wrap === 'anywhere');
  ok(etiqueta + ' el nombre no usa overflow-wrap:anywhere', anywhere.length === 0,
    anywhere.length ? anywhere.length + ' filas con wrap=anywhere' : '');
  ok(etiqueta + ' ningun nombre pasa de ' + MAX_LINEAS + ' renglones', largos.length === 0,
    largos.length ? largos.length + ' se parten, el peor "' + peor.t + '" en ' + peor.lineas + ' renglones' : '');
  ok(etiqueta + ' cabecera y filas comparten plantilla',
    !!r.plantillaHead && r.plantillaHead === r.plantillaRow,
    r.plantillaHead === r.plantillaRow ? '' : 'head=' + r.plantillaHead + '\n      row =' + r.plantillaRow);
  ok(etiqueta + ' sin desborde horizontal de pagina', !r.overflowX, '');
};

// ── barrido de anchos en SUBASTA: la franja donde vivia el bug ─────────────
console.log('\n=== Tablero en subasta: barrido de anchos ===');
for (const W of [1920, 1600, 1500, 1440, 1366, 1280, 1100, 900, 700, 390]) {
  const pg = await b.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await pg.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await arrancar(pg, 'auction');
  const r = await medirTablero(pg);
  evaluar('(' + W + 'px auction)', r);
  // En una subasta la columna del dinero es el punto entero de la pantalla:
  // si hay que soltar columnas, AAV no es una de las que se sueltan.
  if (W > 700) ok('(' + W + 'px auction) conserva la columna AAV',
    r.rotulos.some(x => /AAV/i.test(x)), 'rotulos: ' + r.rotulos.join(', '));
  await pg.close();
}

// ── control: en snake el bug NUNCA se dio, y debe seguir sin darse ─────────
console.log('\n=== Tablero en snake: control ===');
for (const W of [1440, 1280, 390]) {
  const pg = await b.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
  await pg.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await arrancar(pg, 'snake');
  const r = await medirTablero(pg);
  evaluar('(' + W + 'px snake)', r);
  await pg.close();
}

// ── al reescalar la ventana: la plantilla tiene que seguir al contenedor ───
console.log('\n=== Reescalado en vivo ===');
{
  const pg = await b.newPage({ viewport: { width: 1920, height: 900 }, deviceScaleFactor: 1 });
  await pg.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await arrancar(pg, 'auction');
  for (const W of [1366, 1100, 1920]) {
    await pg.setViewportSize({ width: W, height: 900 });
    await pg.waitForTimeout(700);
    const r = await medirTablero(pg);
    evaluar('(resize a ' + W + 'px)', r);
  }
  await pg.close();
}

await b.close();
cerrar();
console.log('\n' + (fails ? fails + ' FALLOS' : 'ALL GREEN'));
process.exit(fails ? 1 : 0);
