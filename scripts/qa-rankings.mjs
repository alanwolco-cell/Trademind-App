#!/usr/bin/env node
// Gate de My Rankings. Corre contra el navegador REAL, no contra un stub: la
// mitad de lo que hay que proteger aqui (que el nombre no se trunque, que la
// consola quede limpia, que 390px no desborde) no existe fuera de un layout de
// verdad.
//
//   node scripts/qa-rankings.mjs            # arranca su propio servidor
//   QA_BASE=http://localhost:3210 node scripts/qa-rankings.mjs
//
// Playwright NO esta en package.json a proposito: su postinstall se baja los
// navegadores y eso entraria en cada build de Vercel. El script lo resuelve de
// donde ya exista en la maquina. Si no lo encuentra, dice como instalarlo.
//
// El check (b) es un CONTROL NEGATIVO: con la casilla apagada el board NO puede
// pintar mi puesto. Sin el, (c) pasaria aunque el puente estuviera cableado al
// reves, que es justo la clase de test-adorno que este repo no acepta.
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

const PORT = process.env.QA_PORT || 3211;
let BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
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

// Los dos errores de consola del entorno local: el script de insights de Vercel
// no existe fuera de Vercel y /api/odds/implied necesita ODDS_API_KEY. En
// produccion los dos devuelven 200, verificado por curl.
const KNOWN = [/_vercel\/insights/, /odds\/implied/, /503 \(Service/, /404 \(Not Found\)/];
let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };
const abrirTab = async pg => {
  await pg.evaluate(() => switchScreen('research'));
  await pg.waitForTimeout(350);
  await pg.evaluate(() => {
    const t = Array.from(document.querySelectorAll('#screen-research .inner-tab')).find(x => /My Rankings/i.test(x.textContent));
    if (t) t.click();
  });
  await pg.waitForFunction(() => document.querySelectorAll('#rk-body .rk-row').length > 0, { timeout: 30000 });
};
const b = await chromium.launch();
async function nueva(w, h) {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error' && !KNOWN.some(r => r.test(m.text()))) errs.push(m.text().slice(0, 140)); });
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 140)));
  await pg.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  return { pg, errs };
}

console.log('\n=== My Rankings: la lista ===');
// ── escritorio ──────────────────────────────────────────────────────────
{
  const { pg, errs } = await nueva(1440, 950);
  await abrirTab(pg);
  const n = await pg.$$eval('#rk-body .rk-row', r => r.length);
  ok('(a) la lista carga jugadores', n > 100, n + ' filas');

  const tiers = await pg.$$eval('#rk-body .rk-tier', r => r.length);
  ok('(b) arranca con Tier 1 pintado', tiers >= 1, tiers + ' rotulos de tier');

  const primeros = await pg.$$eval('#rk-body .rk-row .rk-name', r => r.slice(0, 3).map(x => x.textContent));
  // mover el 3ro arriba dos veces y comprobar que queda 1ro
  await pg.evaluate(() => { tmrMove(2, -1); tmrMove(1, -1); });
  await pg.waitForTimeout(150);
  const tras = await pg.$$eval('#rk-body .rk-row .rk-name', r => r.slice(0, 3).map(x => x.textContent));
  ok('(c) reordenar cambia el orden', tras[0] === primeros[2], `${primeros.join(' / ')}  ->  ${tras.join(' / ')}`);

  // persistencia: recargar y comprobar que el orden sobrevive
  await pg.reload({ waitUntil: 'networkidle' });
  await pg.evaluate(() => switchScreen('research'));
  await pg.waitForTimeout(300);
  await pg.evaluate(() => {
    const t = Array.from(document.querySelectorAll('#screen-research .inner-tab')).find(x => /My Rankings/i.test(x.textContent));
    if (t) t.click();
  });
  await pg.waitForFunction(() => document.querySelectorAll('#rk-body .rk-row').length > 0, { timeout: 30000 });
  const trasReload = await pg.$$eval('#rk-body .rk-row .rk-name', r => r.slice(0, 3).map(x => x.textContent));
  ok('(d) el orden sobrevive a recargar', trasReload[0] === tras[0], `esperaba ${tras[0]}, salio ${trasReload[0]}`);

  // corte de tier
  const idPrimero = await pg.$eval('#rk-body .rk-row', r => r.getAttribute('data-id'));
  await pg.evaluate(id => tmrCut(id), idPrimero);
  await pg.waitForTimeout(120);
  const tiers2 = await pg.$$eval('#rk-body .rk-tier', r => r.length);
  ok('(e) cortar tier crea un tier nuevo', tiers2 > tiers, `${tiers} -> ${tiers2}`);

  // El delta contra el consenso se pinta en TODAS las filas visibles, no solo
  // en las movidas: antes solo aparecia cuando era distinto de cero, asi que
  // una lista recien abierta escondia la unica cifra que dice algo.
  const filas = await pg.$$eval('#rk-body .rk-row', r => r.length);
  const deltas = await pg.$$eval('#rk-body .rk-vs', r => r.length);
  ok('(f) el delta contra el consenso se pinta en todas las filas', deltas === filas,
    deltas + ' deltas para ' + filas + ' filas');
  // $$eval y no $eval: si el elemento no existe, $eval LANZA y se lleva por
  // delante los checks que vienen detras. Un gate que revienta esconde mas de
  // lo que ensena.
  const movido = await pg.$$eval('#rk-body .rk-row .rk-vs', r => r.length ? r[0].textContent.trim() : null);
  ok('(f2) tras mover, el delta deja de ser cero', /^[+-]\d+$/.test(movido || ''), 'primera fila: ' + JSON.stringify(movido));

  // La cabecera de columnas cae a plomo sobre las columnas de la fila. Es lo
  // unico que distingue una rejilla de verdad de seis cifras sueltas: si se
  // descuadra, POS queda encima de los ADP y nadie sabe que es cada numero.
  const plomo = await pg.evaluate(() => {
    const row = document.querySelector('#rk-body .rk-row');
    const head = document.querySelector('#rk-body .rk-colhead');
    if (!row || !head) return null;
    const R = (p, sel) => { const e = p.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
    const pares = [
      ['pos', R(head, '.rk-ch-pr'), R(row, '.rk-posrank'), 'left'],
      ['adp', R(head, '.rk-ch-adp'), R(row, '.rk-adp'), 'right'],
      ['vs', R(head, '.rk-ch-vs'), R(row, '.rk-vs'), 'right']
    ];
    return pares.map(([n, h, c, lado]) => {
      if (!h || !c) return n + ': falta';
      const d = Math.abs(h[lado] - c[lado]);
      return d <= 2 ? null : n + ' desviado ' + Math.round(d) + 'px';
    }).filter(Boolean);
  });
  ok('(s) la cabecera cae a plomo sobre sus columnas', plomo && plomo.length === 0,
    plomo === null ? 'no hay cabecera' : (plomo.join(' | ') || 'pos, adp y vs alineados'));

  // Foto en cada fila, con el id de Sleeper. Sin esto la fila vuelve a ser
  // texto plano, que es de lo que venia.
  const fotos = await pg.$$eval('#rk-body .rk-row .rk-pic img',
    r => r.filter(x => /sleepercdn\.com\/content\/nfl\/players\/thumb\/\d+\.jpg/.test(x.getAttribute('src'))).length);
  ok('(t) cada fila lleva la foto del jugador', fotos === filas, fotos + ' fotos para ' + filas + ' filas');

  // El rank por posicion sale de MI orden, no del consenso: el primer WR de mi
  // lista es WR1 aunque el consenso lo tenga tercero.
  const posRank = await pg.evaluate(() => {
    const cuenta = {}; const malos = [];
    document.querySelectorAll('#rk-body .rk-row').forEach(fila => {
      const ep = fila.querySelector('.rk-pos'), en = fila.querySelector('.rk-posn');
      if (!ep || !en) { malos.push('fila sin rank por posicion'); return; }
      const pos = ep.textContent;
      cuenta[pos] = (cuenta[pos] || 0) + 1;
      if (Number(en.textContent) !== cuenta[pos]) malos.push(pos + en.textContent + ' deberia ser ' + pos + cuenta[pos]);
    });
    return malos.slice(0, 3);
  });
  ok('(u) el rank por posicion cuenta sobre mi lista', posRank.length === 0, posRank.join(' | ') || 'correlativo por posicion');

  // La banda de tier declara cuantos jugadores tiene, y ese numero es el de
  // filas VISIBLES: con un filtro puesto, decir 200 encima de tres seria mentir.
  // Se suman TODAS las bandas: aqui arriba ya se corto un tier, asi que mirar
  // solo la primera compararia "1 player" contra las 200 filas de la pantalla.
  const conteo = await pg.evaluate(() => {
    const bandas = Array.from(document.querySelectorAll('#rk-body .rk-tier .rk-tier-c'));
    return {
      bandas: bandas.length,
      suma: bandas.reduce((a, e) => a + Number(e.textContent.replace(/\D/g, '') || 0), 0),
      filas: document.querySelectorAll('#rk-body .rk-row').length
    };
  });
  ok('(v) las bandas de tier declaran su conteo real', conteo.bandas > 0 && conteo.suma === conteo.filas,
    JSON.stringify(conteo));

  // filtro
  await pg.evaluate(() => tmrFilter('QB', document.querySelector('#rk-filters .rk-fb')));
  await pg.waitForTimeout(120);
  const soloQb = await pg.$$eval('#rk-body .rk-row .rk-pos', r => r.every(x => x.textContent === 'QB') && r.length > 0);
  ok('(g) el filtro por posicion filtra', soloQb);
  await pg.evaluate(() => tmrFilter('ALL', document.querySelector('#rk-filters .rk-fb')));

  ok('(h) consola limpia en escritorio', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.screenshot({ path: '/tmp/qa-rk-desktop.png' });
  await pg.close();
}

// ── movil 390px ─────────────────────────────────────────────────────────
{
  const { pg, errs } = await nueva(390, 844);
  await abrirTab(pg);
  const desborde = await pg.evaluate(() => document.documentElement.scrollWidth);
  ok('(i) 390px sin desborde horizontal', desborde <= 390, 'scrollWidth ' + desborde);

  const fuera = await pg.evaluate(() => {
    const malos = [];
    document.querySelectorAll('#tab-rankings *').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && (r.right > 391 || r.left < -1)) malos.push((e.className || e.tagName) + ' right=' + Math.round(r.right));
    });
    return malos.slice(0, 3);
  });
  ok('(j) ningun elemento se sale del viewport movil', fuera.length === 0, fuera.join(' | '));

  // nombres nunca truncados: ningun nodo de nombre puede estar recortado
  const cortados = await pg.evaluate(() => {
    const malos = [];
    document.querySelectorAll('#rk-body .rk-name').forEach(e => {
      if (e.scrollWidth > e.clientWidth + 1) malos.push(e.textContent);
    });
    return malos.slice(0, 5);
  });
  ok('(k) ningun nombre truncado a 390px', cortados.length === 0, cortados.join(' | '));

  const alto = await pg.evaluate(() => {
    const b = document.querySelectorAll('#rk-body .rk-ib');
    return Array.from(b).every(x => x.getBoundingClientRect().height >= 30);
  });
  ok('(l) botones tocables (>=30px) en movil', alto);

  ok('(m) consola limpia en movil', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.screenshot({ path: '/tmp/qa-rk-mobile.png', fullPage: false });
  await pg.close();
}


console.log('\n=== My Rankings: el puente al board del mock ===');
{
  const { pg, errs } = await nueva(1440, 950);
  await abrirTab(pg);
  const subido = await pg.evaluate(() => {
    const nombre = TMR.rows[39].name;
    TMR.rows.unshift(TMR.rows.splice(39, 1)[0]);
    tmrSave(); tmrPaint();
    return nombre;
  });
  ok('(n) subo un jugador del puesto 40 al 1', !!subido, subido);

  await pg.evaluate(() => tmrToggleUse(false));
  await pg.evaluate(() => switchScreen('mock'));
  await pg.waitForTimeout(500);
  await pg.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('md-dtype', 'snake'); set('md-teams', '12'); set('md-rounds', '15'); set('md-slot', '1'); set('md-clock', '0');
  });
  await pg.evaluate(() => startMockDraft());
  await pg.waitForFunction(() => document.querySelectorAll('#md-choices .md-bd-row').length > 0, { timeout: 40000 });

  const apagado = await pg.$$eval('#md-choices .md-bd-my', r => r.length);
  ok('(o) CONTROL NEGATIVO: casilla apagada, el board no pinta mi puesto', apagado === 0, apagado + ' marcas (esperado 0)');

  await pg.evaluate(() => { tmrToggleUse(true); mdFilterChoices(); });
  await pg.waitForTimeout(400);
  const encendido = await pg.$$eval('#md-choices .md-bd-my', r => r.length);
  ok('(p) casilla encendida: el board pinta mi puesto', encendido > 0, encendido + ' marcas');

  const txt = await pg.$eval('#md-choices .md-bd-my', e => e.textContent);
  ok('(q) la marca lleva el numero de MI lista', /MY\s*#\d+/.test(txt.replace(/ /g, ' ')), JSON.stringify(txt));

  ok('(r) consola limpia con el puente activo', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

await b.close();
cerrar();
console.log('\n' + (fails ? fails + ' CHECKS FALLARON' : 'RANKINGS ALL GREEN'));
process.exit(fails ? 1 : 0);
