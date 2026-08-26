// Une los drafts de Yahoo (scrapeados) con los de Sleeper (API publica, sin auth)
// y les pega la posicion de cada jugador desde el diccionario de Sleeper.
//
// Decisiones tomadas tras auditar la data (26-ago-2026):
//  - Los sufijos (Jr., Sr., III) rompian el emparejamiento por nombre. Se quitan.
//  - Un nombre puede chocar con un defensivo (CB, G). Se prefiere siempre la
//    posicion de fantasy (QB/RB/WR/TE/K/DEF) sobre cualquier otra.
//  - Los drafts de novatos de dynasty (pocas rondas) NO son comparables con un
//    draft normal: la ronda 1 significa otra cosa. Se etiquetan aparte.
//  - Los drafts a medias o en curso se marcan y quedan fuera del analisis.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA = join(homedir(), 'Development', 'trademind-app', 'scripts', 'data');
const S = 'https://api.sleeper.app/v1';
const MYID = '359098099047628800';
const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

const j = async u => { const r = await fetch(u); return r.ok ? r.json() : null; };
const SUFIJOS = /\b(jr|sr|ii|iii|iv|v)\b/g;
const norm = s => (s || '').toLowerCase().replace(/[.'`-]/g, ' ').replace(SUFIJOS, '').replace(/[^a-z]/g, '');

// ---- diccionario ----
console.log('[1] Diccionario de Sleeper...');
const players = await j(`${S}/players/nfl`);
const porId = {}, porNombre = {}, porApellido = {};
for (const [id, p] of Object.entries(players)) {
  if (!p.position) continue;
  const full = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
  porId[id] = { nombre: full, pos: p.position };
  const n = norm(full);
  if (!n) continue;
  const esFantasy = FANTASY.has(p.position);
  // preferir siempre un jugador de fantasy sobre un defensivo con el mismo nombre
  if (!porNombre[n] || (esFantasy && !FANTASY.has(porNombre[n]))) porNombre[n] = p.position;
  if (esFantasy) {
    const ap = norm(p.last_name || '');
    if (ap) (porApellido[ap] ||= new Set()).add(p.position);
  }
}
console.log(`    ${Object.keys(porId).length} jugadores`);

const sinResolver = new Set();
// Apodos que Yahoo usa y Sleeper no reconoce.
const ALIAS = { hollywoodbrown: 'marquisebrown' };
const EQUIPOS_NFL = new Set(['49ers','Bears','Bengals','Bills','Broncos','Browns','Buccaneers','Cardinals','Chargers','Chiefs','Colts','Commanders','Cowboys','Dolphins','Eagles','Falcons','Giants','Jaguars','Jets','Lions','Packers','Panthers','Patriots','Raiders','Rams','Ravens','Saints','Seahawks','Steelers','Texans','Titans','Vikings']);

function pos(nombre) {
  const t = (nombre || '').trim();
  // defensas de equipo primero: Yahoo las escribe como el apodo (incluye "49ers")
  if (EQUIPOS_NFL.has(t)) return 'DEF';
  let n = norm(nombre);
  if (ALIAS[n]) n = ALIAS[n];
  if (porNombre[n]) return porNombre[n];
  // ultimo recurso: apellido unico entre jugadores de fantasy
  const partes = t.split(/\s+/);
  if (partes.length >= 2) {
    const ap = norm(partes[partes.length - 1]) || norm(partes[partes.length - 2]);
    const s = porApellido[ap];
    if (s && s.size === 1) return [...s][0];
  }
  sinResolver.add(nombre);
  return null;
}

const drafts = [];

// ---- Yahoo ----
console.log('\n[2] Yahoo...');
// Yahoo es opcional: si no se ha corrido el extractor, se sigue solo con
// Sleeper en vez de tronar. La mitad del dato sigue siendo util.
let yh = { ligas: [] };
try {
  yh = JSON.parse(readFileSync(join(DATA, 'yahoo-history-wolco.json'), 'utf8'));
} catch {
  console.log('    (sin yahoo-history-wolco.json; corre npm run yahoo:extract para incluir Yahoo)');
}
for (const l of yh.ligas) {
  if (!l.draft) continue;
  const picks = l.draft.filter(p => p.jugador && !/^-+\s*empty\s*-+$/i.test(p.jugador));
  if (!picks.length) { console.log(`    ${l.season} ${l.nombre}: tablero vacío, descartada`); continue; }
  const equipos = [...new Set(picks.map(p => p.equipo))];
  const total = equipos.length;
  const mio = equipos.find(e => norm(l.equipo).startsWith(norm(e).slice(0, 8)) || norm(e).startsWith(norm(l.equipo).slice(0, 8)));
  const rondas = Math.max(...picks.map(p => p.ronda));
  drafts.push({
    fuente: 'yahoo', season: l.season, liga: l.nombre, equipos: total, rondas,
    mi_equipo: mio || null, tipo: 'redraft', completo: picks.length >= total * 5,
    picks: picks.map(p => ({
      ronda: p.ronda, pick: p.pick, global: (p.ronda - 1) * total + p.pick,
      jugador: p.jugador, pos: pos(p.jugador), equipo: p.equipo, mio: p.equipo === mio
    }))
  });
  const m = drafts.at(-1).picks.filter(p => p.mio).length;
  console.log(`    ${l.season} ${l.nombre}: ${picks.length} picks, ${total} equipos, ${m} míos${mio ? '' : '  (NO identifiqué mi equipo)'}`);
}

// ---- Sleeper ----
console.log('\n[3] Sleeper...');
for (let y = 2019; y <= 2026; y++) {
  for (const L of (await j(`${S}/user/${MYID}/leagues/nfl/${y}`)) || []) {
    const esDynasty = L.settings?.type === 2;
    for (const d of (await j(`${S}/league/${L.league_id}/drafts`)) || []) {
      const picks = (await j(`${S}/draft/${d.draft_id}/picks`)) || [];
      if (!picks.length) continue;
      const rosters = (await j(`${S}/league/${L.league_id}/rosters`)) || [];
      const miRoster = rosters.find(r => r.owner_id === MYID
        || (r.co_owners || []).includes(MYID));
      const miSlot = miRoster ? miRoster.roster_id : null;
      const total = L.total_rosters || d.settings?.teams || 0;
      const rondas = d.settings?.rounds || Math.max(...picks.map(p => p.round));
      // un draft de novatos de dynasty tiene pocas rondas y no es comparable
      const tipo = esDynasty && rondas <= 6 ? 'rookie' : (esDynasty ? 'startup' : 'redraft');
      drafts.push({
        fuente: 'sleeper', season: +y, liga: L.name, equipos: total, rondas,
        mi_equipo: miSlot, tipo, estado: d.status,
        completo: d.status === 'complete' && picks.length >= total * Math.min(rondas, 5),
        picks: picks.map(p => ({
          ronda: p.round, pick: p.draft_slot, global: p.pick_no,
          jugador: porId[p.player_id]?.nombre || p.player_id,
          pos: porId[p.player_id]?.pos || null,
          equipo: p.roster_id, mio: miSlot != null && p.roster_id === miSlot
        }))
      });
      const m = drafts.at(-1).picks.filter(p => p.mio).length;
      const D = drafts.at(-1);
      console.log(`    ${y} ${L.name.slice(0, 26).padEnd(28)} ${String(picks.length).padStart(3)} picks, ${String(m).padStart(2)} míos  [${tipo}${D.completo ? '' : ', incompleto'}]`);
    }
  }
}

const out = join(DATA, 'drafts-wolco.json');
writeFileSync(out, JSON.stringify({ generado: new Date().toISOString().slice(0, 10), drafts }, null, 1));
const mios = drafts.reduce((a, d) => a + d.picks.filter(p => p.mio).length, 0);
console.log(`\nGuardado: ${out}`);
console.log(`${drafts.length} drafts | ${drafts.reduce((a, d) => a + d.picks.length, 0)} picks | ${mios} tuyos`);
console.log(`sin resolver posición: ${sinResolver.size}${sinResolver.size ? ' -> ' + [...sinResolver].slice(0, 10).join(', ') : ''}\n`);
