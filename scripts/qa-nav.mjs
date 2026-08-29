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
  const padres = Array.from(document.querySelectorAll('#mob-menu .mob-parent'));
  for (const p of padres) {
    const it = Array.from(document.querySelectorAll('#mob-menu .mob-menu-item'))
      .find(x => x.textContent.trim().startsWith(et));
    if (it && it.offsetParent) break;
    p.click();
    await new Promise(r => setTimeout(r, 260));
  }
  const it = Array.from(document.querySelectorAll('#mob-menu .mob-menu-item'))
    .find(x => x.textContent.trim().startsWith(et));
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
  for (const [etiqueta, espera] of [['Buy / Sell', 'screen-research'], ['Trade Analyzer', 'screen-analyze'], ['My League', 'screen-league']]) {
    const pg = await nueva(w, h);
    await abrirCajon(pg);
    const c = await clicEnCajon(pg, etiqueta);
    const d = await donde(pg);
    ok('(b) ' + quien + ': cajon > ' + etiqueta + ' entra a la app',
      c === 'clicado' && d.pantalla === espera && !d.heroEnPantalla,
      c + ' | ' + JSON.stringify(d));
    await pg.close();
  }

  // (e) My Rankings tiene que estar EN EL CAJON. Vivia solo en la barra de
  // pestanas, que en el telefono se sale de la ventana: la feature existia y
  // no habia forma de llegar a ella.
  {
    const pg = await nueva(w, h);
    await abrirCajon(pg);
    const c = await clicEnCajon(pg, 'My Rankings');
    const d = await donde(pg);
    ok('(e) ' + quien + ': cajon > My Rankings llega a la lista',
      c === 'clicado' && d.pantalla === 'screen-research' && d.tab === 'tab-rankings' && !d.heroEnPantalla,
      c + ' | ' + JSON.stringify(d));
    // La lista sale de una fetch al board de Sleeper: leerla en el mismo
    // instante del clic mide la red, no el producto. Medido el 2026-08-28:
    // tarda ~3 s con la cache fria y este check fallaba al azar TAMBIEN contra
    // el codigo de HEAD, o sea que llevaba tiempo mintiendo en las dos
    // direcciones. Se espera a que pinte; si no pinta nunca, sigue fallando.
    await pg.waitForFunction(() => document.querySelectorAll('#rk-body .rk-row').length > 100,
      { timeout: 30000 }).catch(() => { });
    const filas = await pg.$$eval('#rk-body .rk-row', r => r.length).catch(() => 0);
    ok('(f) ' + quien + ': la lista pinta jugadores al llegar por el cajon', filas > 100, filas + ' filas');
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
  for (const [etiqueta, espera] of [['Analyze', 'screen-analyze'], ['Draft', 'screen-mock']]) {
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

await b.close();
cerrar();
console.log(fails ? '\n' + fails + ' FALLOS' : '\nNAV ALL GREEN');
process.exit(fails ? 1 : 0);
