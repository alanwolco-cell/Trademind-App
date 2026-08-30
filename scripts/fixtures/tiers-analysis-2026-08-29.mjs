import fs from 'node:fs';
const S = process.argv[2];
const doc = JSON.parse(fs.readFileSync(S + '/rk-doc.json', 'utf8'));
const adp = JSON.parse(fs.readFileSync(S + '/adp.json', 'utf8')).players;
const byId = {}; Object.values(adp).forEach(p => { byId[String(p._id)] = p; });
const ans = Object.values(doc.game);
const M = { 0: 0, 1: 1, '-1': -1, 2: 3, '-2': -3 };
const order = doc.order.map(String);
const posOf = id => (byId[id] || {}).pos || '?';
const name = id => (byId[id] || {}).name || id;
const out = {};
for (const pos of ['RB', 'WR', 'TE', 'QB']) {
  const ids = order.filter(id => posOf(id) === pos).slice(0, 40);
  const idx = {}; ids.forEach((id, i) => idx[id] = i);
  const A = ans.filter(a => idx[String(a.a)] != null && idx[String(a.b)] != null).map(a => ({ i: idx[String(a.a)], j: idx[String(a.b)], m: M[a.v] }));
  // score: minimizar sum (s_i - s_j - m)^2 + eps*(s_i - prior_i)^2, Gauss-Seidel
  const n = ids.length, s = ids.map((_, i) => (n - i) * 0.3), eps = 0.02;
  for (let it = 0; it < 400; it++) for (let i = 0; i < n; i++) {
    let num = eps * (n - i) * 0.3, den = eps;
    for (const a of A) { if (a.i === i) { num += s[a.j] + a.m; den++; } else if (a.j === i) { num += s[a.i] - a.m; den++; } }
    s[i] = num / den;
  }
  const rel = {}; A.forEach(a => { rel[a.i + '>' + a.j] = a.m; rel[a.j + '>' + a.i] = -a.m; });
  const ord = ids.map((_, i) => i).sort((x, y) => (s[y] - s[x]) || (x - y));
  const tiers = [[]]; let contra = 0;
  for (let k = 0; k < ord.length; k++) {
    const x = ord[k]; tiers[tiers.length - 1].push(x);
    if (k + 1 >= ord.length) break;
    const y = ord[k + 1], d = rel[x + '>' + y], gap = s[x] - s[y];
    const cut = d === 0 ? false : (d != null && Math.abs(d) === 3) || gap >= 2;
    if (cut) tiers.push([]);
  }
  A.forEach(a => { if ((s[a.i] - s[a.j]) * a.m < 0 && a.m !== 0) contra++; });
  out[pos] = { answers: A.length, contra, tiers: tiers.map(t => t.map(i => ({ n: name(ids[i]), s: +s[i].toFixed(1), ans: A.filter(a => a.i === i || a.j === i).length }))) };
}
fs.writeFileSync(S + '/tiers-out.json', JSON.stringify(out, null, 1));
for (const pos of Object.keys(out)) {
  console.log(`\n== ${pos}: ${out[pos].answers} respuestas, ${out[pos].contra} contradicciones`);
  out[pos].tiers.slice(0, 7).forEach((t, i) => console.log(`T${i + 1}: ` + t.map(p => `${p.n} (${p.s}${p.ans === 0 ? ', sin respuestas' : ''})`).join(' | ')));
}
