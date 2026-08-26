// Extractor de historial de Yahoo Fantasy.
// Inventario: /f1/myleagues. Temporadas viejas: /<anio>/f1/<id>.
// Las tarjetas de "League Renewal" NO traen el league_id, asi que se emparejan por
// orden de aparicion y se VERIFICAN cargando la liga y comparando el titulo.
import { openContext, isLoggedIn } from './session.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SALIDA = join(homedir(), 'Development', 'trademind-app', 'scripts', 'data');
mkdirSync(SALIDA, { recursive: true });
const ANIO_ACTUAL = 2026;
const urlLiga = (anio, id) => anio === ANIO_ACTUAL
  ? `https://football.fantasysports.yahoo.com/f1/${id}`
  : `https://football.fantasysports.yahoo.com/${anio}/f1/${id}`;
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ctx = await openContext({ headless: process.env.HEADLESS !== '0' });
const page = ctx.pages()[0] || await ctx.newPage();

// La sesion de Yahoo caduca. Sin este chequeo el extractor recorre las siete
// ligas contra la portada publica y guarda un JSON vacio que parece exito.
if (!(await isLoggedIn(page))) {
  console.error('\nSesión de Yahoo caducada o ausente. Corre:  npm run yahoo:login\n');
  await ctx.close();
  process.exit(1);
}

// ---------- 1. Inventario ----------
console.log('\n[1] Inventario de ligas');
await page.goto('https://football.fantasysports.yahoo.com/f1/myleagues', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3000);
try { await page.click('text=/Expand all/i', { timeout: 5000 }); await page.waitForTimeout(2000); } catch {}

const crudo = await page.evaluate(() => {
  // a) temporada en curso: tabla "My Teams & Leagues"
  const actuales = [];
  for (const tr of document.querySelectorAll('tr')) {
    const c = [...tr.cells || []].map(x => x.innerText.trim());
    if (c.length < 3) continue;
    const a = tr.querySelector('a[href*="/f1/"]');
    const m = a && (a.getAttribute('href') || '').match(/\/f1\/(\d+)/);
    if (m && c[0] && !/league name/i.test(c[0])) {
      actuales.push({ league_id: m[1], nombre: c[0], equipo: c[1], rol: c[2] });
    }
  }
  // b) tarjetas de renovacion (sin id)
  const tarjetas = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length) continue;
    if (!/^Season:\s*\d{4}$/i.test((el.innerText || '').trim())) continue;
    let p = el;
    for (let i = 0; i < 9 && p; i++) {
      p = p.parentElement; if (!p) break;
      const li = (p.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      if (li.length >= 5 && li.length <= 14) {
        const iS = li.findIndex(x => /^Season:/i.test(x));
        tarjetas.push({
          nombre: li[iS - 2] || null,
          equipo: (li[iS - 1] || '').replace(/\s*\(Commissioner\)\s*$/i, '').replace(/\s+/g, ' ').trim(),
          comisionado: /\(Commissioner\)/i.test(li[iS - 1] || ''),
          season: +((li[iS] || '').match(/(\d{4})/) || [])[1],
          rank: (li.find(x => /^Rank:/i.test(x)) || '').replace(/^Rank:\s*/i, '') || null,
          record: li.find(x => /^\d+-\d+-\d+$/.test(x)) || null
        });
        break;
      }
    }
  }
  // c) todos los ids que aparecen en el HTML, en orden
  const ids = [...new Set([...document.body.innerHTML.matchAll(/\/f1\/(\d+)/g)].map(m => m[1]))];
  return { actuales, tarjetas, ids };
});

const idsActuales = new Set(crudo.actuales.map(l => l.league_id));
const idsViejos = crudo.ids.filter(id => !idsActuales.has(id));
const ligas = [
  ...crudo.actuales.map(l => ({ ...l, season: ANIO_ACTUAL, origen: 'actual' })),
  ...crudo.tarjetas.map((t, i) => ({ ...t, league_id: idsViejos[i] || null, origen: 'renewal' }))
].filter(l => l.league_id);

console.log(`    ${ligas.length} ligas`);
for (const l of ligas) console.log(`      ${l.season}  ${l.nombre}  (${l.league_id})  ${l.equipo || ''}`);

// ---------- 2. Verificar el emparejamiento ----------
console.log('\n[2] Verificando que cada id corresponda a su liga');
for (const l of ligas) {
  try {
    await page.goto(urlLiga(l.season, l.league_id), { waitUntil: 'domcontentloaded', timeout: 40000 });
    const t = (await page.title()).replace(/\s*\|.*$/, '').trim();
    l.titulo_real = t;
    l.verificado = norm(t) === norm(l.nombre);
    console.log(`      ${l.verificado ? 'ok  ' : 'MAL '} ${l.season} ${l.nombre}  ->  ${t}`);
  } catch (e) { l.verificado = false; console.log(`      MAL  ${l.nombre}: ${e.message.slice(0, 40)}`); }
}

// ---------- 3. Drafts ----------
console.log('\n[3] Drafts');
for (const l of ligas) {
  if (!l.verificado) { l.draft = null; l.nota = 'no verificada'; continue; }
  try {
    await page.goto(`${urlLiga(l.season, l.league_id)}/draftresults`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    const cuerpo = await page.evaluate(() => document.body.innerText);
    l.draft_nota = /draft.*(not|hasn.t|isn.t).*(happen|occur|start|schedul)/i.test(cuerpo)
      || /has not drafted|no draft results/i.test(cuerpo) ? 'sin draft' : null;
    const picks = await page.evaluate(() => {
      const out = [];
      for (const tabla of document.querySelectorAll('table')) {
        const mr = (tabla.rows[0]?.cells[0]?.innerText || '').trim().match(/Round\s*(\d+)/i);
        if (!mr) continue;
        for (let i = 1; i < tabla.rows.length; i++) {
          const c = [...tabla.rows[i].cells].map(x => x.innerText.trim());
          if (c.length < 3) continue;
          const pick = parseInt((c[0] || '').replace(/\D/g, ''), 10);
          if (!pick || !c[1]) continue;
          out.push({ ronda: +mr[1], pick, jugador: c[1], equipo: c[2] });
        }
      }
      return out;
    });
    l.draft = picks.length ? picks : null;
    // marcar los picks suyos
    if (l.draft && l.equipo) {
      const mio = norm(l.equipo);
      l.mis_picks = l.draft.filter(p => norm(p.equipo) && mio.startsWith(norm(p.equipo).slice(0, 10))).length;
    }
    console.log(`      ${l.season} ${l.nombre}: ${picks.length ? picks.length + ' picks, ' + Math.max(...picks.map(p => p.ronda)) + ' rondas' : (l.draft_nota || 'vacío')}`);
  } catch (e) { l.draft = null; l.nota = 'error'; console.log(`      ${l.nombre}: falló`); }
}

const archivo = join(SALIDA, 'yahoo-history-wolco.json');
writeFileSync(archivo, JSON.stringify({ extraido: new Date().toISOString().slice(0, 10), ligas }, null, 1));
const cd = ligas.filter(l => l.draft);
console.log(`\nGuardado: ${archivo}`);
console.log(`${cd.length} drafts, ${cd.reduce((a, l) => a + l.draft.length, 0)} picks.\n`);
await ctx.close();
