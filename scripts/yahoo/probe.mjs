// Sonda: con la sesion viva, averigua cual ruta de data sirve.
// No extrae nada todavia. Reporta la verdad para no escribir el extractor a ciegas.
import { openContext, isLoggedIn, leerLigas } from './session.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DUMP = join(homedir(), 'Development', 'trademind-app', 'scripts', 'data', 'yahoo-probe');
mkdirSync(DUMP, { recursive: true });

const ctx = await openContext({ headless: process.env.HEADLESS !== '0' });
const page = ctx.pages()[0] || await ctx.newPage();
const hallazgos = { paginas: {}, api: {} };

console.log('\n--- SONDA YAHOO FANTASY ---\n');

if (!(await isLoggedIn(page))) {
  console.log('Sin sesión. Corre primero:  npm run yahoo:login\n');
  await ctx.close();
  process.exit(1);
}
console.log('[ok] sesión viva\n');

// 1. La API oficial, a ver si acepta cookies en vez de OAuth
console.log('[1] fantasysports.yahooapis.com con cookies de sesión');
const API = 'https://fantasysports.yahooapis.com/fantasy/v2';
for (const [nombre, url] of [
  ['todas las temporadas', `${API}/users;use_login=1/games;game_codes=nfl/leagues?format=json`],
  ['solo juegos', `${API}/users;use_login=1/games?format=json`]
]) {
  try {
    const r = await page.request.get(url, { failOnStatusCode: false });
    const cuerpo = await r.text();
    const ok = r.status() === 200 && cuerpo.trim().startsWith('{');
    console.log(`    ${nombre}: HTTP ${r.status()}${ok ? '  JSON OK' : ''}`);
    hallazgos.api[nombre] = { status: r.status(), ok };
    if (ok) {
      writeFileSync(join(DUMP, 'api-oficial.json'), cuerpo);
      console.log('      -> guardado api-oficial.json');
    } else {
      console.log(`      -> ${cuerpo.slice(0, 130).replace(/\s+/g, ' ')}`);
    }
  } catch (e) { console.log(`    ${nombre}: falló (${e.message.slice(0, 70)})`); }
}

// 2. Que expone la web de Fantasy por dentro
console.log('\n[2] estructura de la web de Yahoo Fantasy');
const paginas = {
  home: 'https://football.fantasysports.yahoo.com/',
  perfil: 'https://football.fantasysports.yahoo.com/f1/profile'
};
for (const [nombre, url] of Object.entries(paginas)) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    await page.waitForTimeout(2500);
    const html = await page.content();
    writeFileSync(join(DUMP, `${nombre}.html`), html);
    const ligas = leerLigas(html);
    const incrustado = /root\.App\.main\s*=|window\.__PRELOADED|"leagues"\s*:/.test(html);
    // Yahoo marca la temporada en los links de liga viejos
    const anios = [...new Set([...html.matchAll(/\b(20[0-2]\d)\b/g)].map(m => m[1]))]
      .filter(a => +a >= 2005 && +a <= 2026).sort();
    console.log(`    ${nombre}: ${html.length} bytes | JSON incrustado: ${incrustado ? 'sí' : 'no'} | ligas: ${ligas.length}`);
    if (ligas.length) console.log(`      ids: ${ligas.slice(0, 15).join(', ')}`);
    if (anios.length) console.log(`      años vistos en la página: ${anios.join(', ')}`);
    hallazgos.paginas[nombre] = { bytes: html.length, incrustado, ligas, anios };
  } catch (e) { console.log(`    ${nombre}: falló (${e.message.slice(0, 70)})`); }
}

writeFileSync(join(DUMP, 'hallazgos.json'), JSON.stringify(hallazgos, null, 1));
console.log(`\nHTML crudo y hallazgos en:\n  ${DUMP}\n`);
console.log('Pásame esta salida y escribo el extractor contra la ruta que sí sirve.\n');

await ctx.close();
