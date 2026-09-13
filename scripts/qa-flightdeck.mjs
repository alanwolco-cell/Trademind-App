#!/usr/bin/env node
// Gate de COMPOSICION Flight Deck: los invariantes que el juez midio el
// 2026-09-12 y que ningun gate vigilaba, porque todos los demas miran
// funcionamiento (puertas, aritmetica, datos) y estos son de forma.
//
//   node scripts/qa-flightdeck.mjs
//   QA_BASE=https://macdraft.app node scripts/qa-flightdeck.mjs
//
// QUE MIDE Y POR QUE
//
// 1. NEGRO PURO. Regla dura del repo: el fondo nunca es #000. Se colaron dos
//    secciones de la portada con background:#000 a mano (1.842px a 1440) y
//    nadie lo vio en cinco sesiones. Un hex a mano es como se escapan.
// 2. VACIO BAJO EL FOOTER. En paginas cortas el footer se despegaba y quedaban
//    137px en /research, 204 en /hub y 306 en /sage: como el fondo de despues
//    es otro, el hueco se VE.
// 3. LA PISTA DE LOS RIELES. Un riel que esconde contenido sin decirlo no se
//    desliza, porque nadie sabe que hay mas. Y al reves: pintar la pista
//    cuando NO hay nada escondido es mentir. Las dos direcciones se miden, que
//    es lo que hace que el check valga.
// 4. ESTADOS VACIOS DEL HUB. Las tres pestanas eran lienzo muerto sin liga.
// 5. FUGA DE FALLBACK. Los controles de formulario no heredan la fuente: 19
//    elementos caian a Arial en un sitio que declara sus tres familias.
//
// Los anchos son los cuatro que importan: 320 y 390 porque ahi vive el
// usuario, 1280 y 1440 porque ahi mira el dueno.
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

const PORT = process.env.QA_PORT || 3219;
const BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
let srv = null;
if (!process.env.QA_BASE) {
  srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
    { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { } await new Promise(r => setTimeout(r, 500)); }
}
const cerrar = () => { if (srv) try { srv.kill(); } catch (_) { } };

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };
const seguro = async (pg, fn, arg) => {
  try { return await pg.evaluate(fn, arg); } catch (e) { return { _err: String(e).slice(0, 160) }; }
};

const errsConsola = [];
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /sleepercdn/];
const b = await chromium.launch();

async function abrir(w, h, rutaApp) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 });
  const pg = await ctx.newPage();
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (RUIDO.some(r => r.test(m.text()) || r.test(url))) return;
    errsConsola.push(w + rutaApp + ': ' + m.text().slice(0, 110));
  });
  pg.on('pageerror', e => errsConsola.push(w + rutaApp + ' PAGEERROR ' + String(e).slice(0, 140)));
  await pg.goto(BASE + rutaApp, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(3000);
  // los paneles .reveal entran con IntersectionObserver: sin recorrer la pagina
  // se quedan a opacidad 0 y la medicion habla de un hueco que no existe.
  await pg.evaluate(async () => {
    const a = document.documentElement.scrollHeight;
    for (let y = 0; y < a; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
    scrollTo(0, 0);
  });
  await pg.waitForTimeout(500);
  return { ctx, pg };
}

const NEGRO = () => {
  let px = 0; const quien = [];
  document.querySelectorAll('section,div,footer,main,body,article').forEach(e => {
    if (getComputedStyle(e).backgroundColor !== 'rgb(0, 0, 0)') return;
    const r = e.getBoundingClientRect();
    if (r.height < 80) return;
    px += Math.round(r.height);
    quien.push(((e.className || '') + '').split(' ').slice(0, 2).join('.') || e.tagName);
  });
  return { px, quien: [...new Set(quien)].slice(0, 4) };
};

const PIE = () => {
  const f = [...document.querySelectorAll('footer')].filter(e => e.getBoundingClientRect().height > 30).pop();
  if (!f) return null;
  const doc = Math.round(document.documentElement.scrollHeight);
  return { hueco: Math.max(0, doc - Math.round(f.getBoundingClientRect().bottom + scrollY)), doc, vp: Math.round(innerHeight) };
};

const ARIAL = () => {
  const mal = [];
  document.querySelectorAll('button,input,select,textarea,option').forEach(e => {
    if (/^(Arial|Helvetica|"Times|Times)/i.test(getComputedStyle(e).fontFamily)) {
      mal.push((e.textContent || e.value || e.tagName).trim().slice(0, 20));
    }
  });
  return { n: mal.length, muestra: [...new Set(mal)].slice(0, 5) };
};

const RIELES = () => {
  const out = [];
  document.querySelectorAll('.inner-tab-bar,#sage-suggestions,#home-analyst-row').forEach(el => {
    if (!el.offsetParent) return;                       // invisible: no se mide
    const esconde = el.scrollWidth - el.clientWidth > 4;
    const cs = getComputedStyle(el);
    const mask = (cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none');
    out.push({
      id: el.id || ((el.className || '') + '').split(' ')[0],
      esconde, pista: !!mask, clase: el.classList.contains('riel')
    });
  });
  return out;
};

console.log('== FLIGHT DECK: composicion ==  ' + BASE + '\n');
const RUTAS = ['/', '/sage', '/research', '/hub'];
const ANCHOS = [[320, 844], [390, 844], [1280, 900], [1440, 900]];

for (const [w, h] of ANCHOS) {
  for (const r of RUTAS) {
    const { ctx, pg } = await abrir(w, h, r);
    const negro = await seguro(pg, NEGRO);
    ok(`(1) ${r} a ${w}: cero fondo en negro PURO`,
      negro && negro.px === 0, JSON.stringify(negro));

    const pie = await seguro(pg, PIE);
    // Solo tiene sentido en paginas CORTAS: en una larga el footer cae donde cae.
    if (pie && pie.doc <= pie.vp + 80) {
      ok(`(2) ${r} a ${w}: pagina corta, el footer llega al fondo`,
        pie.hueco <= 4, JSON.stringify(pie));
    }

    const rieles = await seguro(pg, RIELES);
    if (Array.isArray(rieles)) {
      const mudos = rieles.filter(x => x.esconde && !x.pista);
      const mentirosos = rieles.filter(x => !x.esconde && x.pista);
      ok(`(3a) ${r} a ${w}: todo riel que esconde algo lo DECLARA`,
        mudos.length === 0, JSON.stringify(rieles));
      // CONTROL NEGATIVO: sin esto, pintar la pista SIEMPRE pasaria (3a).
      ok(`(3b) ${r} a ${w}: CONTROL, el riel que no esconde nada no pinta pista`,
        mentirosos.length === 0, JSON.stringify(rieles));
    }

    const arial = await seguro(pg, ARIAL);
    ok(`(5) ${r} a ${w}: ningun control cae a la fuente del sistema`,
      arial && arial.n === 0, JSON.stringify(arial));
    await ctx.close();
  }
}

// (4) los tres paneles del hub sin liga abierta
{
  const { ctx, pg } = await abrir(390, 844, '/hub');
  const tabs = await seguro(pg, () => {
    const out = {};
    ['tab-hub-booth', 'tab-hub-history', 'tab-hub-market'].forEach(id => {
      const el = document.getElementById(id);
      out[id] = el ? (el.textContent || '').trim().length : -1;
    });
    return out;
  });
  const vals = Object.values(tabs);
  ok('(4) las tres pestanas del hub dicen que habria ahi, no lienzo muerto',
    vals.length === 3 && vals.every(v => v > 80), JSON.stringify(tabs));
  await ctx.close();
}

// (6) el resumen de la semana de Leagues cabe ENTERO en el escalon minimo.
// Bloqueante de la relectura del juez (13-sep): a 320 el aro (118px) + la
// lista (minmax 190px) empujaban "4 of 6" y "Last Call" fuera del viewport,
// sin scroll posible: informacion eliminada. A 320 el bloque se apila.
{
  const { ctx, pg } = await abrir(320, 844, '/myleagues?demo=1');
  await pg.waitForSelector('.ml-week', { timeout: 60000 }).catch(() => { });
  const semana = await seguro(pg, () => {
    const filas = Array.from(document.querySelectorAll('.ml-week-row b'));
    if (!filas.length) return { filas: 0 };
    const fuera = filas.filter(b => {
      const r = b.getBoundingClientRect();
      return r.right > window.innerWidth + 1 || r.width === 0;
    }).map(b => b.textContent.trim());
    return { filas: filas.length, fuera, scrollX: document.documentElement.scrollWidth > window.innerWidth };
  });
  ok('(6) a 320, las cifras del resumen semanal son alcanzables (4 of 6, Last Call)',
    semana && semana.filas >= 2 && semana.fuera.length === 0 && !semana.scrollX,
    JSON.stringify(semana));
  await ctx.close();
}

ok('(z) consola limpia', errsConsola.length === 0, errsConsola.slice(0, 4).join(' | '));

await b.close();
cerrar();
console.log('\n' + (fails ? fails + ' FALLOS' : 'ALL GREEN'));
process.exit(fails ? 1 : 0);
