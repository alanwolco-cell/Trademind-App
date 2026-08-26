// Informe de tendencias de draft sobre el historial unificado Yahoo + Sleeper.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require(join(homedir(), 'Development', 'trademind-app', 'server', 'lib', 'tendencias-draft.js'));

const DATA = join(homedir(), 'Development', 'trademind-app', 'scripts', 'data');
const { drafts } = JSON.parse(readFileSync(join(DATA, 'drafts-wolco.json'), 'utf8'));

// Decisiones de inclusion, explicitas:
//  - fuera los drafts incompletos o en curso: el reparto todavia no existe
//  - fuera los drafts de novatos de dynasty: ahi "ronda 1" significa otra cosa
const usables = drafts.filter(d => d.completo !== false && d.tipo !== 'rookie' && d.mi_equipo != null);
const excluidos = drafts.filter(d => !usables.includes(d));

console.log('=== MUESTRA ===');
console.log(`  ${usables.length} drafts usables de ${drafts.length}`);
for (const d of excluidos) console.log(`    fuera: ${d.season} ${d.liga} (${d.tipo}${d.completo === false ? ', incompleto' : ''}${d.mi_equipo == null ? ', sin dueño' : ''})`);

function armar(lista) {
  const picks = [];
  const miRosterPorDraft = {};
  for (const d of lista) {
    const liga = `${d.liga} ${d.season}`;          // unico por temporada
    miRosterPorDraft[`${liga}:${d.season}`] = d.mi_equipo;
    for (const p of d.picks) {
      picks.push({ liga, temporada: d.season, roster: p.equipo, ronda: p.ronda, pos: p.pos, rondasTotales: d.rondas });
    }
  }
  return { picks, miRosterPorDraft };
}

// El tipo de draft se traduce al mismo eje que usa el producto:
// un startup de dynasty es dynasty; todo lo demas cae en redraft.
const { picks, miRosterPorDraft, formatoPorLiga } = (() => {
  const picks = [], miRosterPorDraft = {}, formatoPorLiga = {};
  for (const d of usables) {
    const liga = `${d.liga} ${d.season}`;            // unico por temporada
    miRosterPorDraft[`${liga}:${d.season}`] = d.mi_equipo;
    formatoPorLiga[liga] = d.tipo === 'startup' ? 'dynasty' : 'redraft';
    for (const p of d.picks) {
      picks.push({ liga, temporada: d.season, roster: p.equipo, ronda: p.ronda, pos: p.pos, rondasTotales: d.rondas });
    }
  }
  return { picks, miRosterPorDraft, formatoPorLiga };
})();

const porEjes = T.analizarPorEjes(picks, miRosterPorDraft, { formatoPorLiga });

for (const eje of ['redraft', 'dynasty']) {
  const r = porEjes[eje];
  const n = usables.filter(d => (d.tipo === 'startup' ? 'dynasty' : 'redraft') === eje);
  if (!n.length) continue;
  console.log(`\n\n########## ${eje.toUpperCase()} — ${n.length} drafts, ${new Set(n.map(d => d.season)).size} temporadas ##########`);

  console.log('\n--- HALLAZGOS CONFIRMADOS (pasan la prueba contra tus rivales) ---');
  if (!r.confirmados.length) console.log('   ninguno pasa el umbral.');
  for (const c of r.confirmados) console.log(`   [p ${c.pEsPiso ? '<' + c.pPiso : '= ' + c.p}]  ${c.texto}`);

  console.log('\n--- SIN SEÑAL (drafteas como el resto de la sala) ---');
  for (const c of r.sinSenal) console.log(`   ${c.label.padEnd(24)} p=${c.p}  n=${c.n}`);

  if (r.insuficientes.length) {
    console.log('\n--- MUESTRA INSUFICIENTE ---');
    for (const c of r.insuficientes) console.log(`   ${c.label.padEnd(24)} n=${c.n}, faltan ${c.falta}`);
  }

  console.log('\n--- TU MEZCLA TEMPRANA POR AÑO (descriptivo, sin p-valor) ---');
  console.log('   año   drafts  picks    RB    WR    QB    TE');
  for (const m of r.mezcla) {
    console.log(`   ${m.anio}  ${String(m.drafts).padStart(4)}  ${String(m.picks).padStart(6)}` +
      ['RB', 'WR', 'QB', 'TE'].map(x => String(m.pct[x] + '%').padStart(6)).join('') +
      (m.solido ? '' : '   (muestra floja)'));
  }
}
