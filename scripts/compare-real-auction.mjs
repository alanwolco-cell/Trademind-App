#!/usr/bin/env node
// Compara una subasta REAL (fixture) contra lo que el motor produce para la
// misma configuracion: sticker (AU.val) y precio de venta simulado, jugador
// por jugador y por franja. Reusa el arnes de calibrate-room.mjs tal cual.
//   node scripts/compare-real-auction.mjs scripts/fixtures/auction-nfl-divas-2026-08-27.json [--rooms 40]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const fixPath = argv.find(a => a.endsWith('.json'));
const ROOMS = parseInt(argv[argv.indexOf('--rooms') + 1], 10) || 40;
const RNDS = parseInt(argv[argv.indexOf('--rounds') + 1], 10) || 15;
const CURVE = parseFloat(argv[argv.indexOf('--curve') + 1]) || 0;
const QUIET = argv.includes('--quiet');
const FIX = JSON.parse(fs.readFileSync(fixPath, 'utf8'));
const cal = fs.readFileSync(path.join(ROOT, 'scripts', 'calibrate-room.mjs'), 'utf8');
const prefix = cal.slice(0, cal.indexOf('// ── invariants')).replace(/^'use strict';\n/m, '').replace('process.argv.slice(2)', '[]');
const tmp = path.join(ROOT, 'scripts', '.cmp-harness.tmp.mjs');
fs.writeFileSync(tmp, prefix + '\nexport { sandbox, runRoom };\n');
const { sandbox, runRoom } = await import(tmp);
fs.unlinkSync(tmp);

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const key = (n, pos) => { const w = norm(n).split(' '); return pos + ':' + (w.length > 1 ? w[0][0] + ':' : '') + w.slice(1).join(' ') || (pos + ':' + w[0]); };
const obs = []; // {n,pos,price,team}
for (const [team, rows] of Object.entries(FIX.rosters)) rows.forEach(([n, pos, price]) => obs.push({ n, pos, price, team }));

sandbox.localStorage.setItem('tm_md_fantazy26', '1');
if (CURVE) sandbox.AU_VAL_CURVE = CURVE;
const sales = {}, stickers = {}; let poolIdx = null;
for (let i = 0; i < ROOMS; i++) {
  const r = await runRoom({ teams: FIX.teams, rounds: RNDS, scoring: 0.5, sf: false, auction: true, budget: FIX.budget, slot: 9 });
  poolIdx = poolIdx || {};
  r.sold.forEach(s => { poolIdx[key(s.p.name, s.p.pos)] = s.p.name; });
  r.sold.forEach(s => { const k = key(s.p.name, s.p.pos); (sales[k] = sales[k] || []).push(s.price); stickers[k] = s.value; });
}
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const rows = [], miss = [];
obs.forEach(o => {
  const k = o.pos === 'DEF' ? null : key(o.n, o.pos);
  const s = k && sales[k];
  if (!s) { miss.push(o.n + ' ' + o.pos); return; }
  rows.push({ ...o, name: poolIdx[k], sticker: stickers[k], sim: med(s), n: s.length });
});
rows.sort((a, b) => b.price - a.price);
console.log(`\n${FIX.source}\nsalas simuladas: ${ROOMS} (FZ26, half PPR, ${RNDS} rondas, VAL_CURVE ${CURVE || 'default'})\n`);
if (!QUIET) console.log('real  sticker  sim   jugador');
if (!QUIET) rows.forEach(r => console.log(`$${String(r.price).padStart(3)}  $${String(r.sticker).padStart(3)}    $${String(r.sim).padStart(3)}   ${r.name} ${r.pos} (${r.team})`));
console.log('\nsin resolver en el pool del motor:', miss.join(', ') || 'ninguno');
const band = (lo, hi, label) => {
  const b = rows.filter(r => r.price >= lo && r.price <= hi);
  const sr = b.reduce((a, r) => a + r.price, 0), ss = b.reduce((a, r) => a + r.sticker, 0), sm = b.reduce((a, r) => a + r.sim, 0);
  console.log(`${label.padEnd(14)} n=${String(b.length).padStart(3)}  real $${sr}  sticker $${ss} (${(100 * ss / sr - 100).toFixed(0)}%)  sim $${sm} (${(100 * sm / sr - 100).toFixed(0)}%)`);
};
console.log('\n=== por franja de precio real (suma de dolares, desvio del motor) ===');
band(50, 999, '$50+'); band(30, 49, '$30-49'); band(15, 29, '$15-29'); band(5, 14, '$5-14'); band(2, 4, '$2-4'); band(1, 1, '$1');
console.log('\n=== por posicion ===');
['QB', 'RB', 'WR', 'TE'].forEach(p => {
  const b = rows.filter(r => r.pos === p);
  const sr = b.reduce((a, r) => a + r.price, 0), ss = b.reduce((a, r) => a + r.sticker, 0), sm = b.reduce((a, r) => a + r.sim, 0);
  console.log(`${p}  n=${b.length}  real $${sr}  sticker $${ss} (${(100 * ss / sr - 100).toFixed(0)}%)  sim $${sm} (${(100 * sm / sr - 100).toFixed(0)}%)`);
});
const top = rows.slice(0, 10);
console.log(`\ntop-10 real: $${top.reduce((a, r) => a + r.price, 0)} = ${(top.reduce((a, r) => a + r.price, 0) / (FIX.teams * FIX.budget) * 100).toFixed(1)}% del dinero; #1 = ${(rows[0].price / FIX.budget * 100).toFixed(1)}% del presupuesto`);
console.log(`$1 reales: ${obs.filter(o => o.price === 1).length} de ${obs.length} lotes`);
