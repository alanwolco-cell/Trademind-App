#!/usr/bin/env node
// Genera la imagen del hero de la portada: public/hero-leagues.png
//
//   node scripts/gen-hero-shot.mjs
//   node scripts/gen-hero-shot.mjs --dry   (deja la imagen en un temporal)
//
// POR QUE CON DATOS DE DEMOSTRACION, y no con una cuenta real.
// La portada la ve un desconocido. Las ligas de verdad se llaman como se les
// ocurrio a diez amigos en un grupo de WhatsApp, y algunos de esos nombres no
// se pueden publicar. Asi que la captura sale del producto REAL corriendo (los
// mismos estilos, la misma rejilla, los mismos escudos y colores derivados),
// pero con seis ligas inventadas y nombres limpios. Es una captura del
// producto, no un dibujo: si la tarjeta se rompe, la portada lo enseña.
'use strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATOS = [
  path.join(ROOT, 'node_modules/playwright/index.mjs'),
  '/Users/wolco/Development/mi-nuevo-website/node_modules/playwright/index.mjs',
  '/Users/wolco/Development/contratos/node_modules/playwright/index.mjs',
  '/Users/wolco/Development/ernestocalvo/node_modules/playwright/index.mjs'
];
const ruta = CANDIDATOS.find(p => fs.existsSync(p));
if (!ruta) { console.error('No encuentro playwright.'); process.exit(2); }
const { chromium } = await import(ruta);

const SECO = process.argv.includes('--dry');
const DESTINO = SECO
  ? path.join(os.tmpdir(), 'hero-leagues.png')
  : path.join(ROOT, 'public', 'hero-leagues.png');

const PORT = process.env.SHOT_PORT || 3290;
const BASE = 'http://localhost:' + PORT;
const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
  { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
  await new Promise(r => setTimeout(r, 500));
}

// Seis ligas inventadas, con la forma exacta que pinta mlPaintLeagues.
const DEMO = [
  ['Sunday Money', 2, 12, 'PPR', [8, 3], 128.4, 121.7, 'The Commissioner', true],
  ['The Group Chat', 0, 10, 'HALF', [7, 4], 116.9, 124.2, 'Waiver Wire Willy', false],
  ['Dinner Table League', 0, 12, 'PPR', [6, 5], 109.5, 98.1, 'Backup Plan', false],
  ['The Office', 0, 10, 'STD', [9, 2], 121.0, 118.8, 'Copy Room Kings', false],
  ['Dynasty Warehouse', 2, 12, 'PPR', [5, 6], 132.7, 126.3, 'Rebuild Rick', false],
  ['Last Call', 0, 14, 'HALF', [4, 7], 104.2, 112.6, 'Sunday Scaries', false]
];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2 });
const pg = await ctx.newPage();
await pg.addInitScript(() => { try { localStorage.setItem('tm_username', 'demo'); } catch (e) { } });
await pg.goto(BASE + '/myleagues', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => typeof window.mlPaintLeagues === 'function' || (window.ML && window.ML.leagues), null, { timeout: 30000 }).catch(() => { });
await pg.waitForTimeout(1500);

const ok = await pg.evaluate((demo) => {
  if (!window.ML) return 'sin modulo';
  ML.loading = false; ML.ready = true; ML.err = null; ML.stale = null; ML.week = 11;
  ML.username = 'demo'; ML.filtro = {};
  ML.leagues = demo.map(function (d, i) {
    var nombre = d[0], tipo = d[1], equipos = d[2], scoring = d[3];
    var rec = d[4], mio = d[5], suyo = d[6], rival = d[7], campeon = d[8];
    var rec_ = { rec: scoring === 'PPR' ? 1 : (scoring === 'HALF' ? 0.5 : 0) };
    // Con el plantel vacio la tarjeta dice "rosters are not set yet" y se pierde
    // justo lo que hay que enseñar: el duelo y su linea.
    var plantel = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    var rosters = [
      { roster_id: 1, owner_id: 'me', players: plantel, settings: { wins: rec[0], losses: rec[1], fpts: 1200 } },
      { roster_id: 2, owner_id: 'opp', players: plantel, settings: { wins: 5, losses: 6, fpts: 1100 } }
    ];
    return {
      // El color sale de un hash del id: con ids correlativos (demo-0, demo-1)
      // los tonos salen casi identicos y se pierde la gracia.
      id: nombre.toLowerCase().replace(/[^a-z]+/g, '-'),
      plat: i === 3 ? 'yahoo' : 'sleeper', name: nombre,
      teams: equipos, status: 'in_season', type: tipo,
      settings: { playoff_teams: 6, playoff_week_start: 15 },
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'],
      scoring_settings: rec_, avatar: null, logo: null,
      champId: campeon ? 1 : null,
      _hyd: {
        rosters: rosters,
        users: { me: { display_name: 'You', metadata: {} }, opp: { display_name: rival, metadata: {} } },
        mine: rosters[0], sc: null,
        proj: { 1: { total: mio, coverage: 1 }, 2: { total: suyo, coverage: 1 } },
        matchups: [], muBy: {}, myMu: { roster_id: 1, matchup_id: 1 }, opp: 2, schedule: null
      }
    };
  });
  mlPaintLeagues();
  var sub = document.getElementById('ml-sub');
  if (sub) sub.textContent = '6 leagues · Week 11';
  // Fuera lo que no aporta en una foto de portada.
  var t = document.querySelector('#screen-myleagues .ml-tools'); if (t) t.remove();
  return document.querySelectorAll('.ml-card').length;
}, DEMO);
if (typeof ok !== 'number' || ok < 6) {
  console.error('La demo no pinto las seis tarjetas (' + ok + '). No se toca la portada.');
  await b.close(); srv.kill(); process.exit(1);
}
await pg.waitForTimeout(400);

const caja = await pg.evaluate(() => {
  const g = document.querySelector('#screen-myleagues .ml-grid') || document.querySelector('.ml-grid');
  if (!g) return { error: 'no encuentro la rejilla' };
  const r = g.getBoundingClientRect();
  return {
    x: Math.max(0, r.left + window.scrollX - 10),
    y: Math.max(0, r.top + window.scrollY - 10),
    width: Math.min(1240, r.width + 20),
    height: Math.min(900, r.height + 20)
  };
});
if (caja.error || !caja.width) {
  console.error('No se pudo medir la rejilla: ' + JSON.stringify(caja));
  await b.close(); srv.kill(); process.exit(1);
}
await pg.screenshot({ path: DESTINO, clip: caja });

const px = fs.statSync(DESTINO).size;
console.log('escrito ' + DESTINO + ' (' + Math.round(px / 1024) + ' KB), recorte ' +
  Math.round(caja.width) + 'x' + Math.round(caja.height));
console.log('RECORDATORIO: en index.html el <img> del hero tiene que declarar width="' +
  Math.round(caja.width) + '" height="' + Math.round(caja.height) + '" y subir el ?v=');

await b.close(); srv.kill();
