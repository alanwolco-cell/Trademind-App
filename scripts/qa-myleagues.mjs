#!/usr/bin/env node
// Gate de MY LEAGUES. Entra CLICANDO desde la portada, como una persona.
//
//   node scripts/qa-myleagues.mjs
//   QA_BASE=https://macdraft.app node scripts/qa-myleagues.mjs
//   QA_USER=otro node scripts/qa-myleagues.mjs
//
// QUE MIDE Y POR QUE
//
// 1. La puerta. La leccion de 2026-08-26 en este repo: un gate que entra por la
//    puerta de servicio (llamando renderX() a mano) no prueba la puerta de
//    entrada. Aqui se abre el cajon y se toca la entrada, en telefono y en
//    escritorio.
// 2. La aritmetica del tablero. Las odds son numeros que el usuario va a creer,
//    asi que se comprueban como numeros: los dos lados de un duelo suman 1, la
//    linea de uno es la contraria de la del otro, el total es el mismo en las
//    dos filas, y el reparto del titulo suma 100%.
// 3. Los controles negativos, que son la mitad del gate:
//    - una liga SIN draftear no puede tener odds de titulo (el fallo real que
//      aparecio construyendo esto: repartia el campeonato entre doce equipos
//      con proyeccion cero, y el numero salia del ORDEN de la lista).
//    - sin lineas cargadas, el tablero se declara cerrado en vez de pintar
//      ceros.
// 4. El canario del propio instrumento. Antes de fiarse de la medicion, el gate
//    comprueba que su medidor detecta un valor que SABE que esta mal. Sin eso,
//    un check verde no dice nada.
//
// Las proyecciones entran por fixture (scripts/fixtures/odds-props-*.json) para
// que la aritmetica sea deterministica y no dependa de una API de pago.
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

const PORT = process.env.QA_PORT || 3216;
const BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
const USER = process.env.QA_USER || 'wolco';
const PROPS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/odds-props-2026-09-08.json'), 'utf8')).props;

let srv = null;
if (!process.env.QA_BASE) {
  srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
    { env: { ...process.env, PORT: String(PORT) },
      // QA_SRV_LOG=1 deja ver el servidor: sin eso, un 500 del backend es una
      // caja negra y uno acaba adivinando.
      stdio: process.env.QA_SRV_LOG ? 'inherit' : 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
    await new Promise(r => setTimeout(r, 500));
  }
}
const cerrar = () => { if (srv) try { srv.kill(); } catch (_) { } };

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };
// Contra el codigo roto, evaluate() puede devolver {_err}. Sin este
// normalizador la corrida REVIENTA en el primer fallo y se lleva por delante
// los veinte checks de detras. Este repo ya pago esa leccion dos veces.
const seguro = async (pg, fn, arg) => {
  try { return await pg.evaluate(fn, arg); } catch (e) { return { _err: String(e).slice(0, 160) }; }
};
// pg.click() LANZA si el selector no existe, y contra el codigo viejo eso mata
// la corrida y se lleva por delante los checks de detras. Misma leccion que el
// $eval de qa-rankings: reportar FAIL, nunca tumbar.
const clic = async (pg, sel) => {
  try { const el = await pg.$(sel); if (!el) return false; await el.click({ timeout: 4000 }); return true; }
  catch (e) { return false; }
};

const errsConsola = [];
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/];
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
    // "Failed to load resource" no dice QUE recurso en su texto: el nombre esta
    // en la localizacion del mensaje. Filtrar solo por texto dejaba pasar los
    // dos ruidos conocidos del entorno local y el gate acusaba en falso.
    const url = (m.location() && m.location().url) || '';
    if (RUIDO.some(r => r.test(t) || r.test(url))) return;
    errsConsola.push(t.slice(0, 140) + (url ? '  <- ' + url.slice(0, 90) : ''));
  });
  pg.on('pageerror', e => errsConsola.push('PAGEERROR ' + String(e).slice(0, 200)));
  await pg.addInitScript(([u, p]) => {
    try { localStorage.setItem('tm_username', u); } catch (e) { }
    window._ML_PROPS_FIXTURE = p;
  }, [USER, PROPS]);
  return { ctx, pg };
}

// Entra por donde entra una persona: portada, cajon, toque.
async function entrarClicando(pg) {
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2600);
  // El control del cajon cambia entre telefono y escritorio: More en la barra
  // inferior, la hamburguesa en la cabecera. Se usa el que este VISIBLE, igual
  // que qa-nav.mjs, porque son dos puertas distintas para la misma pantalla.
  const abierto = await pg.evaluate(async () => {
    const esta = () => { const m = document.getElementById('mob-menu'); return !!(m && m.classList.contains('open')); };
    if (esta()) return true;
    const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !!e.offsetParent; };
    const btns = Array.from(document.querySelectorAll('button'));
    const more = btns.find(x => x.textContent.trim() === 'More' && visible(x));
    const burger = btns.find(x => /mobMenuToggle/.test(x.getAttribute('onclick') || '') && visible(x));
    const bt = more || burger;
    if (!bt) return false;
    bt.click();
    await new Promise(r => setTimeout(r, 700));
    return esta();
  });
  if (!abierto) return { abierto: false };
  const item = await pg.$('#mob-menu button[onclick*="myleagues"]');
  if (!item) return { abierto: true, item: false };
  await item.click();
  await pg.waitForTimeout(1400);
  return { abierto: true, item: true };
}

async function esperarDatos(pg, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 30000)) {
    const listo = await seguro(pg, () => !!(window.ML && ML.ready && !ML.loading));
    if (listo === true) return true;
    await pg.waitForTimeout(400);
  }
  return false;
}

console.log('== MY LEAGUES ==  base=' + BASE + '  usuario=' + USER + '\n');

/* ---------------------------------------------------------------- ESCRITORIO */
{
  const { ctx, pg } = await nuevaPagina(1400, 900, false);
  const nav = await entrarClicando(pg);
  ok('(a) el cajon abre y lista All Leagues', nav.abierto === true && nav.item === true,
    JSON.stringify(nav));

  const tras = await seguro(pg, () => {
    const s = document.getElementById('screen-myleagues');
    const hero = document.querySelector('#screen-home, .hero');
    const r = hero && hero.getBoundingClientRect();
    return {
      activa: !!(s && s.classList.contains('active')),
      heroFuera: !hero || !r || r.bottom <= 0 || r.height === 0 || getComputedStyle(hero).display === 'none',
      ruta: location.pathname
    };
  });
  ok('(b) el clic deja la pantalla activa y saca la portada', tras.activa === true && tras.heroFuera === true,
    JSON.stringify(tras));
  ok('(c) la ruta queda en /myleagues', tras.ruta === '/myleagues', 'ruta=' + tras.ruta);

  const cargo = await esperarDatos(pg, 45000);
  ok('(d) los datos cargan', cargo === true);

  const est = await seguro(pg, () => ({
    ligas: (ML.leagues || []).length,
    tarjetas: document.querySelectorAll('#screen-myleagues .ml-card').length,
    err: ML.err,
    props: !!ML.props,
    conMio: (ML.leagues || []).every(L => L._hyd && L._hyd.mine)
  }));
  ok('(e) hay ligas y una tarjeta por liga', est.ligas > 0 && est.tarjetas === est.ligas, JSON.stringify(est));
  ok('(f) toda liga listada tiene equipo del usuario', est.conMio === true, JSON.stringify(est));
  ok('(g) el fixture de lineas entra', est.props === true);

  // --- CANARIO DEL INSTRUMENTO -------------------------------------------
  // Antes de creerle a los checks de aritmetica, se comprueba que detectan un
  // numero que SABEMOS que esta mal.
  const canario = await seguro(pg, () => {
    const malo = { a: 0.6, b: 0.6 };                     // dos favoritos: imposible
    const sumaMal = Math.abs(malo.a + malo.b - 1) < 0.01;
    const bien = { a: 0.6, b: 0.4 };
    const sumaBien = Math.abs(bien.a + bien.b - 1) < 0.01;
    return { detectaMalo: sumaMal === false, aceptaBueno: sumaBien === true };
  });
  ok('(h) canario: el medidor de probabilidades caza un valor malo',
    canario.detectaMalo === true && canario.aceptaBueno === true, JSON.stringify(canario));

  // --- ARITMETICA PURA ----------------------------------------------------
  const mat = await seguro(pg, () => {
    const r = {};
    r.amFav = mlAmerican(0.75);      // favorito: precio negativo
    r.amDog = mlAmerican(0.25);      // no favorito: positivo
    r.amEven = mlAmerican(0.5);
    r.wpIgual = mlWinProb(100, 100);
    r.wpMas = mlWinProb(120, 100);
    r.wpMenos = mlWinProb(100, 120);
    r.spCero = mlSpread(0);
    r.simetria = Math.abs(mlWinProb(120, 100) + mlWinProb(100, 120) - 1);
    return r;
  });
  ok('(i) el precio del favorito es negativo y el del otro positivo',
    String(mat.amFav).startsWith('-') && String(mat.amDog).startsWith('+'), JSON.stringify(mat));
  ok('(j) un duelo parejo da 50% y precio par', mat.wpIgual === 0.5 && String(mat.amEven) === '-100',
    JSON.stringify(mat));
  ok('(k) las dos probabilidades de un duelo suman 1',
    typeof mat.simetria === 'number' && mat.simetria < 1e-9, 'desvio=' + mat.simetria);
  ok('(l) no existe el pick em: la linea nunca es cero',
    typeof mat.spCero === 'number' && mat.spCero !== 0, 'spread=' + mat.spCero);

  // --- EL TABLERO ---------------------------------------------------------
  const abrioOdds = await clic(pg, '#screen-myleagues .inner-tab[data-tab="tab-ml-odds"]');
  ok('(l2) la pestana Odds existe y se puede tocar', abrioOdds === true);
  await pg.waitForTimeout(1500);
  // la simulacion arranca sola al pintar; se le da tiempo al calendario
  for (let i = 0; i < 40; i++) {
    const listo = await seguro(pg, () => document.querySelectorAll('#screen-myleagues .ml-champ-row').length > 0
      || !!document.querySelector('.ml-champ .ml-sub2'));
    if (listo === true) break;
    await pg.waitForTimeout(500);
  }

  // El tablero abre en TODAS las ligas: una fila por duelo tuyo. Primero se
  // mide esa vista, y despues se filtra a UNA liga, que es donde existen los
  // dos lados y la tabla de campeonato.
  const slate = await seguro(pg, () => {
    const filas = [...document.querySelectorAll('#screen-myleagues .ml-game')];
    const resumen = [...document.querySelectorAll('.ml-slate-n b')].map(x => x.textContent.trim());
    const pct = filas.map(f => {
      const c = f.querySelectorAll('.ml-cell');
      return parseFloat((c[2] || {}).textContent || 'NaN');
    });
    return { filas: filas.length, resumen, pct, ligas: (ML.leagues || []).filter(mlDrafted).length };
  });
  ok('(l3) el tablero abre con TUS duelos de todas las ligas',
    slate.filas > 0 && slate.filas <= slate.ligas, JSON.stringify(slate).slice(0, 200));
  ok('(l4) el resumen del domingo trae sus tres cifras',
    Array.isArray(slate.resumen) && slate.resumen.length === 3 && slate.resumen.every(x => x && x.length),
    JSON.stringify(slate.resumen));
  ok('(l5) los duelos van del peor al mejor, que es donde puedes hacer algo',
    Array.isArray(slate.pct) && slate.pct.length > 0
    && slate.pct.every((v, i) => i === 0 || slate.pct[i - 1] <= v + 0.05),
    JSON.stringify(slate.pct));

  // filtrar a una liga concreta
  const filtro = await seguro(pg, async () => {
    // Tiene que ser una liga CABEZA A CABEZA: desde que best ball se detecta
    // bien (2026-09-09), la primera liga con duelo puede ser una de best ball,
    // que no tiene torneo por siembra y por tanto no tiene titulo que repartir.
    // El check (p) mide el reparto del titulo: sin liga con titulo, no mide.
    const L = (ML.leagues || []).filter(x =>
      mlDrafted(x) && x._hyd && x._hyd.opp != null && mlIsHeadToHead(x))[0];
    if (!L) return { salta: true };
    mlOpenOdds(L.id);
    await new Promise(r => setTimeout(r, 1200));
    return { salta: false, liga: L.name };
  });
  ok('(l6) elegir una liga filtra el mismo tablero', filtro.salta === true || !!filtro.liga,
    JSON.stringify(filtro));
  for (let i = 0; i < 40; i++) {
    const listo = await seguro(pg, () => document.querySelectorAll('#screen-myleagues .ml-champ-row').length > 0
      || !!document.querySelector('.ml-champ .ml-sub2'));
    if (listo === true) break;
    await pg.waitForTimeout(500);
  }

  const board = await seguro(pg, () => {
    const juegos = [...document.querySelectorAll('#screen-myleagues .ml-game')].map(g => {
      const filas = [...g.querySelectorAll('.ml-bd-row')].map(f => {
        const c = f.querySelectorAll('.ml-cell');
        return {
          nombre: (f.querySelector('b') || {}).textContent || '',
          spread: (c[0] || {}).textContent || '',
          money: (c[1] || {}).textContent || '',
          total: ((c[2] || {}).textContent || '').replace(/[ou]\s*/, '')
        };
      });
      return filas;
    });
    return { n: juegos.length, juegos };
  });
  // Nada de indexar a ciegas: contra un tablero de una sola fila esto reventaba
  // la corrida entera en vez de reportar el fallo. Otra vez la misma leccion.
  const juegos = Array.isArray(board.juegos) ? board.juegos : [];
  const dosFilas = juegos.length > 0 && juegos.every(g => Array.isArray(g) && g.length === 2);
  const signosOpuestos = dosFilas && juegos.every(g =>
    (g[0].spread.startsWith('-') && g[1].spread.startsWith('+')) ||
    (g[0].spread.startsWith('+') && g[1].spread.startsWith('-')));
  const totalIgual = dosFilas && juegos.every(g => g[0].total === g[1].total);
  const spreadIgual = dosFilas && juegos.every(g =>
    Math.abs(parseFloat(g[0].spread) + parseFloat(g[1].spread)) < 1e-9);
  ok('(m) el tablero pinta duelos con sus dos lados', board.n > 0 && dosFilas === true,
    'juegos=' + board.n);
  ok('(n) la linea de un lado es la contraria del otro',
    board.n > 0 && signosOpuestos === true && spreadIgual === true, 'juegos=' + board.n);
  ok('(o) el total es el mismo en los dos lados', board.n > 0 && totalIgual === true, 'juegos=' + board.n);

  const champ = await seguro(pg, () => {
    const filas = [...document.querySelectorAll('#screen-myleagues .ml-champ-row')];
    const pct = filas.map(f => parseFloat((f.querySelector('.ml-champ-pct') || {}).textContent || '0'));
    return { n: filas.length, suma: pct.reduce((a, x) => a + x, 0), pct };
  });
  ok('(p) el titulo se reparte entre todos los equipos y suma 100%',
    champ.n > 0 && Math.abs(champ.suma - 100) <= 1.2, JSON.stringify(champ));

  // --- CONTROL NEGATIVO: liga sin draftear --------------------------------
  const sinDraft = await seguro(pg, async () => {
    const L = (ML.leagues || []).filter(x => !mlDrafted(x))[0];
    if (!L) return { salta: true };
    ML.oddsLeague = L.id;
    mlPaintOdds();
    await new Promise(r => setTimeout(r, 800));
    return {
      salta: false,
      filas: document.querySelectorAll('#screen-myleagues .ml-champ-row').length,
      sim: !!ML.sims[L.id],
      dice: !!document.querySelector('.ml-champ .ml-sub2')
    };
  });
  ok('(q) CONTROL: una liga sin draftear no recibe odds de titulo, y lo dice',
    sinDraft.salta === true || (sinDraft.filas === 0 && sinDraft.sim === false && sinDraft.dice === true),
    JSON.stringify(sinDraft));

  const sinDraftTarjeta = await seguro(pg, () => {
    const L = (ML.leagues || []).filter(x => !mlDrafted(x))[0];
    if (!L) return { salta: true };
    const sim = mlSimLeague(L, 200);
    return { salta: false, sim: sim === null };
  });
  ok('(r) CONTROL: el simulador se niega sobre planteles vacios',
    sinDraftTarjeta.salta === true || sinDraftTarjeta.sim === true, JSON.stringify(sinDraftTarjeta));

  // --- CONTROL NEGATIVO: sin lineas, tablero cerrado ----------------------
  const cerrado = await seguro(pg, async () => {
    const guardadas = ML.props;
    ML.props = null;
    mlPaintOdds();
    await new Promise(r => setTimeout(r, 400));
    const txt = (document.getElementById('ml-odds-body') || {}).textContent || '';
    const juegos = document.querySelectorAll('#screen-myleagues .ml-game').length;
    ML.props = guardadas;
    return { dice: /board is closed/i.test(txt), juegos };
  });
  ok('(s) CONTROL: sin lineas el tablero se declara cerrado y no pinta ceros',
    cerrado.dice === true && cerrado.juegos === 0, JSON.stringify(cerrado));

  // --- EXPOSICION ---------------------------------------------------------
  const abrioJug = await clic(pg, '#screen-myleagues .inner-tab[data-tab="tab-ml-players"]');
  ok('(s2) la pestana My Players existe y se puede tocar', abrioJug === true);
  await pg.waitForTimeout(1200);
  const expo = await seguro(pg, () => {
    const total = (ML.leagues || []).length;
    const ex = mlExposure();
    const ids = Object.keys(ex.mine);
    const excede = ids.filter(id => ex.mine[id].length > total).length;
    // el conteo pintado tiene que coincidir con el calculado
    const filas = [...document.querySelectorAll('#screen-myleagues .ml-row')].map(r => ({
      n: parseInt((r.querySelector('.ml-row-n') || {}).textContent || '0', 10),
      nombre: (r.querySelector('b') || {}).textContent
    }));
    const top = filas[0] || {};
    const maxCalc = Math.max(...ids.map(id => ex.mine[id].length));
    return { total, jugadores: ids.length, excede, filas: filas.length, topPintado: top.n, maxCalc };
  });
  ok('(t) la exposicion se pinta y nadie aparece en mas ligas de las que hay',
    expo.jugadores > 0 && expo.filas > 0 && expo.excede === 0, JSON.stringify(expo));
  // --- LA IDENTIDAD DE CADA LIGA -----------------------------------------
  const identidad = await seguro(pg, async () => {
    const t = document.querySelector('#screen-myleagues .inner-tab[data-tab="tab-ml-leagues"]');
    if (t) t.click();
    await new Promise(r => setTimeout(r, 900));
    const cards = [...document.querySelectorAll('#screen-myleagues .ml-card')];
    const colores = cards.map(c => c.style.getPropertyValue('--liga')).filter(Boolean);
    const sinEscudo = cards.filter(c => !c.querySelector('.ml-shield, .ml-mono')).length;
    // Un color por liga que cambie entre repintados no sirve para reconocer.
    mlPaintLeagues();
    const otra = [...document.querySelectorAll('#screen-myleagues .ml-card')].map(c => c.style.getPropertyValue('--liga'));
    return {
      cards: cards.length, colores: colores.length,
      distintos: new Set(colores).size, sinEscudo,
      estable: JSON.stringify(colores) === JSON.stringify(otra),
      chips: document.querySelectorAll('#screen-myleagues .ml-chip').length
    };
  });
  ok('(v1) cada liga lleva escudo o monograma, nunca un hueco',
    identidad.cards > 0 && identidad.sinEscudo === 0, JSON.stringify(identidad));
  ok('(v2) el color de cada liga es estable entre repintados',
    identidad.estable === true && identidad.colores === identidad.cards, JSON.stringify(identidad));
  ok('(v3) los colores distinguen: no todas las ligas del mismo tono',
    identidad.distintos >= Math.min(4, identidad.cards), JSON.stringify(identidad));
  ok('(v4) hay filtros con su conteo', identidad.chips >= 2, JSON.stringify(identidad));

  const filtrado = await seguro(pg, async () => {
    const chips = [...document.querySelectorAll('#screen-myleagues .ml-chip')];
    const objetivo = chips.filter(c => !/^All/.test(c.textContent))[0];
    if (!objetivo) return { salta: true };
    const etiqueta = objetivo.textContent.replace(/\d+$/, '').trim();
    const n = parseInt((objetivo.querySelector('span') || {}).textContent || '0', 10);
    objetivo.click();
    await new Promise(r => setTimeout(r, 500));
    const tras = document.querySelectorAll('#screen-myleagues .ml-card').length;
    // Control: volver a "All" tiene que devolver TODAS.
    const todo = [...document.querySelectorAll('#screen-myleagues .ml-chip')].filter(c => /^All/.test(c.textContent))[0];
    if (todo) todo.click();
    await new Promise(r => setTimeout(r, 500));
    return { salta: false, etiqueta, prometido: n, pintadas: tras, vuelta: document.querySelectorAll('#screen-myleagues .ml-card').length };
  });
  ok('(v5) el filtro pinta exactamente las que promete su conteo',
    filtrado.salta === true || filtrado.prometido === filtrado.pintadas, JSON.stringify(filtrado));
  ok('(v6) CONTROL: quitar el filtro devuelve todas',
    filtrado.salta === true || filtrado.vuelta === identidad.cards, JSON.stringify(filtrado));

  ok('(u) el numero pintado arriba es el maximo real',
    typeof expo.topPintado === 'number' && expo.topPintado > 0 && expo.topPintado === expo.maxCalc,
    JSON.stringify(expo));

  await ctx.close();
}

/* -------------------------------------------------------------------- MOVIL */
{
  const { ctx, pg } = await nuevaPagina(390, 844, true);
  const nav = await entrarClicando(pg);
  ok('(v) en telefono tambien se llega tocando', nav.abierto === true && nav.item === true, JSON.stringify(nav));
  await esperarDatos(pg, 45000);
  const m = await seguro(pg, () => {
    const s = document.getElementById('screen-myleagues');
    const anchos = [...document.querySelectorAll('#screen-myleagues *')]
      .filter(el => el.getBoundingClientRect().right > 391).length;
    return {
      activa: !!(s && s.classList.contains('active')),
      scroll: document.documentElement.scrollWidth,
      desbordan: anchos,
      tarjetas: document.querySelectorAll('#screen-myleagues .ml-card').length
    };
  });
  ok('(w) a 390px no hay desborde ni elementos fuera de pantalla',
    m.scroll <= 390 && m.desbordan === 0, JSON.stringify(m));
  ok('(x) la pantalla trae contenido en el telefono', m.activa === true && m.tarjetas > 0, JSON.stringify(m));

  // los blancos tactiles de la pantalla, la regla de 44px
  const toques = await seguro(pg, () => {
    const sel = '#screen-myleagues button, #screen-myleagues select, #screen-myleagues input, #screen-myleagues .inner-tab';
    const malos = [...document.querySelectorAll(sel)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.height < 40;
    }).map(el => (el.textContent || el.tagName).trim().slice(0, 24) + ' ' + Math.round(el.getBoundingClientRect().height));
    return malos;
  });
  ok('(y) los blancos tactiles llegan a 40px', Array.isArray(toques) && toques.length === 0,
    JSON.stringify(toques).slice(0, 300));

  await ctx.close();
}

ok('(z) consola limpia', errsConsola.length === 0, errsConsola.slice(0, 5).join(' | '));

await b.close();
cerrar();
console.log('\n' + (fails ? fails + ' FALLOS' : 'ALL GREEN'));
process.exit(fails ? 1 : 0);
