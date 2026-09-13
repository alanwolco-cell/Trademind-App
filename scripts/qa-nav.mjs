#!/usr/bin/env node
// Gate de NAVEGACION. Recorre la app CLICANDO como una persona: abre el cajon,
// toca una entrada, toca la barra inferior. Nada de llamar a switchScreen() ni
// a renderX() a mano.
//
//   node scripts/qa-nav.mjs
//   QA_BASE=https://macdraft.app node scripts/qa-nav.mjs
//
// POR QUE EXISTE. El 2026-08-26 el dueno reporto "ningun tab funciona, todo me
// manda al home page". Los cinco gates del repo estaban en verde: todos entraban
// a las pantallas llamando switchScreen() directo, y el fallo solo aparece por
// el camino del clic, con el cajon ABIERTO. Cerrar el cajon disparaba
// history.back(), que es asincrono, y su popstate aterrizaba DESPUES del cambio
// de pantalla restaurando la ruta anterior: el home.
//
// La leccion, y la razon de que este gate mida lo que mide: un gate que entra
// por la puerta de servicio no prueba la puerta de entrada.
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

const PORT = process.env.QA_PORT || 3212;
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

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };

const b = await chromium.launch();
const nueva = async (w, h) => {
  const pg = await b.newPage({ viewport: { width: w, height: h } });
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2600);
  return pg;
};

// Donde estoy DE VERDAD: no basta con que la pantalla lleve la clase active, el
// hero de la portada no puede seguir ocupando la ventana.
const donde = pg => pg.evaluate(() => {
  const a = document.querySelector('.screen.active');
  const hero = document.querySelector('.mk-hero-shot');
  const hr = hero ? hero.getBoundingClientRect() : null;
  return {
    pantalla: a ? a.id : 'NINGUNA',
    tab: (document.querySelector('.screen.active .tab-content.active') || {}).id || null,
    heroEnPantalla: hr ? (hr.top < window.innerHeight && hr.bottom > 0) : false,
    ruta: location.pathname + location.hash
  };
});

// Abre el cajon como lo abre una persona: el boton de la barra inferior en el
// telefono, la hamburguesa de la cabecera en escritorio. El que este visible.
const abrirCajon = pg => pg.evaluate(async () => {
  const abierto = () => { const m = document.getElementById('mob-menu'); return !!(m && m.classList.contains('open')); };
  if (abierto()) return 'ya estaba abierto';
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !!e.offsetParent; };
  const more = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'More' && visible(x));
  const burger = Array.from(document.querySelectorAll('button')).find(x => /mobMenuToggle/.test(x.getAttribute('onclick') || '') && visible(x));
  const bt = more || burger;
  if (!bt) return 'NO HAY BOTON VISIBLE PARA ABRIR EL CAJON';
  bt.click();
  await new Promise(r => setTimeout(r, 700));
  return abierto() ? (more ? 'abierto con More' : 'abierto con la hamburguesa') : 'EL CAJON NO ABRIO';
});

const clicEnCajon = (pg, etiqueta) => pg.evaluate(async (et) => {
  // Exacta primero, y solo despues por prefijo. Con solo prefijo, "My League"
  // casaba tambien con "All Leagues"/"My Leagues" y el gate acusaba al producto
  // de un fallo que era del propio medidor.
  const buscar = () => {
    const items = Array.from(document.querySelectorAll('#mob-menu .mob-menu-item'));
    return items.find(x => x.textContent.trim() === et)
        || items.find(x => x.textContent.trim().startsWith(et));
  };
  const padres = Array.from(document.querySelectorAll('#mob-menu .mob-parent'));
  for (const p of padres) {
    const it = buscar();
    if (it && it.offsetParent) break;
    p.click();
    await new Promise(r => setTimeout(r, 260));
  }
  const it = buscar();
  if (!it) return 'NO ESTA EN EL CAJON';
  it.click();
  await new Promise(r => setTimeout(r, 1500));
  return 'clicado';
}, etiqueta);

for (const [w, h, quien] of [[390, 844, 'telefono'], [1440, 950, 'escritorio']]) {
  console.log('\n=== ' + quien + ' (' + w + 'px) ===');

  // (a) el cajon se abre desde un control VISIBLE
  {
    const pg = await nueva(w, h);
    const r = await abrirCajon(pg);
    ok('(a) ' + quien + ': el cajon se abre desde un control visible', /abierto/.test(r), r);
    await pg.close();
  }

  // (b..d) desde la PORTADA, con el cajon abierto, cada destino tiene que
  // llevarme ahi y sacarme del hero. Este es el caso que estaba roto.
  // "Roster Grade" era la puerta de screen-league hasta la poda del
  // 2026-09-11 (dueno): ahora la puerta se llama League Trades.
  for (const [etiqueta, espera] of [['Buy / Sell', 'screen-research'], ['Trade Analyzer', 'screen-analyze'], ['League Trades', 'screen-league'], ['Leagues', 'screen-myleagues']]) {
    const pg = await nueva(w, h);
    await abrirCajon(pg);
    const c = await clicEnCajon(pg, etiqueta);
    const d = await donde(pg);
    ok('(b) ' + quien + ': cajon > ' + etiqueta + ' entra a la app',
      c === 'clicado' && d.pantalla === espera && !d.heroEnPantalla,
      c + ' | ' + JSON.stringify(d));
    await pg.close();
  }

  // (e) Weekly Rankings tiene que estar EN EL CAJON (la leccion de My
  // Rankings: una feature que solo vive en la barra de pestanas no existe en
  // el telefono). Desde el 2026-09-11 la puerta es la hoja semanal; la de
  // draft ("Draft Rankings") queda tras draft-only.
  {
    const pg = await nueva(w, h);
    await abrirCajon(pg);
    const c = await clicEnCajon(pg, 'Weekly Rankings');
    const d = await donde(pg);
    ok('(e) ' + quien + ': cajon > Weekly Rankings llega a la hoja',
      c === 'clicado' && d.pantalla === 'screen-research' && d.tab === 'tab-weekly' && !d.heroEnPantalla,
      c + ' | ' + JSON.stringify(d));
    // La hoja sale de tres fetch (documento, jugadores, semana): leerla en el
    // instante del clic mide la red, no el producto. Se espera a que pinte
    // ALGO deliberado: filas si hay semana publicada, o el vacio honesto.
    await pg.waitForFunction(() => {
      const b = document.getElementById('wk-body');
      return b && (b.querySelector('.wk-row') || b.querySelector('.rk-empty'));
    }, { timeout: 30000 }).catch(() => { });
    const pinta = await pg.evaluate(() => {
      const b = document.getElementById('wk-body');
      if (!b) return 'sin wk-body';
      if (b.querySelector('.wk-row')) return 'filas';
      if (b.querySelector('.rk-empty')) return 'vacio declarado';
      return 'en blanco';
    });
    ok('(f) ' + quien + ': la hoja pinta contenido deliberado al llegar por el cajon',
      pinta === 'filas' || pinta === 'vacio declarado', pinta);
    await pg.close();
  }

  // (g) el boton atras vuelve a la portada, no saca del sitio
  {
    const pg = await nueva(w, h);
    await abrirCajon(pg);
    await clicEnCajon(pg, 'Buy / Sell');
    await pg.goBack({ waitUntil: 'domcontentloaded' }).catch(() => { });
    await pg.waitForTimeout(900);
    const d = await donde(pg);
    ok('(g) ' + quien + ': atras desde la app vuelve a la portada sin salir del sitio',
      /macdraft|localhost/.test(await pg.url()) && (d.pantalla === 'screen-home' || d.pantalla === 'NINGUNA' || d.heroEnPantalla),
      JSON.stringify(d));
    await pg.close();
  }
}

// (h) la barra inferior del telefono, con el cajon ABIERTO encima: el mismo
// camino que rompia, por otra puerta.
{
  console.log('\n=== barra inferior del telefono ===');
  // La barra cambio el 2026-09-08: Analyze salio de la barra (sigue en el
  // cajon y en su ruta) y entro Leagues, que es lo que se mira cada semana.
  // 2026-09-09: fuera de temporada de drafts, la barra es Home/Trades/Mac/Leagues.
  for (const [etiqueta, espera] of [['Leagues', 'screen-myleagues'], ['Trades', 'screen-analyze']]) {
    const pg = await nueva(390, 844);
    await abrirCajon(pg);
    const r = await pg.evaluate(async (et) => {
      const c = Array.from(document.querySelectorAll('button')).filter(x => {
        const r = x.getBoundingClientRect();
        return r.top > window.innerHeight - 90 && x.textContent.trim() === et;
      });
      if (!c.length) return 'no encontrado';
      c[c.length - 1].click();
      await new Promise(r => setTimeout(r, 1500));
      return 'clicado';
    }, etiqueta);
    const d = await donde(pg);
    ok('(h) barra inferior > ' + etiqueta + ' con el cajon abierto',
      r === 'clicado' && d.pantalla === espera && !d.heroEnPantalla, r + ' | ' + JSON.stringify(d));
    await pg.close();
  }
}

/* ── EL RAIL DE ESCRITORIO (12-sep) ────────────────────────────────────────
   Puerta NUEVA, y por eso entra aqui: el rail solo existe con SESION y en
   escritorio, asi que hay que sembrar la cuenta (es lo que enciende
   html.is-app, app.js:210). Se toca cada fila como una persona y se comprueba
   que la pantalla cambia Y que el rail marca donde estas.
   Los CONTROLES son la mitad del bloque: sin sesion no hay rail, en el
   telefono no hay rail, y a 1000px tampoco (el corte es 1001). Sin ellos, un
   rail pintado siempre pasaria los checks de arriba. */
{
  const conSesion = async (w, h) => {
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    await pg.addInitScript(() => { try { localStorage.setItem('tm_username', 'wolco'); } catch (e) { } });
    await pg.goto(BASE + '/myleagues', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pg.waitForTimeout(2800);
    return pg;
  };

  const pg = await conSesion(1440, 900);
  const base = await pg.evaluate(() => {
    const r = document.getElementById('app-rail');
    return {
      visible: !!(r && getComputedStyle(r).display !== 'none'),
      ancho: r ? Math.round(r.getBoundingClientRect().width) : 0,
      puertas: document.querySelectorAll('#app-rail .rail-item').length,
      // nada del contenido puede quedar debajo del rail
      bajoRail: [...document.querySelectorAll('.screen.active, footer')]
        .filter(e => { const x = e.getBoundingClientRect(); return x.width > 0 && x.left < (r ? r.getBoundingClientRect().right : 0) - 1; }).length,
      desborde: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  ok('(r1) con sesion y en escritorio el rail existe, mide lo suyo y no tapa nada',
    base.visible === true && base.ancho >= 200 && base.ancho <= 260
    && base.puertas === 5 && base.bajoRail === 0 && base.desborde === false,
    JSON.stringify(base));

  // Cada puerta, TOCANDOLA
  const esperados = [
    ['Ask Mac', 'screen-sage'],
    ['Trade Analyzer', 'screen-analyze'],
    ['Research', 'screen-research'],
    ['Leagues', 'screen-myleagues']
  ];
  for (const [rotulo, pantalla] of esperados) {
    const r = await pg.evaluate(t => {
      const x = [...document.querySelectorAll('#app-rail .rail-item')]
        .find(e => e.textContent.trim() === t);
      if (!x) return 'sin-puerta';
      x.click();
      return 'clicado';
    }, rotulo);
    await pg.waitForTimeout(1300);
    const d = await pg.evaluate(() => {
      const act = document.querySelector('.screen.active');
      const marcado = [...document.querySelectorAll('#app-rail .rail-item.active')].map(e => e.textContent.trim());
      return { pantalla: act ? act.id : 'ninguna', marcados: marcado.length, marcado: marcado[0] || null };
    });
    ok('(r2) el rail abre ' + rotulo + ' y lo marca como activo',
      r === 'clicado' && d.pantalla === pantalla && d.marcados === 1 && d.marcado === rotulo,
      r + ' | ' + JSON.stringify(d));
  }

  // "More" es la UNICA puerta al cajon en este modo (la hamburguesa se esconde
  // para no tener dos puertas a lo mismo): si no abriera, todo lo que no esta
  // en el rail quedaria inalcanzable en escritorio.
  const masr = await pg.evaluate(() => {
    const m = document.querySelector('#app-rail .rail-more');
    if (!m) return { hay: false };
    m.click();
    return { hay: true };
  });
  await pg.waitForTimeout(900);
  const cajon = await pg.evaluate(() => {
    const mm = document.getElementById('mob-menu');
    const nb = document.getElementById('nav-burger');
    return {
      abierto: !!(mm && mm.classList.contains('open')),
      burgerVisible: !!(nb && getComputedStyle(nb).display !== 'none')
    };
  });
  ok('(r3) "More" abre el cajon, y la hamburguesa no lo duplica en este modo',
    masr.hay === true && cajon.abierto === true && cajon.burgerVisible === false,
    JSON.stringify({ masr, cajon }));
  await pg.close();

  // CONTROLES
  const sinRail = async (w, h, sembrar, etiqueta) => {
    const p2 = await b.newPage({ viewport: { width: w, height: h } });
    if (sembrar) await p2.addInitScript(() => { try { localStorage.setItem('tm_username', 'wolco'); } catch (e) { } });
    await p2.goto(BASE + '/myleagues', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p2.waitForTimeout(2500);
    const v = await p2.evaluate(() => {
      const r = document.getElementById('app-rail');
      return { rail: !!(r && getComputedStyle(r).display !== 'none'), pad: getComputedStyle(document.body).paddingLeft };
    });
    ok('(r4) CONTROL: ' + etiqueta + ' no hay rail', v.rail === false && v.pad === '0px', JSON.stringify(v));
    await p2.close();
  };
  await sinRail(1440, 900, false, 'sin sesion');
  await sinRail(390, 844, true, 'en el telefono');
  await sinRail(1000, 900, true, 'a 1000px, justo bajo el corte');
}

await b.close();
cerrar();
console.log(fails ? '\n' + fails + ' FALLOS' : '\nNAV ALL GREEN');
process.exit(fails ? 1 : 0);
