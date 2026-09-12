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

/* ── 6: liga SIN trades (best ball con disable_trades) no ofrece tradear ──── */
// bestball 39 del dueno: settings.disable_trades=1 (medido 2026-09-11).
const LIGA_SIN_TRADES = '1402829686446268416';
{
  const pg = await nuevaPagina(390, 844, true);
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => typeof loadUser === 'function', { timeout: 30000 });
  await pg.evaluate(([u, lid]) => {
    document.getElementById('sleeper-username').value = u;
    return loadUser(lid);
  }, [USER, LIGA_SIN_TRADES]);
  await pg.waitForFunction(() => window.leagueNoTrades !== undefined && leagueRosters.length > 0, { timeout: 40000 }).catch(() => { });
  const st = await pg.evaluate(async () => {
    switchScreen('research');
    await new Promise(r => setTimeout(r, 1200));
    const bs = document.getElementById('buysell-content');
    showAnalyzeTab('ideas');
    await new Promise(r => setTimeout(r, 600));
    const ideas = document.getElementById('ideas-list-tab');
    showAnalyzeTab('analyzer');
    const banner = document.getElementById('no-trades-banner');
    return {
      flag: window.leagueNoTrades,
      bsNota: /trades disabled/i.test((bs || {}).textContent || ''),
      bsPills: bs ? bs.querySelectorAll('.signal-pill').length : -1,
      ideasNota: /trades disabled/i.test((ideas || {}).textContent || ''),
      bannerVisible: banner ? getComputedStyle(banner).display !== 'none' : false,
      bannerNombra: /bestball 39/i.test((banner || {}).textContent || '')
    };
  });
  ok('(6a) la liga sin trades queda marcada al conectarla', st.flag === true, JSON.stringify(st));
  ok('(6b) Buy/Sell no predica trades imposibles: nota y cero señales',
    st.bsNota === true && st.bsPills === 0, JSON.stringify(st));
  ok('(6c) Trade Ideas dice que no hay trades en esa liga', st.ideasNota === true, JSON.stringify(st));
  ok('(6d) el analizador declara el candado con el nombre de la liga',
    st.bannerVisible === true && st.bannerNombra === true, JSON.stringify(st));
  await pg.close();
}

/* ── 7: en modo app la portada tiene puerta (y la pestana Home no rebota) ── */
{
  const pg = await nuevaPagina(390, 844, true);
  await pg.addInitScript(u => { try { localStorage.setItem('tm_username', u); } catch (_) { } }, USER);
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2500);
  const homeTab = await pg.evaluate(() => {
    const t = document.querySelector('#tabbar .tabbar-item[data-tab="home"]');
    return t ? getComputedStyle(t).display : 'no-existe';
  });
  ok('(7a) conectado, la pestana Home esta escondida DE VERDAD (antes rebotaba)',
    homeTab === 'none', 'display: ' + homeTab);
  await pg.evaluate(() => {
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btns = [document.querySelector('#tabbar .tabbar-item[data-tab="more"]'), document.getElementById('nav-burger')].filter(e => e && vis(e));
    if (btns[0]) btns[0].click();
  });
  await pg.waitForTimeout(600);
  const puerta = await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#mob-menu button')).find(x => /The home page/i.test(x.textContent));
    if (!b) return { existe: false };
    const r = b.getBoundingClientRect();
    if (!(r.width > 0)) return { existe: true, visible: false };
    b.click();
    return { existe: true, visible: true };
  });
  await pg.waitForTimeout(1200);
  const tras = await pg.evaluate(() => ({
    pantalla: (document.querySelector('.screen.active') || {}).id || 'NINGUNA',
    hero: (() => { const h = document.querySelector('.hero'); if (!h) return false; const r = h.getBoundingClientRect(); return r.height > 50 && getComputedStyle(h).display !== 'none'; })()
  }));
  ok('(7b) el cajon ofrece "The home page" y el clic LLEGA a la portada',
    puerta.existe === true && puerta.visible === true && tras.hero === true,
    JSON.stringify({ puerta, tras }));
  // (7c) el wordmark tambien: "quiero que me lleve al home page si clickeo
  // arriba donde dice mac draft" (dueno, 2026-09-12). Con cuenta, el logo
  // llevaba a Leagues; ahora la portada.
  await pg.goto(BASE + '/myleagues', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2000);
  await pg.evaluate(() => { const l = document.querySelector('.nav-logo'); if (l) l.click(); });
  await pg.waitForTimeout(1000);
  const logo = await pg.evaluate(() => ({
    hero: (() => { const h = document.querySelector('.hero'); if (!h) return false; const r = h.getBoundingClientRect(); return r.height > 50 && getComputedStyle(h).display !== 'none'; })()
  }));
  ok('(7c) conectado, el clic en el wordmark lleva a la portada', logo.hero === true, JSON.stringify(logo));
  await pg.close();
}

/* ── 8: la fila de Buy/Sell tras la recomposicion Flight Deck (12-sep) ──────
   Dos cosas que la pantalla no tenia y una que se rompio al hacerlas.
   (8a) la fila dice la CIFRA del movimiento de 30 dias, en mono tabular. Antes
        decia "Rising fast" donde va un numero: la pantalla entera existe para
        comparar movimientos y no pintaba ni uno.
   (8b) la fila ENTERA es el boton que abre el porque, y abre al PRIMER toque.
        Este check es la razon de que exista el bloque: al mover el estado
        cerrado de un style inline a la clase .bs-why, toggleBsWhy siguio
        preguntando por w.style.display, que con la fila cerrada ya venia
        VACIO, asi que el primer toque cerraba algo ya cerrado y no pasaba
        nada. Se toca DOS veces, porque un check de un solo toque pasaba
        igual con el fallo invertido. */
{
  const pg = await nuevaPagina(390, 844, true);
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => typeof loadUser === 'function', { timeout: 30000 });
  await pg.evaluate(([u, lid]) => {
    document.getElementById('sleeper-username').value = u;
    return loadUser(lid);
  }, [USER, LIGA_REDRAFT]);
  // Hay que dejar que loadUser TERMINE y deje su rastro antes de navegar: ir a
  // /research en caliente recarga la pagina a mitad de la carga y la liga se
  // restaura vacia, con lo que Buy/Sell no tiene de que hablar (y el check
  // fallaba por la prisa del gate, no por el producto).
  await pg.waitForFunction(() => window.leagueRosters && leagueRosters.length > 0, { timeout: 40000 }).catch(() => { });
  await pg.goto(BASE + '/research', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => window.leagueRosters && leagueRosters.length > 0, { timeout: 40000 }).catch(() => { });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => {
    const t = [...document.querySelectorAll('#screen-research .inner-tab')]
      .find(x => (x.getAttribute('onclick') || '').includes("'tab-buysell'"));
    if (t) t.click();
  });
  const hayFilas = await pg.waitForFunction(
    () => document.querySelectorAll('#buysell-content .bs-row').length > 0,
    { timeout: 40000 }).then(() => true).catch(() => false);

  const cifra = await pg.evaluate(() => {
    const nums = [...document.querySelectorAll('#buysell-content .bs-move-num')];
    if (!nums.length) return { n: 0 };
    const cs = getComputedStyle(nums[0]);
    return {
      n: nums.length,
      // toda cifra visible tiene que ser un numero con signo, no una palabra
      todasNumero: nums.every(x => /^[+−-]?[\d,]+$/.test(x.textContent.trim())),
      mono: /mono/i.test(cs.fontFamily),
      tabular: cs.fontVariantNumeric.indexOf('tabular-nums') > -1
    };
  });
  ok('(8a) la fila de Buy/Sell pinta la CIFRA del movimiento, en mono tabular',
    hayFilas && cifra.n > 0 && cifra.todasNumero === true && cifra.mono === true && cifra.tabular === true,
    JSON.stringify(cifra));

  const cerrado0 = await pg.evaluate(() => {
    const w = document.querySelector('#buysell-content .bs-why');
    return w ? getComputedStyle(w).display : 'sin-why';
  });
  let abre1 = 'no-toco', cierra2 = 'no-toco';
  try {
    await pg.locator('#buysell-content .bs-main').first().tap();
    await pg.waitForTimeout(350);
    abre1 = await pg.evaluate(() => {
      const w = document.querySelector('#buysell-content .bs-why');
      const c = document.querySelector('#buysell-content .bs-caret');
      return (w ? getComputedStyle(w).display : 'sin-why') + '|' + (c && c.classList.contains('is-open') ? 'flecha-girada' : 'flecha-quieta');
    });
    await pg.locator('#buysell-content .bs-main').first().tap();
    await pg.waitForTimeout(350);
    cierra2 = await pg.evaluate(() => {
      const w = document.querySelector('#buysell-content .bs-why');
      return w ? getComputedStyle(w).display : 'sin-why';
    });
  } catch (_) { }
  ok('(8b) UN toque en la fila abre el porque (y el segundo lo cierra)',
    cerrado0 === 'none' && abre1 === 'block|flecha-girada' && cierra2 === 'none',
    'cerrada:' + cerrado0 + ' toque1:' + abre1 + ' toque2:' + cierra2);
  await pg.close();
}

ok('(z) consola limpia', errsConsola.length === 0, errsConsola.slice(0, 5).join(' | '));

await b.close();
cerrar();
console.log(fails ? '\n' + fails + ' FALLOS' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
