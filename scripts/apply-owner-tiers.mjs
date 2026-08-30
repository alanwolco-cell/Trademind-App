#!/usr/bin/env node
// Aplica UNA vez los tiers dictados por el dueno (scripts/fixtures/tiers-owner-*.json)
// a su documento de My Rankings en Vercel Blob: reordena dentro de cada posicion
// (estable: los RB ocupan las plazas de RB), escribe breaksPos, anade objetivos de QB
// y su lista Love sin pisar lo que haya. Requiere BLOB_READ_WRITE_TOKEN en el entorno.
//   node scripts/apply-owner-tiers.mjs scripts/fixtures/tiers-owner-2026-08-29.json [--dry]
import fs from 'node:fs';
import { list, put } from '@vercel/blob';
const [fix, ...rest] = process.argv.slice(2); const DRY = rest.includes('--dry');
const T = JSON.parse(fs.readFileSync(fix, 'utf8'));
const adp = (await (await fetch('https://macdraft.app/api/stats/adp')).json()).players;
const idOf = {}; const posOf = {};
Object.values(adp).forEach(p => { idOf[p.name.toLowerCase()] = String(p._id); posOf[String(p._id)] = p.pos; });
const RK = 'perfil/rankings-owner.json';
const { blobs } = await list({ prefix: RK, limit: 1 });
const doc = await (await fetch(blobs[0].url)).json();
const order = doc.order.map(String);
const breaksPos = {}; const missing = [];
for (const pos of ['QB', 'RB', 'WR', 'TE']) {
  const tiers = T[pos].map(t => t.map(n => { const id = idOf[n.toLowerCase()]; if (!id) missing.push(n); return id; }).filter(Boolean));
  const listed = tiers.flat(); const seen = new Set(listed);
  const slots = []; order.forEach((id, i) => { if (posOf[id] === pos) slots.push(i); });
  const current = slots.map(i => order[i]);
  const nuevo = listed.filter(id => current.includes(id)).concat(current.filter(id => !seen.has(id)));
  slots.forEach((i, k) => { order[i] = nuevo[k]; });
  breaksPos[pos] = tiers.slice(0, -1).map(t => t[t.length - 1]).filter(id => current.includes(id));
  console.log(pos, 'tiers', tiers.length, 'listados', listed.length, 'en lista', listed.filter(id => current.includes(id)).length, 'cortes', breaksPos[pos].length);
}
const targets = new Set((doc.targets || []).map(String)); const pref = Object.assign({}, doc.pref || {});
(T.QB_targets || []).forEach(n => { const id = idOf[n.toLowerCase()]; if (!id) return missing.push(n); targets.add(id); if (!pref[id]) pref[id] = 'love'; });
const out = { ...doc, order, breaksPos, targets: [...targets], pref, updatedAt: Date.now() };
console.log('sin resolver:', missing.join(', ') || 'ninguno', '| targets', out.targets.length, '| love', Object.values(pref).filter(v => v === 'love').length);
if (DRY) { console.log('dry: no se escribe'); process.exit(0); }
await put(RK, JSON.stringify(out), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0, contentType: 'application/json' });
// el CDN de Blob puede servir la copia vieja unos segundos: reintentar con cache-buster
for (let k = 0; k < 8; k++) {
  const b = (await list({ prefix: RK, limit: 1 })).blobs[0];
  const chk = await (await fetch(b.url + '?t=' + Date.now(), { cache: 'no-store' })).json();
  if (chk.breaksPos && chk.updatedAt === out.updatedAt) { console.log('verificado: breaksPos', Object.keys(chk.breaksPos).map(p => p + ':' + chk.breaksPos[p].length).join(' ')); process.exit(0); }
  await new Promise(r => setTimeout(r, 3000));
}
console.log('AVISO: no pude leer de vuelta el documento nuevo (CDN); comprobar a mano'); process.exit(1);
