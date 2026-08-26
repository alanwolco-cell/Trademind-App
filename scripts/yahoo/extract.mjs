// Extractor de historial de Yahoo Fantasy.
// Inventario desde /f1/myleagues, temporadas viejas en /<anio>/f1/<id>.
// Prioridad: resultados de draft, que es lo que Wolco quiere analizar.
import { openContext } from './session.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SALIDA = join(homedir(), 'Development', 'trademind-app', 'scripts', 'data');
mkdirSync(SALIDA, { recursive: true });

const ANIO_ACTUAL = 2026;
const urlLiga = (anio, id) =>
  anio === ANIO_ACTUAL
    ? `https://football.fantasysports.yahoo.com/f1/${id}`
    : `https://football.fantasysports.yahoo.com/${anio}/f1/${id}`;

const ctx = await openContext({ headless: process.env.HEADLESS !== '0' });
const page = ctx.pages()[0] || await ctx.newPage();

// ---------- 1. Inventario ----------
console.log('\n[1] Leyendo inventario de ligas...');
await page.goto('https://football.fantasysports.yahoo.com/f1/myleagues', {
  waitUntil: 'domcontentloaded', timeout: 45000
});
await page.waitForTimeout(3000);
try { await page.click('text=/Expand all/i', { timeout: 5000 }); await page.waitForTimeout(2000); } catch {}

const inventario = await page.evaluate((anioActual) => {
  const ligas = [];
  // Ligas de la temporada en curso: tabla "My Teams & Leagues"
  for (const a of document.querySelectorAll('a[href*="/f1/"]')) {
    const m = (a.getAttribute('href') || '').match(/\/f1\/(\d+)(?:$|[/?#])/);
    const nombre = (a.innerText || '').trim();
    if (m && nombre && nombre.length > 1 && !/^\d+$/.test(nombre)) {
      if (!ligas.some(l => l.league_id === m[1])) {
        ligas.push({ league_id: m[1], nombre, season: anioActual, origen: 'actual' });
      }
    }
  }
  // Ligas viejas: bloques de "League Renewal" con "Season: YYYY"
  const texto = document.body.innerText;
  const bloque = texto.split(/League Renewal/i)[1] || '';
  const lineas = bloque.split('\n').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < lineas.length; i++) {
    const ms = lineas[i].match(/^Season:\s*(\d{4})$/i);
    if (!ms) continue;
    const season = +ms[1];
    const nombre = lineas[i - 2] || '';
    const equipo = (lineas[i - 1] || '').replace(/\s*\(Commissioner\)\s*$/i, '').trim();
    const esComish = /\(Commissioner\)/i.test(lineas[i - 1] || '');
    let rank = null, record = null;
    for (let j = i + 1; j < Math.min(i + 6, lineas.length); j++) {
      const mr = lineas[j].match(/^Rank:\s*(\d+)/i); if (mr) rank = +mr[1];
      const mw = lineas[j].match(/^(\d+)-(\d+)-(\d+)$/); if (mw) record = lineas[j];
    }
    ligas.push({ league_id: null, nombre, season, equipo, comisionado: esComish, rank, record, origen: 'renewal' });
  }
  return ligas;
}, ANIO_ACTUAL);

// Los ids de las viejas salen de los hrefs; emparejar por orden de aparicion
const idsEnPagina = await page.evaluate(() =>
  [...new Set([...document.body.innerHTML.matchAll(/\/f1\/(\d+)/g)].map(m => m[1]))]
);
const idsActuales = new Set(inventario.filter(l => l.origen === 'actual').map(l => l.league_id));
const idsViejas = idsEnPagina.filter(id => !idsActuales.has(id));
let k = 0;
for (const l of inventario) if (l.origen === 'renewal' && !l.league_id) l.league_id = idsViejas[k++] || null;

const ligas = inventario.filter(l => l.league_id);
console.log(`    ${ligas.length} ligas encontradas:`);
for (const l of ligas) console.log(`      ${l.season}  ${l.nombre}  (id ${l.league_id})${l.equipo ? '  equipo: ' + l.equipo : ''}`);

// ---------- 2. Drafts ----------
console.log('\n[2] Extrayendo drafts...');
const resultados = [];
for (const l of ligas) {
  const url = `${urlLiga(l.season, l.league_id)}/draftresults`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const titulo = await page.title();
    if (/There was a problem|not found/i.test(titulo)) {
      console.log(`    ${l.season} ${l.nombre}: no accesible`);
      resultados.push({ ...l, draft: null, nota: 'liga no accesible' });
      continue;
    }
    const picks = await page.evaluate(() => {
      const out = [];
      for (const tabla of document.querySelectorAll('table')) {
        const cab = (tabla.rows[0]?.cells[0]?.innerText || '').trim();
        const mr = cab.match(/Round\s*(\d+)/i);
        if (!mr) continue;
        const ronda = +mr[1];
        for (let i = 1; i < tabla.rows.length; i++) {
          const c = [...tabla.rows[i].cells].map(x => x.innerText.trim());
          if (c.length < 3) continue;
          const pick = parseInt((c[0] || '').replace(/\D/g, ''), 10);
          if (!pick || !c[1]) continue;
          out.push({ ronda, pick, jugador: c[1], equipo: c[2] });
        }
      }
      return out;
    });
    if (picks.length) {
      console.log(`    ${l.season} ${l.nombre}: ${picks.length} picks, ${Math.max(...picks.map(p => p.ronda))} rondas`);
      resultados.push({ ...l, draft: picks });
    } else {
      console.log(`    ${l.season} ${l.nombre}: sin draft todavía`);
      resultados.push({ ...l, draft: null, nota: 'sin draft' });
    }
  } catch (e) {
    console.log(`    ${l.season} ${l.nombre}: falló (${e.message.slice(0, 50)})`);
    resultados.push({ ...l, draft: null, nota: 'error' });
  }
}

const archivo = join(SALIDA, 'yahoo-history-wolco.json');
writeFileSync(archivo, JSON.stringify({ extraido: '2026-08-26', usuario: 'awolcovinsky', ligas: resultados }, null, 1));
const conDraft = resultados.filter(r => r.draft);
console.log(`\nGuardado: ${archivo}`);
console.log(`${conDraft.length} drafts con data, ${conDraft.reduce((a, r) => a + r.draft.length, 0)} picks totales.\n`);

await ctx.close();
