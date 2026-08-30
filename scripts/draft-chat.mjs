#!/usr/bin/env node
// Draft Day por chat: el dueno cuenta las ventas en el chat y Claude las registra aqui.
// Guarda las ventas en un JSON y las REPRODUCE todas contra la sala real de macdraft.app
// (Draft Day, FZ26) en cada llamada, e imprime: sala, techo del jugador en el bloque,
// rivales que pueden pasarte y el tier del dueno (fixture de tiers dictados).
//   node scripts/draft-chat.mjs sold "gibbs" 86 3        # venta: nombre precio asiento (9 = el dueno)
//   node scripts/draft-chat.mjs block "jeanty"           # que dice la sala de un jugador
//   node scripts/draft-chat.mjs undo                     # borra la ultima venta
//   node scripts/draft-chat.mjs state                    # solo la sala
// Estado en /Users/wolco/Development/trademind-app/scripts/data/draft-live-2026-08-30.json
import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const F = path.join(ROOT, 'scripts', 'data', 'draft-live-2026-08-30.json');
const TIERS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'tiers-owner-2026-08-29.json'), 'utf8'));
const BASE = process.env.QA_BASE || 'https://macdraft.app';
const [cmd, ...a] = process.argv.slice(2);
const st = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : { sales: [] };
if (cmd === 'sold') st.sales.push({ n: a[0], p: +a[1], s: +a[2] });
if (cmd === 'undo') st.sales.pop();
fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(st, null, 1));
const tierOf = (name) => { for (const pos of ['QB', 'RB', 'WR', 'TE']) for (let i = 0; i < TIERS[pos].length; i++) if (TIERS[pos][i].some(n => n.toLowerCase() === name.toLowerCase())) return { pos, t: i + 1, mates: TIERS[pos][i].filter(n => n.toLowerCase() !== name.toLowerCase()) }; return null; };
const pw = await import('/Users/wolco/Development/ernestocalvo/node_modules/playwright/index.mjs');
const b = await pw.chromium.launch(); const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
await pg.goto(BASE + '/#draftday'); await pg.waitForFunction(() => window.AU && AU.active && document.getElementById('lv-in'), null, { timeout: 30000 });
const bad = await pg.evaluate((sales) => sales.map(x => { const r = lvSold(x.n, x.p, x.s); return r && r.err ? x.n + ': ' + r.err : null; }).filter(Boolean), st.sales);
if (bad.length) console.log('VENTAS RECHAZADAS:', bad.join(' | '));
const room = await pg.evaluate(() => { const r = lvRead(); const seats = Object.keys(AU.budgets).map(s => `${s}${+s === MD.mySlot ? '*' : ''}:$${AU.budgets[s]}/${AU.slotsLeft[s]}`).join(' '); return { n: AU.sold.length, inf: +r.inflacion.toFixed(3), fase: lvFase(r).t, seats }; });
console.log(`SALA: ${room.n} vendidos, inflacion ${room.inf}. ${room.fase}\nASIENTOS (presupuesto/huecos, * = tu): ${room.seats}`);
const sold = new Set(st.sales.map(x => x.n.toLowerCase()));
const who = cmd === 'block' ? a[0] : null;
if (who) {
  const t = await pg.evaluate((n) => { const r = lvBlock(n); const box = document.getElementById('lv-panel') || document.querySelector('.lv-panel'); const g = s => (box.querySelector(s)?.innerText || '').replace(/\s+/g, ' '); return { lot: g('.lv-lot').slice(0, 300), brk: g('.lv-break'), adv: g('.lv-adv'), name: AU.lot && AU.lot.p && AU.lot.p.name }; }, who);
  console.log(`\nBLOQUE: ${t.lot}\nDESGLOSE: ${t.brk}${t.adv ? '\nCONSEJO: ' + t.adv : ''}`);
  const tr = t.name && tierOf(t.name);
  if (tr) console.log(`TU TIER: ${tr.pos} T${tr.t}. Quedan en ese tier: ${tr.mates.filter(m => !sold.has(m.toLowerCase().split(' ').pop()) && !sold.has(m.toLowerCase())).join(', ') || 'ninguno'}`);
  else if (t.name) console.log('TU TIER: no esta en tus tiers dictados');
}
await b.close();
