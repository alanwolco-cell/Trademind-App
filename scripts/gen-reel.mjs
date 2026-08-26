#!/usr/bin/env node
// Genera el reel del hero FILMANDO EL PRODUCTO REAL contra localhost.
//
//   node scripts/gen-reel.mjs                 # escribe public/promo-reel.mp4 y su poster
//   node scripts/gen-reel.mjs --dry           # deja la salida en el scratchpad, no toca public/
//   REEL_SECS=13 node scripts/gen-reel.mjs
//
// POR QUE EXISTE. El reel que estaba en produccion se hizo A MANO y se
// desincronizo del producto: mostraba un jugador que NO EXISTE ("J. Love RB
// ARI"), truncaba "J. Smith-Njigb", iba tipografiado en Archivo (fuente vetada,
// el sitio ya migro a Familjen Grotesk) y desperdiciaba dos tercios del cuadro.
// Filmando el producto real, tres de esos cuatro defectos no pueden volver:
// los jugadores salen del maestro de Sleeper, los nombres los maquета el CSS de
// verdad, y la fuente es la que sirve /fonts/*.woff2. El cuarto (encuadre) se
// resuelve aqui, fijando el cuadro y comprobando que el primer fotograma no es
// negro.
//
// NO se genera con IA: un video de la UI hecho con IA muestra un producto que
// no existe. Decision del dueno.
//
// Playwright NO esta en package.json a proposito: su postinstall se baja los
// navegadores y eso correria en cada build de Vercel.
'use strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const SECS = Number(process.env.REEL_SECS || 13);
// El viewport es parametro, no constante: a 1920 entra en cuadro el panel
// "My team" vacio, y a ~1400 se esconde solo por la regla de layout de la
// sesion del 25-ago, con lo que todo sale mas grande. Es una decision de
// encuadre del dueno, asi que se elige desde fuera sin tocar el script.
const ANCHO = Number(process.env.REEL_W || 1920);
const ALTO  = Number(process.env.REEL_H || Math.round(ANCHO * 9 / 16));

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

// ffmpeg: en esta maquina vive en ~/.local/bin y NO hay ffprobe, asi que todo
// lo que haya que medir del video se mide con el propio ffmpeg.
const FFMPEG = ['ffmpeg', path.join(os.homedir(), '.local/bin/ffmpeg')]
  .find(c => spawnSync(c, ['-version'], { stdio: 'ignore' }).status === 0);
if (!FFMPEG) { console.error('No encuentro ffmpeg.'); process.exit(2); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'macdraft-reel-'));
const PORT = process.env.REEL_PORT || 3221;
const BASE = process.env.REEL_BASE || ('http://localhost:' + PORT);
let srv = null;
if (!process.env.REEL_BASE) {
  srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')],
    { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
    await new Promise(r => setTimeout(r, 500));
  }
}
const cerrar = () => { if (srv) try { srv.kill(); } catch (_) { } };

console.log('Filmando la sala de subasta a ' + ANCHO + 'x' + ALTO + ', ' + SECS + 's...');
const b = await chromium.launch();
const tVideo = Date.now();   // Playwright empieza a grabar AQUI, no cuando yo filmo
const ctx = await b.newContext({
  viewport: { width: ANCHO, height: ALTO },
  deviceScaleFactor: 1,
  recordVideo: { dir: TMP, size: { width: ANCHO, height: ALTO } }
});
const pg = await ctx.newPage();

// El motor NO tiene semilla propia: MD.seed solo se usa para jitter en tres
// puntos y el resto llama Math.random() directo. Sin sembrarlo aqui, ANTES de
// que cargue app.js, dos corridas del generador darian reels distintos y
// "regenerar el reel" dejaria de ser una operacion repetible.
const SEMILLA = Number(process.env.REEL_SEED || 0x2f6e2b1);
await pg.addInitScript(s => {
  let x = s >>> 0;
  Math.random = function () { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}, SEMILLA);

const errs = [];
pg.on('pageerror', e => errs.push(e.message.slice(0, 140)));
await pg.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });

// Arranque sin clicks fragiles: no existe ninguna funcion tipo
// mdSetAuctionParams, el patron del codigo es setear los <select> y arrancar.
await pg.evaluate(() => goMock('solo'));
await pg.waitForTimeout(400);
await pg.selectOption('#md-dtype', 'auction');
await pg.selectOption('#md-teams', '12');
await pg.selectOption('#md-scoring', '1');
await pg.selectOption('#md-format', '1qb');
await pg.selectOption('#md-budget', '200');
await pg.selectOption('#md-slot', '5');
await pg.selectOption('#md-rounds', '8');
await pg.waitForTimeout(200);
await pg.click('#md-start-btn');
await pg.waitForFunction(() => {
  const w = document.getElementById('au-wrap');
  return w && w.style.display !== 'none' && document.querySelector('#au-lot .au-name');
}, { timeout: 90000 });

// El encuadre: la sala arriba del todo, para que el cuadro no arranque en negro
// ni gaste tercios en vacio (defecto 4 del reel viejo).
await pg.evaluate(() => {
  const w = document.getElementById('au-wrap');
  const y = w.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, Math.max(0, y - 96));
});
// Que las caras esten cargadas ANTES de empezar a grabar: un avatar entrando a
// media toma delata que el video se hizo con la pagina a medio pintar.
await pg.waitForTimeout(1800);

// EL ENCUADRE. Filmar la ventana entera a 1920 mete el riel derecho casi vacio
// y un cuarto inferior en negro; pintado luego a min(1120px,94vw) la tipografia
// queda diminuta. Se mide la caja que ocupan de verdad la tarjeta del lote, los
// presupuestos y la lista, y se recorta a 16:9 alrededor. El recorte se hace
// SIN ampliar (sale a 1280x720 desde una region de ese tamano o mayor), asi que
// el texto queda nitido a 1:1 en el hero.
const caja = await pg.evaluate(() => {
  const partes = ['#au-lot', '#au-budgets', '#md-choices']
    .map(sel => document.querySelector(sel))
    .filter(Boolean).map(e => e.getBoundingClientRect());
  if (!partes.length) return null;
  const x0 = Math.min(...partes.map(r => r.left));
  const y0 = Math.min(...partes.map(r => r.top));
  const x1 = Math.max(...partes.map(r => r.right));
  const y1 = Math.max(...partes.map(r => r.bottom));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, vw: window.innerWidth, vh: window.innerHeight };
});


// entre pujas y ese ritmo esta pensado ya para camara. No se usa _AU_FAST.
const t0 = Date.now();
const visto = [];
while (Date.now() - t0 < SECS * 1000) {
  const s = await pg.evaluate(() => {
    const n = document.querySelector('.au-name');
    const sub = document.querySelector('.au-sub');
    const bid = document.querySelector('.au-bid-num');
    if (!n) return null;
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return {
      nombre: n.textContent.trim(),
      sub: sub ? sub.textContent.trim() : '',
      bid: bid ? bid.textContent.trim() : '',
      fuente: cs.fontFamily,
      // truncado real: el texto no cabe en su caja
      cortado: n.scrollWidth > Math.ceil(r.width) + 1 || /…|\.\.\.$/.test(n.textContent)
    };
  });
  if (s) visto.push(s);
  await pg.waitForTimeout(320);
}
await pg.waitForTimeout(300);
const desde = (t0 - tVideo) / 1000;   // segundo del video en que empieza la sala

// El maestro de Sleeper se pide con el servidor TODAVIA vivo: es la
// comprobacion que al reel viejo le falto y por eso enseñaba un "J. Love RB
// ARI" que no existe.
let reales = null;
try {
  const r = await fetch(BASE + '/api/sleeper/players/nfl/slim');
  if (r.ok) {
    const js = await r.json();
    // El maestro slim viene como OBJETO indexado por id y trae first_name /
    // last_name, NO un campo name: armarlo con p.name daba un conjunto de
    // cadenas vacias y entonces TODO jugador parecia inexistente. Se noto
    // porque acuso a Bijan Robinson.
    const lista = Array.isArray(js) ? js : Object.values(js);
    reales = new Set(lista
      .map(p => ((p.first_name || '') + ' ' + (p.last_name || '')).trim())
      .filter(Boolean));
  }
} catch (_) { }

await ctx.close();   // cierra el contexto para que Playwright vuelque el video
await b.close();
cerrar();

const webm = fs.readdirSync(TMP).filter(f => f.endsWith('.webm')).map(f => path.join(TMP, f))[0];
if (!webm) { console.error('Playwright no dejo ningun video en ' + TMP); process.exit(1); }

const SAL = DRY ? TMP : path.join(ROOT, 'public');
const MP4 = path.join(SAL, 'promo-reel.mp4');
const JPG = path.join(SAL, 'promo-poster.jpg');

// Este ffmpeg no acepta -vsync. Y para pasar de un webm de framerate VARIABLE
// (lo que suelta Playwright) a un mp4 de framerate constante NO sirve -r suelto:
// choca con -fps_mode. El filtro fps=30 lo resuelve sin ambiguedad.
const ff = (args) => {
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); throw new Error('ffmpeg fallo: ' + args.join(' ')); }
  return r;
};
// -ss va ANTES de -i para que el recorte sea rapido, y se reencodea igual
// porque el corte tiene que caer en el fotograma exacto, no en el keyframe mas
// cercano. Sin este recorte el reel arrancaba con los once segundos de armar la
// sala, incluida la pagina de inicio en blanco: de ahi salia el fotograma
// inicial claro que delataba el check de luminancia.
// El recorte a 16:9, con un respiro alrededor y siempre dentro de la ventana.
let vf = 'fps=30';
let recorte = 'ventana entera';
const crop = {};
if (caja && !process.env.REEL_SIN_RECORTE) {
  const AIRE = 24;
  let x = Math.max(0, Math.floor(caja.x - AIRE));
  let w = Math.min(caja.vw - x, Math.ceil(caja.w + AIRE * 2));
  // Arriba NO va aire: encima de la caja esta el rotulo "DRAFT BOARD" de la
  // pantalla, y con aire entraba cortado por la mitad, que es peor que no verlo.
  let y = Math.max(0, Math.floor(caja.y));
  let h = Math.min(caja.vh - y, Math.ceil(caja.h + AIRE));
  // NO se fuerza 16:9. Forzarlo crecia el lado ancho hasta 1476 y esos 184px de
  // mas metian en cuadro el panel "My team" VACIO, que es lo unico que el reel
  // no puede ensenar. El dueno eligio el recorte cerrado sobre tres medidos:
  // manda el contenido, y el hero pinta el video a min(1120px,94vw) igual.
  // libx264 con yuv420p exige lados PARES
  w -= w % 2; h -= h % 2;
  vf = 'fps=30,crop=' + w + ':' + h + ':' + x + ':' + y;
  recorte = w + 'x' + h + ' en (' + x + ',' + y + ')';
  crop.w = w; crop.h = h;
}
console.log('encuadre: ' + recorte);
ff(['-ss', desde.toFixed(2), '-i', webm, '-t', String(SECS), '-vf', vf,
  '-c:v', 'libx264', '-preset', 'slow',
  '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', MP4]);
// El poster sale del segundo 1, no del 0: el fotograma 0 de una grabacion suele
// venir a medio componer, y ese poster es lo que ve quien tenga
// prefers-reduced-motion, o sea que no puede ser un cuadro cualquiera.
ff(['-ss', '1', '-i', MP4, '-frames:v', '1', '-q:v', '3', JPG]);

// ── Comprobaciones sobre lo que de verdad se filmo ────────────────────────
let malas = 0;
const chk = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) malas++; };

const nombres = [...new Set(visto.map(v => v.nombre))];
chk('la sala mostro jugadores', nombres.length > 0, nombres.join(', '));
chk('ningun nombre sale cortado', visto.every(v => !v.cortado),
  visto.filter(v => v.cortado).map(v => v.nombre).join(', '));
chk('tipografiado en Familjen Grotesk', visto.every(v => /Familjen Grotesk/.test(v.fuente)),
  visto[0] ? visto[0].fuente : 'sin muestras');
chk('sin errores de pagina', errs.length === 0, errs.join(' | '));

if (reales) {
  // CONTROL NEGATIVO. Sin esto, un conjunto mal armado (cadenas vacias, campo
  // que no existe) daria verde con cualquier cosa en pantalla, que es justo el
  // fallo que dejo pasar al "J. Love RB ARI" del reel viejo. Se comprueba que
  // el conjunto SI rechaza un nombre inventado antes de creerle que acepta.
  const CEBO = 'Jaromir Wolcovinsky';
  chk('el maestro rechaza un nombre inventado (control)', !reales.has(CEBO),
    reales.size + ' nombres reales cargados');
  const fantasmas = nombres.filter(n => !reales.has(n));
  chk('todos los jugadores existen en el maestro de Sleeper', fantasmas.length === 0,
    fantasmas.length ? 'NO EXISTEN: ' + fantasmas.join(', ') : nombres.join(', ') + ' - comprobados contra ' + reales.size);
} else chk('maestro de Sleeper accesible', false, 'no se pudo descargar');

// El primer fotograma no puede ser negro (defecto 4 del reel viejo). signalstats
// da la luminancia media del cuadro; en negro puro YAVG ronda 16.
const st = spawnSync(FFMPEG, ['-hide_banner', '-i', MP4, '-frames:v', '1',
  '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], { encoding: 'utf8' });
const yavg = Number((/YAVG=([\d.]+)/.exec(st.stderr || '') || [])[1] || 0);
chk('el primer fotograma no es negro', yavg > 20, 'luminancia media ' + yavg.toFixed(1));

const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(
  spawnSync(FFMPEG, ['-hide_banner', '-i', MP4], { encoding: 'utf8' }).stderr || '');
const segs = dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : 0;
chk('dura lo pedido', Math.abs(segs - SECS) < 4, segs.toFixed(1) + 's de ' + SECS + 's');

console.log('\n' + MP4 + '  (' + (fs.statSync(MP4).size / 1024 | 0) + ' KB)');
console.log(JPG + '  (' + (fs.statSync(JPG).size / 1024 | 0) + ' KB)');
// El encuadre depende del contenido, asi que los atributos width/height del
// <video> cambian con cada regeneracion. Se recuerdan con el numero REAL: el
// reel viejo estuvo meses en produccion declarando 1080x1080 sobre un archivo
// de 1920x1080.
if (!DRY) console.log('\nRECUERDA en public/index.html: subir el cache-bust ?v= del video\ny declararlo width="' + (crop.w || '?') + '" height="' + (crop.h || '?') + '".');
console.log(malas ? '\n' + malas + ' FALLOS' : '\nREEL OK');
process.exit(malas ? 1 : 0);
