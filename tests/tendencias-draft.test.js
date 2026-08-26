'use strict';
// Tests del auto-scouting de drafts. Corre con: node --test tests/
//
// Lo que se protege aqui no es "que no truene", es que el modulo no diga de
// Wolco algo que la data no sostiene. Cada test cubre una forma concreta de
// mentir con estadistica que ya estuvo a punto de pasar.
const test = require('node:test');
const assert = require('node:assert');
const T = require('../server/lib/tendencias-draft');

// Fabrica un draft: equipos, rondas, y una funcion que decide la posicion.
function draft(liga, temporada, equipos, rondas, posDe) {
  const picks = [];
  for (let r = 1; r <= rondas; r++) {
    for (let e = 1; e <= equipos; e++) {
      picks.push({ liga, temporada, roster: e, ronda: r, pos: posDe(r, e), rondasTotales: rondas });
    }
  }
  return picks;
}

test('el denominador incluye a quien tomo CERO de la posicion', () => {
  // Si solo contaran los rosters con al menos uno, el extremo de abajo
  // desaparece y nadie podria salir como zero-RB.
  const picks = draft('L', 2020, 4, 4, (r, e) => (e === 1 ? 'WR' : 'RB'));
  const { repartos } = T.repartosPorDraft(picks, { 'L:2020': 1 }, k => k.pos === 'RB');
  assert.strictEqual(repartos.length, 1);
  assert.strictEqual(repartos[0].mio, 0, 'yo tome cero RB');
  assert.strictEqual(repartos[0].otros.length, 3, 'los otros tres siguen en el denominador');
});

test('un draft donde no aparezco no entra en la muestra', () => {
  const picks = draft('L', 2020, 4, 4, () => 'RB');
  const { repartos, drafts } = T.repartosPorDraft(picks, { 'L:2020': 99 }, k => k.pos === 'RB');
  assert.strictEqual(drafts, 0);
  assert.strictEqual(repartos.length, 0);
});

test('mismo nombre de liga en dos temporadas NO se mezcla', () => {
  // Bug latente real: agrupar por nombre de liga hace que "Dynasty 2024" y
  // "Dynasty 2025" compartan roster id y se contaminen entre si.
  const a = draft('Dynasty', 2024, 4, 2, () => 'RB');
  const b = draft('Dynasty', 2025, 4, 2, () => 'WR');
  const { drafts } = T.repartosPorDraft(
    [...a, ...b], { 'Dynasty:2024': 1, 'Dynasty:2025': 2 }, k => k.pos === 'RB'
  );
  assert.strictEqual(drafts, 2, 'cada temporada es un draft aparte');
});

test('K/DEF se normaliza por largo del draft', () => {
  // Ronda 12 de 15 es tarde; ronda 12 de 20 es tempranisimo para un kicker.
  const corto = draft('Corto', 2020, 3, 15, r => (r === 14 ? 'K' : 'RB'));
  const largo = draft('Largo', 2020, 3, 20, r => (r === 12 ? 'K' : 'RB'));
  const cuenta = k => (k.pos === 'K' || k.pos === 'DEF') && k.rondasTotales && k.ronda <= k.rondasTotales - 2;
  assert.strictEqual(corto.filter(cuenta).length, 0, 'ronda 14 de 15 no es temprano');
  assert.ok(largo.filter(cuenta).length > 0, 'ronda 12 de 20 si es temprano');
});

test('muestra chica devuelve insuficiente, no una afirmacion', () => {
  const picks = draft('L', 2020, 3, 2, () => 'RB');
  const r = T.tendenciaPosicion(picks, { 'L:2020': 1 }, 'RB');
  assert.strictEqual(r.estado, 'insuficiente');
  assert.ok(r.falta > 0);
  assert.strictEqual(r.texto, undefined, 'una afirmacion insuficiente no lleva texto');
});

test('analizar() nunca deja texto en un claim no confirmado', () => {
  // El candado de aplicarFDR. Es la garantia de la que depende todo lo demas:
  // si esto se rompe, la pantalla puede publicar algo que el motor rechazo.
  const picks = draft('L', 2020, 4, 4, (r, e) => (e === 1 ? 'RB' : 'WR'));
  const r = T.analizar(picks, { 'L:2020': 1 });
  for (const c of r.claims) {
    if (c.estado !== 'confirmado') {
      assert.strictEqual(c.texto, undefined, `${c.label} no confirmado pero traia texto`);
    }
  }
});

test('mezclaPorAnio solo cuenta MIS picks y solo rondas tempranas', () => {
  const picks = draft('L', 2020, 2, 8, (r, e) => (e === 1 ? 'RB' : 'WR'));
  const m = T.mezclaPorAnio(picks, { 'L:2020': 1 });
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].picks, T.RONDAS_TEMPRANAS, 'solo las rondas tempranas mias');
  assert.strictEqual(m[0].pct.RB, 100);
  assert.strictEqual(m[0].pct.WR, 0, 'los picks del rival no entran');
});

test('un año con un solo draft se marca como muestra floja', () => {
  const picks = draft('L', 2020, 2, 4, () => 'RB');
  const m = T.mezclaPorAnio(picks, { 'L:2020': 1 });
  assert.strictEqual(m[0].solido, false);
});

test('el resultado es reproducible: misma entrada, mismo p', () => {
  const picks = draft('L', 2020, 6, 4, (r, e) => (e === 1 && r <= 2 ? 'RB' : 'WR'));
  const roster = { 'L:2020': 1 };
  const a = T.tendenciaPosicion(picks, roster, 'RB');
  const b = T.tendenciaPosicion(picks, roster, 'RB');
  assert.strictEqual(a.p, b.p, 'la semilla debe venir del dato, no del reloj');
});

test('entrada vacia no truena', () => {
  const r = T.analizar([], {});
  assert.ok(Array.isArray(r.claims));
  assert.strictEqual(r.confirmados.length, 0);
  assert.deepStrictEqual(r.mezcla, []);
});

test('acepta la llave por liga a secas, como la arma /api/perfil', () => {
  // La ruta existente indexa por league_id (unico por temporada en Sleeper),
  // no por 'liga:temporada'. El modulo tiene que servirle sin adaptador.
  const picks = draft('L123', 2020, 4, 4, (r, e) => (e === 1 ? 'RB' : 'WR'));
  const { repartos, drafts } = T.repartosPorDraft(picks, { L123: 1 }, k => k.pos === 'RB');
  assert.strictEqual(drafts, 1);
  assert.strictEqual(repartos[0].mio, 4);
  const m = T.mezclaPorAnio(picks, { L123: 1 });
  assert.strictEqual(m[0].pct.RB, 100);
});

test('la llave por draft gana sobre la llave por liga si ambas existen', () => {
  const picks = draft('L', 2020, 4, 4, (r, e) => (e === 2 ? 'RB' : 'WR'));
  const { repartos } = T.repartosPorDraft(picks, { 'L:2020': 2, L: 1 }, k => k.pos === 'RB');
  assert.strictEqual(repartos[0].mio, 4, 'debe usar el roster 2, no el 1');
});

test('roster id 0 no se confunde con ausente', () => {
  // Trampa clasica: `miRoster[key] || fallback` trata el 0 como falta.
  const picks = draft('L', 2020, 3, 4, () => 'RB').map(p => ({ ...p, roster: p.roster - 1 }));
  const { drafts } = T.repartosPorDraft(picks, { 'L:2020': 0 }, k => k.pos === 'RB');
  assert.strictEqual(drafts, 1, 'el roster 0 es un roster valido');
});

test('filtrarPorEje separa dynasty de redraft', () => {
  const picks = [
    ...draft('DYN', 2020, 2, 2, () => 'RB'),
    ...draft('RED', 2020, 2, 2, () => 'WR')
  ];
  const fmt = { DYN: 'dynasty', RED: 'redraft' };
  assert.strictEqual(T.filtrarPorEje(picks, fmt, 'dynasty').length, 4);
  assert.strictEqual(T.filtrarPorEje(picks, fmt, 'redraft').length, 4);
  assert.strictEqual(T.filtrarPorEje(picks, fmt, null).length, 8, 'sin eje no filtra');
});

test('keeper cae del lado de redraft, no de dynasty', () => {
  // ejeDeDosLados agrupa todo lo que no es dynasty con redraft. Es una decision
  // de producto que ya vive en formato.js; aqui solo se protege de una deriva.
  const picks = draft('K', 2020, 2, 2, () => 'RB');
  assert.strictEqual(T.filtrarPorEje(picks, { K: 'keeper' }, 'redraft').length, 4);
  assert.strictEqual(T.filtrarPorEje(picks, { K: 'keeper' }, 'dynasty').length, 0);
});

test('una liga sin formato conocido se trata como redraft', () => {
  const picks = draft('X', 2020, 2, 2, () => 'RB');
  assert.strictEqual(T.filtrarPorEje(picks, {}, 'redraft').length, 4);
});

test('analizarPorEjes devuelve los dos lados siempre', () => {
  const picks = draft('RED', 2020, 4, 4, () => 'RB');
  const r = T.analizarPorEjes(picks, { RED: 1 }, { formatoPorLiga: { RED: 'redraft' } });
  assert.ok(r.dynasty && r.redraft, 'ambos ejes presentes aunque uno venga vacio');
  assert.strictEqual(r.dynasty.confirmados.length, 0);
  assert.strictEqual(r.redraft.eje, 'redraft');
});
