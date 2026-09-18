#!/usr/bin/env node
// GATE DEL LOGIN DE YAHOO (2026-09-18).
//
//   node scripts/qa-yahoo-login.mjs
//
// El OAuth real de Yahoo solo cierra contra macdraft.app, asi que aqui se
// levanta un Yahoo de MENTIRA en localhost que canjea cualquier codigo por un
// token, y el servidor se apunta a el (YAHOO_TOKEN_URL, que solo acepta
// localhost). Lo que se mide es todo lo nuestro: el relevo cifrado, la vuelta
// a la misma pestana, que un tropiezo de red no desloguea, y las puertas.
//
// El caso que motivo esto: en la app instalada del iPhone el login se abre en
// una capa de Safari que NO comparte almacenamiento con la app. Se simula con
// DOS contextos de navegador: la "app" pide el login y el "Safari" hace el
// callback. Si el token no cruza, el check (3) se pone rojo.
'use strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
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

const PORT = Number(process.env.QA_PORT || 3223);
const FAKE = PORT + 100;
const BASE = 'http://localhost:' + PORT;

// Prevuelo: un servidor viejo en el puerto haria medir OTRO proceso.
try { await fetch(BASE + '/'); console.error('El puerto ' + PORT + ' ya contesta. Cierra ese proceso.'); process.exit(2); } catch (_) { }

// Yahoo de mentira: canjea cualquier codigo. Cuenta los canjes.
let canjes = 0;
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    canjes++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ access_token: 'qa-access-' + canjes, refresh_token: 'qa-refresh', expires_in: 3600 }));
  });
});
await new Promise(r => fake.listen(FAKE, r));

const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: {
    ...process.env, PORT: String(PORT),
    YAHOO_CLIENT_ID: 'qa-client', YAHOO_CLIENT_SECRET: 'qa-secret',
    YAHOO_TOKEN_URL: 'http://127.0.0.1:' + FAKE + '/token',
    YAHOO_HANDOFF_STORE: 'local'
  }, stdio: 'ignore'
});
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
  await new Promise(r => setTimeout(r, 500));
}
const cerrar = () => { try { srv.kill(); } catch (_) { } try { fake.close(); } catch (_) { } };
let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };
const nonce = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const tomar = async (h) => (await fetch(BASE + '/api/yahoo/handoff/take', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ h }) })).json();
const estado = (loc) => {
  const st = new URL(loc).searchParams.get('state');
  try { return JSON.parse(Buffer.from(st || '', 'base64url').toString('utf8')); } catch (_) { return {}; }
};

try {
  // ── 1. /login lleva el secreto y la vuelta por state, y filtra la vuelta
  const h1 = nonce();
  const r1 = await fetch(BASE + '/api/yahoo/login?h=' + h1 + '&r=' + encodeURIComponent('/research?x=1'), { redirect: 'manual' });
  const s1 = estado(r1.headers.get('location') || 'http://x/');
  ok('(1a) /login manda a Yahoo con el secreto y la vuelta en state',
    r1.status === 302 && s1.h === h1 && s1.r === '/research?x=1', JSON.stringify({ status: r1.status, s1 }));
  ok('(1b) sin scope por parametro (Yahoo lo rechaza, ver la nota de /login)',
    !/[?&]scope=/.test(r1.headers.get('location') || ''), r1.headers.get('location'));
  const r1c = await fetch(BASE + '/api/yahoo/login?h=corto&r=' + encodeURIComponent('//evil.com/x'), { redirect: 'manual' });
  const s1c = estado(r1c.headers.get('location') || 'http://x/');
  ok('(1c) CONTROL: una vuelta a otro host y un secreto mal formado no pasan', !s1c.h && !s1c.r, JSON.stringify(s1c));

  // ── 2. el relevo: el callback lo deja, se recoge UNA vez
  const h2 = nonce();
  const pend = await tomar(h2);
  ok('(2a) antes del login el relevo dice pending, con 200 (sin ruido en consola)', pend.pending === true, JSON.stringify(pend));
  const st2 = Buffer.from(JSON.stringify({ h: h2 })).toString('base64url');
  const cb = await fetch(BASE + '/api/yahoo/callback?code=qa&state=' + st2);
  const cbHtml = await cb.text();
  ok('(2b) el callback contesta sin bajar planteles (un solo canje, cero llamadas a Fantasy)',
    cb.ok && canjes === 1 && /yahoo-done\.js/.test(cbHtml), 'canjes=' + canjes);
  // EL ATAQUE: un enlace de login con un h que conoce otro. Si el callback
  // dejara el token solo, ese otro lo recogeria aqui.
  const solo = await tomar(h2);
  ok('(2b2) el callback SOLO no deja nada en el relevo (sin el toque, un enlace ajeno no roba la sesion)',
    solo.pending === true && !solo.token, JSON.stringify(solo));
  const tok2 = (cbHtml.match(/"access_token":"([^"]+)"/) || [])[1];
  const sube = await fetch(BASE + '/api/yahoo/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ h: h2, token: { access_token: tok2, refresh_token: 'qa-refresh', expires_at: Date.now() + 3600e3 } }) });
  const basura = await fetch(BASE + '/api/yahoo/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ h: h2, token: { access_token: 'x'.repeat(5000) } }) });
  ok('(2b3) la subida confirmada entra; una mal formada es 400', sube.ok && basura.status === 400, sube.status + ' / ' + basura.status);
  const tomado = await tomar(h2);
  ok('(2c) la app recoge el token con su secreto', tomado.token && tomado.token.access_token === 'qa-access-1', JSON.stringify(tomado));
  const otra = await tomar(h2);
  ok('(2d) un solo uso: la segunda vez ya no hay nada', otra.pending === true && !otra.token, JSON.stringify(otra));
  const malo = await fetch(BASE + '/api/yahoo/handoff/take', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ h: 'xyz' }) });
  ok('(2e) un secreto mal formado es 400', malo.status === 400, String(malo.status));
  // Lo guardado en disco no se lee sin el secreto.
  const os = await import('node:os');
  const h2b = nonce();
  await fetch(BASE + '/api/yahoo/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ h: h2b, token: { access_token: 'qa-access-secreto', refresh_token: 'r' } }) });
  // El archivo EXACTO de este secreto (archivos viejos de otras corridas no cuentan).
  const { createHash } = await import('node:crypto');
  const archivo = path.join(os.tmpdir(), 'yahoo-handoff-' + createHash('sha256').update('yh-id:' + h2b).digest('hex').slice(0, 40) + '.json');
  const crudo = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '';
  ok('(2f) el relevo guardado esta cifrado: el token no aparece en claro', !!crudo && !/qa-access/.test(crudo) && /"tag"/.test(crudo),
    crudo ? crudo.slice(0, 80) : 'no existe ' + archivo);
  await tomar(h2b);

  // ── 3. la app instalada: login en OTRO almacenamiento, y el token cruza
  const b = await chromium.launch();
  const errs = [];
  const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /posthog/, /sleepercdn/, /api\/sleeper/];
  const vigilar = pg => {
    pg.on('console', m => { if (m.type() !== 'error') return; const t = m.text(); const u = (m.location() || {}).url || ''; if (!RUIDO.some(r => r.test(t) || r.test(u))) errs.push(t.slice(0, 160)); });
    pg.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));
  };
  const app = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await app.addInitScript(() => {
    // "Instalada": display-mode standalone, como la PWA del iPhone.
    const mm = window.matchMedia.bind(window);
    window.matchMedia = q => /standalone/.test(q) ? { matches: true, media: q, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } } : mm(q);
    // La capa de Safari: se abre, pero en otro mundo. Se apunta la URL.
    window.__abiertas = [];
    window.open = (u) => { window.__abiertas.push(String(u)); return { closed: false, close() { } }; };
  });
  const pa = await app.newPage(); vigilar(pa);
  let pedidosApp = 0;
  await pa.route('**/api/yahoo/leagues', r => { pedidosApp++; r.fulfill({ json: { leagues: [] } }); });
  await pa.goto(BASE + '/myleagues', { waitUntil: 'domcontentloaded' });
  await pa.waitForFunction(() => typeof mlYahooConnect === 'function', { timeout: 30000 });
  const btn = await pa.$('#screen-myleagues .ml-y');
  ok('(3a) Leagues sin cuenta ofrece Sign in with Yahoo', !!btn);
  if (btn) await btn.click(); else await pa.evaluate(() => mlYahooConnect());
  const abierta = await pa.evaluate(() => window.__abiertas[0] || '');
  const h3 = new URL(abierta || '/?h=', BASE).searchParams.get('h');
  ok('(3b) el login sale con un secreto de 128 bits', /^[a-f0-9]{32}$/.test(h3 || ''), abierta);
  // El "Safari" de la capa: otro contexto, otro localStorage.
  const safari = await b.newContext();
  const ps = await safari.newPage(); vigilar(ps);
  const loginResp = await fetch(BASE + abierta, { redirect: 'manual' });
  const st3 = new URL(loginResp.headers.get('location')).searchParams.get('state');
  await ps.goto(BASE + '/api/yahoo/callback?code=qa&state=' + st3, { waitUntil: 'domcontentloaded' });
  await ps.waitForTimeout(300);
  const safariTxt = await ps.evaluate(() => document.body.innerText);
  ok('(3c) la capa pide confirmar y avisa del enlace ajeno, sin abrir Mac Draft dentro de ella',
    /Connect Yahoo to Mac Draft\?/.test(safariTxt) && /someone sent you this link/i.test(safariTxt), safariTxt.slice(0, 160));
  await pa.waitForTimeout(3000);
  const antes = await pa.evaluate(() => !!localStorage.getItem('tm_yahoo_tok'));
  ok('(3c2) CONTROL: sin el toque la app NO recibe nada', antes === false, String(antes));
  await ps.click('button');
  await ps.waitForFunction(() => /Yahoo connected/.test(document.body.innerText), { timeout: 8000 }).catch(() => { });
  const despues = await ps.evaluate(() => document.body.innerText);
  ok('(3c3) tras el toque dice que vuelvas a la app', /go back to Mac Draft/i.test(despues), despues.slice(0, 120));
  await pa.waitForFunction(() => { try { return !!JSON.parse(localStorage.getItem('tm_yahoo_tok') || 'null'); } catch (_) { return false; } }, { timeout: 12000 }).catch(() => { });
  const enApp = await pa.evaluate(() => ({ tok: JSON.parse(localStorage.getItem('tm_yahoo_tok') || 'null'), pend: localStorage.getItem('tm_yahoo_h') }));
  ok('(3d) EL CASO DEL IPHONE: el token llega a la app aunque el login fue en otro almacenamiento',
    !!(enApp.tok && /^qa-access-/.test(enApp.tok.access_token)), JSON.stringify(enApp));
  ok('(3e) y el pendiente se limpia', !enApp.pend, String(enApp.pend));
  for (let i = 0; i < 50 && !pedidosApp; i++) await pa.waitForTimeout(100);
  ok('(3f) Leagues se rehace sola y pide las ligas de Yahoo con la sesion nueva', pedidosApp > 0, 'pedidos=' + pedidosApp);

  // ── 4. popup bloqueado en un navegador normal: login en la misma pestana
  const web = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await web.addInitScript(() => { window.open = () => null; });
  const pw = await web.newPage(); vigilar(pw);
  let loginUrl = '';
  await pw.route('**/api/yahoo/login*', r => { loginUrl = r.request().url(); r.fulfill({ status: 200, contentType: 'text/html', body: '<p>yahoo</p>' }); });
  await pw.goto(BASE + '/myleagues', { waitUntil: 'domcontentloaded' });
  await pw.waitForFunction(() => typeof mlYahooConnect === 'function', { timeout: 30000 });
  await pw.evaluate(() => mlYahooConnect());
  for (let i = 0; i < 50 && !loginUrl; i++) await pw.waitForTimeout(100);
  // La peticion que hizo la pestana, contestada de verdad por el servidor.
  const r4 = loginUrl ? await fetch(loginUrl, { redirect: 'manual' }) : null;
  const s4 = r4 ? estado(r4.headers.get('location') || 'http://x/') : {};
  ok('(4a) sin popup, la misma pestana va a Yahoo con la vuelta a Leagues', s4.r === '/myleagues' && /^[a-f0-9]{32}$/.test(s4.h || ''), JSON.stringify(s4));
  // El callback vuelve a /myleagues en esta pestana, con la sesion puesta.
  let pedidosWeb = 0;
  await pw.route('**/api/yahoo/leagues', r => { pedidosWeb++; r.fulfill({ json: { leagues: [] } }); });
  await pw.goto(BASE + '/api/yahoo/callback?code=qa&state=' + Buffer.from(JSON.stringify(s4)).toString('base64url'));
  await pw.waitForURL(/\/myleagues/, { timeout: 10000 }).catch(() => { });
  for (let i = 0; i < 80 && !pedidosWeb; i++) await pw.waitForTimeout(100);
  const w4 = await pw.evaluate(() => ({ url: location.pathname, tok: !!JSON.parse(localStorage.getItem('tm_yahoo_tok') || 'null'), pend: localStorage.getItem('tm_yahoo_h') }));
  ok('(4b) vuelve a Leagues ya conectado y pide sus ligas', w4.url === '/myleagues' && w4.tok && !w4.pend && pedidosWeb > 0,
    JSON.stringify({ ...w4, pedidosWeb }));

  // Login CSRF: un enlace al callback que este navegador NO pidio (codigo de
  // otra cuenta) no puede meter esa cuenta aqui, ni con vuelta ni sin ella.
  const ajeno = await b.newContext();
  const pj = await ajeno.newPage(); vigilar(pj);
  await pj.goto(BASE + '/api/yahoo/callback?code=otro&state=' + Buffer.from(JSON.stringify({ r: '/myleagues' })).toString('base64url'));
  await pj.waitForTimeout(900);
  const pj1 = await pj.evaluate(() => ({ tok: localStorage.getItem('tm_yahoo_tok'), url: location.pathname }));
  await pj.goto(BASE + '/api/yahoo/callback?code=otro');
  await pj.waitForTimeout(600);
  const pj2 = await pj.evaluate(() => localStorage.getItem('tm_yahoo_tok'));
  ok('(4c) CONTROL: un callback que este navegador no pidio no guarda ninguna cuenta', !pj1.tok && !pj2, JSON.stringify({ pj1, pj2 }));

  // ── 5. un tropiezo de red NO desloguea; un rechazo de Yahoo si
  const vivo = await pw.evaluate(async () => {
    localStorage.setItem('tm_yahoo_tok', JSON.stringify({ access_token: 'viejo', refresh_token: 'r', expires_at: Date.now() - 1000 }));
    const f0 = window.fetch;
    window.fetch = (u, o) => /\/api\/yahoo\/refresh/.test(u) ? Promise.resolve(new Response('{}', { status: 502 })) : f0(u, o);
    const t = await mlYahooVivo();
    const quedo = !!JSON.parse(localStorage.getItem('tm_yahoo_tok') || 'null');
    window.fetch = (u, o) => /\/api\/yahoo\/refresh/.test(u) ? Promise.resolve(new Response('{}', { status: 401 })) : f0(u, o);
    const t2 = await mlYahooVivo();
    const quedo2 = !!JSON.parse(localStorage.getItem('tm_yahoo_tok') || 'null');
    window.fetch = f0;
    return { t, quedo, t2, quedo2 };
  });
  ok('(5a) un 502 al refrescar conserva la sesion', vivo.quedo === true && vivo.t === 'viejo', JSON.stringify(vivo));
  ok('(5b) CONTROL: un 401 de Yahoo si la cierra', vivo.quedo2 === false && vivo.t2 === null, JSON.stringify(vivo));
  const reintento = await pw.evaluate(async () => {
    localStorage.setItem('tm_yahoo_tok', JSON.stringify({ access_token: 'a1', refresh_token: 'r', expires_at: Date.now() + 3600e3 }));
    const f0 = window.fetch; const vistos = [];
    window.fetch = (u, o) => {
      if (/\/api\/yahoo\/refresh/.test(u)) return Promise.resolve(new Response(JSON.stringify({ access_token: 'a2', expires_in: 3600 }), { status: 200 }));
      if (/\/api\/yahoo\/leagues/.test(u)) { const t = o.headers['X-Yahoo-Token']; vistos.push(t); return Promise.resolve(new Response(JSON.stringify({ leagues: [] }), { status: t === 'a2' ? 200 : 401 })); }
      return f0(u, o);
    };
    let bien = false; try { await mlYahooGet('/leagues'); bien = true; } catch (_) { }
    window.fetch = f0;
    return { bien, vistos, tok: JSON.parse(localStorage.getItem('tm_yahoo_tok')).access_token };
  });
  const tropiezo = await pw.evaluate(async () => {
    localStorage.setItem('tm_yahoo_tok', JSON.stringify({ access_token: 'b1', refresh_token: 'r', expires_at: Date.now() + 3600e3 }));
    const f0 = window.fetch;
    window.fetch = (u, o) => /\/api\/yahoo\/refresh/.test(u) ? Promise.resolve(new Response('{}', { status: 502 }))
      : /\/api\/yahoo\/leagues/.test(u) ? Promise.resolve(new Response('{}', { status: 401 })) : f0(u, o);
    let msg = ''; try { await mlYahooGet('/leagues'); } catch (e) { msg = e.message; }
    window.fetch = f0;
    return { msg, quedo: !!JSON.parse(localStorage.getItem('tm_yahoo_tok') || 'null') };
  });
  ok('(5d) 401 y el refresco con tropiezo: la sesion se conserva', tropiezo.quedo === true && /temporarily/.test(tropiezo.msg), JSON.stringify(tropiezo));
  ok('(5c) un 401 con el token "vivo" se refresca y repite antes de desloguear',
    reintento.bien && reintento.vistos.join(',') === 'a1,a2' && reintento.tok === 'a2', JSON.stringify(reintento));

  // ── 6. el analizador con Sleeper conectado tiene puerta a Yahoo
  const an = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pn = await an.newPage(); vigilar(pn);
  await pn.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pn.waitForFunction(() => typeof renderLeagues === 'function' && typeof mlYahooStart === 'function', { timeout: 30000 });
  const puerta = await pn.evaluate(() => {
    switchScreen('analyze');
    document.getElementById('login-panel').style.display = 'none';
    window._myLeagues = [{ league_id: '1', name: 'QA Sleeper', season: '2026', total_rosters: 12, status: 'in_season', settings: {} }];
    renderLeagues(window._myLeagues);
    const bt = document.querySelector('#yahoo-add-row .yahoo-add-btn');
    const r = bt && bt.getBoundingClientRect();
    const seVe = !!bt && getComputedStyle(bt).display !== 'none' && r.width > 0;
    leagueId = '1';
    const dd = document.getElementById('lg-switch-dd'); dd.style.display = 'block'; _renderLeagueSwitcher('');
    return { visible: seVe, alto: r ? Math.round(r.height) : 0, sw: /Add your Yahoo leagues/.test(dd.innerText) };
  });
  ok('(6a) bajo la lista de ligas hay boton de Yahoo, de 44px de alto', puerta.visible && puerta.alto >= 44, JSON.stringify(puerta));
  ok('(6b) y el cambiador de liga ofrece traer Yahoo', puerta.sw, JSON.stringify(puerta));
  await pn.route('**/api/yahoo/leagues', r => r.fulfill({ json: { leagues: [{ league_key: '461.l.9', name: 'QA Merge', season: '2026', num_teams: 10 }] } }));
  const merge = await pn.evaluate(async () => {
    localStorage.setItem('tm_yahoo_tok', JSON.stringify({ access_token: 'm', refresh_token: 'r', expires_at: Date.now() + 3600e3 }));
    window.dispatchEvent(new CustomEvent('tm-yahoo-connected'));
    for (let i = 0; i < 40 && !(window._myLeagues || []).some(l => l.platform === 'yahoo'); i++) await new Promise(r => setTimeout(r, 100));
    _renderLeagueSwitcher('');
    return {
      ligas: (window._myLeagues || []).map(l => l.name),
      sw: document.getElementById('lg-switch-dd').innerText,
      estado: document.getElementById('yahoo-add-status').textContent,
      boton: getComputedStyle(document.querySelector('#yahoo-add-row .yahoo-add-btn')).display === 'none'
    };
  });
  ok('(6c) al conectar, las ligas de Yahoo se SUMAN a las de Sleeper', merge.ligas.join('|') === 'QA Sleeper|QA Merge', JSON.stringify(merge.ligas));
  ok('(6d) el cambiador las lista y deja de ofrecer Yahoo', /QA Merge/.test(merge.sw) && !/Add your Yahoo/.test(merge.sw), merge.sw.replace(/\s+/g, ' ').slice(0, 160));
  ok('(6e) lo dice en una linea y esconde el boton', /1 Yahoo league added/.test(merge.estado) && merge.boton === true, JSON.stringify({ e: merge.estado, b: merge.boton }));

  // ── 7. quien SOLO juega en Yahoo: ninguna pantalla le pide Sleeper
  const soloY = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await soloY.addInitScript(() => {
    if (!sessionStorage.getItem('qa-sembrado')) {
      sessionStorage.setItem('qa-sembrado', '1');
      localStorage.setItem('tm_yahoo_tok', JSON.stringify({ access_token: 'y', refresh_token: 'r', expires_at: Date.now() + 3600e3 }));
    }
  });
  // TODAS las rutas de Yahoo de mentira: con el token falso, cualquier llamada
  // al Yahoo real devuelve 401 y la app, con razon, cierra la sesion.
  await soloY.route('**/api/yahoo/**', r => {
    const u = r.request().url();
    if (/\/api\/yahoo\/leagues/.test(u)) return r.fulfill({ json: { leagues: [{ league_key: '461.l.77', name: 'QA Solo Yahoo', season: '2026', num_teams: 10 }] } });
    if (/\/api\/yahoo\/status/.test(u)) return r.fulfill({ json: { configured: true } });
    return r.fulfill({ json: {} });
  });
  const py = await soloY.newPage(); vigilar(py);
  await py.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await py.waitForFunction(() => typeof switchScreen === 'function' && typeof mlYahooConectado === 'function', { timeout: 30000 });
  await py.waitForTimeout(800);
  const nav = await py.evaluate(() => ({
    connect: getComputedStyle(document.getElementById('nav-signin')).display,
    pill: (document.getElementById('user-pill-name') || {}).textContent
  }));
  ok('(7a) arriba no le ofrece "Connect": su cuenta es Yahoo', nav.connect === 'none' && nav.pill === 'Yahoo', JSON.stringify(nav));
  await py.evaluate(() => switchScreen('analyze'));
  await py.waitForFunction(() => /QA Solo Yahoo/.test((document.getElementById('league-list') || {}).innerText || ''), { timeout: 10000 }).catch(() => { });
  const an7 = await py.evaluate(() => ({
    login: getComputedStyle(document.getElementById('login-panel')).display,
    lista: (document.getElementById('league-list') || {}).innerText || ''
  }));
  ok('(7b) el analizador lista sus ligas de Yahoo, sin pedirle usuario de Sleeper',
    an7.login === 'none' && /QA Solo Yahoo/.test(an7.lista) && /Yahoo/.test(an7.lista), JSON.stringify(an7).slice(0, 200));
  await py.evaluate(() => switchScreen('sage'));
  await py.waitForTimeout(300);
  const mac = await py.evaluate(() => document.getElementById('sage-connect-hint').textContent);
  ok('(7c) Ask Mac no le pide Sleeper', /Yahoo/.test(mac) && !/Sleeper/.test(mac), mac);
  await py.evaluate(() => goConnectLeague());
  await py.waitForFunction(() => /QA Solo Yahoo/.test((document.getElementById('cm-list') || {}).innerText || ''), { timeout: 10000 }).catch(() => { });
  const modal = await py.evaluate(() => ({ lista: (document.getElementById('cm-list') || {}).innerText || '',
    boton: document.getElementById('cm-yahoo') && getComputedStyle(document.getElementById('cm-yahoo')).display }));
  ok('(7d) el boton Connect le muestra sus ligas de Yahoo directo', /QA Solo Yahoo/.test(modal.lista) && modal.boton === 'none', JSON.stringify(modal));
  await py.evaluate(() => { closeConnectModal(); signOut(); });
  await py.waitForTimeout(300);
  const fuera = await py.evaluate(() => ({ tok: localStorage.getItem('tm_yahoo_tok'), connect: getComputedStyle(document.getElementById('nav-signin')).display }));
  ok('(7e) Sign out tambien cierra Yahoo', !fuera.tok && fuera.connect !== 'none', JSON.stringify(fuera));
  // Y el modal, a alguien sin nada, le ofrece Yahoo.
  await py.evaluate(() => goConnectLeague());
  await py.waitForTimeout(200);
  const ofrece = await py.evaluate(() => { const bt = document.getElementById('cm-yahoo'); const r = bt && bt.getBoundingClientRect(); return { ve: !!bt && getComputedStyle(bt).display !== 'none', alto: r ? Math.round(r.height) : 0 }; });
  ok('(7f) sin cuenta, el modal de Connect ofrece Sign in with Yahoo (44px)', ofrece.ve && ofrece.alto >= 44, JSON.stringify(ofrece));

  ok('(z) consola limpia', errs.length === 0, errs.join('\n      '));
  await b.close();
} catch (e) {
  ok('(!) el gate no reviento', false, String(e && e.stack || e).slice(0, 400));
}
cerrar();
console.log(fails ? '\n' + fails + ' FALLO(S)' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
