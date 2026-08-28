#!/usr/bin/env node
// Genera los assets de la PWA instalada desde el icono de marca, con ffmpeg:
//   public/icon-192.png, public/icon-512.png (manifest)
//   public/splash/*.png: la pantalla de arranque de iOS en sus tamanos EXACTOS
//   (iOS ignora background_color del manifest y sin la imagen de SU tamano
//   pinta negro). Degradado VERTICAL de marca, nunca radial, con Mac centrado.
// El primer fotograma de la animacion CSS (#tm-splash en index.html) es el mismo
// degradado y el mismo icono, para que el traspaso no se vea.
//   node scripts/gen-pwa-assets.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const ICON = path.join(PUB, 'apple-touch-icon.png'); // 180px, la unica fuente que hay
const TOP = '0x2a1f4a', BOT = '0x050507';           // morado de marca arriba, fondo abajo
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
fs.mkdirSync(path.join(PUB, 'splash'), { recursive: true });
for (const s of [192, 512]) ff(['-i', ICON, '-vf', `scale=${s}:${s}:flags=lanczos`, path.join(PUB, `icon-${s}.png`)]);
// el mismo icono sin su fondo negro, para el splash CSS (#tm-splash) sobre el degradado
ff(['-i', ICON, '-vf', 'format=rgba,colorkey=0x000000:0.08:0.05,scale=512:512:flags=lanczos', path.join(PUB, 'splash', 'mark.png')]);
// [ancho, alto, dpr] en pixeles fisicos, retrato
export const SIZES = [
  [640, 1136, 2], [750, 1334, 2], [1242, 2208, 3], [1125, 2436, 3], [828, 1792, 2], [1242, 2688, 3],
  [1080, 2340, 3], [1170, 2532, 3], [1284, 2778, 3], [1179, 2556, 3], [1290, 2796, 3], [1206, 2622, 3]
];
for (const [w, h] of SIZES) {
  const ic = Math.round(w * 0.36);
  ff(['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${TOP}:c1=${BOT}:x0=0:y0=0:x1=0:y1=${h}:nb_colors=2,format=rgb24`,
    '-i', ICON, '-filter_complex', `[1]format=rgba,colorkey=0x000000:0.08:0.05,scale=${ic}:${ic}:flags=lanczos[i];[0][i]overlay=(W-w)/2:(H-h)/2`,
    '-frames:v', '1', path.join(PUB, 'splash', `${w}x${h}.png`)]);
}
const tags = SIZES.map(([w, h, r]) =>
  `<link rel="apple-touch-startup-image" href="/splash/${w}x${h}.png" media="(device-width: ${w / r}px) and (device-height: ${h / r}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)">`).join('\n');
fs.writeFileSync(path.join(ROOT, 'scripts', '.splash-tags.html'), tags);
console.log('ok: icon-192, icon-512, ' + SIZES.length + ' splash; etiquetas en scripts/.splash-tags.html');
