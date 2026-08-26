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
      desborde: document.documentElement.scrollWidth > window.innerWidth
    }));
    ok(tag === 'phone' ? 'c2' : 'c1', st.panel && st.viva && st.espejo,
      `${tag}: al clicar abre la sala en modo espejo con el panel puesto`);
    ok(tag === 'phone' ? 'd2' : 'd1', !st.desborde, `${tag}: la pantalla no desborda a ${w}px`);
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

  const inf = await pg.evaluate(() => {
    [['bijan', 72, 4], ['mccaffrey', 68, 5], ['chase', 69, 6], ['nacua', 64, 7]]
      .forEach(([n, p, s]) => lvSold(n, p, s));
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

  // ── (p) REACTION TIME, con techo declarado ───────────────────────────────
  const ms = await pg.evaluate(() => {
    const qs = ['chase', 'gibbs', 'bijan', 'nabers', 'hall', 'achane', 'taylor', 'brown', 'smith', 'jeanty'];
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) { LV._qc = {}; const r = lvFind(qs[i % qs.length]); if (r.length) lvCeiling(r[0]); }
    return (performance.now() - t0) / 300;
  });
  ok('p', ms < TECHO_MS,
    `busqueda + techo sin cache en ${ms.toFixed(3)}ms, techo declarado ${TECHO_MS}ms`);

  await pg.close();
} finally {
  await br.close();
  if (srv) srv.kill();
}

console.log('');
if (fail) { console.log(`LIVE QA: ${fail} FALLOS de ${pass + fail}`); process.exit(1); }
console.log(`LIVE ALL GREEN: ${pass} checks`);
