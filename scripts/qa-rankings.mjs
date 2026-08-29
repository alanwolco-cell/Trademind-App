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
// El dueno del gate: una llave de cuenta fija, cuyo acctId (sha256, 32 hex,
// la misma derivacion de server/lib/identity.js) va en PERFIL_ACCTS del
// servidor de prueba. Y un desconocido, para el control negativo.
import crypto from 'node:crypto';
import os from 'node:os';
const OWNER_KEY = 'qa-rankings-owner-' + 'a'.repeat(40);
const OTHER_KEY = 'qa-rankings-other-' + 'b'.repeat(40);
// Los dispositivos que llegan con un codigo. NO estan en PERFIL_ACCTS: entran
// por el Blob, que es justo lo que la feature tiene que demostrar.
const NEW_KEY = 'qa-rankings-newdev-' + 'c'.repeat(40);
const NEW2_KEY = 'qa-rankings-repeat-' + 'd'.repeat(40);
const RL_KEY = 'qa-rankings-bruto0-' + 'e'.repeat(40);
const OWNER_ID = crypto.createHash('sha256').update(OWNER_KEY).digest('hex').slice(0, 32);
// El documento del dueno arranca VACIO en cada corrida: el seed y la ida y
// vuelta entre navegadores se prueban desde cero, en un archivo temporal, sin
// tocar el blob de produccion aunque .env.local traiga el token.
const RK_FILE = path.join(os.tmpdir(), 'qa-rankings-doc-' + process.pid + '.json');
// Los codigos de vinculacion y la lista de cuentas vinculadas: mismos archivos
// temporales y por la misma razon, que ninguna corrida toque el Blob real.
const LINK_FILE = path.join(os.tmpdir(), 'qa-link-codes-' + process.pid + '.json');
const EXTRA_FILE = path.join(os.tmpdir(), 'qa-extra-accts-' + process.pid + '.json');
for (const f of [RK_FILE, LINK_FILE, EXTRA_FILE]) { try { fs.unlinkSync(f); } catch (_) { } }
if (!process.env.QA_BASE) {
  srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
    { env: { ...process.env, PORT: String(PORT), PERFIL_ACCTS: OWNER_ID, PERFIL_RK_STORE: 'local',
      PERFIL_RK_FILE: RK_FILE, PERFIL_LINK_FILE: LINK_FILE, PERFIL_EXTRA_FILE: EXTRA_FILE }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
    await new Promise(r => setTimeout(r, 500));
  }
}
const cerrar = () => {
  if (srv) try { srv.kill(); } catch (_) { }
  for (const f of [RK_FILE, LINK_FILE, EXTRA_FILE]) { try { fs.unlinkSync(f); } catch (_) { } }
};

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
// Cada pagina abre en SU contexto (localStorage propio) con la llave de cuenta
// del dueno, salvo que se pida la del desconocido. Se cuentan los PUT al
// documento y los GET, porque el control negativo tiene que probar que una
// cuenta corriente no manda NADA al servidor.
async function nueva(w, h, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addInitScript(k => { try { localStorage.setItem('tm_acct', k); } catch (_) { } }, opts.key || OWNER_KEY);
  // Memoria de sala del mock: sirve para probar que la columna Pay del dueno
  // NO la escucha, porque su liga es una sola.
  if (opts.mock) await ctx.addInitScript(m => { try { localStorage.setItem('tm_mock_settings', m); } catch (_) { } }, JSON.stringify(opts.mock));
  // /perfil no pinta nada sin un usuario de Sleeper guardado: pide conectar
  // primero, y entonces no se llega nunca a la tarjeta del 403.
  if (opts.user) await ctx.addInitScript(u => { try { localStorage.setItem('tm_username', u); } catch (_) { } }, opts.user);
  const pg = await ctx.newPage();
  const errs = [], puts = [], gets = [];
  pg.on('console', m => { if (m.type() === 'error' && !KNOWN.some(r => r.test(m.text()))) errs.push(m.text().slice(0, 140)); });
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 140)));
  pg.on('request', rq => {
    if (/\/api\/perfil\/rankings/.test(rq.url())) (rq.method() === 'PUT' ? puts : gets).push(rq.url());
  });
  const _close = pg.close.bind(pg);
  pg.close = async () => { try { await _close(); } catch (_) { } try { await ctx.close(); } catch (_) { } };
  await pg.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  return { pg, errs, puts, gets, ctx };
}
// Espera a que el ultimo cambio haya llegado al servidor
const sincronizado = pg => pg.waitForFunction(() => typeof TMR !== 'undefined' && TMR.owner === true && !TMR._dirty && !TMR._syncing
  && Number(localStorage.getItem('tm_rk_sync_at')) > 0, { timeout: 15000 }).then(() => true).catch(() => false);

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
      ['vs', R(head, '.rk-ch-vs'), R(row, '.rk-vs'), 'right'],
      // La cabecera Pay cae sobre el borde derecho de la CIFRA, no sobre la
      // columna entera: al lado de la cifra puede haber el boton de volver al
      // precio del motor, y el rotulo tiene que decir de que es la cifra.
      ['pay', R(head, '.rk-ch-pay'), R(row, '.rk-pr'), 'right']
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

console.log('\n=== My Rankings: el dinero ===');
// NADA en esta seccion puede LANZAR. Contra el codigo anterior no existen ni
// TMR.price ni tmrSetPrice, y un evaluate que revienta se lleva por delante
// todos los checks que vienen detras: el gate se pondria verde por no llegar a
// mirar. Es la misma leccion que ya se pago con $eval en este mismo archivo.
const eva = async (pg, fn, arg) => { try { return await pg.evaluate(fn, arg); } catch (e) { return { _err: String(e.message || e).slice(0, 90) }; } };
const esperar = (pg, fn, ms) => pg.waitForFunction(fn, { timeout: ms || 40000 }).catch(() => { });
const teclear = async (pg, sel, v) => { try { await pg.fill(sel, v, { timeout: 3000 }); return true; } catch (_) { return false; } };
{
  const { pg, errs } = await nueva(1440, 950);
  // el preset de SU liga: 10 equipos, $200, 15 rondas, half PPR
  await eva(pg, () => { try { mdFantazy26Toggle(true); } catch (_) { } });
  await abrirTab(pg);
  await esperar(pg, () => typeof TMR !== 'undefined' && !TMR.pricing && Object.keys(TMR.price || {}).length > 0);

  // (w) La columna del dinero se pinta en TODAS las filas visibles y con
  //     cifras de verdad. Un "$-" o un cero es una columna que no dice nada.
  const pay = await eva(pg, () => {
    const filas = document.querySelectorAll('#rk-body .rk-row').length;
    const cif = Array.from(document.querySelectorAll('#rk-body .rk-pr')).map(e => e.textContent.trim());
    const malos = cif.filter(t => !/^\$\d+$/.test(t) || Number(t.slice(1)) <= 0);
    return { filas, n: cif.length, malos: malos.slice(0, 3), top: cif.slice(0, 3), room: (typeof TMR !== 'undefined' ? TMR.room : null) };
  });
  ok('(w) la columna Pay se pinta en todas las filas, con cifras > 0',
    !pay._err && pay.n > 0 && pay.n === pay.filas && pay.malos.length === 0,
    pay._err || `${pay.n} cifras para ${pay.filas} filas, top ${(pay.top || []).join(' / ')} en ${JSON.stringify(pay.room)}`);

  // (w2) CONTROL DE SANIDAD del precio: sale del motor de subasta, no de un
  //      numero inventado. El bote de la sala son teams x budget y los precios
  //      de los draftables tienen que sumar eso, con el suelo de $1 de la cola
  //      larga por encima. Sin esto, la columna podria pintar cualquier cosa.
  const suma = await eva(pg, () => {
    const st = (typeof TMR !== 'undefined' && TMR.sticker) || null;
    if (!st || !TMR.room) return { falta: true };
    const total = Object.keys(st).reduce((a, k) => a + st[k], 0);
    return { total, bote: TMR.room.teams * TMR.room.budget, cola: Object.keys(st).length - TMR.room.teams * TMR.room.rounds };
  });
  ok('(w2) los precios suman el bote de la sala',
    !suma._err && !suma.falta && suma.total >= suma.bote && suma.total <= suma.bote + suma.cola + 5,
    suma._err || (suma.falta ? 'no hay precios de sala' : `$${suma.total} contra $${suma.bote} de bote mas ${suma.cola} jugadores al suelo de $1`));

  // (x) Edicion en el sitio: se toca la cifra, se escribe, Enter guarda, y
  //     sobrevive a recargar. Se guarda por ID, como el orden.
  const idPrim = await pg.$$eval('#rk-body .rk-row', r => r.length ? r[0].getAttribute('data-id') : null);
  const calc = await eva(pg, i => (typeof TMR !== 'undefined' && TMR.price) ? TMR.price[i] : null, idPrim);
  await eva(pg, i => tmrEditPrice(i), idPrim);
  const hayIn = await pg.$$eval('#rk-body .rk-pr-in', r => r.length);
  const lleno = await teclear(pg, '#rk-body .rk-pr-in', '95');
  if (lleno) await pg.keyboard.press('Enter');
  await pg.waitForTimeout(250);
  const trasEd = await eva(pg, () => {
    const b = document.querySelector('#rk-body .rk-pr');
    if (!b) return { falta: true };
    return { txt: b.textContent.trim(), manual: b.classList.contains('is-manual'), title: b.getAttribute('title') };
  });
  ok('(x1) tocar la cifra abre la caja y Enter guarda',
    hayIn === 1 && !trasEd._err && !trasEd.falta && trasEd.txt === '$95' && trasEd.manual && calc !== 95,
    `caja=${hayIn}, quedo ${trasEd.txt} marcado a mano=${trasEd.manual} (el motor decia $${calc})`);
  ok('(x2) el precio a mano ensena el del motor en el tooltip',
    !!calc && typeof trasEd.title === 'string' && new RegExp('\\$' + calc + '\\b').test(trasEd.title),
    JSON.stringify(trasEd.title));

  // Escape cancela: el blur que viene detras NO puede guardar
  const idSeg = await eva(pg, () => (typeof TMR !== 'undefined' && TMR.rows[1]) ? TMR.rows[1].id : null);
  await eva(pg, i => tmrEditPrice(i), idSeg);
  const lleno2 = await teclear(pg, '#rk-body .rk-pr-in', '7');
  if (lleno2) await pg.keyboard.press('Escape');
  await pg.waitForTimeout(200);
  const esc = await eva(pg, i => ({
    manual: (typeof TMR !== 'undefined' && TMR.manual) ? TMR.manual[i] == null : false,
    txt: (document.querySelectorAll('#rk-body .rk-pr')[1] || { textContent: '' }).textContent.trim()
  }), idSeg);
  ok('(x3) Escape cancela y no guarda nada', lleno2 && !esc._err && esc.manual && esc.txt !== '$7', JSON.stringify(esc));

  // objetivos, ANTES de recargar: se guardan en la misma llave. Se limpia el
  // plan primero: el seed del dueno ya dejo sus objetivos puestos.
  await eva(pg, () => { Object.keys(TMR.target).forEach(k => { if (TMR.target[k]) tmrToggleTarget(k); }); tmrToggleTarget(TMR.rows[0].id); tmrToggleTarget(TMR.rows[1].id); });
  await sincronizado(pg);
  await pg.waitForTimeout(150);

  await pg.reload({ waitUntil: 'networkidle' });
  await abrirTab(pg);
  await esperar(pg, () => typeof TMR !== 'undefined' && !TMR.pricing);
  const trasRec = await eva(pg, i => {
    const b = document.querySelector('#rk-body .rk-pr');
    return {
      txt: b ? b.textContent.trim() : null, manual: !!(b && b.classList.contains('is-manual')),
      guardado: (typeof TMR !== 'undefined' && TMR.manual) ? TMR.manual[i] : undefined,
      tgOn: document.querySelectorAll('#rk-body .rk-tg.on').length
    };
  }, idPrim);
  ok('(x4) el precio a mano y los objetivos sobreviven a recargar',
    !trasRec._err && trasRec.txt === '$95' && trasRec.manual && trasRec.guardado === 95 && trasRec.tgOn === 2,
    JSON.stringify(trasRec));

  // (y) volver al calculado: sin esto, escribir un precio seria una puerta de
  //     un solo sentido.
  const nMan = await pg.$$eval('#rk-body .rk-pr.is-manual', r => r.length);
  const nX = await pg.$$eval('#rk-body .rk-prx', r => r.length);
  await eva(pg, i => tmrClearPrice(i), idPrim);
  await pg.waitForTimeout(200);
  const vuelta = await eva(pg, i => {
    const b = document.querySelector('#rk-body .rk-pr');
    return {
      txt: b ? b.textContent.trim() : null, manual: !!(b && b.classList.contains('is-manual')),
      guardado: (typeof TMR !== 'undefined' && TMR.manual) ? TMR.manual[i] == null : false,
      calc: (typeof TMR !== 'undefined' && TMR.price) ? TMR.price[i] : null
    };
  }, idPrim);
  ok('(y) se puede volver al precio del motor',
    nMan === 1 && nX === 1 && !vuelta._err && !vuelta.manual && vuelta.guardado && vuelta.txt === '$' + vuelta.calc,
    `precios a mano=${nMan}, botones de vuelta=${nX}, ${JSON.stringify(vuelta)}`);

  // (z) La barra Build: la suma tiene que cuadrar CONTANDO el dolar de cada
  //     hueco sin objetivo. Sin ese dolar, un plan de tres cracks parece que
  //     cabe en $200 y el domingo se queda sin equipo.
  //     Se parte de un plan LIMPIO y barato (dos jugadores de mitad de tabla)
  //     para que el control negativo del rojo signifique algo.
  await eva(pg, () => {
    Object.keys(TMR.target).forEach(k => { if (TMR.target[k]) tmrToggleTarget(k); });
    tmrToggleTarget(TMR.rows[60].id);
    tmrToggleTarget(TMR.rows[61].id);
  });
  await pg.waitForTimeout(150);
  const bd = await eva(pg, () => {
    const el = document.getElementById('rk-build');
    if (!el || typeof tmrBuildData !== 'function') return { falta: true };
    const d = tmrBuildData();
    const esperado = Object.keys(TMR.target).filter(k => TMR.target[k])
      .reduce((a, k) => a + (tmrPriceOf(k) || 0), 0) + Math.max(0, d.cfg.rounds - d.n);
    return { d, esperado, oculto: el.hidden, txt: el.textContent.replace(/\s+/g, ' ').trim(), cls: el.className };
  });
  ok('(z1) la barra Build suma objetivos mas el relleno a $1',
    !bd._err && !bd.falta && !bd.oculto && bd.d.total === bd.esperado && bd.d.huecos === bd.d.cfg.rounds - bd.d.n
    && bd.txt.indexOf('$' + bd.d.total) >= 0 && bd.txt.indexOf('$' + bd.d.left) >= 0,
    bd._err || bd.falta ? 'no hay barra Build' :
      `${bd.d.n} objetivos a $${bd.d.gasto} + ${bd.d.huecos} huecos = $${bd.d.total} (esperado $${bd.esperado}), quedan $${bd.d.left}`);
  ok('(z2) con el plan dentro del presupuesto la barra NO va en rojo',
    !bd._err && !bd.falta && !bd.d.over && bd.cls.indexOf('is-over') < 0,
    bd.falta ? 'no hay barra Build' : `total $${bd.d.total} de $${bd.d.cfg.budget}, clase "${bd.cls}"`);

  // control POSITIVO del rojo: se marcan los doce primeros y no cabe
  const over = await eva(pg, () => {
    const el = document.getElementById('rk-build');
    if (!el || typeof tmrBuildData !== 'function') return { falta: true };
    for (let i = 0; i < 12; i++) if (!TMR.target[TMR.rows[i].id]) tmrToggleTarget(TMR.rows[i].id);
    return { d: tmrBuildData(), cls: el.className, txt: el.textContent.replace(/\s+/g, ' ').trim() };
  });
  ok('(z3) pasarse del presupuesto pinta la barra en rojo y lo dice',
    !over._err && !over.falta && over.d.over && over.cls.indexOf('is-over') >= 0
    && /Drop a target or lower a price/.test(over.txt) && over.txt.indexOf('-$' + Math.abs(over.d.left)) >= 0,
    over.falta ? 'no hay barra Build' : `$${over.d.total} de $${over.d.cfg.budget}, clase "${over.cls}"`);

  // el desglose por posicion tiene que contar los objetivos, no la lista
  const pos = await eva(pg, () => {
    if (typeof tmrBuildData !== 'function') return { falta: true };
    const d = tmrBuildData();
    const e = document.querySelector('#rk-build .rk-bd-pos');
    return { suma: ['QB', 'RB', 'WR', 'TE'].reduce((a, p) => a + (d.pos[p] || 0), 0), n: d.n, txt: e ? e.textContent.trim() : null };
  });
  ok('(z4) el desglose por posicion cuenta exactamente los objetivos',
    !pos._err && !pos.falta && pos.n > 0 && pos.suma === pos.n && !!pos.txt,
    pos.falta ? 'no hay barra Build' : `${pos.suma} repartidos de ${pos.n} objetivos: ${pos.txt}`);

  ok('(z5) consola limpia con la columna del dinero', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.screenshot({ path: '/tmp/qa-rk-build.png' });
  await pg.close();
}

// (z6) CERO SPINNERS. Mientras el feed de subasta no llega, la columna del
// dinero va en skeleton CON SU FORMA, no en blanco y no con una ruedita. Se
// fuerza reteniendo /api/stats/aav: sin retenerlo el feed llega tan rapido que
// el check pasaria por casualidad, que es lo mismo que no comprobar nada.
{
  const { pg, errs } = await nueva(1440, 950);
  let soltar = null;
  await pg.route('**/api/stats/aav*', async route => {
    await new Promise(r => { soltar = r; });
    await route.continue();
  });
  const abre = abrirTab(pg).catch(() => { });
  await pg.waitForTimeout(3500);
  const skel = await eva(pg, () => ({
    filas: document.querySelectorAll('#rk-body .rk-row').length,
    skel: document.querySelectorAll('#rk-body .rk-pr-skel').length,
    ruedas: document.querySelectorAll('#tab-rankings .spinner, #tab-rankings [class*="spin"]').length,
    forma: (function () {
      const e = document.querySelector('#rk-body .rk-pr-skel');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return Math.round(r.width) + 'x' + Math.round(r.height);
    })()
  }));
  ok('(z6) mientras el precio no llega, la columna va en skeleton y no hay spinner',
    !skel._err && skel.filas > 100 && skel.skel === skel.filas && skel.ruedas === 0 && !!skel.forma,
    JSON.stringify(skel));
  if (soltar) soltar();
  await abre;
  await esperar(pg, () => typeof TMR !== 'undefined' && !TMR.pricing);
  const tras = await eva(pg, () => ({
    skel: document.querySelectorAll('#rk-body .rk-pr-skel').length,
    cif: document.querySelectorAll('#rk-body .rk-pr').length
  }));
  ok('(z7) al llegar el feed el skeleton se va y quedan las cifras',
    !tras._err && tras.skel === 0 && tras.cif > 100, JSON.stringify(tras));
  ok('(z8) consola limpia con el feed retenido', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

console.log('\n=== My Rankings: entrando por la puerta de entrada ===');
// El cajon se abre y se navega igual que en qa-nav: con el control VISIBLE de
// cada ventana y abriendo el grupo padre si viene plegado.
const abrirCajon = pg => pg.evaluate(async () => {
  const abierto = () => { const m = document.getElementById('mob-menu'); return !!(m && m.classList.contains('open')); };
  if (abierto()) return 'ya estaba abierto';
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !!e.offsetParent; };
  const more = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'More' && visible(x));
  const burger = Array.from(document.querySelectorAll('button')).find(x => /mobMenuToggle/.test(x.getAttribute('onclick') || '') && visible(x));
  const bt = more || burger;
  if (!bt) return 'NO HAY BOTON VISIBLE';
  bt.click();
  await new Promise(r => setTimeout(r, 700));
  return abierto() ? 'abierto' : 'EL CAJON NO ABRIO';
});
const clicEnCajon = (pg, et) => pg.evaluate(async (et) => {
  const busca = () => Array.from(document.querySelectorAll('#mob-menu .mob-menu-item'))
    .find(x => x.textContent.trim().startsWith(et));
  for (const p of Array.from(document.querySelectorAll('#mob-menu .mob-parent'))) {
    const it = busca();
    if (it && it.offsetParent) break;
    p.click();
    await new Promise(r => setTimeout(r, 260));
  }
  const it = busca();
  if (!it || !it.offsetParent) return 'NO ESTA EN EL CAJON';
  it.click();
  await new Promise(r => setTimeout(r, 1500));
  return 'clicado';
}, et);

for (const [tag, w, h] of [['escritorio', 1440, 950], ['movil', 390, 844]]) {
  const { pg, errs } = await nueva(w, h);
  const c1 = await abrirCajon(pg);
  const c2 = await clicEnCajon(pg, 'My Rankings');
  ok('(A-' + tag + ') el cajon lleva a My Rankings', c1.indexOf('abierto') >= 0 && c2 === 'clicado', c1 + ' / ' + c2);
  if (c2 !== 'clicado') { await pg.close(); continue; }
  await pg.waitForFunction(() => document.querySelectorAll('#rk-body .rk-pr').length > 0, { timeout: 45000 }).catch(() => { });
  await pg.waitForFunction(() => !TMR.pricing, { timeout: 45000 }).catch(() => { });
  const st = await eva(pg, () => {
    const bd = document.getElementById('rk-build');
    const hero = document.querySelector('.mk-hero-shot');
    const hr = hero ? hero.getBoundingClientRect() : null;
    return {
      pantalla: (document.querySelector('.screen.active') || {}).id || 'NINGUNA',
      tab: (document.querySelector('.screen.active .tab-content.active') || {}).id || null,
      filas: document.querySelectorAll('#rk-body .rk-row').length,
      cifras: document.querySelectorAll('#rk-body .rk-pr').length,
      cero: Array.from(document.querySelectorAll('#rk-body .rk-pr')).filter(e => !/^\$\d+$/.test(e.textContent.trim())).length,
      build: !!bd && !bd.hidden,
      heroEnPantalla: hr ? (hr.top < window.innerHeight && hr.bottom > 0) : false,
      desborde: document.documentElement.scrollWidth > window.innerWidth
    };
  });
  // Sin haber pasado nunca por Mock Draft no hay memoria de sala, y la columna
  // NO puede caer en los defaults del HTML (12 equipos, 8 rondas): en subasta
  // ocho rondas son 96 huecos y el precio saldria de otro juego.
  const sala = await eva(pg, () => {
    const el = document.getElementById('rk-build');
    return { room: (typeof TMR !== 'undefined' ? TMR.room : null), bar: el ? el.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
  ok('(B2-' + tag + ') sin memoria de sala, precia una subasta normal y lo declara',
    !sala._err && sala.room && sala.room.teams === 10 && sala.room.budget === 200 && sala.room.rounds === 15 && sala.room.scoring === 0.5
    && /10 teams, \$200, half PPR, 1QB, 15 rounds/.test(sala.bar),
    JSON.stringify(sala.room) + ' | ' + sala.bar.slice(0, 90));
  ok('(B-' + tag + ') llegando por clic, la lista y la columna Pay estan puestas',
    !st._err && st.pantalla === 'screen-research' && st.tab === 'tab-rankings' && st.filas > 100
    && st.cifras === st.filas && st.cero === 0 && st.build && !st.heroEnPantalla && !st.desborde,
    JSON.stringify(st));
  ok('(C-' + tag + ') consola limpia entrando por clic', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

console.log('\n=== My Rankings: solo el dueno, y su documento en el servidor ===');
// (N) CONTROL NEGATIVO. Una cuenta que no es la del dueno abre My Rankings y
//     tiene que ver EXACTAMENTE lo de antes: sin columna Pay, sin barra Build,
//     sin objetivos, y sin mandar ni pedir nada a /api/perfil/rankings.
{
  const { pg, errs, puts, gets } = await nueva(1440, 950, { key: OTHER_KEY });
  await abrirTab(pg);
  await pg.waitForFunction(() => typeof TMR !== 'undefined' && TMR.owner !== null, { timeout: 15000 }).catch(() => { });
  await eva(pg, () => { tmrMove(0, 1); });   // un cambio: NO puede disparar un PUT
  await pg.waitForTimeout(1500);
  const neg = await eva(pg, () => ({
    owner: (typeof TMR !== 'undefined') ? TMR.owner : 'sin TMR',
    pr: document.querySelectorAll('#rk-body .rk-pr').length,
    tg: document.querySelectorAll('#rk-body .rk-tg').length,
    head: document.querySelectorAll('#rk-body .rk-ch-pay').length,
    build: (function () { const e = document.getElementById('rk-build'); return !!e && !e.hidden; })(),
    cols: getComputedStyle(document.querySelector('#rk-body .rk-row')).gridTemplateColumns.split(' ').length,
    cls: document.getElementById('tab-rankings').classList.contains('rk-owner'),
    sync: (document.getElementById('rk-sync') || {}).textContent || '',
    // Los botones del dueno no pueden estar NI escondidos: se comprueba el DOM,
    // no la visibilidad. Un boton con display:none sigue estando ahi para quien
    // abra el inspector, y "solo para el" tiene que aguantar eso.
    tools: document.querySelectorAll('#rk-owner-tools .rk-btn').length,
    juego: (function () { const g = document.getElementById('rk-game'); return !!g && !g.hidden; })(),
    hoja: (function () { const h = document.getElementById('rk-sheet'); return !!h && !h.hidden; })()
  }));
  ok('(N1) una cuenta corriente no ve columna Pay, ni objetivos, ni barra Build',
    !neg._err && neg.owner === false && neg.pr === 0 && neg.tg === 0 && neg.head === 0 && !neg.build && neg.cols === 7 && !neg.cls && neg.sync === '',
    JSON.stringify(neg));
  ok('(N2) una cuenta corriente no manda ni pide el documento del dueno', puts.length === 0 && gets.length === 0,
    `PUT=${puts.length} GET=${gets.length}`);
  ok('(N4) una cuenta corriente no tiene Tier Game ni Cheat Sheet, ni escondidos',
    !neg._err && neg.tools === 0 && !neg.juego && !neg.hoja,
    JSON.stringify({ tools: neg.tools, juego: neg.juego, hoja: neg.hoja }));
  ok('(N3) consola limpia sin ser el dueno', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

// (S) EL SEED, una sola vez. El documento del servidor arranca vacio en esta
//     corrida, asi que el primer navegador del dueno siembra los objetivos del
//     plan y la lista Love, lo declara si algo no resuelve, y lo sube. El
//     segundo navegador NO lo repite: lo dice el documento, no su localStorage.
let idGibbs = null, idSwift = null;
{
  // Las secciones de arriba ya corrieron como el dueno y subieron SU plan al
  // servidor: para probar el seed desde cero, el documento se borra antes.
  try { fs.unlinkSync(RK_FILE); } catch (_) { }
  const { pg, errs, puts } = await nueva(1440, 950);
  await abrirTab(pg);
  const s1 = await sincronizado(pg);
  const seed = await eva(pg, () => {
    const find = n => TMR.rows.find(r => r.name === n);
    const g = find('Jahmyr Gibbs'), sw = find("D'Andre Swift");
    let pref = {};
    try { pref = (JSON.parse(localStorage.getItem('tm_lv_pref') || 'null') || {}).pref || {}; } catch (_) { }
    return {
      flag: localStorage.getItem('tm_rk_seed_v1'),
      n: Object.keys(TMR.target).filter(k => TMR.target[k]).length,
      gibbs: g ? { id: g.id, on: !!TMR.target[g.id], love: pref[g.id] } : null,
      swift: sw ? { id: sw.id, on: !!TMR.target[sw.id], love: pref[sw.id] } : null,
      missing: TMR.seedMissing,
      declared: /Could not find on the board/.test((document.getElementById('rk-build') || {}).textContent || ''),
      tgOn: document.querySelectorAll('#rk-body .rk-tg.on').length
    };
  });
  idGibbs = seed.gibbs && seed.gibbs.id; idSwift = seed.swift && seed.swift.id;
  ok('(S1) el seed marca los objetivos del plan y la lista Love, y sube al servidor',
    s1 && !seed._err && seed.flag === '1' && seed.n >= 20 && seed.gibbs && seed.gibbs.on && seed.gibbs.love === 'love'
    && seed.swift && seed.swift.on && seed.swift.love === 'love' && seed.tgOn === seed.n && puts.length >= 1,
    JSON.stringify(seed) + ` PUT=${puts.length}`);
  ok('(S2) lo que no resuelve se declara, nunca se traga',
    !seed._err && Array.isArray(seed.missing) && (seed.missing.length === 0 || seed.declared),
    `sin resolver: ${JSON.stringify(seed.missing)}`);
  ok('(S3) consola limpia con el seed y el PUT', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');

  // Se quita a Gibbs del plan y se pone un precio a mano en la primera fila:
  // eso es lo que el OTRO navegador tiene que ver.
  await eva(pg, g => { tmrToggleTarget(g); tmrSetPrice(TMR.rows[0].id, 77); }, idGibbs);
  const s2 = await sincronizado(pg);
  ok('(S4) el cambio llega al servidor con debounce (un PUT por rafaga)', s2 && puts.length >= 2, `PUT=${puts.length}`);

  // (R) IDA Y VUELTA ENTRE DOS NAVEGADORES con la llave del dueno. Es la razon
  //     de la feature: editar desde el celular y verlo en la computadora.
  const B = await nueva(390, 844);
  await abrirTab(B.pg);
  await B.pg.waitForFunction(() => typeof TMR !== 'undefined' && TMR.owner === true && !TMR.pricing, { timeout: 30000 }).catch(() => { });
  const enB = await eva(B.pg, g => {
    const b = document.querySelector('#rk-body .rk-pr');
    return {
      txt: b ? b.textContent.trim() : null, manual: !!(b && b.classList.contains('is-manual')),
      price: TMR.manual[TMR.rows[0].id], gibbs: !!TMR.target[g], flag: localStorage.getItem('tm_rk_seed_v1'),
      n: Object.keys(TMR.target).filter(k => TMR.target[k]).length,
      desborde: document.documentElement.scrollWidth > window.innerWidth,
      tgBox: (function () { const e = document.querySelector('#rk-body .rk-tg'); if (!e) return null; const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()
    };
  }, idGibbs);
  ok('(R1) el segundo navegador (390px) recibe el precio a mano y el plan del primero',
    !enB._err && enB.txt === '$77' && enB.manual && enB.price === 77 && enB.n >= 19 && !enB.desborde, JSON.stringify(enB));
  ok('(R2) el seed NO se repite en el segundo navegador: Gibbs sigue fuera del plan y la bandera viene del documento',
    !enB._err && enB.gibbs === false && enB.flag === '1', JSON.stringify({ gibbs: enB.gibbs, flag: enB.flag }));

  // Vuelta: el telefono cambia el precio y la computadora lo ve al volver el foco
  await eva(B.pg, () => tmrSetPrice(TMR.rows[0].id, 66));
  const s3 = await sincronizado(B.pg);
  await eva(pg, () => window.dispatchEvent(new Event('focus')));
  await pg.waitForFunction(() => TMR.manual[TMR.rows[0].id] === 66, { timeout: 10000 }).catch(() => { });
  const enA = await eva(pg, () => ({
    txt: (document.querySelector('#rk-body .rk-pr') || {}).textContent, price: TMR.manual[TMR.rows[0].id]
  }));
  ok('(R3) la vuelta: el primer navegador recibe al volver el foco lo que el segundo edito',
    s3 && !enA._err && enA.price === 66 && String(enA.txt).trim() === '$66', JSON.stringify(enA));
  ok('(R4) consola limpia en los dos navegadores', errs.length === 0 && B.errs.length === 0,
    errs.concat(B.errs).slice(0, 3).join(' | ') || 'sin errores');
  await B.pg.close();
  await pg.close();
}

// (O) el endpoint del dueno responde 200 a todos y solo dice si a la llave listada
{
  const h = k => ({ 'x-tm-acct': k });
  const a = await fetch(BASE + '/api/perfil/owner', { headers: h(OWNER_KEY) }).then(r => r.json()).catch(() => null);
  const o = await fetch(BASE + '/api/perfil/owner', { headers: h(OTHER_KEY) }).then(r => r.json()).catch(() => null);
  const anon = await fetch(BASE + '/api/perfil/rankings').then(r => r.status).catch(() => 0);
  const ajeno = await fetch(BASE + '/api/perfil/rankings', { headers: h(OTHER_KEY) }).then(r => r.status).catch(() => 0);
  const gordo = await fetch(BASE + '/api/perfil/rankings', { method: 'PUT', headers: { ...h(OWNER_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: [], pad: 'x'.repeat(210 * 1024) }) }).then(r => r.status).catch(() => 0);
  const malo = await fetch(BASE + '/api/perfil/rankings', { method: 'PUT', headers: { ...h(OWNER_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: 'no' }) }).then(r => r.status).catch(() => 0);
  ok('(O1) /api/perfil/owner: true para el dueno, false para el resto', !!a && a.owner === true && !!o && o.owner === false, JSON.stringify({ a, o }));
  ok('(O2) /api/perfil/rankings: 401 anonimo, 403 ajeno, 413 por encima del tope, 400 con forma mala',
    anon === 401 && ajeno === 403 && (gordo === 413) && malo === 400, JSON.stringify({ anon, ajeno, gordo, malo }));
}


console.log('\n=== Vincular otro dispositivo con un codigo ===');
// La cuenta de esta app es POR NAVEGADOR, asi que reinstalar la PWA deja al
// dueno fuera de sus propias pantallas. Lo que aqui se prueba es el camino
// entero: el dueno pide el codigo, el aparato nuevo lo teclea, y a partir de
// ahi ve lo mismo. Y sobre todo lo que NO puede pasar: que reparta codigos
// quien no es dueno, que un codigo sirva dos veces, o que se pueda adivinar.
{
  const cab = k => ({ 'x-tm-acct': k, 'Content-Type': 'application/json' });
  const nuevo = (k, b) => fetch(BASE + '/api/perfil/link/new',
    { method: 'POST', headers: k ? cab(k) : { 'Content-Type': 'application/json' }, body: b || '{}' });
  const reclamar = (k, code) => fetch(BASE + '/api/perfil/link/claim',
    { method: 'POST', headers: k ? cab(k) : { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const esDueno = k => fetch(BASE + '/api/perfil/owner', { headers: { 'x-tm-acct': k } })
    .then(r => r.json()).then(j => !!(j && j.owner)).catch(() => null);

  const sAjeno = await nuevo(OTHER_KEY).then(r => r.status).catch(() => 0);
  const sAnon = await nuevo(null).then(r => r.status).catch(() => 0);
  const cAnon = await reclamar(null, '123456').then(r => r.status).catch(() => 0);
  ok('(L1) solo un dispositivo ya vinculado reparte codigos: 403 ajeno, 401 anonimo',
    sAjeno === 403 && sAnon === 401 && cAnon === 401, JSON.stringify({ sAjeno, sAnon, cAnon }));

  // (L2) el dueno pide el codigo POR LA UI, con el boton que ve en pantalla.
  const A = await nueva(1440, 950);
  await abrirTab(A.pg);
  await sincronizado(A.pg);
  await esperar(A.pg, () => typeof TMR !== 'undefined' && !TMR.pricing && Object.keys(TMR.price || {}).length > 0, 30000);
  const planA = await eva(A.pg, () => TMR.manual);
  let clic = true;
  try { await A.pg.click('#rk-owner-tools button[onclick="tmrLinkOpen()"]', { timeout: 5000 }); }
  catch (_) { clic = false; }
  await esperar(A.pg, () => { const e = document.getElementById('lk-code-out'); return !!e && /^[0-9]{6}$/.test((e.textContent || '').trim()); }, 15000);
  const panel = await eva(A.pg, () => ({
    code: ((document.getElementById('lk-code-out') || {}).textContent || '').trim(),
    left: ((document.getElementById('lk-left') || {}).textContent || '').trim(),
    // El codigo se lee de lejos: si sale con el mismo cuerpo que un parrafo,
    // el que lo teclea en el otro aparato lo va a leer mal.
    px: (function () { const e = document.getElementById('lk-code-out'); return e ? Math.round(parseFloat(getComputedStyle(e).fontSize)) : 0; })(),
    guia: /Have a code/i.test((document.getElementById('rk-link') || {}).textContent || '')
  }));
  const code = (panel && panel.code) || '';
  // El mismo panel en el telefono: el codigo se reparte desde donde uno este,
  // y este es un producto que se abre desde WhatsApp.
  await A.pg.setViewportSize({ width: 390, height: 844 });
  await A.pg.waitForTimeout(200);
  const enMovil = await eva(A.pg, () => {
    const e = document.getElementById('lk-code-out');
    const r = e ? e.getBoundingClientRect() : null;
    return {
      desborde: document.documentElement.scrollWidth > window.innerWidth,
      dentro: !!r && r.left >= 0 && r.right <= window.innerWidth,
      px: e ? Math.round(parseFloat(getComputedStyle(e).fontSize)) : 0
    };
  });
  await A.pg.setViewportSize({ width: 1440, height: 950 });
  await A.pg.waitForTimeout(200);
  ok('(L2) el dueno pide un codigo desde la UI y sale grande, con el tiempo que queda',
    clic && /^[0-9]{6}$/.test(code) && /Expires in \d+:\d\d/.test(panel.left) && panel.px >= 28 && panel.guia
    && !enMovil._err && !enMovil.desborde && enMovil.dentro && enMovil.px >= 28,
    JSON.stringify({ ...panel, movil: enMovil }));

  // (L3) el aparato nuevo: primero un codigo que NO existe. Se deriva del real
  //      cambiando el ultimo digito, para que nunca choque por azar con el.
  const malo = code ? code.slice(0, 5) + String((Number(code[5]) + 1) % 10) : '000000';
  const B = await nueva(390, 844, { key: NEW_KEY });
  await abrirTab(B.pg);
  await esperar(B.pg, () => typeof TMR !== 'undefined' && TMR.owner === false, 25000);
  const antes = await eva(B.pg, () => ({
    tools: document.querySelectorAll('#rk-owner-tools .rk-btn').length,
    puerta: document.querySelectorAll('#rk-owner-tools .rk-linkq').length,
    pr: document.querySelectorAll('#rk-body .rk-pr').length
  }));
  let clicB = true;
  try { await B.pg.click('#rk-owner-tools .rk-linkq', { timeout: 5000 }); } catch (_) { clicB = false; }
  await teclear(B.pg, '#lk-code', malo);
  await eva(B.pg, () => tmrLinkSubmit());
  await esperar(B.pg, () => /not valid|already used|expired/i.test((document.getElementById('lk-msg') || {}).textContent || ''), 12000);
  const tras = await eva(B.pg, () => ({
    msg: ((document.getElementById('lk-msg') || {}).textContent || '').trim(),
    owner: TMR.owner,
    pr: document.querySelectorAll('#rk-body .rk-pr').length,
    tools: document.querySelectorAll('#rk-owner-tools .rk-btn').length
  }));
  ok('(L3) el aparato nuevo llega sin nada y un codigo inventado no lo deja entrar',
    !antes._err && antes.tools === 0 && antes.puerta === 1 && antes.pr === 0
    && clicB && !tras._err && /not valid/i.test(tras.msg) && tras.owner === false && tras.pr === 0 && tras.tools === 0,
    JSON.stringify({ antes, tras }));

  // (L4) ahora el codigo bueno, tecleado en la misma casilla.
  await teclear(B.pg, '#lk-code', code);
  await eva(B.pg, () => tmrLinkSubmit());
  await esperar(B.pg, () => typeof TMR !== 'undefined' && TMR.owner === true
    && document.querySelectorAll('#rk-body .rk-pr').length > 0, 30000);
  await sincronizado(B.pg);
  const dentro = await eva(B.pg, () => ({
    owner: TMR.owner,
    cls: document.getElementById('tab-rankings').classList.contains('rk-owner'),
    pr: document.querySelectorAll('#rk-body .rk-pr').length,
    tg: document.querySelectorAll('#rk-body .rk-tg').length,
    juego: /Tier Game/.test(document.getElementById('rk-owner-tools').textContent || ''),
    hoja: /Cheat Sheet/.test(document.getElementById('rk-owner-tools').textContent || ''),
    manual: TMR.manual,
    dicho: /Device linked/i.test((document.getElementById('rk-link') || {}).textContent || ''),
    desborde: document.documentElement.scrollWidth > window.innerWidth
  }));
  ok('(L4) con el codigo bueno pasa a dueno y le baja la MISMA lista, sin recargar',
    !dentro._err && dentro.owner === true && dentro.cls && dentro.pr > 0 && dentro.tg > 0
    && dentro.juego && dentro.hoja && dentro.dicho && !dentro.desborde
    && JSON.stringify(dentro.manual) === JSON.stringify(planA) && Object.keys(planA || {}).length > 0,
    JSON.stringify({ ...dentro, manual: Object.keys(dentro.manual || {}).length, planA: Object.keys(planA || {}).length }));

  // Y sobrevive a recargar: el permiso vive en el servidor, no en la pagina.
  await B.pg.reload({ waitUntil: 'networkidle' });
  await abrirTab(B.pg);
  await esperar(B.pg, () => typeof TMR !== 'undefined' && TMR.owner === true, 25000);
  const otraVez = await eva(B.pg, () => ({ owner: TMR.owner, pr: document.querySelectorAll('#rk-body .rk-pr').length }));
  ok('(L5) el vinculo sobrevive a recargar el aparato nuevo',
    !otraVez._err && otraVez.owner === true && otraVez.pr > 0, JSON.stringify(otraVez));

  // (L6) el mismo codigo, otra cuenta: no sirve dos veces.
  // Un codigo rechazado responde 200 con owner:false a proposito: Chrome
  // imprime en consola cualquier respuesta que no sea 2xx, y teclear mal seis
  // digitos es un camino normal de usuario. Lo que se comprueba es que el
  // rechazo SEA un rechazo, no el codigo HTTP.
  const rep = await reclamar(NEW2_KEY, code).then(async r => ({ s: r.status, j: await r.json().catch(() => null) })).catch(() => ({ s: 0, j: null }));
  const dueno2 = await esDueno(NEW2_KEY);
  ok('(L6) un codigo usado no vuelve a servir, y quien lo intento sigue afuera',
    rep.s === 200 && rep.j && rep.j.owner === false && /already used/i.test(rep.j.error || '') && dueno2 === false,
    JSON.stringify({ ...rep, dueno2 }));

  // (L7) adivinar sale caro: cinco intentos por cuenta y ventana, y el sexto ya
  //      no llega ni a mirar el codigo.
  const tiros = [];
  for (let i = 0; i < 6; i++) {
    tiros.push(await reclamar(RL_KEY, String(100000 + i))
      .then(async r => ({ s: r.status, e: ((await r.json().catch(() => null)) || {}).error || '' }))
      .catch(() => ({ s: 0, e: '' })));
  }
  const bruto = await esDueno(RL_KEY);
  ok('(L7) el que adivina se queda sin tiros: 5 rechazos y despues el corte',
    tiros.every(x => x.s === 200) && tiros.slice(0, 5).every(x => /not valid/i.test(x.e))
    && /too many tries/i.test(tiros[5].e) && bruto === false,
    JSON.stringify({ tiros, bruto }));

  // (L8) CONTROL NEGATIVO. Vincular un aparato no abre la puerta a nadie mas:
  //      una llave cualquiera que nunca tecleo un codigo sigue siendo cuenta
  //      corriente. Sin esto, (L4) pasaria igual con un permitido() roto que
  //      dijera que si a todo el mundo.
  const otro = await esDueno(OTHER_KEY);
  const rk = await fetch(BASE + '/api/perfil/rankings', { headers: { 'x-tm-acct': OTHER_KEY } }).then(r => r.status).catch(() => 0);
  ok('(L8) CONTROL NEGATIVO: vincular uno no vincula a los demas',
    otro === false && rk === 403, JSON.stringify({ otro, rk }));

  ok('(L9) consola limpia vinculando, en los dos aparatos', A.errs.length === 0 && B.errs.length === 0,
    A.errs.concat(B.errs).slice(0, 3).join(' | ') || 'sin errores');

  // (L10) EL OTRO CAMINO DE ENTRADA. Cuando el dueno reinstala la app, la
  //       pantalla por la que se entera de que algo va mal es /perfil, que le
  //       responde 403. Ahi tiene que estar la misma puerta, o el unico camino
  //       de vuelta seria acordarse de que existe un tab llamado My Rankings.
  //       Aqui NO se mide la consola: Chrome imprime cualquier 403, y este 403
  //       es la respuesta correcta a una cuenta que todavia no se vinculo.
  const code2 = await nuevo(OWNER_KEY).then(r => r.json()).then(j => (j && j.code) || '').catch(() => '');
  const C = await nueva(390, 844, { key: NEW2_KEY, user: 'qamacdraft' });
  await eva(C.pg, () => switchScreen('perfil'));
  await esperar(C.pg, () => !!document.getElementById('pf-code'), 20000);
  const caja = await eva(C.pg, () => {
    const i = document.getElementById('pf-code');
    const r = i ? i.getBoundingClientRect() : null;
    return {
      hay: !!i, alto: r ? Math.round(r.height) : 0, modo: i ? i.getAttribute('inputmode') : '',
      desborde: document.documentElement.scrollWidth > window.innerWidth,
      // El id propio tiene que seguir saliendo: es la salida de emergencia por
      // env var, y esta feature no la reemplaza, la evita.
      id: /[0-9a-f]{32}/.test(document.getElementById('perfil-cuerpo').textContent || '')
    };
  });
  await teclear(C.pg, '#pf-code', code2);
  await eva(C.pg, () => _perfilLink());
  // El mensaje "Linked" es transitorio a proposito: al vincular se vuelve a
  // pintar el perfil entero y con el se va la tarjeta del 403. Lo que se mide
  // es el efecto, no el cartel: la casilla del codigo ya no esta, y el
  // servidor da por dueno a esta cuenta.
  await esperar(C.pg, () => !document.getElementById('pf-code'), 20000);
  const fuera = await eva(C.pg, () => !document.getElementById('pf-code'));
  const dueno3 = await esDueno(NEW2_KEY);
  ok('(L10) la misma puerta esta en /perfil, que es donde el dueno ve el 403',
    !caja._err && caja.hay && caja.alto >= 44 && caja.modo === 'numeric' && !caja.desborde && caja.id
    && fuera === true && dueno3 === true,
    JSON.stringify({ caja, fuera, dueno3 }));
  await C.pg.close();
  await B.pg.close();
  await A.pg.close();
}

console.log('\n=== Tier Game: la inferencia, como funcion pura ===');
// (G) La inferencia NO se prueba pintando: se prueba con casos armados a mano,
//     que es para lo que tmrTiersInfer es pura y esta exportada. Un universo de
//     mentira de doce jugadores hace visible lo que en la lista real de 200 se
//     esconde. Corre dentro de la pagina porque ahi vive la funcion, no porque
//     necesite el DOM: no toca ni uno.
{
  const { pg, errs } = await nueva(1440, 950);
  const r = await eva(pg, () => {
    const rows = [
      { id: 'r1', name: 'A Uno', pos: 'RB', team: 'X' }, { id: 'w1', name: 'B Dos', pos: 'WR', team: 'X' },
      { id: 'r2', name: 'C Tres', pos: 'RB', team: 'X' }, { id: 'w2', name: 'D Cuatro', pos: 'WR', team: 'X' },
      { id: 'r3', name: 'E Cinco', pos: 'RB', team: 'X' }, { id: 'w3', name: 'F Seis', pos: 'WR', team: 'X' },
      { id: 'q1', name: 'G Siete', pos: 'QB', team: 'X' }, { id: 'r4', name: 'H Ocho', pos: 'RB', team: 'X' },
      { id: 't1', name: 'I Nueve', pos: 'TE', team: 'X' }, { id: 'w4', name: 'J Diez', pos: 'WR', team: 'X' },
      { id: 'q2', name: 'K Once', pos: 'QB', team: 'X' }, { id: 't2', name: 'L Doce', pos: 'TE', team: 'X' }
    ];
    const base = rows.map(x => x.id).join(',');
    const entre = (res, x, y) => {
      const A = res.order.indexOf(x), B = res.order.indexOf(y);
      for (let q = Math.min(A, B); q < Math.max(A, B); q++) if (res.breaks[res.order[q]]) return true;
      return false;
    };
    const vacio = tmrTiersInfer(rows, []);
    const same = tmrTiersInfer(rows, [{ a: 'r1', b: 'w1', v: 0 }]);
    const claro = tmrTiersInfer(rows, [{ a: 'r1', b: 'w1', v: 2 }]);
    const gana = tmrTiersInfer(rows, [{ a: 'r1', b: 'w1', v: 2 }, { a: 'r1', b: 'w1', v: 0 }]);
    const poco = tmrTiersInfer(rows, [{ a: 'r1', b: 'w1', v: 1 }]);
    const tr = tmrTiersInfer(rows, [{ a: 'r3', b: 'r1', v: 2 }, { a: 'r1', b: 'r2', v: 2 }]);
    const quieto = tmrTiersInfer(rows, [{ a: 'r4', b: 'r1', v: 2 }]);
    // el juego, jugado entero: ni una pareja repetida
    let ans = [], visto = {}, repes = 0, cruces = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      const p = tmrGameNext(rows, ans);
      if (!p) break;
      const k = [p.a, p.b].sort().join('|');
      if (visto[k]) repes++;
      visto[k] = 1;
      if (p.cross) cruces++;
      ans.push({ a: p.a, b: p.b, v: 1 });
      n++;
    }
    return {
      base,
      vacio: { ord: vacio.order.join(','), cortes: vacio.cuts.length, movidos: vacio.moved },
      sameCorta: entre(same, 'r1', 'w1'),
      claroCorta: entre(claro, 'r1', 'w1'),
      ganaSame: entre(gana, 'r1', 'w1'),
      pocoCorta: entre(poco, 'r1', 'w1'),
      tr: { ok: tr.order.indexOf('r3') < tr.order.indexOf('r1') && tr.order.indexOf('r1') < tr.order.indexOf('r2'),
        c1: entre(tr, 'r3', 'r1'), c2: entre(tr, 'r1', 'r2'), ord: tr.order.join(',') },
      // r4 y r1 se comparan; los que no juegan conservan su puesto relativo
      quieto: { t2: quieto.order.indexOf('t2') === 11, q2: quieto.order.indexOf('q2') === 10, ord: quieto.order.join(',') },
      juego: { n, repes, cruces, prog: tmrGameProgress(rows, ans).pct }
    };
  });
  ok('(G1) sin respuestas la lista no se mueve y no aparece ni un corte',
    !r._err && r.vacio.ord === r.base && r.vacio.cortes === 0 && r.vacio.movidos === 0, JSON.stringify(r.vacio));
  ok('(G2) un "same tier" declarado NUNCA corta entre esos dos', !r._err && r.sameCorta === false, JSON.stringify({ same: r.sameCorta }));
  ok('(G3) un "clearly" SIEMPRE deja un corte entre los dos', !r._err && r.claroCorta === true, JSON.stringify({ claro: r.claroCorta }));
  ok('(G4) el "same tier" gana al "clearly" cuando el dueno se contradice', !r._err && r.ganaSame === false, JSON.stringify({ gana: r.ganaSame }));
  ok('(G5) un "slightly" ordena pero no corta', !r._err && r.pocoCorta === false, JSON.stringify({ poco: r.pocoCorta }));
  ok('(G6) transitividad: r3 > r1 > r2, con su corte en cada escalon',
    !r._err && r.tr.ok && r.tr.c1 && r.tr.c2, JSON.stringify(r.tr));
  ok('(G7) el que no aparece en ninguna respuesta conserva su puesto',
    !r._err && r.quieto.t2 && r.quieto.q2, JSON.stringify(r.quieto));
  ok('(G8) el juego no repite una pareja y llega a resolver los tiers',
    !r._err && r.juego.n > 20 && r.juego.repes === 0 && r.juego.prog === 100, JSON.stringify(r.juego));
  ok('(G9) consola limpia con la inferencia', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

console.log('\n=== Tier Game: jugando, entrando por la puerta de entrada ===');
// (J) Se entra CLICANDO el boton, no llamando tmrGameOpen(): la leccion del
//     2026-08-26 es que un gate que entra por la puerta de servicio deja pasar
//     una feature a la que no se puede llegar.
let juegoIds = null;
{
  const { pg, errs, puts } = await nueva(1440, 950);
  await abrirTab(pg);
  await esperar(pg, () => typeof TMR !== 'undefined' && TMR.owner === true && !TMR.pricing
    && Object.keys(TMR.price || {}).length > 0, 45000);
  const hayBtn = await eva(pg, () => {
    const b = Array.from(document.querySelectorAll('#rk-owner-tools .rk-btn')).map(x => x.textContent.trim());
    return { btns: b };
  });
  ok('(J1) el dueno tiene los botones Tier Game y Cheat Sheet en las herramientas',
    !hayBtn._err && hayBtn.btns.indexOf('Tier Game') >= 0 && hayBtn.btns.indexOf('Cheat Sheet') >= 0,
    JSON.stringify(hayBtn.btns));

  await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#rk-owner-tools .rk-btn')).find(x => /Tier Game/.test(x.textContent));
    if (b) b.click();
  });
  await esperar(pg, () => { const g = document.getElementById('rk-game'); return g && !g.hidden && g.querySelectorAll('.rk-gm-b').length === 5; }, 15000);
  const abierto = await eva(pg, () => {
    const g = document.getElementById('rk-game');
    const btns = Array.from(g.querySelectorAll('.rk-gm-b'));
    const cartas = Array.from(g.querySelectorAll('.rk-gm-card')).map(c => ({
      nm: (c.querySelector('.rk-gm-nm') || {}).textContent,
      txt: c.textContent.replace(/\s+/g, ' ').trim(),
      dinero: /\$/.test(c.textContent) || !!c.querySelector('.rk-gm-pay'),
      foto: !!c.querySelector('img[src*="sleepercdn"]')
    }));
    return {
      visible: !g.hidden,
      lista: (document.querySelector('#tab-rankings .rk-list') || {}).offsetParent === null,
      n: btns.length,
      chico: btns.filter(b => b.getBoundingClientRect().height < 44).length,
      txt: btns.map(b => b.textContent.trim()),
      cartas,
      prog: (document.getElementById('rk-gm-pg') || {}).textContent || '',
      sub: (g.querySelector('.rk-gm-t span') || {}).textContent || '',
      dineroEnPantalla: /\$/.test(g.textContent),
      pareja: TMR.gamePair ? [TMR.gamePair.a, TMR.gamePair.b] : null
    };
  });
  ok('(J2) el juego abre con la pareja y cinco respuestas de 44px+, y SIN un solo precio',
    !abierto._err && abierto.visible && abierto.lista && abierto.n === 5 && abierto.chico === 0
    && abierto.cartas.length === 2 && abierto.cartas.every(c => c.nm && c.foto && !c.dinero)
    && !abierto.dineroEnPantalla && /Mac turns your order into what to pay/.test(abierto.sub)
    && /Same tier/.test(abierto.txt[2] || '')
    && /^\d+ answers? · \d+ of \d+ tier boundaries resolved$/.test(abierto.prog.trim()),
    JSON.stringify({ n: abierto.n, chico: abierto.chico, cartas: abierto.cartas, sub: abierto.sub, prog: abierto.prog }));

  // Se contestan cinco parejas clicando de verdad. La pareja tiene que cambiar
  // en cada respuesta y el progreso tiene que subir: una barra decorativa se
  // quedaria quieta y este check no lo veria.
  const antes = abierto.pareja;
  const vistas = [];
  for (let i = 0; i < 5; i++) {
    const p = await eva(pg, () => TMR.gamePair ? TMR.gamePair.a + '|' + TMR.gamePair.b : null);
    vistas.push(p);
    await pg.evaluate(i2 => {
      const b = document.querySelectorAll('#rk-game .rk-gm-b')[i2];
      if (b) b.click();
    }, [0, 2, 4, 1, 3][i]);
    await pg.waitForTimeout(120);
  }
  const tras = await eva(pg, () => ({
    n: TMR.game.length,
    pareja: TMR.gamePair ? TMR.gamePair.a + '|' + TMR.gamePair.b : null,
    prog: tmrGameProgress(TMR.rows, TMR.game),
    v: TMR.game.map(x => x.v)
  }));
  const repetidas = vistas.filter((x, i) => vistas.indexOf(x) !== i).length;
  ok('(J3) contestar guarda la respuesta, cambia de pareja y mueve el progreso',
    !tras._err && tras.n === 5 && repetidas === 0 && tras.prog.answered === 5 && tras.prog.resolved > 0
    && JSON.stringify(tras.v) === JSON.stringify([2, 0, -2, 1, -1]),
    JSON.stringify({ n: tras.n, repetidas, prog: tras.prog, v: tras.v }));

  await pg.evaluate(() => { const b = document.getElementById('rk-gm-undo'); if (b) b.click(); });
  await pg.waitForTimeout(150);
  const undo = await eva(pg, () => ({ n: TMR.game.length, pareja: TMR.gamePair ? TMR.gamePair.a + '|' + TMR.gamePair.b : null }));
  ok('(J4) Undo borra la ultima respuesta y devuelve ESA pareja, no otra',
    !undo._err && undo.n === 4 && undo.pareja === vistas[4], JSON.stringify({ undo, esperaba: vistas[4] }));

  // Se dejan respuestas de sobra para que el Apply tenga algo que hacer, y se
  // apunta el estado ANTES para poder comprobar que de verdad cambio.
  await eva(pg, () => {
    for (let i = 0; i < 40; i++) {
      const p = tmrGameNext(TMR.rows, TMR.game);
      if (!p) break;
      TMR.game.push({ a: p.a, b: p.b, v: (i % 5) - 2, t: Date.now() });
    }
    TMR.gamePair = tmrGameNext(TMR.rows, TMR.game);
    tmrGameSave(); tmrGamePaint();
  });
  const prevN = puts.length;
  const previo = await eva(pg, () => ({
    orden: TMR.rows.slice(0, 100).map(r => r.id).join(','),
    cortes: Object.keys(TMR.breakAfter).filter(k => TMR.breakAfter[k]).length,
    espera: tmrTiersInfer(TMR.rows, TMR.game)
  }));
  // Nunca se lee dentro de un eva que pudo fallar sin red: un acceso crudo
  // aqui tumba la corrida entera contra el codigo roto, que es exactamente
  // para lo que existe este bloque.
  const esp = (previo && previo.espera) || { moved: -1, cuts: [], order: [] };
  await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#rk-game .rk-btn')).find(x => /Build tiers/.test(x.textContent));
    if (b) b.click();
  });
  await esperar(pg, () => { const p = document.getElementById('rk-gm-prev'); return p && !p.hidden && /moves/.test(p.textContent); }, 10000);
  const vistaPrevia = await eva(pg, () => (document.getElementById('rk-gm-prev') || {}).textContent || '');
  ok('(J5) antes de aplicar, la vista previa DICE cuanto se mueve y cuantos cortes deja',
    typeof vistaPrevia === 'string' && new RegExp('moves ' + esp.moved + ' of').test(vistaPrevia.replace(/\s+/g, ' '))
    && new RegExp('leaves ' + esp.cuts.length + ' tier').test(vistaPrevia.replace(/\s+/g, ' ')),
    JSON.stringify(String(vistaPrevia).replace(/\s+/g, ' ').slice(0, 190)));

  await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#rk-gm-prev .rk-btn')).find(x => /Apply tiers/.test(x.textContent));
    if (b) b.click();
  });
  await esperar(pg, () => { const g = document.getElementById('rk-game'); return !g || g.hidden; }, 10000);
  const aplicado = await eva(pg, () => ({
    orden: TMR.rows.slice(0, 100).map(r => r.id).join(','),
    cortes: Object.keys(TMR.breakAfter).filter(k => TMR.breakAfter[k]).length,
    bandas: document.querySelectorAll('#rk-body .rk-tier').length,
    lista: document.querySelectorAll('#rk-body .rk-row').length,
    guardado: (JSON.parse(localStorage.getItem('tm_rankings_v1') || '{}').order || []).slice(0, 100).join(',')
  }));
  ok('(J6) Apply reordena la lista de verdad, pone los cortes inferidos y los guarda',
    !aplicado._err && aplicado.orden === esp.order.join(',') && aplicado.orden !== previo.orden
    && aplicado.cortes === esp.cuts.length && aplicado.bandas > 1 && aplicado.lista > 100
    && aplicado.guardado === aplicado.orden,
    JSON.stringify({ cortes: aplicado.cortes, esperaba: esp.cuts.length, bandas: aplicado.bandas, movio: aplicado.orden !== previo.orden }));

  const s = await sincronizado(pg);
  ok('(J7) el juego y los tiers aplicados suben al servidor', s && puts.length > prevN, `PUT ${prevN} -> ${puts.length}`);
  juegoIds = await eva(pg, () => TMR.game.map(x => x.a + '|' + x.b + '|' + x.v).join(','));
  ok('(J8) consola limpia jugando y aplicando', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

// (K) Retomar desde el OTRO dispositivo. Es la razon de guardar el juego en el
//     documento del servidor y no solo en localStorage: el dueno contesta
//     parejas en el celular en la cola del banco y sigue en la computadora.
{
  const { pg, errs } = await nueva(390, 844);
  await abrirTab(pg);
  await esperar(pg, () => typeof TMR !== 'undefined' && TMR.owner === true && Array.isArray(TMR.game) && TMR.game.length > 0, 25000);
  await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#rk-owner-tools .rk-btn')).find(x => /Tier Game/.test(x.textContent));
    if (b) b.click();
  });
  await esperar(pg, () => { const g = document.getElementById('rk-game'); return g && !g.hidden; }, 15000);
  const seg = await eva(pg, () => {
    const btns = Array.from(document.querySelectorAll('#rk-game .rk-gm-b'));
    return {
      juego: TMR.game.map(x => x.a + '|' + x.b + '|' + x.v).join(','),
      n: TMR.game.length,
      desborde: document.documentElement.scrollWidth > window.innerWidth,
      chico: btns.filter(b => b.getBoundingClientRect().height < 44).length,
      fuera: btns.filter(b => { const r = b.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; }).length,
      prog: (document.getElementById('rk-gm-pg') || {}).textContent || ''
    };
  });
  ok('(K1) el segundo navegador (390px) retoma el juego exactamente donde quedo',
    !seg._err && seg.juego === juegoIds && seg.n > 40, `${seg.n} respuestas, iguales: ${seg.juego === juegoIds}`);
  ok('(K2) a 390px el juego no desborda y sus botones se tocan',
    !seg._err && !seg.desborde && seg.chico === 0 && seg.fuera === 0, JSON.stringify(seg).slice(0, 160));
  ok('(K3) consola limpia retomando en el telefono', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

console.log('\n=== Tier Game: el prior del mercado, la escalada y las contradicciones ===');
// (M) La parte "inteligente", probada como funcion pura sobre un universo con
//     PRECIOS: sin dinero el eje del corte no existe y estos casos no se ven.
//     Los precios son la curva real de FZ26 que documenta CLAUDE.md.
{
  const { pg, errs } = await nueva(1440, 950);
  const _r = await eva(pg, () => {
    const precios = [77, 75, 68, 65, 64, 61, 61, 59, 54, 53, 53, 51, 45, 42, 40, 39, 39, 36, 36, 36, 35, 34, 33, 32, 32, 31,
      27, 26, 26, 25, 24, 23, 22, 21, 20, 19, 19, 18, 17, 17, 17, 16, 15, 15, 14, 13, 13, 12, 11, 11, 11, 10, 7, 6, 5, 4, 3, 2, 2, 1];
    const pos = ['RB', 'RB', 'WR', 'WR', 'RB', 'RB', 'WR', 'WR', 'RB', 'RB', 'WR', 'WR', 'RB', 'RB', 'RB', 'RB', 'RB', 'QB', 'WR', 'RB',
      'WR', 'TE', 'TE', 'WR', 'WR', 'RB', 'QB', 'RB', 'WR', 'WR', 'WR', 'RB', 'RB', 'WR', 'WR', 'QB', 'RB', 'WR', 'WR', 'WR',
      'WR', 'RB', 'WR', 'TE', 'RB', 'RB', 'RB', 'RB', 'QB', 'TE', 'RB', 'QB', 'QB', 'RB', 'WR', 'TE', 'QB', 'RB', 'WR', 'TE'];
    const rows = [], pay = {};
    precios.forEach((v, i) => { const id = 'p' + i; rows.push({ id, name: 'Jug' + i, pos: pos[i], team: 'X' }); pay[id] = v; });
    const O = { pay, budget: 200 };
    const entre = (res, x, y) => {
      const A = res.order.indexOf(x), B = res.order.indexOf(y);
      for (let q = Math.min(A, B); q < Math.max(A, B); q++) if (res.breaks[res.order[q]]) return true;
      return false;
    };
    const tierDe = res => { let t = 1, m = {}; res.order.forEach(id => { m[id] = t; if (res.breaks[id]) t++; }); return m; };

    // PRIOR: sin una sola respuesta ya hay tiers, y salen del escalon de precio
    const cero = tmrTiersInfer(rows, [], O);
    const tc = tierDe(cero);
    const porPos = {};
    cero.order.forEach(id => { const p = rows.find(x => x.id === id).pos; (porPos[p] = porPos[p] || {})[tc[id]] = 1; });

    // y se RINDE ante una sola respuesta suya (p8 $54 y p20 $35)
    const juntos = tmrTiersInfer(rows, [{ a: 'p8', b: 'p20', v: 0 }], O);

    // ESCALADA: p46 ($13) gana clearly a p32 ($22), que esta por encima
    const e1 = tmrGameNext(rows, [{ a: 'p46', b: 'p32', v: 2 }], O);
    const rival1 = e1 && (e1.a === 'p46' ? e1.b : e1.a);
    const e2 = tmrGameNext(rows, [{ a: 'p46', b: 'p32', v: 2 }, { a: 'p46', b: rival1, v: 2 }], O);
    const rival2 = e2 && (e2.a === 'p46' ? e2.b : e2.a);
    const eEmp = tmrGameNext(rows, [{ a: 'p46', b: 'p32', v: 2 }, { a: 'p46', b: rival1, v: 0 }], O);

    // GANANCIA DE INFORMACION: la primera pregunta cae en el umbral y arriba
    const n0 = tmrGameNext(rows, [], O);
    const gap0 = Math.abs(cero.money[n0.a] - cero.money[n0.b]);

    // TRANSITIVIDAD CON CONFIANZA: nunca pregunta A vs C con A>B>C en clearly
    let ans = [{ a: 'p0', b: 'p4', v: 2 }, { a: 'p4', b: 'p8', v: 2 }], vioAC = false;
    for (let i = 0; i < 40; i++) {
      const nx = tmrGameNext(rows, ans, O);
      if (!nx) break;
      if ([nx.a, nx.b].sort().join('|') === 'p0|p8') vioAC = true;
      ans.push({ a: nx.a, b: nx.b, v: 1 });
    }

    // CONTRADICCIONES
    const cy = tmrGameCycles(rows, [{ a: 'p0', b: 'p4', v: 2 }, { a: 'p4', b: 'p8', v: 2 }, { a: 'p8', b: 'p0', v: 2 }], O);
    const sinCy = tmrGameCycles(rows, [{ a: 'p0', b: 'p4', v: 2 }, { a: 'p4', b: 'p8', v: 2 }], O);

    // SESION CORTA: 30 respuestas dan tiers coherentes
    let a30 = [];
    for (let i = 0; i < 30; i++) {
      const nx = tmrGameNext(rows, a30, O);
      if (!nx) break;
      a30.push({ a: nx.a, b: nx.b, v: [2, 1, 0, -1, 1][i % 5] });
    }
    const r30 = tmrTiersInfer(rows, a30, O), t30 = tierDe(r30);
    const pos30 = {};
    r30.order.forEach(id => { const p = rows.find(x => x.id === id).pos; (pos30[p] = pos30[p] || {})[t30[id]] = 1; });

    return {
      prior: {
        cortes: cero.cuts.length, movidos: cero.moved, umbral: cero.umbral,
        tiersPorPos: Object.keys(porPos).map(p => p + ':' + Object.keys(porPos[p]).length).join(' '),
        cortadosSin: entre(cero, 'p8', 'p20'), cortadosCon: entre(juntos, 'p8', 'p20')
      },
      esc: {
        e1, rival1, sube1: !!rival1 && cero.order.indexOf(rival1) < cero.order.indexOf('p32'),
        posRival1: rival1 && rows.find(x => x.id === rival1).pos,
        e2, rival2, sube2: !!rival2 && !!rival1 && cero.order.indexOf(rival2) < cero.order.indexOf(rival1),
        empateCorta: !!eEmp && !eEmp.why
      },
      gan: { n0, gap0, umbral: cero.umbral, peorPuesto: Math.max(cero.order.indexOf(n0.a), cero.order.indexOf(n0.b)) },
      vioAC,
      cy: { n: cy.length, ids: cy[0] && cy[0].ids, rep: cy[0] && cy[0].repreguntar, sin: sinCy.length },
      corta: {
        n: a30.length, cortes: r30.cuts.length, cortesCero: cero.cuts.length,
        minTiers: Math.min.apply(null, Object.keys(pos30).map(p => Object.keys(pos30[p]).length)),
        bandasTop20: new Set(r30.order.slice(0, 20).map(id => t30[id])).size,
        prog: tmrGameProgress(rows, a30)
      }
    };
  });

  const r = Object.assign({ prior: {}, esc: {}, gan: {}, cy: {}, corta: {} }, _r || {});
  ok('(M1) PRIOR: sin una sola respuesta ya hay tiers, sacados del escalon de precio',
    !r._err && r.prior.cortes >= 5 && r.prior.movidos === 0 && r.prior.umbral > 0,
    JSON.stringify(r.prior));
  ok('(M2) y el prior se RINDE: un "same tier" suyo borra un escalon de mercado de $19',
    !r._err && r.prior.cortadosSin === true && r.prior.cortadosCon === false,
    `mercado los separa: ${r.prior.cortadosSin}, tras su respuesta: ${r.prior.cortadosCon}`);
  ok('(M3) ESCALADA: tras ganar clearly desde abajo, lo prueba contra uno de MAS arriba',
    !r._err && r.esc.e1 && r.esc.e1.why === 'up' && r.esc.sube1 && r.esc.posRival1 === 'RB',
    JSON.stringify({ e1: r.esc.e1, sube: r.esc.sube1, pos: r.esc.posRival1 }));
  ok('(M4) y si sigue ganando sigue subiendo; un empate la corta',
    !r._err && r.esc.e2 && r.esc.e2.why === 'up' && r.esc.sube2 && r.esc.empateCorta,
    JSON.stringify({ e2: r.esc.e2, sube2: r.esc.sube2, empateCorta: r.esc.empateCorta }));
  ok('(M5) GANANCIA: la primera pregunta cae en el umbral de corte y arriba, no en un abismo',
    !r._err && r.gan.gap0 <= r.gan.umbral * 2.5 && r.gan.peorPuesto < 20,
    `salto $${r.gan.gap0} contra umbral $${r.gan.umbral}, peor puesto ${r.gan.peorPuesto}`);
  ok('(M6) nunca gasta un turno en A vs C teniendo A>B>C con dos "clearly"',
    !r._err && r.vioAC === false);
  ok('(M7) detecta la contradiccion A>B>C>A y ofrece que pareja re-preguntar',
    !r._err && r.cy.n === 1 && r.cy.ids && r.cy.ids.length === 3 && r.cy.rep && r.cy.rep.length === 2,
    JSON.stringify(r.cy));
  ok('(M8) CONTROL NEGATIVO: sin ciclo no inventa una contradiccion', !r._err && r.cy.sin === 0, 'ciclos: ' + r.cy.sin);
  ok('(M9) una sesion de 30 respuestas ya deja tiers coherentes',
    !r._err && r.corta.n === 30 && r.corta.minTiers >= 2 && r.corta.bandasTop20 >= 3
    && r.corta.cortes >= r.corta.cortesCero && r.corta.prog.resolved > 0 && r.corta.prog.total > 0,
    JSON.stringify(r.corta));
  ok('(M10) consola limpia con el motor nuevo', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

console.log('\n=== El Pay sale de SU ORDEN, no de que el sepa cuanto valen ===');
// (P) Correccion del dueno: "yo no se cuanto deberian valer. yo quiero que tu
//     me digas basado en los rankings que yo haga". El check que lo prueba es
//     mover un jugador y ver que su precio se va al puesto al que lo movio: si
//     no, la columna estaria pintando el mercado con otro nombre.
{
  const { pg, errs } = await nueva(1440, 950);
  await abrirTab(pg);
  await esperar(pg, () => typeof TMR !== 'undefined' && TMR.owner === true && !TMR.pricing
    && Object.keys(TMR.price || {}).length > 0, 45000);

  const mov = await eva(pg, () => {
    // La curva de RB de la sala, que es contra lo que se compara
    const curvaRB = Object.keys(TMR.sticker).filter(id => TMR._stPos && TMR._stPos[id] === 'RB')
      .map(id => TMR.sticker[id]).sort((a, b) => b - a);
    const rbs = TMR.rows.filter(r => r.pos === 'RB');
    if (rbs.length < 9 || curvaRB.length < 9) return { falta: true, rbs: rbs.length, curva: curvaRB.length };
    const rb1 = rbs[0], victima = rbs[7];          // el RB8 de SU lista
    // El precio a mano manda sobre todo, asi que aqui estorba: se quita de los
    // dos. (Una seccion anterior le puso $66 al primero de la lista.)
    delete TMR.manual[victima.id]; delete TMR.manual[rb1.id];
    tmrPaint();
    const antes = tmrPriceOf(victima.id);
    // Se mueve al puesto de RB2 de SU lista, justo detras del RB1
    TMR.rows = TMR.rows.filter(r => r !== victima);
    TMR.rows.splice(TMR.rows.indexOf(rb1) + 1, 0, victima);
    // Cada uno solo en su tier: asi se mide la regla cruda, sin el suavizado
    // del tier encima (un grupo de uno no se suaviza).
    TMR.breakAfter = {};
    TMR.breakAfter[rb1.id] = true;
    TMR.breakAfter[victima.id] = true;
    tmrSave(); tmrPaint();
    const fila = document.querySelector('#rk-body .rk-row[data-id="' + victima.id + '"] .rk-pr');
    return {
      nombre: victima.name, antes, antesEsperado: curvaRB[7],
      despues: tmrPriceOf(victima.id), esperado: curvaRB[1],
      rb1: tmrPriceOf(rb1.id), rb1Esperado: curvaRB[0],
      pintado: fila ? fila.textContent.trim() : null
    };
  });
  ok('(P1) mover un RB del puesto 8 al 2 de su lista le pone el precio del segundo RB de la sala',
    !mov._err && !mov.falta && mov.despues === mov.esperado
    && mov.despues !== mov.antes && mov.rb1 === mov.rb1Esperado && mov.pintado === '$' + mov.esperado,
    JSON.stringify(mov));

  // (P2) El suavizado del tier: dos del mismo tier y misma posicion se acercan,
  //      porque para el son intercambiables, y el dinero del grupo no cambia.
  const suave = await eva(pg, () => {
    TMR.manual = {};
    const corte = TMR.rows.filter(r => r.pos === 'RB')[5];
    TMR.breakAfter = {};
    TMR.breakAfter[corte.id] = true;
    tmrSave(); tmrPaint();
    // El grupo del tier 1 tal y como lo ve el codigo: los RB desde el principio
    // hasta el corte, ambos incluidos.
    const grupo = [];
    for (const r of TMR.rows) { if (r.pos === 'RB') grupo.push(r); if (TMR.breakAfter[r.id]) break; }
    const curvaRB = Object.keys(TMR.sticker).filter(id => TMR._stPos && TMR._stPos[id] === 'RB')
      .map(id => TMR.sticker[id]).sort((a, b) => b - a);
    const crudos = curvaRB.slice(0, grupo.length);
    const conSuave = grupo.map(r => tmrPriceOf(r.id));
    const rango = a => Math.max.apply(null, a) - Math.min.apply(null, a);
    return {
      crudos, conSuave, rangoCrudo: rango(crudos), rangoSuave: rango(conSuave),
      sumaCruda: crudos.reduce((a, b) => a + b, 0), sumaSuave: conSuave.reduce((a, b) => a + b, 0)
    };
  });
  ok('(P2) dentro de un tier los precios se acercan, y el dinero del grupo se conserva',
    !suave._err && suave.rangoSuave < suave.rangoCrudo && suave.rangoSuave > 0
    && Math.abs(suave.sumaSuave - suave.sumaCruda) <= suave.conSuave.length / 2 + 1,
    JSON.stringify(suave));

  // (P3) CONTROL: el precio escrito a mano sigue mandando sobre todo lo anterior
  const man = await eva(pg, () => {
    const r = TMR.rows.filter(x => x.pos === 'RB')[3];
    tmrSetPrice(r.id, 91);
    return { id: r.id, pay: tmrPriceOf(r.id), calc: TMR.price[r.id] };
  });
  ok('(P3) el precio que el escribe a mano sigue mandando sobre el deducido',
    !man._err && man.pay === 91 && man.calc !== 91, JSON.stringify(man));
  ok('(P4) consola limpia con el precio deducido de su orden', errs.length === 0,
    errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

console.log('\n=== Fantazy 2026: los settings de SU liga mandan ===');
// (F) Regla del dueno: "toma en cuenta los league settings y format de la liga".
//     El check que importa no es que los numeros salgan bonitos, es que NO
//     cambien cuando el se pone a probar otra sala en Mock Draft. Por eso el
//     segundo navegador arranca con memoria de una sala de 12 equipos PPR de 8
//     rondas: si el Pay se moviera, sus precios del domingo dependerian de con
//     que estuvo jugando el sabado.
{
  const leer = async mock => {
    const { pg, errs } = await nueva(1440, 950, mock ? { mock } : {});
    await abrirTab(pg);
    await esperar(pg, () => typeof TMR !== 'undefined' && TMR.owner === true && !TMR.pricing
      && Object.keys(TMR.price || {}).length > 0, 45000);
    const d = await eva(pg, () => {
      const r = TMR.rows.find(x => /Gibbs/.test(x.name)) || TMR.rows[0];
      return {
        room: TMR.room, fmt: TMR.fmt,
        jugador: r.name, pay: tmrPriceOf(r.id), sticker: TMR.sticker ? TMR.sticker[r.id] : null,
        bar: (document.getElementById('rk-build') || {}).textContent.replace(/\s+/g, ' ').trim(),
        shape: tmrRosterShape(TMR.room || tmrRoomCfg()),
        // el espejo del formato de board, contra los cuatro casos
        fmts: [
          tmrAdpFmt({ sf: false, scoring: 0.5 }), tmrAdpFmt({ sf: false, scoring: 1 }),
          tmrAdpFmt({ sf: false, scoring: 0 }), tmrAdpFmt({ sf: true, scoring: 0.5 })
        ]
      };
    });
    return { d, errs, pg };
  };
  const A = await leer(null);
  const B = await leer({ 'md-teams': '12', 'md-scoring': '1', 'md-rounds': '8', 'md-budget': '300', 'md-format': 'sf', 'md-dtype': 'auction' });

  ok('(F1) la sala del dueno es SU liga: 10 equipos, $200, 15 rondas, half PPR, 1QB',
    !A.d._err && A.d.room && A.d.room.teams === 10 && A.d.room.budget === 200 && A.d.room.rounds === 15
    && A.d.room.scoring === 0.5 && A.d.room.sf === false && A.d.room.fz26 === true,
    JSON.stringify(A.d.room));
  ok('(F2) y NO se mueve porque el mock este puesto en 12 equipos PPR de 8 rondas',
    !B.d._err && B.d.room && B.d.room.teams === 10 && B.d.room.rounds === 15 && B.d.room.scoring === 0.5
    && B.d.pay === A.d.pay && B.d.sticker === A.d.sticker && A.d.pay > 0,
    `${A.d.jugador}: sin memoria $${A.d.pay}, con memoria de otra sala $${B.d.pay} (sticker ${A.d.sticker}/${B.d.sticker})`);
  ok('(F3) el board es el de SU formato (half PPR), no el de PPR entero',
    !A.d._err && A.d.fmt === 'half-ppr' && B.d.fmt === 'half-ppr', `A ${A.d.fmt} / B ${B.d.fmt}`);
  ok('(F4) la barra Build declara la liga entera, con scoring y 1QB',
    !A.d._err && /Fantazy 2026: 10 teams, \$200, half PPR, 1QB, 15 rounds/.test(A.d.bar),
    String(A.d.bar || '').slice(0, 110));
  ok('(F5) el roster es el de la liga: 9 titulares (QB, 2RB, 2WR, TE, FLEX, K, DEF) y 6 de banca',
    !A.d._err && A.d.shape && A.d.shape.QB === 1 && A.d.shape.RB === 2 && A.d.shape.WR === 2
    && A.d.shape.TE === 1 && A.d.shape.FLEX === 1 && A.d.shape.titulares === 9 && A.d.shape.banca === 6,
    JSON.stringify(A.d.shape));
  // ANTI-DERIVA: el mapa formato->board es un ESPEJO de app.js. Se extrae del
  // otro archivo y se compara caso por caso, que es la vacuna que este repo ya
  // usa para tmClasificarLiga. Sin esto los dos se separan en silencio y el
  // precio se calcula con el board de otra liga.
  const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const mAdp = appSrc.match(/var\s+_adpFmt\s*=\s*([^;]+);/);
  let espejo = null;
  if (mAdp) {
    const f = new Function('MD', 'return ' + mAdp[1] + ';');
    espejo = [f({ sf: false, scoring: 0.5 }), f({ sf: false, scoring: 1 }), f({ sf: false, scoring: 0 }), f({ sf: true, scoring: 0.5 })];
  }
  ok('(F6) el mapa formato->board de rankings.js sigue siendo el MISMO que el de app.js',
    !!espejo && !A.d._err && JSON.stringify(espejo) === JSON.stringify(A.d.fmts),
    'app.js ' + JSON.stringify(espejo) + ' vs rankings.js ' + JSON.stringify(A.d.fmts));
  ok('(F7) consola limpia con la sala forzada', A.errs.length === 0 && B.errs.length === 0,
    A.errs.concat(B.errs).slice(0, 3).join(' | ') || 'sin errores');
  await A.pg.close();
  await B.pg.close();
}

console.log('\n=== Cheat Sheet ===');
// (H) El caso que el dueno escribio con sus palabras: Swift en el tier de Hall
//     significa "quemate la plata en Gibbs y agarras a Swift en vez de Cook".
//     Se arma ese tier a mano (los tres RB juntos y un corte por cada lado) y
//     se comprueba que la hoja saca la cuenta bien, no que diga algo parecido.
{
  const { pg, errs } = await nueva(1440, 950);
  await eva(pg, () => { try { mdFantazy26Toggle(true); } catch (_) { } });
  await abrirTab(pg);
  await esperar(pg, () => typeof TMR !== 'undefined' && TMR.owner === true && !TMR.pricing && Object.keys(TMR.price || {}).length > 0);

  // CONTROL NEGATIVO de la hoja: sin un solo corte de tier, "Cheapest in" no
  // puede decir nada (el "tier" seria la lista entera) y tiene que callarse y
  // explicar por que. Sin este check, H2 pasaria igual con la linea diciendo
  // cualquier cosa sobre un tier de cuarenta jugadores.
  await eva(pg, () => { TMR.breakAfter = {}; tmrSave(); tmrPaint(); tmrSheetOpen(); });
  await esperar(pg, () => { const s = document.getElementById('rk-sheet'); return s && !s.hidden; }, 15000);
  const mudo = await eva(pg, () => ({
    deals: document.querySelectorAll('#rk-sheet .rk-sh-deal').length,
    nota: !!document.getElementById('rk-sh-notiers'),
    secs: document.querySelectorAll('#rk-sheet .rk-sh-sec').length
  }));
  ok('(H-0) CONTROL NEGATIVO: sin cortes de tier la hoja no inventa una ganga y lo dice',
    !mudo._err && mudo.deals === 0 && mudo.nota && mudo.secs > 0, JSON.stringify(mudo));
  await eva(pg, () => tmrSheetClose());

  const armado = await eva(pg, () => {
    const buscar = ap => TMR.rows.findIndex(r => r.pos === 'RB' && new RegExp('\\b' + ap, 'i').test(r.name));
    let iCook = buscar('Cook'), iHall = buscar('Hall'), iSwift = buscar('Swift');
    if (iCook < 0 || iHall < 0 || iSwift < 0) return { falta: { iCook, iHall, iSwift } };
    const cook = TMR.rows[iCook], hall = TMR.rows[iHall], swift = TMR.rows[iSwift];
    // Los tres pegados, en ese orden, y un corte a cada lado: el tier queda
    // siendo exactamente esos tres y nada mas.
    TMR.rows = TMR.rows.filter(r => r !== hall && r !== swift);
    const j = TMR.rows.indexOf(cook);
    TMR.rows.splice(j + 1, 0, hall, swift);
    TMR.breakAfter = {};
    if (j > 0) TMR.breakAfter[TMR.rows[j - 1].id] = true;
    TMR.breakAfter[swift.id] = true;
    tmrSave(); tmrPaint();
    const uno = r => ({
      id: r.id, nm: r.name, pay: tmrPriceOf(r.id),
      mercado: (TMR.sticker && TMR.sticker[r.id] != null) ? TMR.sticker[r.id] : null
    });
    return { cook: uno(cook), hall: uno(hall), swift: uno(swift) };
  });
  ok('(H0) el caso se pudo armar: Cook, Hall y Swift en un tier, con su precio',
    !!armado && !armado._err && !armado.falta && armado.cook && armado.cook.pay > 0
    && armado.hall && armado.hall.pay > 0 && armado.swift && armado.swift.pay > 0,
    JSON.stringify(armado));

  await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#rk-owner-tools .rk-btn')).find(x => /Cheat Sheet/.test(x.textContent));
    if (b) b.click();
  });
  await esperar(pg, () => { const s = document.getElementById('rk-sheet'); return s && !s.hidden && s.querySelectorAll('.rk-sh-sec').length > 0; }, 15000);

  const hoja = await eva(pg, () => {
    const s = document.getElementById('rk-sheet');
    const d = tmrSheetData();
    const deals = Array.from(s.querySelectorAll('.rk-sh-deal')).map(x => x.textContent.replace(/\s+/g, ' ').trim());
    return {
      visible: !s.hidden,
      lista: (document.querySelector('#tab-rankings .rk-list') || {}).offsetParent === null,
      plan: (s.querySelector('.rk-sh-plan') || {}).textContent.replace(/\s+/g, ' ').trim(),
      total: d.plan.total, left: d.plan.left, huecos: d.plan.huecos, rondas: d.plan.cfg.rounds,
      secs: Array.from(s.querySelectorAll('.rk-sh-h')).map(x => x.textContent.trim()),
      deals,
      notas: Array.from(s.querySelectorAll('.rk-sh-notes li')).map(x => x.textContent.trim()),
      liga: (s.querySelector('#rk-sh-liga') || {}).textContent || '',
      cab: (s.querySelector('.rk-sh-top') || {}).textContent.replace(/\s+/g, ' ').trim(),
      gaps: Array.from(s.querySelectorAll('.rk-sh-gaps li')).map(x => x.textContent.replace(/\s+/g, ' ').trim()),
      mkData: (d.market || []).map(m => (m && m.gap)
        ? (m.pos + '/' + m.tier + '/' + m.gap.r.name + '/sala $' + m.gap.mercado + ' -> yo $' + m.gap.pay)
        : 'sin hueco de mercado'),
      market: s.querySelectorAll('.rk-sh-deal.is-market').length,
      objetivos: s.querySelectorAll('.rk-sh-li.is-target').length,
      top: d.top ? { nm: d.top.r.name, pay: d.top.pay } : null
    };
  });
  const arm = (armado && armado.cook && armado.swift) ? armado : null;
  /* La frase del dueno, ahora que el Pay sale de SU orden: si el sube a Swift
   * al tier de Hall, Mac le pone precio de RB de arriba, pero la SALA lo sigue
   * vendiendo barato. Ese hueco es el hallazgo, y es literalmente lo que el
   * describio: "quemate todo en Gibbs y agarras a Swift en vez de Cook". */
  const hueco = arm && arm.swift.pay != null && arm.swift.mercado != null
    ? arm.swift.pay - arm.swift.mercado : null;
  const rx = arm && hueco != null
    ? new RegExp('Market has him lower: ' + arm.swift.nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      + ' goes for about \\$' + arm.swift.mercado + ' and you would pay up to \\$'
      + arm.swift.pay + ' for a tier-\\d+ player\\.')
    : null;
  const linea = (hoja.deals || []).find(x => !!rx && rx.test(x));
  ok('(H1) la hoja abre a pantalla completa, con el plan y una seccion por posicion',
    !hoja._err && hoja.visible && hoja.lista && hoja.secs.indexOf('RB') >= 0 && hoja.secs.indexOf('WR') >= 0
    && String(hoja.plan || '').indexOf('$' + hoja.total) >= 0 && new RegExp(hoja.huecos + ' spots? at \\$1').test(String(hoja.plan || '')),
    JSON.stringify({ secs: hoja.secs, plan: String(hoja.plan || '').slice(0, 120) }));
  ok('(H2) subido Swift al tier de Cook, la hoja dice que la sala lo vende mas barato, con la cuenta exacta',
    !!linea && hueco >= 8, JSON.stringify({ swift: arm && arm.swift, hueco, salio: (hoja.deals || []).slice(0, 3) }));
  ok('(H3) con un hueco de $20 o mas contra la sala, la hoja dice en que gastarlo, y es un objetivo real',
    !!linea && hueco >= 20 && !!hoja.top && linea.indexOf('Spend it on ' + hoja.top.nm + '.') > 0,
    JSON.stringify({ hueco, top: hoja.top, linea }));
  ok('(H4) los objetivos van marcados en la hoja', !hoja._err && hoja.objetivos > 0, hoja.objetivos + ' marcados');
  // Las notas son cuentas del fixture de la subasta real, no adornos: si alguien
  // les cambia una cifra sin volver a medir, esto se pone rojo.
  const nq = (hoja.notas || []).join(' | ');
  ok('(H5) las notas de la sala real traen sus cifras medidas',
    /\$86, 43% of one budget/.test(nq) && /38 of the 130 lots/.test(nq)
    && /C\. Brown \$56, Walker \$55, Hampton \$53/.test(nq) && /Allen \$38, Burrow \$30/.test(nq),
    nq.slice(0, 200));
  ok('(H9) la hoja DECLARA contra que esta calculada: la liga con sus numeros',
    !hoja._err && /Fantazy 2026: 10 teams, \$200, half PPR, 1QB, 15 rounds/.test(hoja.liga)
    && /9 starters \(QB, 2 RB, 2 WR, TE, FLEX, K, DEF\) \+ 6 bench/.test(String(hoja.cab || ''))
    && /6 pt passing TDs/.test(String(hoja.cab || '')),
    JSON.stringify({ liga: hoja.liga, cab: String(hoja.cab || '').slice(0, 150) }));
  // La regla del dueno: en subasta no se "alcanza" a nadie, se paga. Un jugador
  // de un tier alto SUYO que el mercado tiene abajo es el hallazgo, y sube al
  // plan. Y en ningun sitio puede aparecer la palabra reach.
  ok('(H10) el hallazgo de mercado se marca y sube al plan, sin llamarlo nunca un reach',
    !!arm && !hoja._err && hoja.market > 0 && hoja.gaps.length > 0 && !!linea
    && (hoja.mkData || []).some(g => g.indexOf(arm.swift.nm) >= 0)
    && !/reach|above value|overpay/i.test(String(hoja.cab || '') + ' ' + (hoja.deals || []).join(' ') + ' ' + (hoja.gaps || []).join(' ')),
    JSON.stringify({ marcados: hoja.market, mkData: (hoja.mkData || []).slice(0, 3) }));
  ok('(H6) consola limpia con la hoja abierta', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

// (H7) La hoja en el telefono, que es donde se va a leer el domingo.
{
  const { pg, errs } = await nueva(390, 844);
  await abrirTab(pg);
  await esperar(pg, () => typeof TMR !== 'undefined' && TMR.owner === true && !TMR.pricing);
  await pg.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#rk-owner-tools .rk-btn')).find(x => /Cheat Sheet/.test(x.textContent));
    if (b) b.click();
  });
  await esperar(pg, () => { const s = document.getElementById('rk-sheet'); return s && !s.hidden; }, 15000);
  const m = await eva(pg, () => {
    const s = document.getElementById('rk-sheet');
    const fuera = Array.from(s.querySelectorAll('*')).filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
    }).map(e => e.className || e.tagName);
    return { desborde: document.documentElement.scrollWidth, fuera: fuera.slice(0, 4), filas: s.querySelectorAll('.rk-sh-li').length };
  });
  ok('(H7) la hoja a 390px no desborda y ninguna fila se sale', !m._err && m.desborde <= 390 && m.fuera.length === 0 && m.filas > 20,
    JSON.stringify(m));
  ok('(H8) consola limpia con la hoja en el telefono', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

await b.close();
cerrar();
console.log('\n' + (fails ? fails + ' CHECKS FALLARON' : 'RANKINGS ALL GREEN'));
process.exit(fails ? 1 : 0);
