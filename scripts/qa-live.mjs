#!/usr/bin/env node
// Gate de Draft Day: la subasta REAL conducida por lo que canta el dueno.
//
//   node scripts/qa-live.mjs                 # arranca su propio servidor
//   QA_BASE=https://macdraft.app node scripts/qa-live.mjs
//
// POR QUE ESTE GATE ENTRA CLICANDO. La leccion del 2026-08-26 costo un
// despliegue: los cinco gates viejos entraban llamando switchScreen() y
// renderX() directo, y por eso estaban todos en verde sobre una app en la que
// no se podia navegar. Aqui los checks (a) y (b) abren el cajon con el control
// que este VISIBLE y pulsan la entrada del menu, en escritorio y en telefono.
// Si Draft Day pierde su puerta, este gate se pone rojo.
//
// LOS CONTROLES NEGATIVOS, que son la mitad del valor de este archivo:
//  - (j) 'chase' tiene que devolver Ja'Marr Chase. Con el indice viejo devolvia
//        Chase Brown, porque Chase es el NOMBRE de pila del otro. En una
//        subasta eso registra la venta equivocada y envenena presupuestos,
//        huecos e inflacion de ahi en adelante.
//  - (m2) con la puja recien abierta en $1 NO puede haber aviso de ganga. La
//        primera version comparaba precio contra valor a secas, y como todo
//        lote abre en $1, gritaba ganga en cada nominacion. Un aviso que salta
//        siempre deja de leerse justo en el lote que importa.
//  - (l) una etiqueta de gusto NUNCA pone el techo en cero. Regla explicita del
//        dueno: se lleva jugadores que no le gustan si el valor esta.
//  - (k) un nombre inexistente pegado en una lista tiene que DECLARARSE. Un
//        nombre tragado en silencio es un jugador que el cree marcado y no lo
//        esta, y eso se descubre pujando.
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

const PORT = process.env.QA_PORT || 3213;
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

let pass = 0, fail = 0;
const ok = (id, cond, detalle) => {
  if (cond) { pass++; console.log(`PASS  (${id}) ${detalle}`); }
  else { fail++; console.log(`FAIL  (${id}) ${detalle}`); }
};

const TECHO_MS = 5;   // techo declarado para una consulta completa, sin cache

const br = await chromium.launch();
try {
  // ── (a) y (b): SE LLEGA CLICANDO, en las dos ventanas ────────────────────
  for (const [tag, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const pg = await br.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message.slice(0, 120)));
    pg.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // Chrome imprime "Failed to load resource" SIN la URL en el texto: hay
      // que mirar la ubicacion del mensaje. Filtrar por texto dejaba pasar los
      // dos errores del ENTORNO local (en produccion dan 200) y el gate se
      // ponia rojo por el clima.
      const u = ((m.location && m.location()) || {}).url || '';
      if (/_vercel\/insights|api\/odds\/implied/.test(u + ' ' + t)) return;
      errs.push('console: ' + t.slice(0, 120) + (u ? ' @ ' + u.slice(0, 60) : ''));
    });
    await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2200);

    // el cajon se abre con el control VISIBLE: en el telefono la hamburguesa
    // esta OCULTA y manda el boton More de la barra inferior
    let abierto = false;
    for (const sel of ['.tabbar-item[data-tab="more"]', 'button[onclick="mobMenuToggle()"]']) {
      const el = await pg.$(sel);
      if (el && await el.isVisible()) { await el.click(); abierto = true; break; }
    }
    ok(tag === 'phone' ? 'a2' : 'a1', abierto, `${tag}: el cajon se abre con un control visible`);
    if (!abierto) { await pg.close(); continue; }
    await pg.waitForTimeout(450);

    const item = await pg.$('button.mob-menu-item:has-text("Draft Day")');
    const vis = item ? await item.isVisible() : false;
    ok(tag === 'phone' ? 'b2' : 'b1', vis, `${tag}: la entrada Draft Day existe y se ve en el menu`);
    if (!vis) { await pg.close(); continue; }

    await item.click();
    await pg.waitForTimeout(9500);

    const st = await pg.evaluate(() => ({
      panel: !!document.getElementById('lv-panel'),
      viva: !!(window.AU && AU.active),
      espejo: !!(window.AU && AU.live),
      desborde: document.documentElement.scrollWidth > window.innerWidth,
      // la portada NO puede quedar detras del panel: se mide, no se supone
      homeFuera: (function () { var h = document.getElementById('screen-home'); return !h || getComputedStyle(h).display === 'none'; })(),
      mockDentro: (function () { var m = document.getElementById('screen-mock'); return !!m && getComputedStyle(m).display !== 'none'; })()
    }));
    ok(tag === 'phone' ? 'c2' : 'c1', st.panel && st.viva && st.espejo,
      `${tag}: al clicar abre la sala en modo espejo con el panel puesto`);
    ok(tag === 'phone' ? 'd2' : 'd1', !st.desborde, `${tag}: la pantalla no desborda a ${w}px`);
    ok(tag === 'phone' ? 'c3' : 'c0', st.homeFuera && st.mockDentro,
      `${tag}: la sala queda en pantalla y la portada fuera (home=${st.homeFuera ? 'oculta' : 'VISIBLE'})`);
    ok(tag === 'phone' ? 'e2' : 'e1', errs.length === 0,
      `${tag}: consola limpia${errs.length ? ' -> ' + errs[0] : ''}`);
    await pg.close();
  }

  // ── el resto corre en una sola pagina de escritorio ──────────────────────
  const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2200);
  await pg.evaluate(async () => await window.lvEnter());
  await pg.waitForTimeout(1200);

  // ── (f) LOS BOTS NO PUJAN SOLOS. Es la razon de ser del modo espejo: si el
  //    motor sigue conduciendo, pisa el lote que de verdad esta en Yahoo.
  const quieto = await pg.evaluate(async () => {
    const p = lvOne('gibbs'); lvBlock(p);
    const antes = { bid: AU.lot.bid, holder: AU.lot.holder };
    await new Promise(r => setTimeout(r, 3000));
    return { antes, ahora: AU.lot ? { bid: AU.lot.bid, holder: AU.lot.holder } : null };
  });
  ok('f', quieto.ahora && quieto.ahora.bid === quieto.antes.bid,
    `la sala no puja sola en 3s (abrio en $${quieto.antes.bid}, sigue en $${quieto.ahora ? quieto.ahora.bid : '?'})`);

  // ── (g,h,i) UNA VENTA MUEVE LA SALA DE VERDAD ────────────────────────────
  const venta = await pg.evaluate(() => {
    const seat = 3;
    const antes = { bud: AU.budgets[seat], sl: AU.slotsLeft[seat], pool: MD.pool.length, inf: AU.inflation };
    const r = lvSold('gibbs', 72, seat);
    return { err: r.err || null, antes, desp: { bud: AU.budgets[seat], sl: AU.slotsLeft[seat], pool: MD.pool.length } };
  });
  ok('g', !venta.err && venta.desp.bud === venta.antes.bud - 72,
    `una venta descuenta el dinero del comprador ($${venta.antes.bud} -> $${venta.desp.bud})`);
  ok('h', venta.desp.sl === venta.antes.sl - 1 && venta.desp.pool === venta.antes.pool - 1,
    'una venta gasta un hueco de roster y saca al jugador del board');
  // la MISMA venta tecleada dos veces no puede cobrar dos veces
  const dobl = await pg.evaluate(() => { const b = AU.budgets[3]; const r = lvSold('gibbs', 72, 3); return { err: r.err || '', b0: b, b1: AU.budgets[3] }; });
  ok('h2', /already sold/.test(dobl.err) && dobl.b0 === dobl.b1,
    `vender dos veces al mismo jugador se rechaza sin tocar el dinero ($${dobl.b0} sigue en $${dobl.b1})`);

  // lo tecleado como lo diria el dueno: equipo por nombre, "yo", muletillas
  const typed = await pg.evaluate(() => [
    ['gibbs se fue en 86 a ness', 'gibbs', 86, 1], ['jeanty 48 dream team', 'jeanty', 48, 3], ['me lleve olave 19', 'olave', 19, MD.mySlot],
    ['bowers $36 real madrid', 'bowers', 36, 6], ['st. brown 65 5', 'st. brown', 65, 5]
  ].map(([t, n, p, s]) => { const r = lvParseTyped(t); return r && r.price === p && r.seat === s && r.name === n; }));
  ok('t1', typed.every(Boolean), 'la caja entiende "gibbs se fue en 86 a ness", "jeanty 48 dream team", "me lleve olave 19", "bowers $36 real madrid", "st. brown 65 5"');
  // dos toques: bloque -> desplegable de equipo -> precio -> Sold
  const MD_TEAMS_FZ26 = 10;
  const clk = await pg.evaluate(() => { lvBlock('loveland'); const sel = document.getElementById('lv-sold-seat'), inp = document.getElementById('lv-sold-price'); if (!sel || !inp) return { err: 'no row' }; sel.value = '6'; inp.value = '23'; const b0 = AU.budgets[6]; lvSoldClick(); return { b0, b1: AU.budgets[6], opts: sel.options.length }; });
  ok('t2', !clk.err && clk.b1 === clk.b0 - 23 && clk.opts === MD_TEAMS_FZ26, `el bloque cierra la venta con desplegable de equipo y precio (${JSON.stringify(clk)})`);
  const inf = await pg.evaluate(() => {
    // sobreprecio RELATIVO al sticker vigente (1.2x), no dolares fijos: con
    // dolares fijos el check se pudrio al recalibrar VAL_CURVE (2026-08-28),
    // porque $72 por Bijan paso de sobreprecio a precio justo
    [['bijan', 4], ['mccaffrey', 5], ['chase', 6], ['nacua', 7]].forEach(([n, s]) => {
      const p = MD.pool.find(x => new RegExp(n, 'i').test(x.name));
      lvSold(n, Math.round(auValue(p) * 1.2), s);
    });
    const r = lvRead();
    return { inf: r.inflacion, adelanto: r.adelanto, frase: lvFase(r).t };
  });
  ok('i', inf.inf < 1 && inf.adelanto > 0.1,
    `cinco lotes caros enfrian el mercado (inflacion ${inf.inf.toFixed(3)}, gasto ${Math.round(inf.adelanto * 100)} puntos por delante del llenado)`);
  // la frase puede ser la de sala rota (inflacion <= 0.92) o la intermedia,
  // pero en las dos tiene que DECIR que el gasto va por delante: eso es lo
  // que cambia una decision, no la cifra de inflacion
  ok('i2', /running out of money|goes cheap|points ahead/i.test(inf.frase),
    `la sala lo dice en cristiano, no con un numero: "${inf.frase.slice(0, 62)}..."`);

  // ── (j) CONTROL DE EXACTITUD DEL NOMBRE ──────────────────────────────────
  const nom = await pg.evaluate(() => ({
    chase: (lvFind('chase')[0] || {}).name || null,
    brown: (lvFind('st brown')[0] || {}).name || null
  }));
  ok('j', nom.chase === "Ja'Marr Chase",
    `'chase' resuelve al apellido, no al nombre de pila (dio ${nom.chase})`);

  // ── (k) CONTROL NEGATIVO DE LISTAS ───────────────────────────────────────
  const listas = await pg.evaluate(() => lvPrefPaste('avoid', 'Justin Jefferson\nZzz Fantasma'));
  ok('k', listas.ok === 1 && listas.bad.length === 1 && /Fantasma/.test(listas.bad[0]),
    `un nombre inexistente se declara en vez de tragarse (${listas.bad.join(',')})`);

  // ── (l) EL GUSTO SESGA, NO VETA ──────────────────────────────────────────
  const gusto = await pg.evaluate(() => {
    const p = lvOne('jefferson'); lvBlock(p);
    const c = lvCeiling(p);
    return { techo: c.techo, puro: c.puro, pref: c.pref };
  });
  ok('l', gusto.pref === 'avoid' && gusto.techo > 0 && gusto.techo < gusto.puro,
    `"no es mi tipo" baja el techo pero NO lo pone a cero ($${gusto.techo} contra $${gusto.puro} limpio)`);

  // ── (m) LA GANGA: control positivo Y negativo ────────────────────────────
  const m1 = await pg.evaluate(() => {
    // rivales arruinados y con roster casi lleno: nadie puede superar la puja
    for (let s = 1; s <= MD.teams; s++) {
      if (s === MD.mySlot) continue;
      AU.budgets[s] = 6; AU.slotsLeft[s] = 5;
      MD.aiRosters[s] = { QB: 1, RB: 2, WR: 3, TE: 1, K: 0, DEF: 0, list: [] };
    }
    AU.budgets[MD.mySlot] = 90; AU.slotsLeft[MD.mySlot] = 8;
    AU.lot.bid = 8;
    const c = lvCeiling(AU.lot.p);
    return { ganga: c.ganga, frase: lvAdvice(AU.lot.p, c, lvRead()) };
  });
  ok('m1', m1.ganga === true && /nobody left can outbid/i.test(m1.frase),
    'ganga confirmada cuando vale mas Y nadie puede superarla');

  const m2 = await pg.evaluate(() => {
    // misma sala, pero la puja sube por encima del valor
    AU.lot.bid = 60;
    const alto = lvCeiling(AU.lot.p).ganga;
    // y el caso que rompia: lote recien abierto en $1 con la sala INTACTA
    for (let s = 1; s <= MD.teams; s++) { AU.budgets[s] = MD.budget; AU.slotsLeft[s] = MD.rounds; }
    const p = lvOne('jeanty'); lvBlock(p);
    return { alto: alto, abierto: lvCeiling(p).ganga, bid: AU.lot.bid };
  });
  ok('m2', m2.alto === false && m2.abierto === false,
    `sin ganga con la puja alta NI con el lote recien abierto en $${m2.bid} (era el falso positivo de cada nominacion)`);

  // ── (n) EL CONSEJO CALLA CUANDO NO TIENE NADA ────────────────────────────
  const silencio = await pg.evaluate(() => {
    MD.mine = []; AU.inflation = 1;
    const p = lvOne('jeanty'); lvBlock(p);
    return lvAdvice(p, lvCeiling(p), lvRead());
  });
  ok('n', silencio === '', 'el consejo calla en un lote sin nada que decir');

  // ── (o) LA RESERVA BAJA EL TECHO Y SE LIBERA SOLA ────────────────────────
  const res = await pg.evaluate(() => {
    AU.budgets[MD.mySlot] = 200; AU.slotsLeft[MD.mySlot] = 15; AU.inflation = 1;
    const p = lvOne('jeanty'); lvBlock(p);
    LV.reserva = 0; const sin = lvCeiling(p).techo;
    // la reserva solo muerde si el tope resultante cae por debajo del techo:
    // con $200 y 15 huecos el tope es $186, asi que hace falta una reserva
    // grande para que se note sobre un jugador de ~$40. Eso es correcto:
    // una reserva que recortara un techo que ni se acerca a ella seria un
    // castigo sin motivo
    LV.reserva = 150; const con = lvCeiling(p);
    AU.inflation = 0.85; const roto = lvCeiling(p);   // sala sin dinero: se libera
    AU.inflation = 1; AU.slotsLeft[MD.mySlot] = 3; const pocos = lvCeiling(p);
    LV.reserva = 0;
    return { sin, con: con.techo, resAct: con.resAct, roto: roto.resAct, pocos: pocos.resAct };
  });
  ok('o', res.resAct > 0 && res.con < res.sin,
    `la reserva recorta el techo mientras esta activa ($${res.sin} -> $${res.con})`);
  ok('o2', res.roto === 0 && res.pocos === 0,
    'la reserva se libera sola con la sala rota y con pocos huecos (nada de dinero muerto)');

  // ── (t) EL PRECIO QUE EL DUENO ESCRIBIO EN My Rankings MANDA ────────────
  //    Escribir "$88 por Jeanty" es una decision tomada, no una opinion que
  //    haya que promediar con el mercado. Se comprueba por el camino publico
  //    (tmrSetPrice), con control ANTES y DESPUES, y se comprueba tambien que
  //    el desglose lo DECLARA: un techo que sale de algo que uno escribio y no
  //    lo dice, miente por omision.
  //    Y NO puede lanzar: contra el codigo anterior tmrSetPrice no existe, y un
  //    evaluate que revienta se lleva por delante los checks que vienen detras
  //    (el gate se pondria verde por no llegar a mirar).
  const man = await pg.evaluate(() => {
    if (typeof window.tmrSetPrice !== 'function') return { falta: 'no existe tmrSetPrice: la feature no esta' };
    AU.budgets[MD.mySlot] = 200; AU.slotsLeft[MD.mySlot] = 15; AU.inflation = 1;
    LV.reserva = 0;
    const p = lvOne('jeanty');
    delete LV.pref[p.id];
    lvBlock(p);
    lvMisValores();
    const antes = lvCeiling(p);
    window.tmrSetPrice(p.id, 88);      // el camino publico, el mismo del tab
    lvMisValores();
    const desp = lvCeiling(p);
    // el gusto NO puede volver a cobrarse sobre un numero ya escrito
    LV.pref[p.id] = 'avoid';
    const conGusto = lvCeiling(p);
    delete LV.pref[p.id];
    lvPanel();
    const txt = (document.querySelector('#lv-panel .lv-break') || {}).textContent || '';
    // y al quitarlo se vuelve al numero del motor
    window.tmrSetPrice(p.id, '');
    lvMisValores();
    const vuelta = lvCeiling(p);
    return {
      antes: antes.techo, antesMan: antes.manual, desp: desp.techo, despMan: desp.manual,
      conGusto: conGusto.techo, vuelta: vuelta.techo, txt: txt.trim()
    };
  });
  ok('t1', !man.falta && man.antesMan == null && man.antes !== 88 && man.despMan === 88 && man.desp === 88,
    man.falta || `el techo pasa de $${man.antes} (motor) a $${man.desp} en cuanto el dueno escribe su precio`);
  ok('t2', !man.falta && man.conGusto === 88,
    man.falta || `"no es mi tipo" no vuelve a recortar un precio escrito a mano (sigue en $${man.conGusto})`);
  ok('t3', !man.falta && /your price \$88/.test(man.txt || ''),
    man.falta || `el desglose declara de donde sale el numero: "${(man.txt || '').slice(0, 90)}"`);
  ok('t4', !man.falta && man.vuelta === man.antes,
    man.falta || `al borrar el precio a mano se vuelve al del motor ($${man.vuelta})`);

  // ── (p) REACTION TIME, con techo declarado ───────────────────────────────
  const ms = await pg.evaluate(() => {
    const qs = ['chase', 'gibbs', 'bijan', 'nabers', 'hall', 'achane', 'taylor', 'brown', 'smith', 'jeanty'];
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) { LV._qc = {}; const r = lvFind(qs[i % qs.length]); if (r.length) lvCeiling(r[0]); }
    return (performance.now() - t0) / 300;
  });
  ok('p', ms < TECHO_MS,
    `busqueda + techo sin cache en ${ms.toFixed(3)}ms, techo declarado ${TECHO_MS}ms`);

  // ── (q) EL LECTOR DE YAHOO, sobre la sala REAL que guardo el dueno ───────
  const FIX = path.join(ROOT, 'scripts', 'fixtures', 'yahoo-auction-room-2026-08-26.txt');
  const fixTxt = fs.readFileSync(FIX, 'utf8');
  const parsed = await pg.evaluate(t => lvParseYahoo(t), fixTxt);
  ok('q1', parsed.lot && parsed.lot.name === 'O. Hampton' && parsed.lot.bid === 1 && parsed.lot.holder === 'El Capitan',
    `lee el lote vivo (${parsed.lot ? parsed.lot.name + ' $' + parsed.lot.bid + ' ' + parsed.lot.holder : 'nada'})`);
  ok('q2', parsed.seats.length === 12 && parsed.seats.filter(x => x.name === 'Kevin').length === 2,
    `lee los 12 asientos por ORDEN, con los dos "Kevin" y sin tragarse el badge $1 (${parsed.seats.length})`);
  ok('q3', parsed.results.length === 9 && parsed.results[0].name === 'S. Barkley' && parsed.results[8].cost === 64,
    `lee las 9 ventas de Results en orden de pick (${parsed.results.length})`);
  const resolved = await pg.evaluate(() => ({
    b: (lvResolve('B. Robinson') || {}).name, w: (lvResolve('W. Robinson') || {}).name,
    j: (lvResolve('J. SMITH-NJIGBA') || {}).name, a: (lvResolve('A. St. Brown') || {}).name
  }));
  ok('q4', resolved.b === 'Bijan Robinson' && resolved.w === "Wan'Dale Robinson"
    && resolved.j === 'Jaxon Smith-Njigba' && resolved.a === 'Amon-Ra St. Brown',
    `resuelve nombres abreviados por inicial + apellido (B./W. Robinson distintos)`);

  // ── (r) APLICAR LATIDOS: ventas, idempotencia y diferencia de presupuesto ──
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2200);
  await pg.evaluate(async () => await window.lvEnter());
  await pg.waitForTimeout(1200);
  const r1 = await pg.evaluate(t => { const r = lvIngest(t); return { sold: r.sold, picks: MD.picks.length, lot: r.lot }; }, fixTxt);
  ok('r1', r1.sold === 9 && r1.picks === 9 && r1.lot === 'Omarion Hampton',
    `un latido con Results aplica las 9 ventas y pone el lote (${r1.sold} ventas, lote ${r1.lot})`);
  const r2 = await pg.evaluate(t => lvIngest(t).sold, fixTxt);
  ok('r2', r2 === 0, `el MISMO latido otra vez no vende nada (${r2}); es la razon de que se pueda mandar cada 1,5s`);
  // Results cerrada: solo el lote, "Last:" y la tabla. Hampton se vendio a El
  // Capitan por $37 y hay lote nuevo. La venta tiene que salir de la DIFERENCIA.
  let t3 = fixTxt.split('Pick\tPlayer')[0]
    .replace('Last:\nJ. SMITH-NJIGBA\n(WR · SEA)\nmatt', 'Last:\nO. HAMPTON\n(RB · LAC)\nEl Capitan')
    .replace('El Capitan\n\t$200\t0/15', 'El Capitan\n\t$163\t1/15')
    .replace('O. Hampton\nRB\nLAC\nBye 7\nProj $41\n$1\nEl Capitan', 'D. Achane\nRB\nMia\nBye 12\nProj $38\n$14\nHunter');
  const r3 = await pg.evaluate(t => {
    const r = lvIngest(t); const u = AU.sold[0];
    return { sold: r.sold, ultima: u && u.p.name, precio: u && u.price, lote: AU.lot && AU.lot.p.name, bid: AU.lot && AU.lot.bid, warn: r.warn };
  }, t3);
  ok('r3', r3.sold === 1 && r3.ultima === 'Omarion Hampton' && r3.precio === 37,
    `con Results CERRADA la venta sale de la diferencia de presupuesto (${r3.ultima} $${r3.precio})`);
  ok('r4', r3.lote === "De'Von Achane" && r3.bid === 14,
    `el lote nuevo entra con su puja viva (${r3.lote} $${r3.bid})`);
  ok('r5', /share a name \(Kevin\)/.test((r3.warn || []).join(' ')),
    'dos equipos con el mismo nombre se declaran (mock del dueno: dos Kevin)');

  // (r6) sala NUEVA a mitad del draft, con Results CERRADA: el panel no puede
  // reconstruir el historial y tiene que pedir la pestana, con los numeros
  await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2200);
  await pg.evaluate(async () => await window.lvEnter());
  await pg.waitForTimeout(1200);
  const r6 = await pg.evaluate(t => { const r = lvIngest(t); return { sold: r.sold, warn: r.warn[0] || '', picks: MD.picks.length }; }, fixTxt.split('Pick\tPlayer')[0]);
  ok('r6', r6.sold === 0 && /Open the Results tab/.test(r6.warn) && /shows \d+ players bought and this panel has 0/.test(r6.warn),
    `a mitad del draft sin Results, pide la pestana con los dos numeros: "${r6.warn.slice(0, 70)}"`);
  // y con Results visible en el siguiente latido, se pone al dia y calla
  const r7 = await pg.evaluate(t => { const r = lvIngest(t); return { sold: r.sold, warn: (r.warn || []).join(' ') }; }, fixTxt);
  ok('r7', r7.sold === 9 && !/Open the Results tab/.test(r7.warn),
    `con Results visible se pone al dia (${r7.sold} ventas) y deja de pedirla`);
  // (r9) lo que se esta escribiendo sobrevive a un latido: se teclea a medias,
  // llega un latido que repinta el panel, y la caja conserva texto y foco
  await pg.click('#lv-in');
  await pg.keyboard.type('gib');
  await pg.evaluate(t => lvIngest(t), fixTxt);
  const r9 = await pg.evaluate(() => { const i = document.getElementById('lv-in'); return { v: i && i.value, f: document.activeElement === i, hint: (document.getElementById('lv-hint') || {}).textContent || '' }; });
  ok('r9', r9.v === 'gib' && r9.f && /Gibbs/.test(r9.hint),
    `lo escrito sobrevive al latido: valor "${r9.v}", foco ${r9.f}, pista sigue en Gibbs`);
  // (r8) el nombre truncado del preset casa por prefijo
  const r8 = await pg.evaluate(() => { LV.seatMap = {}; return lvSeatOf('Family Feud Champions 2026'); });
  ok('r8', r8 === 10, `"Family Feud ..." del preset casa con el nombre completo de Yahoo por prefijo (asiento ${r8})`);

  // ── (s) EL MARCADOR, DE PUNTA A PUNTA: ventana emergente real ────────────
  // La pagina "Yahoo" es una pagina local con el texto de la sala; el marcador
  // se ejecuta ahi tal cual saldria de la barra de favoritos, abre Mac Draft
  // en una ventana nueva y le manda el texto. El origen no es yahoo.com, asi
  // que la ventana recibe la orden de aceptar cualquier origen SOLO en el gate.
  const yahoo = await br.newPage({ viewport: { width: 1200, height: 800 } });
  await yahoo.setContent('<pre id="t"></pre>');
  await yahoo.evaluate(t => { document.getElementById('t').textContent = t; }, fixTxt);
  const bm = await pg.evaluate(b => lvBookmarklet(b), BASE);
  const src = decodeURIComponent(bm.replace(/^javascript:/, ''));
  const [popup] = await Promise.all([
    yahoo.waitForEvent('popup'),
    yahoo.evaluate(code => { (new Function(code))(); }, src)
  ]);
  await popup.waitForLoadState('domcontentloaded');
  let listo = false;
  for (let i = 0; i < 60 && !listo; i++) {
    await popup.waitForTimeout(500);
    listo = await popup.evaluate(() => !!(window.LV && window.AU && AU.active && LV.on)).catch(() => false);
  }
  // la URL de la ventana ya no conserva el #draftday: switchScreen la
  // reescribe con pushState al entrar en la sala, y eso es correcto. Lo que
  // se comprueba es que la sala este viva, no la forma de la URL.
  ok('s1', listo, `el marcador abre Mac Draft en una ventana y la sala arranca sola por #draftday`);
  await popup.evaluate(() => { LV.anyOrigin = true; });
  let fed = null;
  for (let i = 0; i < 16 && !(fed && fed.n > 0 && fed.picks === 9); i++) {
    await popup.waitForTimeout(500);
    fed = await popup.evaluate(() => ({ n: LV.feed.n, picks: MD.picks.length, live: !!document.querySelector('.lv-yh.is-live') })).catch(() => null);
  }
  ok('s2', fed && fed.n > 0 && fed.picks === 9,
    `la ventana recibe los latidos y aplica la sala (${fed ? fed.n + ' latidos, ' + fed.picks + ' ventas' : 'nada'})`);
  ok('s3', fed && fed.live, 'el panel marca la conexion como viva');
  await popup.close(); await yahoo.close();

  await pg.close();
} finally {
  await br.close();
  if (srv) srv.kill();
}

console.log('');
if (fail) { console.log(`LIVE QA: ${fail} FALLOS de ${pass + fail}`); process.exit(1); }
console.log(`LIVE ALL GREEN: ${pass} checks`);
