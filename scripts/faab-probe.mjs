#!/usr/bin/env node
// SONDA DE FAAB: cuanto pujar por un agente libre, en cada liga del usuario.
//
//   node scripts/faab-probe.mjs                 (usuario wolco, semana en curso)
//   node scripts/faab-probe.mjs otro 3          (otro usuario, semana 3)
//
// QUE ES Y QUE NO ES
// Esto es una SONDA, no la feature: imprime en la terminal para que el dueno
// juzgue si los numeros son creibles ANTES de que se pinte una sola pantalla.
// La regla de este repo es no ensenar un numero que no se pueda defender, y la
// unica manera de saberlo es mirarlo con sus ligas de verdad.
//
// POR QUE EL MOTOR DE SUBASTA NO SIRVE TAL CUAL. auPoolInit precia lo que un
// jugador valia en AGOSTO, repartiendo el bote de la sala entre los draftables.
// Una puja de waiver es sobre lo que cambio ESTA SEMANA: quien no valia nada en
// agosto puede valer un tercio del presupuesto hoy porque el titular se lesiono.
// Asi que el precio sale de otro sitio, y cada termino se mide:
//
//   1. LO QUE TE APORTA. Puntos por semana que suma a TU alineacion titular,
//      con el reglamento de ESA liga: su proyeccion menos la del que saldria.
//      Si no mejora a nadie, no vale una puja, por famoso que sea.
//   2. LO QUE MAS HAY. Cuanto aportan las siguientes mejores opciones libres de
//      su misma posicion. Si hay tres parecidos, tu puja baja; si es el unico,
//      sube. Esta es la parte que un porcentaje fijo nunca puede saber.
//   3. LO QUE TE QUEDA. Tu presupuesto restante de verdad, y las semanas que
//      faltan: el dinero que no gastas hoy solo sirve si queda mercado.
//   4. QUIEN TE LO DISPUTA. Que rivales lo mejorarian tambien y cuanto dinero
//      les queda. Ese es el techo: no hay que pagar mas de lo que puede pagar
//      el rival mas motivado con dinero.
//
// LO QUE ESTA SONDA NO PUEDE HACER TODAVIA, y se declara en vez de fingirse:
//   - No hay cuota de jugadas ni de objetivos de 2026: el nflverse publica esos
//     datos DESPUES de que se juegue, y hoy es la semana 1. La senal de "algo
//     cambio" es, por ahora, tener linea de mercado esta semana, que es la
//     lectura del mercado sobre su papel.
//   - No hay historico de pujas para calibrar: en toda la cuenta del dueno hay
//     24, y 22 en una sola liga.
//
// OJO: la matematica de proyeccion esta REESCRITA aqui en corto. Es aceptable
// para una sonda; el dia que esto sea producto tiene que llamar al mismo codigo
// de public/myleagues.js, o habra dos precios distintos para el mismo jugador.
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const USUARIO = process.argv[2] || 'wolco';
const SLEEPER = 'https://api.sleeper.app/v1';

async function get(u, reintentos = 3) {
  let ultimo = null;
  for (let i = 0; i < reintentos; i++) {
    try {
      const r = await fetch(u);
      if (r.ok) return r.json();
      ultimo = new Error(u + ' -> ' + r.status);
    } catch (e) { ultimo = e; }
    await new Promise(x => setTimeout(x, 400 + i * 800));
  }
  throw ultimo;
}

/* ------------------------------------------------------- las lineas de mercado */
const PROPS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts/fixtures/odds-props-2026-09-08.json'), 'utf8')).props;
const norm = s => String(s || '').toLowerCase().replace(/[.'`]/g, '')
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();
const IDX = {};
Object.keys(PROPS).forEach(k => { IDX[norm(k)] = PROPS[k]; });

const PASE_TD_POR_YARDA = 1 / 150;   // misma constante que myleagues.js, y por lo mismo
function scoring(L) {
  const s = L.scoring_settings || {};
  const n = (v, d) => (isFinite(Number(v)) ? Number(v) : d);
  return { passYd: n(s.pass_yd, 0.04), passTd: n(s.pass_td, 4), rushYd: n(s.rush_yd, 0.1),
    recYd: n(s.rec_yd, 0.1), rec: n(s.rec, 0), rushTd: n(s.rush_td, 6), recTd: n(s.rec_td, 6) };
}
function proyeccion(p, sc) {
  const pr = IDX[norm(p.name)];
  if (!pr) return null;
  let pts = 0;
  if (pr.player_pass_yds != null) pts += pr.player_pass_yds * sc.passYd + pr.player_pass_yds * PASE_TD_POR_YARDA * sc.passTd;
  if (pr.player_rush_yds != null) pts += pr.player_rush_yds * sc.rushYd;
  if (pr.player_reception_yds != null) pts += pr.player_reception_yds * sc.recYd;
  if (pr.player_receptions != null) pts += pr.player_receptions * sc.rec;
  if (pr.td_price != null) {
    const am = Number(pr.td_price);
    const prob = am < 0 ? (-am) / ((-am) + 100) : 100 / (am + 100);
    pts += prob * (p.pos === 'RB' ? sc.rushTd : sc.recTd);
  }
  return Math.round(pts * 10) / 10;
}

const FLEX = { FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], WRRB_WRT: ['RB', 'WR', 'TE'] };
const BANCA = { BN: 1, IR: 1, TAXI: 1 };

// El mejor once posible con una lista de jugadores. Devuelve el total.
function mejorAlineacion(ids, L, sc, master) {
  const slots = (L.roster_positions || []).filter(s => !BANCA[s]);
  const pool = [];
  ids.forEach(id => {
    const p = master[id]; if (!p) return;
    pool.push({ id, p, proj: proyeccion(p, sc) });
  });
  const porPos = {};
  pool.forEach(x => { if (x.proj != null) (porPos[x.p.pos] = porPos[x.p.pos] || []).push(x.proj); });
  const med = {};
  Object.keys(porPos).forEach(k => {
    const a = porPos[k].slice().sort((x, y) => x - y);
    med[k] = a[Math.floor(a.length / 2)];
  });
  pool.forEach(x => { if (x.proj == null) x.proj = med[x.p.pos] != null ? med[x.p.pos] : 0; });
  const usados = {};
  let total = 0;
  const orden = slots.slice().sort((a, b) => (FLEX[a] ? 1 : 0) - (FLEX[b] ? 1 : 0));
  orden.forEach(slot => {
    const ok = FLEX[slot] || [slot];
    let best = null;
    pool.forEach(x => {
      if (usados[x.id]) return;
      if (ok.indexOf(x.p.pos) === -1) return;
      if (!best || x.proj > best.proj) best = x;
    });
    if (best) { usados[best.id] = 1; total += best.proj; }
  });
  return Math.round(total * 10) / 10;
}

// Lo que APORTA un jugador a un plantel: la mejor alineacion con el, menos sin
// el. Es una resta, no una opinion.
function aporta(idNuevo, plantel, L, sc, master) {
  const sin = mejorAlineacion(plantel, L, sc, master);
  const con = mejorAlineacion(plantel.concat([idNuevo]), L, sc, master);
  return Math.round((con - sin) * 10) / 10;
}

/* ------------------------------------------------------------------- la sonda */
(async function () {
  console.log('SONDA DE FAAB  ·  usuario @' + USUARIO + '\n');
  const st = await get(SLEEPER + '/state/nfl');
  const semana = Number(process.argv[3]) || st.week || 1;
  const temporada = st.season;

  const master = {};
  const crudo = await get(SLEEPER + '/players/nfl');
  Object.keys(crudo).forEach(id => {
    const p = crudo[id];
    if (!p || !p.fantasy_positions) return;
    const pos = p.fantasy_positions[0];
    if (['QB', 'RB', 'WR', 'TE'].indexOf(pos) < 0) return;
    // SIN EQUIPO NO ENTRA. La primera corrida recomendaba pujar 900 dolares por
    // "Kenneth Walker WR FA", que es un homonimo sin equipo que heredaba por
    // nombre la linea de mercado de Kenneth Walker III, el RB de Kansas City.
    // Un jugador que no esta en ninguna plantilla de la NFL no puede tener la
    // proyeccion de otro. Es el mismo fallo de homonimos que este repo ya pago
    // en agosto con Justin Jefferson jugando en Cleveland.
    if (!p.team) return;
    master[id] = { id, name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
      pos, team: p.team, depth: p.depth_chart_order, status: p.status,
      inj: p.injury_status || null };
  });

  const user = await get(SLEEPER + '/user/' + encodeURIComponent(USUARIO));
  const ligas = await get(SLEEPER + '/user/' + user.user_id + '/leagues/nfl/' + temporada);

  // Solo las de FAAB: en las de orden no hay puja que valga, y decir un numero
  // ahi seria justo el error que este repo ya cometio con best ball.
  // Una liga que aun no drafteo no tiene waivers, y con el plantel vacio TODO el
  // mercado "te mejora": la primera corrida recomendaba pujar un cuarto del
  // presupuesto por Joe Burrow en tres ligas que ni han drafteado.
  const drafteada = l => ['in_season', 'post_season', 'complete'].indexOf(l.status) >= 0;
  const faab = ligas.filter(l => Number((l.settings || {}).waiver_type) === 2 && drafteada(l));
  const sinDraftear = ligas.filter(l => Number((l.settings || {}).waiver_type) === 2 && !drafteada(l)).length;
  const orden = ligas.filter(l => Number((l.settings || {}).waiver_type) !== 2).length;
  console.log(`${ligas.length} ligas: ${faab.length} de FAAB ya en juego, ${sinDraftear} de FAAB sin draftear`
    + ` (no tienen waivers todavia), ${orden} de orden (ahi no hay puja que valga).\n`);

  const SEM_FIN = 14;   // ultima semana de temporada regular tipica
  const semanasRestantes = Math.max(1, SEM_FIN - semana + 1);

  for (const l of faab) {
    let rosters, users;
    try {
      [rosters, users] = await Promise.all([
        get(SLEEPER + '/league/' + l.league_id + '/rosters'),
        get(SLEEPER + '/league/' + l.league_id + '/users')
      ]);
    } catch (e) { console.log('  (no se pudo leer ' + l.name + ')'); continue; }

    const mio = rosters.filter(r => r.owner_id === user.user_id
      || (r.co_owners || []).indexOf(user.user_id) >= 0)[0];
    if (!mio) continue;
    const L = l;
    const sc = scoring(L);
    const bote = Number((L.settings || {}).waiver_budget) || 100;
    const miGastado = Number((mio.settings || {}).waiver_budget_used) || 0;
    const miDinero = bote - miGastado;

    // agentes libres = todo el maestro menos lo que tiene alguien
    const tomados = {};
    rosters.forEach(r => (r.players || []).forEach(id => { tomados[id] = 1; }));
    const libres = Object.keys(master).filter(id => !tomados[id]);

    // Los que valen la pena mirar: los que TIENEN linea de mercado esta semana.
    // Es la senal de "algo cambio" que si existe hoy; la cuota de jugadas del
    // nflverse todavia no tiene datos de 2026.
    const conLinea = libres.filter(id => IDX[norm(master[id].name)]);

    const candidatos = conLinea.map(id => {
      const g = aporta(id, mio.players || [], L, sc, master);
      return { id, p: master[id], gana: g };
    }).filter(x => x.gana > 0).sort((a, b) => b.gana - a.gana);

    console.log('─'.repeat(74));
    console.log(`${L.name}   ·   bote $${bote}, te quedan $${miDinero}   ·   semana ${semana}, faltan ${semanasRestantes}`);
    console.log(`   ${libres.length} libres, ${conLinea.length} con linea de mercado, ${candidatos.length} te mejorarian`);

    if (!candidatos.length) { console.log('   Nadie del mercado te mejora la alineacion. No pujes.\n'); continue; }

    for (const c of candidatos.slice(0, 4)) {
      // LO QUE MAS HAY: las siguientes opciones de su misma posicion.
      const alternativas = candidatos.filter(x => x.p.pos === c.p.pos && x.id !== c.id)
        .slice(0, 3).map(x => x.gana);
      const sumaAlt = alternativas.reduce((a, b) => a + b, 0);
      const cuota = c.gana / (c.gana + sumaAlt);         // 1 si es el unico

      // QUIEN TE LO DISPUTA: rivales a los que tambien mejora, y su dinero.
      const rivales = rosters.filter(r => r.roster_id !== mio.roster_id).map(r => {
        const g = aporta(c.id, r.players || [], L, sc, master);
        // Acotado al bote: la primera corrida imprimio "el mas motivado tiene
        // $1033" en una liga de $1000, porque waiver_budget_used puede venir
        // negativo cuando la liga devuelve dinero.
        const queda = Math.max(0, Math.min(bote, bote - (Number((r.settings || {}).waiver_budget_used) || 0)));
        return { g, queda };
      }).filter(r => r.g > 0).sort((a, b) => b.g - a.g);
      const rivalTope = rivales.length ? Math.round(rivales[0].queda * (rivales[0].g / (rivales[0].g + sumaAlt))) : 0;

      const puja = Math.max(1, Math.round(miDinero * cuota * Math.min(1, semanasRestantes / SEM_FIN)));
      const tope = Math.max(puja, Math.min(miDinero, rivalTope + Math.ceil(bote * 0.01)));

      const u = master[c.id];
      console.log(`   ${(u.name + ' ' + u.pos + ' ' + (u.team || 'FA')).padEnd(30)} +${c.gana.toFixed(1)} pts/sem`);
      console.log(`      puja $${puja}   tope $${tope}`
        + `   ·   ${alternativas.length ? alternativas.length + ' alternativas parecidas (+' + alternativas.map(a => a.toFixed(1)).join(', +') + ')' : 'no hay otro igual en el mercado'}`
        + `   ·   ${rivales.length} rivales lo quieren` + (rivales.length ? `, el mas motivado tiene $${rivales[0].queda}` : ''));
    }
    console.log('');
  }
})().catch(e => { console.error('fallo:', e.message); process.exit(1); });
