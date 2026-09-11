#!/usr/bin/env node
// Gate del PARSEO DE YAHOO. Sin navegador y sin red: mide las funciones puras
// que convierten la respuesta de Yahoo en el molde de Sleeper.
//
//   node scripts/qa-yahoo-parse.mjs
//
// POR QUE EXISTE. La ingesta de Yahoo no tiene NINGUN gate: el OAuth solo cierra
// contra macdraft.app, asi que ni qa-myleagues ni nadie la toca. El resultado es
// que un error de parseo en las casillas de la liga (roster_positions) baja el
// total proyectado de TODAS las ligas de Yahoo sin que nada se ponga rojo: una
// casilla que se pierde es un titular menos sumando.
//
// EL FIXTURE ES SINTETICO, y hay que decirlo: replica la FORMA documentada de
// /league/{key}/settings (cada entidad anidada en una lista de objetos sueltos,
// numeros como cadenas), no una respuesta capturada. Lo que prueba es el
// parseo, no que Yahoo mande exactamente esto.
//
// El segundo bloque compara contra el ESPEJO del cliente: public/myleagues.js
// traduce las casillas de Yahoo a su vocabulario (ML_YPOS) y descarta las de
// banca (ML_SKIP). Las dos mitades se extraen del archivo y se corren aqui, que
// es la unica forma de que una no derive de la otra sin que nadie se entere.
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const Y = require_(path.join(ROOT, 'server/routes/yahoo.js'));

let fails = 0;
const ok = (n, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (d ? '\n      ' + d : '')); if (!c) fails++; };

// ── El espejo del cliente, extraido del archivo ────────────────────────────
const SRC = fs.readFileSync(path.join(ROOT, 'public/myleagues.js'), 'utf8');
function bloque(nombre) {
  const i = SRC.indexOf('var ' + nombre + ' = {');
  if (i < 0) throw new Error('no encuentro ' + nombre + ' en myleagues.js');
  const j = SRC.indexOf('};', i);
  return eval('(' + SRC.slice(i + ('var ' + nombre + ' = ').length, j + 1) + ')');
}
const ML_YPOS = bloque('ML_YPOS');
const ML_SKIP = bloque('ML_SKIP');
const ML_FLEX = bloque('ML_FLEX');
const mlYPos = p => ML_YPOS[p] || p;
// Lo que acaba contando como titular en mlBestLineup.
const titulares = casillas => casillas.map(mlYPos).filter(s => !ML_SKIP[s]);

// ── Fixture sintetico: la forma de /league/{key}/settings ──────────────────
// Yahoo manda los numeros como cadenas y anida cada entidad en una lista.
const yCasilla = (position, count) => ({ roster_position: { position, position_type: 'O', count: String(count) } });
function settingsYahoo(casillas, stats) {
  return {
    fantasy_content: {
      league: [
        { league_key: '461.l.1', name: 'Liga de prueba', num_teams: '10', current_week: '2' },
        {
          settings: [{
            draft_type: 'live',
            num_playoff_teams: '6',
            playoff_start_week: '15',
            roster_positions: casillas.map(([p, n]) => yCasilla(p, n)),
            stat_categories: { stats: (stats || []).map(([id]) => ({ stat: { stat_id: String(id), enabled: '1', name: 'x' } })) },
            stat_modifiers: { stats: (stats || []).map(([id, v]) => ({ stat: { stat_id: String(id), value: String(v) } })) }
          }]
        }
      ]
    }
  };
}

console.log('== PARSEO DE YAHOO ==\n');

/* ------------------------------------------------ liga estandar de 10 huecos */
// La de fabrica en Yahoo: QB, WR x3, RB x2, TE, W/R/T, K, DEF, banca y un IR.
const ESTANDAR = [['QB', 1], ['WR', 3], ['RB', 2], ['TE', 1], ['W/R/T', 1], ['K', 1], ['DEF', 1], ['BN', 6], ['IR', 1]];
{
  const rp = Y.rosterPositionsDeYahoo(settingsYahoo(ESTANDAR));
  ok('(a) el count se expande: dos RB son dos huecos',
    rp.filter(x => x === 'RB').length === 2 && rp.filter(x => x === 'WR').length === 3,
    JSON.stringify(rp));
  ok('(b) la liga estandar sale con sus 17 casillas (10 titulares + 6 banca + IR)',
    rp.length === 17, 'n=' + rp.length + ' ' + JSON.stringify(rp));
  const t = titulares(rp);
  ok('(c) quedan 10 titulares tras el espejo del cliente',
    t.length === 10, 'n=' + t.length + ' ' + JSON.stringify(t));
  ok('(d) el flex de Yahoo llega como flex de verdad, no como una casilla que nadie puede llenar',
    t.some(s => ML_FLEX[s]), JSON.stringify(t));
}

/* ------------------------------------------------------------- superflex */
{
  const rp = Y.rosterPositionsDeYahoo(settingsYahoo(
    [['QB', 1], ['WR', 2], ['RB', 2], ['TE', 1], ['Q/W/R/T', 1], ['W/R', 1], ['K', 1], ['DEF', 1], ['BN', 5]]));
  const t = titulares(rp);
  ok('(e) superflex de Yahoo (Q/W/R/T) admite QB', (ML_FLEX[mlYPos('Q/W/R/T')] || []).indexOf('QB') >= 0,
    JSON.stringify(ML_FLEX[mlYPos('Q/W/R/T')]));
  ok('(f) 10 titulares en la liga de superflex', t.length === 10, 'n=' + t.length + ' ' + JSON.stringify(t));
  ok('(g) TODA casilla titular es una posicion real o un flex conocido',
    t.every(s => ML_FLEX[s] || ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].indexOf(s) >= 0),
    JSON.stringify(t.filter(s => !ML_FLEX[s] && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].indexOf(s) < 0)));
}

/* --------------------------------------------- las casillas que NO son titulares */
// IR+ es la casilla de lesionados ampliada de Yahoo. Si no se descarta, entra en
// el once como un hueco que ningun jugador puede llenar: no suma puntos, pero
// cuenta contra la cobertura y contra el conteo de titulares que se le enseña al
// usuario.
{
  const rp = Y.rosterPositionsDeYahoo(settingsYahoo(
    ESTANDAR.concat([['IR+', 1]])));
  const t = titulares(rp);
  ok('(h) IR+ no cuenta como titular', t.length === 10, 'n=' + t.length + ' ' + JSON.stringify(t));
}

/* ------------------------------------------------------- defensa a la vieja usanza */
{
  const rp = Y.rosterPositionsDeYahoo(settingsYahoo(
    [['QB', 1], ['RB', 2], ['WR', 2], ['TE', 1], ['W/R/T', 1], ['K', 1], ['D', 1], ['BN', 6]]));
  const t = titulares(rp);
  ok('(i) la casilla D se traduce a DEF', t.indexOf('DEF') >= 0, JSON.stringify(t));
}

/* ------------------------------------------------------------------ el scoring */
{
  // Half PPR con intercepciones y balon perdido. stat_id: 4 yardas de pase,
  // 5 TD de pase, 6 intercepcion, 9 yardas por tierra, 10 TD por tierra,
  // 11 recepcion, 12 yardas de recepcion, 13 TD de recepcion, 18 balon perdido.
  const sc = Y.scoringDeYahoo(settingsYahoo(ESTANDAR,
    [[4, 0.04], [5, 4], [6, -1], [9, 0.1], [10, 6], [11, 0.5], [12, 0.1], [13, 6], [18, -2]]));
  ok('(j) half PPR se lee como 0.5 por recepcion', sc.rec === 0.5, JSON.stringify(sc));
  ok('(k) la intercepcion entra', sc.pass_int === -1, JSON.stringify(sc));
  ok('(l) el balon perdido entra', sc.fum_lost === -2, JSON.stringify(sc));
}

console.log('\n' + (fails ? fails + ' FALLOS' : 'ALL GREEN'));
process.exit(fails ? 1 : 0);
