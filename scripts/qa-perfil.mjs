#!/usr/bin/env node
// Gate del perfil de self-scouting. El motor se escribio puro (sin red, sin DOM,
// sin reloj) justamente para poder comprobarlo contra una linea base calculada a
// mano, y hasta hoy nadie la habia escrito.
//
// Regla de la casa: un test que no falla contra el codigo roto es un adorno.
// Los checks marcados [ROTO-ANTES] fallan a proposito contra la version previa
// del motor, y esta verificado que lo hacian antes del arreglo.
//
// Corre desde cualquier directorio.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(aqui, '..', 'server', 'lib', 'perfil.js'));
const { construirPerfil, binomP, claim, aplicarFDR, edadEnFecha, MIN_N } = M;

let fallos = 0, corridos = 0;
const ok = (nombre, cond, detalle) => {
  corridos++;
  if (cond) { console.log('  ok   ' + nombre); return; }
  fallos++;
  console.log('  FAIL ' + nombre + (detalle ? '\n       ' + detalle : ''));
};
const eq = (nombre, real, esperado) =>
  ok(nombre, Object.is(real, esperado), 'esperado ' + JSON.stringify(esperado) + ', obtuvo ' + JSON.stringify(real));

// ── Fixture ────────────────────────────────────────────────────────────────
// Dos ligas del mismo dueno, una superflex y una de un solo QB, con la senal de
// QB EXACTAMENTE OPUESTA en cada una. Sumadas se cancelan: es el caso que
// demuestra por que mezclar formatos borra la senal en vez de encontrarla.
const TS = Date.parse('2026-01-01T00:00:00Z');
const TS_VIEJO = Date.parse('2025-01-01T00:00:00Z');

const PLAYERS = {
  // age congelada por Sleeper 5 anos atras (le pasa a todo el que deja de
  // actualizarse): birth_date es la unica fuente que no miente.
  p_sf:   { full_name: 'QB Superflex', fantasy_positions: ['QB'], position: 'QB', birth_date: '2000-06-01', age: 20 },
  p_1qb:  { full_name: 'QB UnSoloQB',  fantasy_positions: ['QB'], position: 'QB', birth_date: '1998-03-15', age: 28 },
  // sin birth_date: obliga al camino de respaldo por temporadas enteras
  p_nobd: { full_name: 'RB SinFecha',  fantasy_positions: ['RB'], position: 'RB', age: 25 },
  p_wr:   { full_name: 'WR Cualquiera', fantasy_positions: ['WR'], position: 'WR', birth_date: '2001-09-09', age: 24 }
};

const DUENOS_SF  = { 1: 'U1', 2: 'U2', 3: 'U3' };
const DUENOS_1QB = { 5: 'U1', 6: 'U6', 7: 'U7' };

function armarTrades(n) {
  const t = [];
  for (let i = 0; i < n; i++) {
    // Superflex: entra un QB en cada trade.
    t.push({
      type: 'trade', status: 'complete', created: TS, creator: 'U1',
      roster_ids: [1, 2], adds: { p_sf: 1 }, drops: {}, draft_picks: [],
      _liga: 'LSF', _superflex: true, _duenoPorRoster: DUENOS_SF
    });
    // Un solo QB: sale un QB en cada trade.
    t.push({
      type: 'trade', status: 'complete', created: TS, creator: 'U1',
      roster_ids: [5, 6], adds: {}, drops: { p_1qb: 5 }, draft_picks: [],
      _liga: 'L1QB', _superflex: false, _duenoPorRoster: DUENOS_1QB
    });
  }
  return t;
}

const CTX = { miRosterPorLiga: { LSF: 1, L1QB: 5 }, miUserId: 'U1', temporadaActual: 2026 };
const P = construirPerfil(armarTrades(14), PLAYERS, CTX);
const porLabel = (l) => (P.afirmaciones || []).find(a => a.label === l);

// ── 1. Edad por birth_date, no por aproximacion ────────────────────────────
console.log('\nEdad exacta desde birth_date');

// [ROTO-ANTES] La version previa leia p.age y retrocedia temporadas enteras.
// Con la age congelada de p_sf devolvia 20 en vez de 25.
{
  const r = edadEnFecha(PLAYERS, 'p_sf', TS, 2026);
  eq('QB nacido 2000-06-01 tiene 25 el 2026-01-01', r && r.edad, 25);
  eq('  y se declara exacta', r && r.exacta, true);
}
{
  // El cumpleanos aun no llego en la fecha del trade: 24, no 25.
  const r = edadEnFecha(PLAYERS, 'p_wr', Date.parse('2026-09-08T00:00:00Z'), 2026);
  eq('WR nacido 2001-09-09 tiene 24 el dia ANTES de cumplir', r && r.edad, 24);
  const r2 = edadEnFecha(PLAYERS, 'p_wr', Date.parse('2026-09-09T00:00:00Z'), 2026);
  eq('  y 25 el dia exacto del cumpleanos', r2 && r2.edad, 25);
}
{
  // Un trade de hace dos anos no puede devolver la edad de hoy.
  const r = edadEnFecha(PLAYERS, 'p_sf', Date.parse('2024-07-01T00:00:00Z'), 2026);
  eq('la edad es la del dia del trade, no la de hoy', r && r.edad, 24);
}
{
  // Respaldo: sin birth_date se retrocede por temporadas y se DECLARA aproximada.
  const r = edadEnFecha(PLAYERS, 'p_nobd', TS_VIEJO, 2026);
  eq('sin birth_date cae al respaldo por temporadas', r && r.edad, 24);
  eq('  y se declara aproximada', r && r.exacta, false);
}
eq('sin birth_date y sin age no inventa una edad', edadEnFecha(PLAYERS, 'p_x', TS, 2026), null);

// [ROTO-ANTES] delta era -8 con la age congelada; el real es -2.
eq('edad media recibida', P.edad.recibida, 25);
eq('edad media enviada', P.edad.enviada, 27);
eq('delta de edad', P.edad.delta, -2);
eq('ninguna edad de la muestra fue aproximada', P.edad.nAprox, 0);

// ── 2. QB separados por formato ────────────────────────────────────────────
console.log('\nQB por formato');

// [ROTO-ANTES] No existia: el motor emitia un unico claim 'qb' con los dos
// formatos sumados, que en este fixture da 14 vs 14 y no dice nada.
{
  const sf = porLabel('qb_superflex');
  const uno = porLabel('qb_1qb');
  ok('existe una afirmacion de QB para superflex', !!sf);
  ok('existe una afirmacion de QB para un solo QB', !!uno);
  ok('NO queda una afirmacion de QB que mezcle formatos', !porLabel('qb'));
  eq('superflex: 14 QB entrando, 0 saliendo', sf && sf.a + '/' + sf.b, '14/0');
  eq('un solo QB: 0 entrando, 14 saliendo', uno && uno.a + '/' + uno.b, '0/14');
  eq('superflex se confirma', sf && sf.estado, 'confirmado');
  eq('un solo QB se confirma', uno && uno.estado, 'confirmado');
  ok('los textos distinguen el formato',
    sf && uno && sf.texto !== uno.texto && /superflex/i.test(sf.texto || ''),
    'sf="' + (sf && sf.texto) + '" 1qb="' + (uno && uno.texto) + '"');
}
{
  // La senal real se perdia al sumar: esto es lo que el arreglo recupera.
  const mezclado = claim('qb', 14, 14, { a: 'x', b: 'y' });
  eq('sumar los dos formatos da un volado (control)', mezclado.estado, 'sin_senal');
}
{
  // Un formato que no llega a MIN_N no se emite, se declara corto.
  const p2 = construirPerfil(armarTrades(3), PLAYERS, CTX);
  const sf = (p2.afirmaciones || []).find(a => a.label === 'qb_superflex');
  eq('con 3 QB el formato no afirma nada', sf && sf.estado, 'insuficiente');
  eq('  y dice cuanto le falta', sf && sf.falta, MIN_N - 3);
}
{
  // Un dueno que solo juega superflex no debe ver una fila fantasma de 1QB.
  const soloSF = armarTrades(14).filter(t => t._superflex);
  const p3 = construirPerfil(soloSF, PLAYERS, CTX);
  ok('sin ligas de un solo QB no aparece esa afirmacion',
    !(p3.afirmaciones || []).some(a => a.label === 'qb_1qb'));
}

// ── 3. Lo que ya funcionaba y no se puede romper ───────────────────────────
console.log('\nRegresion');
eq('trades propios contados', P.muestra.tradesPropios, 28);
eq('ningun jugador sin posicion', P.muestra.sinPosicion, 0);
eq('ningun roster sin dueno', P.muestra.sinDueno, 0);
eq('iniciativa: 28 propuestos por mi', P.iniciativa.inicio, 28);
eq('iniciativa se confirma', porLabel('iniciativa').estado, 'confirmado');
eq('QB recibidos en total', P.flujo.recibido.QB, 14);
eq('QB enviados en total', P.flujo.enviado.QB, 14);
eq('contrapartes distintas', P.contrapartes.distintas, 2);

// Trades que nunca ocurrieron no cuentan.
{
  const sucios = armarTrades(14).concat([
    { type: 'trade', status: 'vetoed', created: TS, creator: 'U1', roster_ids: [1, 2], adds: { p_wr: 1 }, drops: {}, _liga: 'LSF', _superflex: true, _duenoPorRoster: DUENOS_SF },
    { type: 'waiver', status: 'complete', created: TS, creator: 'U1', roster_ids: [1], adds: { p_wr: 1 }, drops: {}, _liga: 'LSF', _superflex: true, _duenoPorRoster: DUENOS_SF }
  ]);
  // El motor confia en que la ruta ya filtro; el gate comprueba que un trade de
  // una liga donde no juego tampoco entra.
  const ajeno = armarTrades(1).concat([
    { type: 'trade', status: 'complete', created: TS, creator: 'U9', roster_ids: [8, 9], adds: { p_wr: 8 }, drops: {}, _liga: 'LOTRA', _superflex: true, _duenoPorRoster: { 8: 'U8', 9: 'U9' } }
  ]);
  eq('un trade de una liga ajena no se cuenta', construirPerfil(ajeno, PLAYERS, CTX).muestra.tradesPropios, 2);
  ok('los sucios no rompen el conteo propio', construirPerfil(sucios, PLAYERS, CTX).muestra.tradesPropios >= 28);
}

// El umbral es el umbral.
eq('en MIN_N-1 no afirma', claim('x', MIN_N - 1, 0, { a: 'a', b: 'b' }).estado, 'insuficiente');
ok('en MIN_N ya puede afirmar', claim('x', MIN_N, 0, { a: 'a', b: 'b' }).estado !== 'insuficiente');

// [ROTO-ANTES] Una p diminuta no puede llegar a pantalla como cero. claim()
// la guardaba con toFixed(3), asi que 2*0.5^16 = 0.0000305 se imprimia "p=0",
// que no es un numero pequeno: es la afirmacion de que el azar no podia
// producirlo. concentracionSocios() ya habia resuelto esto con su piso y el
// arreglo nunca se propago al otro lado del archivo.
{
  const c = claim('x', 16, 0, { a: 'a', b: 'b' });
  ok('una p diminuta no colapsa a cero', c.p > 0, 'p=' + c.p);
  ok('  y se marca como piso para que la UI escriba "menor que"', c.pEsPiso === true);
  ok('  con el piso declarado', typeof c.pPiso === 'number' && c.pPiso > 0);
  const g = claim('x', 20, 9, { a: 'a', b: 'b' });
  ok('una p normal NO se marca como piso', !g.pEsPiso, 'p=' + g.p);
  ok('  y conserva su valor legible', g.p > 0.01 && g.p < 1, 'p=' + g.p);
}
ok('ninguna afirmacion del motor llega con p=0',
  P.afirmaciones.every(a => a.p == null || a.p > 0),
  JSON.stringify(P.afirmaciones.filter(a => a.p === 0).map(a => a.label)));

// Binomial contra la mano.
eq('binomP(10,10) = 2*0.5^10', +binomP(10, 10).toFixed(6), +(2 * Math.pow(0.5, 10)).toFixed(6));
eq('binomP(5,10) = 1', +binomP(5, 10).toFixed(6), 1);

// BH tiene la ultima palabra: una p que pasa sola puede no pasar acompanada.
{
  const fam = [{ label: 'a', p: 0.04, estado: 'confirmado', texto: 't' }];
  for (let i = 0; i < 9; i++) fam.push({ label: 'r' + i, p: 0.9, estado: 'sin_senal', texto: 't' });
  aplicarFDR(fam);
  eq('BH degrada una p=0.04 solitaria entre diez pruebas', fam[0].estado, 'sin_senal');
  ok('y le quita el texto para que la UI no pueda pintarlo', fam[0].texto === undefined);
}
{
  // [ROTO-ANTES] El agujero: claim() marca sin_senal en cuanto p > 0.05, pero
  // aplicarFDR solo borraba el texto de las que quedaban FUERA del prefijo del
  // step-up. Una p de 0.06 en buena compania se quedaba marcada "sin senal" y
  // con su frase entera lista para pintar. Hoy la pantalla filtra por estado y
  // no la saca, asi que no se veia; sigue siendo un arma cargada, que es
  // exactamente lo que esta pasada existe para descargar.
  const fam = [
    { label: 'firme', p: 0.001, estado: 'confirmado', texto: 'si' },
    { label: 'floja', p: 0.06, estado: 'sin_senal', texto: 'NO DEBERIA SOBREVIVIR' }
  ];
  aplicarFDR(fam);
  eq('una p=0.06 dentro del prefijo BH sigue sin senal', fam[1].estado, 'sin_senal');
  ok('y NO conserva la frase', fam[1].texto === undefined,
    'quedo texto=' + JSON.stringify(fam[1].texto));
  eq('la firme conserva la suya', fam[0].texto, 'si');
}
{
  // El mismo agujero visto desde el motor completo, no desde el helper.
  const P2 = construirPerfil(armarTrades(14), PLAYERS, CTX);
  ok('ninguna afirmacion no confirmada sale del motor con texto',
    P2.afirmaciones.every(a => a.estado === 'confirmado' || a.texto === undefined),
    JSON.stringify(P2.afirmaciones.filter(a => a.estado !== 'confirmado' && a.texto)));
}

// Mismo historial, misma p: el test de permutacion va sembrado.
{
  const a = construirPerfil(armarTrades(14), PLAYERS, CTX).afirmaciones.find(x => x.label === 'socios');
  const b = construirPerfil(armarTrades(14), PLAYERS, CTX).afirmaciones.find(x => x.label === 'socios');
  eq('la p de socios no se mueve entre corridas', a.p, b.p);
}

// El denominador que va a pantalla tiene que cuadrar con la lista.
eq('patronesEvaluados = afirmaciones', P.muestra.patronesEvaluados, P.afirmaciones.length);
eq('patronesEmitidos = confirmadas', P.muestra.patronesEmitidos,
  P.afirmaciones.filter(a => a.estado === 'confirmado').length);
ok('ninguna afirmacion no confirmada lleva texto que pintar',
  P.afirmaciones.every(a => a.estado === 'confirmado' || a.texto === undefined));

console.log('\n' + (fallos ? 'FALLA: ' + fallos + ' de ' + corridos : 'ALL GREEN: ' + corridos + ' checks'));
process.exit(fallos ? 1 : 0);
