#!/usr/bin/env node
// Gate del REDISEÑO de Ask Mac (2026-09-11, direcciones A+B aprobadas por el
// dueno): el composer manda y los defectos medidos de la auditoria no vuelven.
//
//   node scripts/qa-askmac.mjs
//   QA_BASE=https://macdraft.app node scripts/qa-askmac.mjs
//
// Nunca llama /api/sage (API de pago): la conversacion se simula con
// _sageChatAppend y el status se stubbea con page.route.
// Verificado en ROJO contra el codigo anterior (produccion pre-deploy).
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

const PORT = process.env.QA_PORT || 3227;
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

const errsConsola = [];
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /posthog/, /sleepercdn/, /sage\/status/];
const b = await chromium.launch();
async function pagina(w, h, movil, statusOk) {
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    ...(movil ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {})
  });
  const pg = await ctx.newPage();
  // El status del server de pago se stubbea: este gate mide la pantalla.
  await pg.route('**/api/sage/status**', r => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({ configured: statusOk !== false })
  }));
  await pg.route('**/api/sage/quota**', r => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({ pro: false, dailyLeft: 3, weeklyLeft: 9, referralBonus: 0 })
  }));
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text(), url = (m.location() || {}).url || '';
    if (RUIDO.some(x => x.test(t) || x.test(url))) return;
    errsConsola.push(t.slice(0, 140));
  });
  pg.on('pageerror', e => errsConsola.push('PAGEERROR ' + String(e).slice(0, 200)));
  await pg.goto(BASE + '/sage', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForTimeout(2200);
  return { ctx, pg };
}

/* ── telefono, estado vacio ─────────────────────────────────────────────── */
{
  const { ctx, pg } = await pagina(390, 844, true);
  const st = await pg.evaluate(() => {
    const ta = document.getElementById('sage-chat-input');
    const bt = document.getElementById('sage-chat-send');
    const tb = ta.getBoundingClientRect(), bb = bt.getBoundingClientRect();
    const sug = document.getElementById('sage-suggestions');
    const sr = sug ? sug.getBoundingClientRect() : null;
    return {
      taW: Math.round(tb.width), btW: Math.round(bb.width), btH: Math.round(bb.height),
      title: bt.title || '', poster: !!document.getElementById('sage-greet-owl'),
      dice: /Ask me anything\./.test(document.body.textContent),
      docH: document.documentElement.scrollHeight,
      sugFila: sr ? Math.round(sr.height) : null,
      sugScrollea: sug ? sug.scrollWidth > sug.clientWidth + 10 : null
    };
  });
  ok('(m1) el campo de escribir respira en el telefono (>=200px, era 152)',
    st.taW >= 200, 'textarea ' + st.taW + 'px | boton ' + st.btW + 'px');
  ok('(m2) el boton de enviar es un blanco tactil de 44px con tooltip',
    st.btW >= 42 && st.btW <= 56 && st.btH >= 42 && /Ask Mac/.test(st.title),
    st.btW + 'x' + st.btH + ' title="' + st.title + '"');
  ok('(m3) el saludo-poster murio (sin lechuza de 78px ni "Ask me anything.")',
    !st.poster && !st.dice, JSON.stringify({ poster: st.poster, dice: st.dice }));
  ok('(m4) sin scroll muerto: el chat vacio no mide 1399px de alto',
    st.docH <= 1150, 'alto del documento: ' + st.docH + 'px');
  ok('(m5) los ejemplos van en UNA fila deslizable, no en pila de 198px',
    st.sugFila != null && st.sugFila <= 60 && st.sugScrollea === true,
    'alto ' + st.sugFila + 'px, desliza=' + st.sugScrollea);

  // el panel de chats pasados no queda tapado por la barra inferior
  const side = await pg.evaluate(() => {
    const s = document.querySelector('.sage-side');
    const tb = document.getElementById('tabbar');
    if (!s) return { sinSide: true };
    s.scrollIntoView({ block: 'end' });
    return new Promise(res => setTimeout(() => {
      const r = s.getBoundingClientRect();
      const t = tb ? tb.getBoundingClientRect() : null;
      res({ bottom: Math.round(r.bottom), tabTop: t ? Math.round(t.top) : null });
    }, 300));
  });
  ok('(m6) el historial se ve entero, no mutilado por la tabbar',
    !side.sinSide && side.tabTop != null && side.bottom <= side.tabTop + 2, JSON.stringify(side));
  await ctx.close();
}

/* ── telefono, honestidad del input apagado ─────────────────────────────── */
{
  const { ctx, pg } = await pagina(390, 844, true, false);
  const ph = await pg.evaluate(() => {
    const ta = document.getElementById('sage-chat-input');
    return { dis: ta.disabled, ph: ta.placeholder };
  });
  ok('(m7) sin llave del servidor, el campo apagado LO DICE',
    ph.dis === true && /offline/i.test(ph.ph), JSON.stringify(ph));
  await ctx.close();
}

/* ── escritorio, con conversacion simulada ──────────────────────────────── */
{
  const { ctx, pg } = await pagina(1280, 900, false);
  const st = await pg.evaluate(() => {
    _sageHideGreeting();
    _sageChatAppend('user', 'Should I trade Bijan for Puka?');
    _sageChatAppend('sage', 'Short answer: no. Bijan is the RB1 overall and Puka, great as he is, plays a position you are already deep at. Hold.');
    const log = document.getElementById('sage-chat-log');
    const comp = document.getElementById('sage-composer');
    const lr = log.lastElementChild.getBoundingClientRect();
    const cr = comp.getBoundingClientRect();
    // dedupe de chips: draft y mock comparten etiqueta
    const cont = document.createElement('div');
    _sageRenderNav(cont, 'ok [[go:draft]] [[go:mock]]');
    const chips = cont.querySelectorAll('.sage-nav-chip').length;
    const foco = (() => {
      const ta = document.getElementById('sage-chat-input');
      ta.focus();
      return getComputedStyle(ta).boxShadow;
    })();
    return { hueco: Math.round(cr.top - lr.bottom), chips, foco };
  });
  ok('(d1) sin lienzo muerto: el composer va pegado a la respuesta (<100px, era 312)',
    st.hueco >= 0 && st.hueco < 100, 'hueco: ' + st.hueco + 'px');
  ok('(d2) dos marcadores con la misma etiqueta pintan UN chip', st.chips === 1, st.chips + ' chips');
  ok('(d3) una sola señal de foco: el textarea no pinta su propio anillo',
    st.foco === 'none', 'box-shadow: ' + st.foco);
  await ctx.close();
}

ok('(z) consola limpia', errsConsola.length === 0, errsConsola.slice(0, 5).join(' | '));

await b.close();
cerrar();
console.log(fails ? '\n' + fails + ' FALLOS' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
