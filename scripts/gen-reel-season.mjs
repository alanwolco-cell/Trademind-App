#!/usr/bin/env node
// Genera el reel del hero de la portada: public/promo-season.mp4 (+ poster).
//
//   node scripts/gen-reel-season.mjs          escribe en public/
//   node scripts/gen-reel-season.mjs --dry    deja la salida en un temporal
//
// FILMA EL PRODUCTO REAL (regla del repo: nunca IA generativa, nunca dibujado
// a mano; el reel viejo se desincronizo del producto justamente por ser
// manual). La escena es /myleagues?demo=1: seis ligas INVENTADAS con
// jugadores REALES, porque los nombres de las ligas de verdad del dueno no
// son publicables y las fotos de jugadores si.
// Guion: la parrilla de ligas -> se abre el matchup de Sunday Money (dos
// alineaciones de frente, puntos en vivo) -> el tablero de Odds.
//
// Lecciones del generador viejo, ya pagadas, que este repite a proposito:
// - Playwright graba desde que se crea el CONTEXTO: se guarda ese instante y
//   se recorta con -ss.
// - webm de framerate variable -> mp4 constante va con el filtro fps=30,
//   nunca con -r suelto.
// - El primer fotograma se comprueba por luminancia media: negro = fallo.
'use strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATOS = [
  path.join(ROOT, 'node_modules/playwright/index.mjs'),
  '/Users/wolco/Development/mi-nuevo-website/node_modules/playwright/index.mjs',
  '/Users/wolco/Development/contratos/node_modules/playwright/index.mjs'
];
const ruta = CANDIDATOS.find(p => fs.existsSync(p));
if (!ruta) { console.error('No encuentro playwright.'); process.exit(2); }
const { chromium } = await import(ruta);

const SECO = process.argv.includes('--dry');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-season-'));
const DEST_MP4 = SECO ? path.join(TMP, 'promo-season.mp4') : path.join(ROOT, 'public', 'promo-season.mp4');
const DEST_POSTER = SECO ? path.join(TMP, 'poster.jpg') : path.join(ROOT, 'public', 'promo-season-poster.jpg');

const W = 1240, H = 780;
const PORT = process.env.REEL_PORT || 3291;
const BASE = 'http://localhost:' + PORT;
const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
  { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
  await new Promise(r => setTimeout(r, 500));
}

const fallos = [];
const b = await chromium.launch();
const t0 = Date.now();
const ctx = await b.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 2,
  recordVideo: { dir: TMP, size: { width: W, height: H } }
});
const pg = await ctx.newPage();
// Los dos errores del ENTORNO local (insights 404 y odds 503) no cuentan;
// cualquier otro error de consola tumba el reel.
const errs = [];
pg.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  const url = (m.location() && m.location().url) || '';
  if (/_vercel\/insights/.test(t + url)) return;
  if (/503|odds\/implied/.test(t + url)) return;
  // una foto que falta en el CDN de Sleeper no es un defecto nuestro y la UI
  // ya la esconde (onerror); cualquier otro error tumba el reel
  if (/sleepercdn\.com/.test(url) && /404/.test(t)) return;
  errs.push((t + ' <- ' + url).slice(0, 200));
});
await pg.goto(BASE + '/myleagues?demo=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForFunction(() => document.querySelectorAll('#screen-myleagues .ml-card').length >= 6, null, { timeout: 30000 });
// que las fotos del overlay esten calientes antes de abrirlo en camara
// Se abre SUNDAY MONEY por nombre, no "la primera": el orden de la parrilla
// es por urgencia y puede poner delante una liga sin el duelo completo.
const abreSunday = () => {
  const c = [...document.querySelectorAll('#screen-myleagues .ml-card[role=button]')]
    .find(x => /Sunday Money/.test(x.textContent));
  if (c) c.click();
  return !!c;
};
await pg.evaluate(async (fn) => {
  eval('(' + fn + ')')(); await new Promise(r => setTimeout(r, 1200));
  mlCloseMatchup(); await new Promise(r => setTimeout(r, 300));
}, abreSunday.toString());
await pg.waitForTimeout(600);

const tEscena = Date.now();          // aqui ARRANCA el reel (se recorta lo anterior)
await pg.waitForTimeout(2800);       // escena 1: la parrilla de ligas
await pg.evaluate((fn) => { eval('(' + fn + ')')(); }, abreSunday.toString());
await pg.waitForTimeout(4200);       // escena 2: el matchup, dos alineaciones de frente

// COMPROBACIONES dentro del overlay, con la camara rodando (no alteran nada)
const dentro = await pg.evaluate(() => {
  const ov = document.getElementById('ml-mu-overlay');
  const nombres = [...ov.querySelectorAll('.ml-mu-txt b')].map(x => x.textContent.trim());
  const fotos = [...ov.querySelectorAll('.ml-mu-p img')].filter(i => i.naturalWidth > 0).length;
  const trunc = [...ov.querySelectorAll('.ml-mu-txt b')].filter(x => x.scrollHeight > x.clientHeight + 2).length;
  const reales = ov.querySelectorAll('.ml-mu-pts.is-real').length;
  return { nombres, fotos, trunc, reales };
});
await pg.evaluate(() => mlCloseMatchup());
await pg.waitForTimeout(700);
await pg.evaluate(() => document.querySelector('#screen-myleagues .inner-tab[data-tab="tab-ml-odds"]').click());
await pg.waitForTimeout(3600);       // escena 3: el tablero de Odds
const tFin = Date.now();

await ctx.close();                   // suelta el webm
await b.close(); srv.kill();

// --- verificaciones ---------------------------------------------------------
if (errs.length) fallos.push('consola sucia: ' + errs[0]);
const maestro = JSON.parse(fs.readFileSync('/tmp/master.json', 'utf8'));
const ps = maestro.players || maestro;
const nombresMaestro = new Set(Object.values(ps).map(p =>
  (((p.first_name || '') + ' ' + (p.last_name || '')).trim()) || p.name || ''));
nombresMaestro.add('Philadelphia Eagles'); nombresMaestro.add('Kansas City Chiefs');
// CONTROL NEGATIVO: un cebo que el maestro tiene que rechazar
if (nombresMaestro.has('Jugador Cebo Inexistente')) fallos.push('el control negativo del maestro no controla nada');
const desconocidos = dentro.nombres.filter(n => !nombresMaestro.has(n));
if (desconocidos.length) fallos.push('jugador fuera del maestro: ' + desconocidos.join(', '));
if (dentro.nombres.length < 18) fallos.push('el matchup no esta completo: ' + dentro.nombres.length + ' de 18');
if (dentro.fotos < 14) fallos.push('pocas fotos cargadas: ' + dentro.fotos);
if (dentro.trunc > 0) fallos.push(dentro.trunc + ' nombres truncados');
if (dentro.reales < 14) fallos.push('el duelo no se ve en vivo: ' + dentro.reales + ' puntos reales');

const webm = fs.readdirSync(TMP).filter(f => f.endsWith('.webm')).map(f => path.join(TMP, f))[0];
if (!webm) { console.error('No salio el webm.'); process.exit(1); }
const ss = ((tEscena - t0) / 1000).toFixed(2);
const dur = ((tFin - tEscena) / 1000).toFixed(2);
execFileSync('ffmpeg', ['-y', '-ss', ss, '-i', webm, '-t', dur,
  '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23',
  '-pix_fmt', 'yuv420p', '-an', DEST_MP4], { stdio: 'pipe' });
execFileSync('ffmpeg', ['-y', '-i', DEST_MP4, '-frames:v', '1', '-q:v', '3', DEST_POSTER], { stdio: 'pipe' });

// En esta maquina no hay ffprobe (solo el ffmpeg estatico): las tres
// verificaciones salen del stderr de ffmpeg, que trae lo mismo.
function ffmeta(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  return String(r.stderr || '');
}
// primer fotograma no negro, por luminancia media (signalstats en el frame 0)
const lumTxt = ffmeta(['-i', DEST_MP4, '-vf', 'select=eq(n\\,0),signalstats,metadata=print', '-frames:v', '1', '-f', 'null', '-']);
const lumM = lumTxt.match(/YAVG=([\d.]+)/);
const lum = lumM ? parseFloat(lumM[1]) : NaN;
if (!(lum >= 8)) fallos.push('primer fotograma casi negro (YAVG ' + lum + ')');
const info = ffmeta(['-i', DEST_MP4]);
const durM = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
const durReal = durM ? (+durM[1] * 3600 + +durM[2] * 60 + parseFloat(durM[3])) : NaN;
if (!(durReal >= 9 && durReal <= 16)) fallos.push('duracion rara: ' + durReal + 's');
const dimM = info.match(/, (\d{3,4})x(\d{3,4})/);
const dims = dimM ? (dimM[1] + ',' + dimM[2]) : '?';

if (fallos.length) {
  console.error('EL REEL NO PASA:\n  - ' + fallos.join('\n  - '));
  process.exit(1);
}
const kb = Math.round(fs.statSync(DEST_MP4).size / 1024);
console.log('escrito ' + DEST_MP4 + ' (' + kb + ' KB, ' + durReal.toFixed(1) + 's, ' + dims + ')');
console.log('poster ' + DEST_POSTER);
console.log('RECORDATORIO: el <video> del hero declara width/height segun ' + dims + ' y sube el ?v=');
