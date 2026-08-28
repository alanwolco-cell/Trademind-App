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

  // objetivos, ANTES de recargar: se guardan en la misma llave
  await eva(pg, () => { tmrToggleTarget(TMR.rows[0].id); tmrToggleTarget(TMR.rows[1].id); });
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
    && /10 teams · \$200 · 15 rounds/.test(sala.bar),
    JSON.stringify(sala.room) + ' | ' + sala.bar.slice(0, 90));
  ok('(B-' + tag + ') llegando por clic, la lista y la columna Pay estan puestas',
    !st._err && st.pantalla === 'screen-research' && st.tab === 'tab-rankings' && st.filas > 100
    && st.cifras === st.filas && st.cero === 0 && st.build && !st.heroEnPantalla && !st.desborde,
    JSON.stringify(st));
  ok('(C-' + tag + ') consola limpia entrando por clic', errs.length === 0, errs.slice(0, 3).join(' | ') || 'sin errores');
  await pg.close();
}

await b.close();
cerrar();
console.log('\n' + (fails ? fails + ' CHECKS FALLARON' : 'RANKINGS ALL GREEN'));
process.exit(fails ? 1 : 0);
