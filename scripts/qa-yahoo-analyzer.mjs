#!/usr/bin/env node
// Gate del ANALIZADOR CON UNA LIGA DE YAHOO (15-sep-2026).
//
//   node scripts/qa-yahoo-analyzer.mjs
//
// POR QUE EXISTE. Hasta hoy el boton de Yahoo del analizador importaba UN
// plantel suelto: te dejaba sin rivales y la liga nunca aparecia en la lista.
// Ahora las ligas de Yahoo entran a la misma lista que las de Sleeper y se
// cargan enteras. Ese camino NO lo puede tocar ningun gate con red de verdad:
// el OAuth de Yahoo solo cierra contra macdraft.app, asi que nadie mas puede
// pedir un token. Sin este gate, el unico que comprueba el camino de Yahoo es
// el dueno abriendo la app.
//
// QUE MIDE, Y QUE NO. Inyecta una respuesta con la FORMA EXACTA que devuelve
// /api/yahoo/league/:key (server/routes/yahoo.js) y mide lo que hace el
// cliente con ella: que la liga se liste, que se cargue por el ramal correcto,
// que salgan los diez equipos con sus rivales, y que lo que Yahoo no da se
// DECLARE en vez de fingirse. El parseo del lado del servidor es cosa de
// qa-yahoo-parse.mjs; este gate no lo cubre y no pretende cubrirlo.
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

const PORT = process.env.QA_PORT || 3219;
const BASE = process.env.QA_BASE || ('http://localhost:' + PORT);
const USER = process.env.QA_USER || 'wolco';
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
const RUIDO = [/_vercel\/insights/, /odds\/implied/, /favicon/, /net::ERR_/, /posthog/, /sleepercdn/, /api\/yahoo/];

// ── El fixture: la forma que devuelve /api/yahoo/league/:key ────────────────
// Nombres de jugadores REALES, porque el cliente los cruza contra el mapa de
// Sleeper con _resolveNames. Si se ponen inventados, resuelven cero y el gate
// mediria un plantel vacio creyendo que mide una liga.
const CLAVE = '461.l.664858';
const NOMBRES = [
  ['Josh Allen', 'QB', 'BUF'], ['Bijan Robinson', 'RB', 'ATL'], ['Ja\'Marr Chase', 'WR', 'CIN'],
  ['Brock Bowers', 'TE', 'LV'], ['Jahmyr Gibbs', 'RB', 'DET'], ['Justin Jefferson', 'WR', 'MIN'],
  ['Lamar Jackson', 'QB', 'BAL'], ['Saquon Barkley', 'RB', 'PHI'], ['CeeDee Lamb', 'WR', 'DAL'],
  ['Trey McBride', 'TE', 'ARI'], ['Jalen Hurts', 'QB', 'PHI'], ['De\'Von Achane', 'RB', 'MIA'],
  ['Amon-Ra St. Brown', 'WR', 'DET'], ['Puka Nacua', 'WR', 'LAR'], ['Derrick Henry', 'RB', 'BAL'],
  ['Malik Nabers', 'WR', 'NYG'], ['Nico Collins', 'WR', 'HOU'], ['Ashton Jeanty', 'RB', 'LV'],
  ['Drake London', 'WR', 'ATL'], ['Brian Thomas Jr.', 'WR', 'JAX']
];
const EQUIPOS = 10;
const FIXTURE = {
  league: {
    league_key: CLAVE, name: 'Fantazy 2026', num_teams: EQUIPOS, season: '2026',
    current_week: 2, playoff_start_week: 15, num_playoff_teams: 6, draft_status: 'postdraft',
    // media PPR y un FLEX, que es el molde que rosterPositionsDeYahoo entrega
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN', 'BN', 'BN', 'BN'],
    scoring_settings: { pass_yd: 0.04, pass_td: 4, pass_int: -1, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2 }
  },
  teams: Array.from({ length: EQUIPOS }, (_, i) => ({
    team_key: CLAVE + '.t.' + (i + 1),
    team_id: i + 1,
    name: ['Alan goat', 'Adrian Peterson', 'Los Wachiturros', 'Family Feud', 'El Combo',
      'Pescao Frito', 'Tiburones', 'Los Diablos Rojos', 'Chombo FC', 'Gallo Pinto'][i],
    logo: null, teamLogo: null, managerPhoto: null,
    is_owned_by_current_login: i === 0,      // el primero es el suyo
    wins: 1, losses: 1, ties: 0, points_for: 210.4,
    // dos jugadores por equipo, sin repetir entre equipos
    players: [NOMBRES[i * 2], NOMBRES[i * 2 + 1]].map(([name, pos, team]) => ({
      player_key: CLAVE + '.p.' + name.replace(/\W/g, ''), name, pos, team, status: ''
    }))
  }))
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const pg = await ctx.newPage();
pg.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text(); const url = (m.location() || {}).url || '';
  if (RUIDO.some(r => r.test(t) || r.test(url))) return;
  errsConsola.push(t.slice(0, 140));
});
pg.on('pageerror', e => errsConsola.push('PAGEERROR ' + String(e).slice(0, 200)));

// La sesion de Yahoo se finge sustituyendo las dos funciones que son la puerta
// al token, DESPUES de que myleagues.js las declare. Sustituirlas antes (con
// addInitScript) choca con su `function mlYahooConectado()` y tumba el archivo
// entero: el gate pasaba a medir una pagina rota creyendo que medía Yahoo.
// No se toca la red: lo que se mide es el cliente, no el servidor.
const fingirYahoo = (clave, fixture) => pg.evaluate(([c, f]) => {
  window.__yahooPedidos = [];
  window.mlYahooConectado = () => true;
  window.mlYahooGet = async (ruta) => {
    window.__yahooPedidos.push(ruta);
    if (ruta === '/leagues') {
      return { leagues: [{ league_key: c, league_id: '664858', name: f.league.name, season: '2026', num_teams: f.league.num_teams, is_finished: 0 }] };
    }
    if (ruta.indexOf('/league/') === 0) return f;
    return {};
  };
}, [clave, fixture]);

await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => typeof loadUser === 'function', { timeout: 30000 });
await pg.waitForFunction(() => typeof mlYahooGet === 'function', { timeout: 30000 });
await fingirYahoo(CLAVE, FIXTURE);
// CONTROL del arnes: si myleagues.js no sobrevivio a la sustitucion, el gate no
// esta midiendo la pagina de verdad y su verde no vale nada.
{
  const vivo = await pg.evaluate(() => typeof mlYahooVivo === 'function' && typeof mlPaint === 'function');
  ok('(0) CONTROL: myleagues.js sigue vivo despues de fingir la sesion', vivo === true, 'vivo: ' + vivo);
}
await pg.evaluate(u => { document.getElementById('sleeper-username').value = u; return loadUser(); }, USER);
await pg.waitForFunction(() => (window._myLeagues || []).length > 0, { timeout: 40000 }).catch(() => { });
await pg.waitForTimeout(1500);

// ── 1. la liga de Yahoo se LISTA junto a las de Sleeper ─────────────────────
const lista = await pg.evaluate(clave => {
  const ls = window._myLeagues || [];
  const y = ls.filter(l => l.league_id === clave)[0] || null;
  return {
    total: ls.length,
    sleeper: ls.filter(l => !l.platform).length,
    yahoo: y ? { name: y.name, platform: y.platform, teams: y.total_rosters } : null,
    tarjetas: Array.from(document.querySelectorAll('#league-list .league-card'))
      .map(c => ((c.querySelector('.league-card-name') || {}).textContent || '').trim()),
    metaYahoo: Array.from(document.querySelectorAll('#league-list .league-card'))
      .filter(c => /Fantazy 2026/.test(c.textContent))
      .map(c => ((c.querySelector('.league-card-meta') || {}).textContent || '').trim())[0] || null
  };
}, CLAVE);
ok('(1a) CONTROL: la cuenta de Sleeper trajo sus ligas (si no, no se mide nada)',
  lista.sleeper >= 5, JSON.stringify({ total: lista.total, sleeper: lista.sleeper }));
ok('(1b) la liga de Yahoo entra a la misma lista, con su marca de plataforma',
  !!lista.yahoo && lista.yahoo.platform === 'yahoo' && lista.yahoo.teams === EQUIPOS,
  JSON.stringify(lista.yahoo));
ok('(1c) se pinta como tarjeta elegible', lista.tarjetas.some(n => /Fantazy 2026/.test(n)),
  JSON.stringify(lista.tarjetas));
ok('(1d) la tarjeta dice que es de Yahoo (dos ligas de nombre parecido serian iguales)',
  !!lista.metaYahoo && /Yahoo/.test(lista.metaYahoo), String(lista.metaYahoo));

// ── 2. la puerta "Yahoo" importa por la ruta nueva, no por el callback viejo
// Esta es la entrada que toca el usuario. Con token vivo no debe abrir OAuth:
// lista TODAS las ligas desde /leagues y la seleccion carga /league/:key.
await pg.evaluate(() => startYahooLogin());
await pg.waitForFunction(() => document.querySelectorAll('#yahoo-team-select option').length > 1, { timeout: 10000 }).catch(() => { });
const puerta = await pg.evaluate(() => ({
  caja: getComputedStyle(document.getElementById('manual-roster-box')).display,
  opciones: Array.from(document.querySelectorAll('#yahoo-team-select option')).map(o => o.textContent),
  estado: document.getElementById('yahoo-status').textContent
}));
ok('(2a) el boton Yahoo reutiliza la sesion y lista las ligas sin repetir OAuth',
  puerta.caja !== 'none' && puerta.opciones.some(x => /Fantazy 2026/.test(x)), JSON.stringify(puerta));
// Regresion exacta del fallo reportado: el callback viejo puede no conseguir
// planteles, pero si entrego token la ruta nueva todavia tiene que continuar.
await pg.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
  origin: window.location.origin,
  data: { type:'trademind-yahoo', payload:{
    error:'Could not read any rosters from Yahoo.',
    token:{access_token:'qa-token',refresh_token:'qa-refresh',expires_at:Date.now()+3600000}
  }}
})));
await pg.waitForTimeout(100);
const tokenConError = await pg.evaluate(() => ({
  opciones: Array.from(document.querySelectorAll('#yahoo-team-select option')).map(o => o.textContent),
  estado: document.getElementById('yahoo-status').textContent
}));
ok('(2b) token valido gana al error viejo del callback y el import sigue',
  tokenConError.opciones.some(x => /Fantazy 2026/.test(x)) && !/Could not read any rosters/.test(tokenConError.estado),
  JSON.stringify(tokenConError));
await pg.evaluate(() => {
  const s = document.getElementById('yahoo-team-select');
  s.value = '0';
  return finishYahooImport();
});
await pg.waitForFunction(() => window.leaguePlatform === 'yahoo' && leagueRosters.length > 0, { timeout: 30000 }).catch(() => { });
await pg.waitForTimeout(800);

const st = await pg.evaluate(clave => {
  const sel = document.getElementById('opp-select');
  const banner = document.getElementById('no-trades-banner');
  return {
    plataforma: window.leaguePlatform,
    pedidos: window.__yahooPedidos,
    rosters: leagueRosters.length,
    users: leagueUsers.length,
    userId: userId,
    miRoster: myRoster.length,
    // el plantel tiene que haberse RESUELTO contra el mapa de Sleeper
    miRosterNombres: myRoster.map(p => p.name),
    rivales: sel ? Array.from(sel.options).filter(o => o.value).length : -1,
    rivalYo: sel ? Array.from(sel.options).some(o => o.value === clave + '.t.1') : null,
    picks: leaguePicks.length, trades: leagueTrades.length, misPicks: myPicks.length,
    noTrades: window.leagueNoTrades,
    modo: leagueMode,
    ppr: leagueFormat.ppr,
    equipos: leagueFormat.totalTeams,
    builder: (document.getElementById('builder-panel') || {}).style?.display,
    meta: (document.getElementById('league-meta') || {}).textContent || '',
    bannerVisible: banner ? getComputedStyle(banner).display !== 'none' : false,
    bannerTexto: (banner || {}).textContent || '',
    atrib: (() => { const a = document.getElementById('yahoo-attrib'); return a ? getComputedStyle(a).display !== 'none' : false; })()
  };
}, CLAVE);

ok('(2c) se cargo por el ramal de Yahoo', st.plataforma === 'yahoo', JSON.stringify({ plataforma: st.plataforma, pedidos: st.pedidos }));
ok('(2d) pidio la liga a Yahoo, no a Sleeper', (st.pedidos || []).some(r => r.indexOf('/league/' + CLAVE) === 0), JSON.stringify(st.pedidos));
ok('(2e) estan los diez equipos con sus planteles', st.rosters === EQUIPOS && st.users === EQUIPOS,
  JSON.stringify({ rosters: st.rosters, users: st.users }));
ok('(2f) el equipo del usuario es el que Yahoo marca como suyo', st.userId === CLAVE + '.t.1', String(st.userId));
ok('(2g) CONTROL: su plantel RESOLVIO contra el mapa de Sleeper (no viene vacio)',
  st.miRoster >= 2, JSON.stringify(st.miRosterNombres));
ok('(2h) hay rivales de verdad: nueve, y el suyo no se ofrece a si mismo',
  st.rivales === EQUIPOS - 1 && st.rivalYo === false, JSON.stringify({ rivales: st.rivales, seOfreceASiMismo: st.rivalYo }));
ok('(2i) el reglamento de Yahoo se leyo: media PPR y diez equipos',
  st.ppr === 0.5 && st.equipos === EQUIPOS, JSON.stringify({ ppr: st.ppr, equipos: st.equipos }));
ok('(2j) el constructor de trades esta abierto', st.builder === 'block', String(st.builder));

// ── 3. lo que Yahoo NO da se DECLARA, no se finge ───────────────────────────
ok('(3a) no se inventan picks ni historial de trades',
  st.picks === 0 && st.trades === 0 && st.misPicks === 0,
  JSON.stringify({ picks: st.picks, trades: st.trades, misPicks: st.misPicks }));
ok('(3b) el cartel dice que Yahoo no entrega picks ni trades pasados',
  st.bannerVisible === true && /pick/i.test(st.bannerTexto) && /Yahoo/.test(st.bannerTexto),
  st.bannerTexto.slice(0, 160));
ok('(3c) NO se marca como liga con trades apagados (ahi si se puede tradear)',
  st.noTrades === false, String(st.noTrades));
ok('(3d) se declara redraft y no se adivina dynasty', st.modo === 'redraft', String(st.modo));
ok('(3e) la atribucion de Yahoo esta a la vista (la piden sus terminos)', st.atrib === true, String(st.atrib));

// ── 4. volver a una liga de Sleeper no queda contaminado ────────────────────
await pg.evaluate(() => {
  const s = (window._myLeagues || []).filter(l => !l.platform)[0];
  return loadLeague(s.league_id, s.name, s.total_rosters, s.season);
});
await pg.waitForFunction(() => window.leaguePlatform === 'sleeper' && leagueRosters.length > 0, { timeout: 40000 }).catch(() => { });
await pg.waitForTimeout(1200);
const vuelta = await pg.evaluate(() => ({
  plataforma: window.leaguePlatform,
  rosters: leagueRosters.length,
  atrib: (() => { const a = document.getElementById('yahoo-attrib'); return a ? getComputedStyle(a).display !== 'none' : false; })(),
  userId: String(userId)
}));
ok('(4a) una liga de Sleeper sigue cargando por su ramal de siempre',
  vuelta.plataforma === 'sleeper' && vuelta.rosters > 0, JSON.stringify(vuelta));
ok('(4b) la atribucion de Yahoo se retira al salir de Yahoo', vuelta.atrib === false, String(vuelta.atrib));
ok('(4c) el userId vuelve a ser el de Sleeper, no una clave de Yahoo',
  !/^\d+\.l\./.test(vuelta.userId), vuelta.userId);

ok('(z) consola limpia', errsConsola.length === 0, errsConsola.join('\n      '));

await b.close(); cerrar();
console.log(fails ? '\n' + fails + ' FALLOS' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
