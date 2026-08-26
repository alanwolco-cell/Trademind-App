// Login manual, una sola vez, en el perfil dedicado.
//
// IMPORTANTE: NO navegar la pestaña que Wolco esta usando.
// La version anterior hacia page.goto() cada 5s para chequear sesion y lo sacaba
// del formulario de login sin parar. Ahora se detecta leyendo cookies, que no toca
// su ventana. Bug encontrado y corregido el 26-ago-2026.
import { openContext, leerLigas, PROFILE_DIR } from './session.mjs';

// Cookies de sesion autenticada de Yahoo. Las anonimas (A1, A3) NO cuentan.
const COOKIES_SESION = ['T', 'Y', 'SSID'];

const ctx = await openContext({ headless: false });
const page = ctx.pages()[0] || await ctx.newPage();

console.log(`\nPerfil dedicado: ${PROFILE_DIR}`);
console.log('Aislado de tu Chrome personal. Tus otras sesiones no se tocan.\n');

await page.goto('https://login.yahoo.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('Loguéate en la ventana que se abrió, con calma.');
console.log('No te voy a mover la página: reviso por cookies, no navegando.\n');

const LIMITE = 15 * 60 * 1000;
const arranque = Date.now();
let listo = false;

while (Date.now() - arranque < LIMITE) {
  await new Promise(r => setTimeout(r, 3000));
  const cookies = await ctx.cookies();
  const vistas = new Set(
    cookies.filter(c => c.domain.includes('yahoo.com')).map(c => c.name)
  );
  if (COOKIES_SESION.some(n => vistas.has(n))) { listo = true; break; }

  const seg = Math.round((Date.now() - arranque) / 1000);
  if (seg % 30 < 3) process.stdout.write(`  esperando... ${seg}s\r`);
}

if (!listo) {
  console.log('\nNo detecté login en 15 minutos. Corre el comando otra vez.\n');
  await ctx.close();
  process.exit(1);
}

console.log('\nSesión de Yahoo detectada. Verificando acceso a Fantasy...\n');

// Verificacion en pestaña APARTE, para no tocar la suya.
const verificador = await ctx.newPage();
try {
  await verificador.goto('https://football.fantasysports.yahoo.com/', {
    waitUntil: 'domcontentloaded', timeout: 45000
  });
  await verificador.waitForTimeout(3000);
  const html = await verificador.content();
  const ligas = leerLigas(html);
  if (ligas.length) {
    console.log(`Fantasy responde: ${ligas.length} liga(s) visibles en la portada.`);
    console.log(`  ids: ${ligas.slice(0, 15).join(', ')}`);
  } else {
    console.log('Sesión guardada, pero la portada no mostró ligas.');
    console.log('Puede ser normal (fuera de temporada). El probe lo confirma.');
  }
} catch (e) {
  console.log(`No pude verificar Fantasy: ${e.message.slice(0, 80)}`);
}

console.log('\nSesión guardada. Ya no vuelve a pedir login.');
console.log('Siguiente:  npm run yahoo:probe\n');

await ctx.close();
