#!/usr/bin/env node
// Gate del HUB DE LIGA: la pantalla compartida que abre un codigo.
//
//   node scripts/qa-hub.mjs
//
// QUE MIDE Y POR QUE
//
// 1. DOS NAVEGADORES DE VERDAD. Un hub que solo se prueba con una pestana no
//    prueba nada: todo lo que importa aqui (reclamar equipo, no poder robarlo,
//    votar el trade de otro) solo existe entre dos personas distintas. Cada
//    contexto tiene su propia llave de cuenta, que es como la app distingue a
//    la gente.
// 2. LAS REGLAS DEL MERCADO son permisos, no adornos: quien no tiene equipo no
//    publica ni vota, y quien esta dentro del trade no vota el suyo. Cada una
//    tiene su control negativo.
// 3. LA PREVIA DEL ENLACE se sirve desde el servidor y lleva texto que escribio
//    un desconocido en Sleeper. Hay un canario con un nombre de liga malicioso:
//    si algun dia alguien "simplifica" el escapado, este check se pone rojo.
// 4. LA HISTORIA que se pinta tiene que ser la del documento, campeon por
//    campeon, no un adorno con forma de tabla.
//
// El hub sale de un fixture (scripts/fixtures/hub-liga-*.json) escrito en el
// almacen LOCAL, asi que la corrida no toca el Blob real ni depende de que una
// liga de Sleeper siga existiendo. El unico check que sale a la red es el de la
// ingesta, que es justo lo que no se puede fingir.
'use strict';
import { spawn } from 'node:child_process';
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

const PORT = process.env.QA_PORT || 3218;
const BASE = 'http://localhost:' + PORT;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-hub-'));
const CODE = 'QAHUB2';
const LIGA_REAL = process.env.QA_LEAGUE || '1312071398390259712';

// El fixture entra al almacen antes de levantar el servidor.
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/hub-liga-2026-09-08.json'), 'utf8'));
fs.writeFileSync(path.join(DIR, CODE + '.json'), JSON.stringify(fixture));
// Canario del escapado: una liga cuyo nombre es un intento de inyeccion.
const cebo = JSON.parse(JSON.stringify(fixture));
cebo.code = 'QAXSS2';
cebo.name = '"><script>alert(1)</script><b x="';
cebo.rosters[0].owner = '"><img src=x onerror=alert(2)>';
fs.writeFileSync(path.join(DIR, 'QAXSS2.json'), JSON.stringify(cebo));

const PROPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/odds-props-2026-09-08.json'), 'utf8')).props;

// PREVUELO. Si el puerto ya contesta, el servidor que levantemos NO podra
// atarse y los checks mediran un proceso ajeno con otro almacen: eso produce
// fallos que no existen y esconde los que si. Se aborta con un mensaje claro
// en vez de dar un veredicto sobre lo que no es.
try {
  const ajeno = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) });
  if (ajeno && ajeno.ok) {
    console.error('El puerto ' + PORT + ' ya esta ocupado por otro servidor.\n' +
      'Cierra ese proceso o corre con QA_PORT=otro. Sin esto, el gate mediria una app distinta.');
    process.exit(2);
  }
} catch (_) { /* nadie contesta: el puerto esta libre, que es lo que queremos */ }

const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), LIGA_STORE: 'local', LIGA_DIR: DIR },
  // QA_SRV_LOG=1 deja ver el servidor: sin eso, un 500 del backend es una caja negra.
  stdio: process.env.QA_SRV_LOG ? 'inherit' : 'ignore'
});
let vivo = false;
for (let i = 0; i < 40; i++) {
  try {
    // No basta con que algo conteste: tiene que ser NUESTRO servidor, el que
    // ve el fixture que acabamos de escribir.
    const r = await fetch(BASE + '/api/liga/' + CODE);
    if (r.ok) { const d = await r.json(); if (d.found && d.hub && d.hub.code === CODE) { vivo = true; break; } }
  } catch (_) { }
  await new Promise(r => setTimeout(r, 500));
}
if (!vivo) {
  console.error('El servidor no levanto con el fixture a la vista. Nada que medir.');
  try { srv.kill(); } catch (_) { }
  process.exit(2);
}
const limpiar = () => { try { srv.kill(); } catch (_) { } try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) { } };

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };
const seguro = async (pg, fn, arg) => {
  try { return await pg.evaluate(fn, arg); } catch (e) { return { _err: String(e).slice(0, 160) }; }
};
const clic = async (pg, sel) => {
  try { const el = await pg.$(sel); if (!el) return false; await el.click({ timeout: 4000 }); return true; }
  catch (e) { return false; }
};

const errsConsola = [];
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/];
const b = await chromium.launch();

// Cada persona es un contexto con SU llave: es lo que hace que "reclamado por
// otro" signifique algo.
async function persona(llave, w, h, movil) {
  const ctx = await b.newContext({
    viewport: { width: w || 1400, height: h || 900 },
    ...(movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {})
  });
  const pg = await ctx.newPage();
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (RUIDO.some(r => r.test(m.text()) || r.test(url))) return;
    errsConsola.push(m.text().slice(0, 130) + (url ? ' <- ' + url.slice(0, 70) : ''));
  });
  pg.on('pageerror', e => errsConsola.push('PAGEERROR ' + String(e).slice(0, 160)));
  await pg.addInitScript(([k, P]) => {
    try { localStorage.setItem('tm_acct', k); localStorage.setItem('tm_username', 'wolco'); } catch (e) { }
    window._ML_PROPS_FIXTURE = P;
  }, [llave, PROPS]);
  return { ctx, pg };
}
async function abrirHub(pg, code) {
  await pg.goto(BASE + '/hub?c=' + code, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 60; i++) {
    const r = await seguro(pg, () => !!(window.HUB && HUB.ready && HUB.doc));
    if (r === true) return true;
    await pg.waitForTimeout(500);
  }
  return false;
}

console.log('== HUB DE LIGA ==  ' + BASE + '\n');

/* ------------------------------------------------------- persona 1: comish */
const p1 = await persona('qa_hub_uno_aaaaaaaaaaaaaaaaaaaaaa');
{
  const { pg } = p1;
  const cargo = await abrirHub(pg, CODE);
  ok('(a) el hub abre con el codigo en la URL', cargo === true);

  const cab = await seguro(pg, () => ({
    liga: (document.querySelector('.hb-title h2') || {}).textContent,
    codigo: (document.querySelector('.hb-code b') || {}).textContent,
    filas: document.querySelectorAll('.hb-row').length,
    lineas: document.querySelectorAll('.hb-line').length,
    equipos: document.querySelectorAll('.hb-team').length
  }));
  ok('(b) pinta la liga, su codigo y un puesto por equipo',
    cab.liga === 'Dynasty' && cab.codigo === CODE && cab.filas === 10, JSON.stringify(cab));
  ok('(c) cada equipo del ranking lleva su linea de Mac', cab.lineas === cab.filas,
    JSON.stringify(cab));
  ok('(d) sin equipo reclamado, ofrece los diez para reclamar', cab.equipos === 10,
    JSON.stringify(cab));

  // El ranking tiene que estar ORDENADO por su propio numero. Un ranking que no
  // ordena es una lista.
  const orden = await seguro(pg, () => (HUB.rank || []).map(x => x.score));
  ok('(e) el ranking va de mayor a menor por su puntaje',
    Array.isArray(orden) && orden.length === 10 && orden.every((v, i) => i === 0 || orden[i - 1] >= v),
    JSON.stringify(orden && orden.map ? orden.map(x => Math.round(x * 100) / 100) : orden));

  // Reclamar
  const reclamo = await seguro(pg, async () => {
    await hbClaim(3);
    await new Promise(r => setTimeout(r, 900));
    return { mio: HUB.myTeamId, quedan: document.querySelectorAll('.hb-team').length };
  });
  ok('(f) reclamar un equipo lo deja como tuyo y cierra el selector',
    reclamo.mio === 3 && reclamo.quedan === 0, JSON.stringify(reclamo));
}

/* ------------------------------------------------------ persona 2: miembro */
const p2 = await persona('qa_hub_dos_bbbbbbbbbbbbbbbbbbbbbb', 390, 844, true);
{
  const { pg } = p2;
  const cargo = await abrirHub(pg, CODE);
  ok('(g) el segundo navegador abre el mismo hub', cargo === true);

  const ve = await seguro(pg, () => ({
    tomados: document.querySelectorAll('.hb-team.is-taken').length,
    libres: document.querySelectorAll('.hb-team:not(.is-taken)').length,
    mio: HUB.myTeamId
  }));
  ok('(h) CONTROL: ve el equipo del otro como reclamado y no como suyo',
    ve.tomados === 1 && ve.libres === 9 && ve.mio === null, JSON.stringify(ve));

  const robo = await seguro(pg, async () => {
    const r = await fetch('/api/liga/' + 'QAHUB2' + '/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: 3 })
    });
    return await r.json();
  });
  ok('(i) CONTROL: no se puede robar un equipo ya reclamado',
    robo && robo.ok === false && robo.taken === true, JSON.stringify(robo));

  const sinEquipo = await seguro(pg, () => /Claim your team/.test(
    (document.getElementById('hub-market-body') || {}).textContent || ''));
  const abrio = await clic(pg, '#screen-hub .inner-tab[data-tab="tab-hub-market"]');
  ok('(j) la pestana Market existe', abrio === true);
  ok('(k) CONTROL: sin equipo, el mercado pide reclamar antes de publicar',
    sinEquipo === true);

  const reclamo2 = await seguro(pg, async () => {
    await hbClaim(5);
    await new Promise(r => setTimeout(r, 900));
    return HUB.myTeamId;
  });
  ok('(l) el segundo reclama otro equipo', reclamo2 === 5, JSON.stringify(reclamo2));

  const desborde = await seguro(pg, () => ({
    scroll: document.documentElement.scrollWidth,
    fuera: [...document.querySelectorAll('#screen-hub *')].filter(e => e.getBoundingClientRect().right > 391).length
  }));
  ok('(m) a 390px el hub no desborda', desborde.scroll <= 390 && desborde.fuera === 0,
    JSON.stringify(desborde));
}

/* ------------------------------------------------------------- el mercado */
{
  const { pg } = p1;
  await abrirHub(pg, CODE);
  const publico = await seguro(pg, async () => {
    const r = await fetch('/api/liga/QAHUB2/block', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selling: ['4034'], wanting: [], note: 'testing the market' })
    });
    const d = await r.json();
    HUB.doc = d.hub; hbPaintMarket();
    return { ok: d.ok, bloques: document.querySelectorAll('.hb-blk').length };
  });
  ok('(n) con equipo, publicar en el block funciona y se pinta',
    publico.ok === true && publico.bloques === 1, JSON.stringify(publico));

  const prop = await seguro(pg, async () => {
    const r = await fetch('/api/liga/QAHUB2/proposal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTeamId: 5, give: ['4034'], get: ['6794'], note: 'trato' })
    });
    const d = await r.json();
    HUB.doc = d.hub; hbPaintMarket();
    const p = d.hub.proposals[d.hub.proposals.length - 1];
    return { ok: d.ok, id: p && p.id, pintadas: document.querySelectorAll('.hb-prop').length };
  });
  ok('(o) proponer un trade lo publica para toda la liga',
    prop.ok === true && prop.pintadas === 1, JSON.stringify(prop));

  const voto = await seguro(pg, async (id) => {
    const r = await fetch('/api/liga/QAHUB2/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, vote: 'no' })
    });
    return await r.json();
  }, prop.id);
  ok('(p) CONTROL: quien esta dentro del trade no vota su propio trade',
    voto && voto.ok === false && voto.involved === true, JSON.stringify(voto));

  // Un tercero con equipo SI puede votar.
  const p3 = await persona('qa_hub_tres_cccccccccccccccccccccc');
  await abrirHub(p3.pg, CODE);
  const votoBueno = await seguro(p3.pg, async (id) => {
    await hbClaim(7);
    await new Promise(r => setTimeout(r, 700));
    const r = await fetch('/api/liga/QAHUB2/vote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, vote: 'yes' })
    });
    const d = await r.json();
    const p = (d.hub.proposals || []).filter(x => x.id === id)[0];
    return { ok: d.ok, votos: p ? Object.keys(p.votes || {}).length : 0 };
  }, prop.id);
  ok('(q) un tercero con equipo si vota, y el voto queda',
    votoBueno.ok === true && votoBueno.votos === 1, JSON.stringify(votoBueno));
  await p3.ctx.close();
}

/* --------------------------------------------------------------- historia */
{
  const { pg } = p1;
  await abrirHub(pg, CODE);
  const abrio = await clic(pg, '#screen-hub .inner-tab[data-tab="tab-hub-history"]');
  ok('(r) la pestana History existe', abrio === true);
  await pg.waitForTimeout(600);
  const hist = await seguro(pg, () => {
    const doc = HUB.doc;
    const esperados = (doc.historia || []).map(t => {
      const c = (t.standings || []).filter(s => s.teamId === t.champion)[0];
      return c ? c.owner : null;
    }).filter(Boolean);
    const pintados = [...document.querySelectorAll('.hb-champ')].map(x => x.textContent);
    return {
      temporadas: document.querySelectorAll('.hb-season').length,
      esperadas: (doc.historia || []).length,
      esperados, pintados,
      anillos: document.querySelectorAll('.hb-cup').length
    };
  });
  ok('(s) pinta una temporada por cada una del documento',
    hist.temporadas === hist.esperadas && hist.temporadas > 0, JSON.stringify(hist));
  ok('(t) el campeon pintado es el del documento, no un adorno',
    Array.isArray(hist.esperados) && hist.esperados.length > 0
    && hist.esperados.every(n => (hist.pintados || []).indexOf(n) !== -1), JSON.stringify(hist));
  ok('(u) el palmares cuenta anillos', hist.anillos > 0, JSON.stringify(hist));
}

/* ------------------------------------------------- la previa del enlace */
{
  const r = await fetch(BASE + '/hub?c=' + CODE);
  const html = await r.text();
  const t = /<meta property="og:title" content="([^"]*)"/.exec(html);
  const d = /<meta property="og:description" content="([^"]*)"/.exec(html);
  ok('(v) el enlace del hub lleva el nombre de LA LIGA, no el de la portada',
    !!t && /Dynasty/.test(t[1]) && !/Mock Draft That Drafts/.test(t[1]), t && t[1]);
  ok('(w) la descripcion dice que hay dentro y el codigo',
    !!d && /10 teams/.test(d[1]) && new RegExp(CODE).test(d[1]), d && d[1]);

  const r2 = await fetch(BASE + '/hub?c=ZZZZZZ');
  const html2 = await r2.text();
  // El titulo por defecto cambia con el posicionamiento del producto (paso el
  // 2026-09-09 al esconder los mock drafts). Lo que este control mide no es una
  // frase concreta: es que un codigo inexistente NO reciba una previa de liga.
  const t2 = /<meta property="og:title" content="([^"]*)"/.exec(html2);
  ok('(x) CONTROL: un codigo que no existe cae en la previa de siempre',
    !!t2 && !/ on Mac Draft$/.test(t2[1]) && /Mac Draft/.test(t2[1]), t2 && t2[1]);

  // CANARIO del escapado. Si alguien "simplifica" attrSeguro, esto se pone rojo
  // antes de que el XSS llegue a produccion.
  const r3 = await fetch(BASE + '/hub?c=QAXSS2');
  const html3 = await r3.text();
  const cabeza = html3.slice(0, html3.indexOf('</head>'));
  ok('(y) CANARIO: un nombre de liga malicioso sale escapado, no ejecutable',
    cabeza.indexOf('<script>alert(1)') === -1 && cabeza.indexOf('onerror=alert(2)') === -1
    && /&lt;script&gt;/.test(cabeza),
    'script suelto=' + (cabeza.indexOf('<script>alert(1)') !== -1));
}

/* ----------------------------------------------------- la ingesta de verdad */
{
  // El unico check que sale a la red: crear un hub desde una liga real, con su
  // historia. Es lo que no se puede fingir con un fixture.
  // Este es el UNICO check que depende de la red. Una caida momentanea de
  // Sleeper lo pondria rojo sin que nada del producto este mal, y un gate que
  // falla al azar es peor que uno rojo: te acostumbra a ignorarlo. Se reintenta
  // dos veces, y si aun asi falla, el mensaje dice que fue la red.
  async function crear(llave) {
    let ultima = null;
    for (let intento = 0; intento < 3; intento++) {
      try {
        const r = await fetch(BASE + '/api/liga/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tm-acct': llave },
          body: JSON.stringify({ leagueId: LIGA_REAL })
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.code) return { r, d, intentos: intento + 1 };
        ultima = { r, d, intentos: intento + 1 };
      } catch (e) {
        ultima = { r: { ok: false, status: 0 }, d: { error: 'red: ' + String(e.message).slice(0, 80) }, intentos: intento + 1 };
      }
      await new Promise(x => setTimeout(x, 1500));
    }
    return ultima;
  }
  const { r, d, intentos } = await crear('qa_hub_ingesta_dddddddddddddddddd');
  ok('(z1) crear un hub desde una liga real devuelve codigo y equipos',
    r.ok && /^[A-Z2-9]{6}$/.test(d.code || '') && d.hub && d.hub.rosters.length > 0,
    JSON.stringify({ code: d.code, rosters: d.hub && d.hub.rosters.length, store: d.store, err: d.error, intentos }));
  ok('(z2) la ingesta trae temporadas pasadas con su tabla',
    d.hub && Array.isArray(d.hub.historia) && d.hub.historia.length > 0
    && (d.hub.historia[0].standings || []).length > 0,
    JSON.stringify({ temporadas: d.hub && d.hub.historia && d.hub.historia.length }));

  // Compartir dos veces la misma liga no puede partir la conversacion en dos.
  const { d: d2 } = await crear('qa_hub_ingesta_eeeeeeeeeeeeeeeeee');
  ok('(z3) CONTROL: compartir la misma liga dos veces devuelve el MISMO codigo',
    d2.code === d.code && d2.reused === true, JSON.stringify({ uno: d.code, dos: d2.code, reused: d2.reused }));

  const sinLlave = await fetch(BASE + '/api/liga/new', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leagueId: LIGA_REAL })
  });
  ok('(z4) CONTROL: sin llave de cuenta no se crea nada', sinLlave.status === 401,
    'status=' + sinLlave.status);

  const publico = await (await fetch(BASE + '/api/liga/' + CODE)).text();
  ok('(z5) el documento publico no filtra llaves de cuenta',
    publico.indexOf('qa_hub_') === -1 && publico.indexOf('createdBy') === -1);
}

ok('(z6) consola limpia', errsConsola.length === 0, errsConsola.slice(0, 4).join(' | '));

await p1.ctx.close(); await p2.ctx.close();
await b.close();
limpiar();
console.log('\n' + (fails ? fails + ' FALLOS' : 'ALL GREEN'));
process.exit(fails ? 1 : 0);
