#!/usr/bin/env node
// Gate del AVISO DE ALINEACION (reporte del dueno, 2026-09-11): el panel le
// recomendo "CJ Stroud in for AJ Brown" con Brown YA JUGADO (partido complete)
// y cruzando QB con WR en una liga 1QB. Dos mentiras en un solo renglon:
//   1. Un jugador cuyo partido ya empezo esta BLOQUEADO: no puede entrar ni
//      salir de la alineacion. Recomendarlo es imposible de ejecutar.
//   2. El pareo entra/sale iba por puntos a secas: el QB que entra se
//      emparejaba con el WR barato que sale, aunque existiera el QB flojo de
//      la misma posicion. El par tiene que ser ejecutable como UN movimiento.
//
//   node scripts/qa-lineup.mjs
//
// Espejo del cliente (patron de qa-yahoo-parse): extrae mlRevisarAlineacion
// (y mlBloqueado si existe) de public/myleagues.js y las corre con datos de
// mentira que reproducen el caso EXACTO del dueno. Verificado en ROJO contra
// el codigo anterior al fix.
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'public', 'myleagues.js'), 'utf8');

// Extraccion por llaves balanceadas, desde la firma de la funcion.
function extraer(nombre) {
  const at = src.indexOf('function ' + nombre + '(');
  if (at < 0) return null;
  let i = src.indexOf('{', at), n = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') n++;
    else if (src[j] === '}') { n--; if (!n) return src.slice(at, j + 1); }
  }
  return null;
}

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };

const fnRevisar = extraer('mlRevisarAlineacion');
const fnBloqueado = extraer('mlBloqueado');
ok('(0) mlRevisarAlineacion se extrae del cliente', !!fnRevisar, fnRevisar ? fnRevisar.length + ' chars' : 'NO ESTA');
if (!fnRevisar) { console.log('\n1 FALLOS'); process.exit(1); }

// El caso del dueno, en miniatura. Liga 1QB (QB/WR/WR/FLEX). Titulares hoy:
// QB flojo, AJ Brown (WR, su partido COMPLETO: bloqueado), WR2 y un RB en el
// flex. En la banca: Stroud (QB, 20 pts, juega el domingo) y un WR bueno.
// El mejor once del optimizador banquea a Brown y al QB flojo.
const players = {
  qbBad:  { id: 'qbBad',  name: 'QB Flojo',    pos: 'QB', team: 'DAL' },
  stroud: { id: 'stroud', name: 'CJ Stroud',   pos: 'QB', team: 'HOU' },
  ajb:    { id: 'ajb',    name: 'AJ Brown',    pos: 'WR', team: 'NE' },
  wr2:    { id: 'wr2',    name: 'WR Dos',      pos: 'WR', team: 'GB' },
  wrGood: { id: 'wrGood', name: 'WR Bueno',    pos: 'WR', team: 'KC' },
  rbFlex: { id: 'rbFlex', name: 'RB Flex',     pos: 'RB', team: 'MIA' }
};
const PROJ = { qbBad: 10, stroud: 20, ajb: 6, wr2: 11, wrGood: 12, rbFlex: 10 };
const mejorLineup = [
  { slot: 'QB',   x: { id: 'stroud', p: players.stroud, proj: 20 } },
  { slot: 'WR',   x: { id: 'wrGood', p: players.wrGood, proj: 12 } },
  { slot: 'WR',   x: { id: 'wr2',    p: players.wr2,    proj: 11 } },
  { slot: 'FLEX', x: { id: 'rbFlex', p: players.rbFlex, proj: 10 } }
];
function liga() {
  return {
    roster_positions: ['QB', 'WR', 'WR', 'FLEX', 'BN', 'BN'],
    settings: {}, status: 'in_season',
    _hyd: {
      mine: { roster_id: 1, players: Object.keys(players), starters: ['qbBad', 'ajb', 'wr2', 'rbFlex'] },
      matchups: [{ roster_id: 1, starters: ['qbBad', 'ajb', 'wr2', 'rbFlex'] }],
      proj: { 1: { lineup: mejorLineup } },
      sc: {}
    }
  };
}
function correr(lock, starters) {
  const sandbox = {
    ML: { players, lock, week: 1 },
    mlDrafted: () => true,
    mlEsBestBall: () => false,
    mlScoring: () => ({}),
    mlProjPlayer: (p) => (p && PROJ[p.id] != null ? PROJ[p.id] : null),
    ML_UMBRAL_CAMBIO: 3,
    ML_FLEX: { FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], WRRB_WRT: ['RB', 'WR', 'TE'] },
    ML_SKIP: { BN: 1, IR: 1, TAXI: 1, 'IR+': 1, IL: 1, 'IL+': 1, NA: 1 }
  };
  vm.createContext(sandbox);
  if (fnBloqueado) vm.runInContext(fnBloqueado, sandbox);
  else vm.runInContext('function mlBloqueado(){return false;}', sandbox);
  vm.runInContext(fnRevisar, sandbox);
  const L = liga();
  if (starters) { L._hyd.mine.starters = starters; L._hyd.matchups[0].starters = starters; }
  sandbox._L = L;
  return vm.runInContext('mlRevisarAlineacion(_L)', sandbox);
}

// ── con el partido de Brown COMPLETO (NE bloqueado) ────────────────────────
const conLock = correr({ NE: 1 });
const nombres = (r) => (r && r.cambios || []).map(c => c.entra.p.name + ' in for ' + c.sale.p.name);
ok('(1) un jugador que YA JUGO no aparece en ninguna recomendacion',
  conLock && !(conLock.cambios || []).some(c => c.entra.p.id === 'ajb' || c.sale.p.id === 'ajb'),
  JSON.stringify(nombres(conLock)));
ok('(2) el QB que entra sale por el QB flojo, no por un WR (par ejecutable)',
  conLock && (conLock.cambios || []).every(c => !(c.entra.p.pos === 'QB' && c.sale.p.pos !== 'QB')),
  JSON.stringify(nombres(conLock)));
ok('(3) el cambio que queda es exactamente Stroud por el QB flojo, +10',
  conLock && conLock.cambios && conLock.cambios.length === 1
  && conLock.cambios[0].entra.p.id === 'stroud' && conLock.cambios[0].sale.p.id === 'qbBad'
  && Math.abs(conLock.cambios[0].gana - 10) < 0.01,
  JSON.stringify(nombres(conLock)) + ' gana=' + (conLock && conLock.gana));

// ── control: SIN candado (nadie ha jugado), Brown si puede salir ───────────
const sinLock = correr({});
ok('(4) sin partidos empezados, los pares van por posicion: Stroud por el QB y el WR bueno por Brown',
  sinLock && sinLock.cambios && sinLock.cambios.length === 2
  && sinLock.cambios.some(c => c.entra.p.id === 'stroud' && c.sale.p.id === 'qbBad')
  && sinLock.cambios.some(c => c.entra.p.id === 'wrGood' && c.sale.p.id === 'ajb'),
  JSON.stringify(nombres(sinLock)));

// ── control del control: el espejo tiene que poder recomendar ──────────────
ok('(5) canario: el espejo produce cambios (no esta midiendo el vacio)',
  sinLock && (sinLock.cambios || []).length > 0, JSON.stringify(sinLock));

// ── el segundo caso del dueno (2026-09-12): la casilla de QB esta VACIA ────
// "me estas diciendo que meta a stroud por rodriguez cuando eso no se puede
// porque stroud es qb". Titulares: QB vacio ('0'), Brown de WR titular. El
// mejor once mete a Stroud (QB) y al WR bueno, y banquea a Brown. El par
// Stroud<->WR es INEJECUTABLE en una casilla QB: lo honesto es "into your
// empty QB slot", y el WR bueno si sale por Brown.
const conHueco = correr({}, ['0', 'ajb', 'wr2', 'rbFlex']);
const movs = (conHueco && conHueco.cambios || []).map(c =>
  c.entra.p.name + (c.sale ? ' in for ' + c.sale.p.name : ' into empty ' + c.hueco));
ok('(6) un QB que entra JAMAS "sale por" un WR (par inejecutable)',
  conHueco && (conHueco.cambios || []).every(c => !(c.sale && c.entra.p.pos === 'QB' && c.sale.p.pos !== 'QB')),
  JSON.stringify(movs));
ok('(7) la casilla vacia se dice como lo que es: Stroud into empty QB',
  conHueco && (conHueco.cambios || []).some(c => c.entra.p.id === 'stroud' && !c.sale && c.hueco === 'QB'),
  JSON.stringify(movs));
ok('(8) y el WR bueno sale por el WR flojo, como par de su posicion',
  conHueco && (conHueco.cambios || []).some(c => c.entra.p.id === 'wrGood' && c.sale && c.sale.p.id === 'ajb'),
  JSON.stringify(movs));

console.log(fails ? '\n' + fails + ' FALLOS' : '\nALL GREEN');
process.exit(fails ? 1 : 0);
