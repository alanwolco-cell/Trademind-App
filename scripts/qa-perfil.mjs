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
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(aqui, '..', 'server', 'lib', 'perfil.js'));
const { construirPerfil, construirPerfiles, analizarWaivers, analizarDrafts, volumenWaiver, binomP, claim, aplicarFDR, edadEnFecha, MIN_N } = M;
const F = require(path.join(aqui, '..', 'server', 'lib', 'formato.js'));
const { clasificarLiga, ejeDeDosLados } = F;

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

// ── 0. Formato de liga: una sola verdad en los dos lados ───────────────────
// El criterio vivia copiado a mano en dos sitios de app.js y nunca habia
// llegado al servidor. Ahora es un modulo, pero el navegador no puede
// requerirlo, asi que existe un espejo en app.js. Este bloque EXTRAE ese espejo
// del archivo y lo corre contra el canonico caso por caso: si alguien edita uno
// y se olvida del otro, esto falla. Un comentario que pida mantenerlos iguales
// no es un candado; esto si.
console.log('\nFormato de liga: servidor y cliente de acuerdo');
{
  const appjs = fs.readFileSync(path.join(aqui, '..', 'public', 'app.js'), 'utf8');
  const m = appjs.match(/function tmClasificarLiga\(l\)\{[\s\S]*?\n\}/);
  ok('el espejo de app.js sigue ahi con su nombre', !!m,
    'si se renombro o se borro, este gate no puede comprobar nada y hay que arreglarlo');
  if (m) {
    const clienteClasificar = new Function(m[0] + '; return tmClasificarLiga;')();
    const CASOS = [
      { liga: { settings: { type: 2 }, name: 'Home League' }, esperado: 'dynasty', fuente: 'settings' },
      { liga: { settings: { type: 1 }, name: 'Home League' }, esperado: 'keeper', fuente: 'settings' },
      { liga: { settings: { type: 0 }, name: 'Dynasty Warriors' }, esperado: 'redraft', fuente: 'settings' },
      { liga: { name: 'The Dynasty League' }, esperado: 'dynasty', fuente: 'nombre' },
      { liga: { name: 'Keeper Kings' }, esperado: 'keeper', fuente: 'nombre' },
      { liga: { name: 'Sunday Money' }, esperado: 'redraft', fuente: 'defecto' },
      { liga: {}, esperado: 'redraft', fuente: 'defecto' },
      { liga: null, esperado: 'redraft', fuente: 'defecto' }
    ];
    let discrepancias = 0;
    for (const c of CASOS) {
      const srv = clasificarLiga(c.liga);
      const cli = clienteClasificar(c.liga);
      if (srv.formato !== cli.formato || srv.fuente !== cli.fuente) discrepancias++;
      eq('  servidor clasifica "' + ((c.liga && c.liga.name) || '(vacia)') + '" como ' + c.esperado,
        srv.formato, c.esperado);
      eq('    y lo declara leido de ' + c.fuente, srv.fuente, c.fuente);
    }
    eq('cliente y servidor coinciden en los ' + CASOS.length + ' casos', discrepancias, 0);
  }
  // El punto entero del respaldo por nombre: una liga de REDRAFT que se llama
  // "Dynasty Warriors" no es dynasty. settings manda sobre el nombre.
  eq('settings gana al nombre',
    clasificarLiga({ settings: { type: 0 }, name: 'Dynasty Warriors' }).formato, 'redraft');
  // Palabra entera, no subcadena: "dynastic" no es "dynasty".
  eq('el respaldo busca la palabra entera',
    clasificarLiga({ name: 'The Dynastic Order' }).formato, 'redraft');
  // Keeper NO es dynasty. Meterlo ahi inflaba las conclusiones de dynasty.
  ok('keeper no se cuela en dynasty', clasificarLiga({ settings: { type: 1 } }).formato !== 'dynasty');
  eq('pero en el eje de dos lados cae con redraft', ejeDeDosLados('keeper'), 'redraft');
  eq('y dynasty se queda solo de su lado', ejeDeDosLados('dynasty'), 'dynasty');
}

// ── 0b. Las funciones puras del pintado ────────────────────────────────────
// Viven en app.js y no se pueden requerir, asi que se extraen igual que el
// espejo del formato. Son puras y tienen logica de verdad: sin gate, el dia que
// alguien cambie la forma de una afirmacion en el motor, la pantalla empieza a
// mentir en silencio y nadie se entera hasta que lo ve un humano.
console.log('\nPintado del perfil');
{
  const appjs = fs.readFileSync(path.join(aqui, '..', 'public', 'app.js'), 'utf8');
  const saca = (re, nombre) => {
    const m = appjs.match(re);
    ok('sigue existiendo ' + nombre, !!m, 'si se renombro, este gate deja de comprobar nada');
    return m ? new Function(m[0] + '; return ' + nombre + ';')() : null;
  };
  const cifra = saca(/function _perfilCifra\(a\)\{[\s\S]*?\n\}/, '_perfilCifra');
  const partes = saca(/function _perfilPartes\(a\)\{[\s\S]*?\n\}/, '_perfilPartes');
  const inicial = saca(/function _perfilEjeInicial\(ejes\)\{[\s\S]*?\n\}/, '_perfilEjeInicial');

  if (cifra) {
    // Cada familia de afirmacion guarda su marcador en un sitio distinto.
    eq('binomial por el lado a', JSON.stringify(cifra({ a: 25, b: 5, n: 30, lado: 'a' })), '{"num":25,"den":30}');
    eq('binomial por el lado b', JSON.stringify(cifra({ a: 5, b: 25, n: 30, lado: 'b' })), '{"num":25,"den":30}');
    eq('permutacion por arriba', JSON.stringify(cifra({ ganados: 73, n: 105, lado: 'a' })), '{"num":73,"den":105}');
    // Por abajo la cifra es a cuantos NO les gana: pintar 12 de 105 junto a la
    // frase "trabajas poco el wire" diria lo contrario de lo que mide.
    eq('permutacion por abajo cuenta al reves', JSON.stringify(cifra({ ganados: 12, n: 105, lado: 'b' })), '{"num":93,"den":105}');
    eq('socios usa su repeticion maxima', JSON.stringify(cifra({ maxObs: 16, n: 29 })), '{"num":16,"den":29}');
    // Sin marcador NO se inventa uno: el bloque se dibuja sin cifra.
    eq('sin marcador no hay cifra', cifra({ n: 12 }), null);
    eq('sin afirmacion tampoco', cifra(null), null);
  }
  if (partes) {
    const p1 = partes({ texto: 'You open the table. The deals are yours to propose.' });
    eq('el titular es la primera frase', p1.titular, 'You open the table.');
    eq('el resto NO repite el titular', p1.resto, 'The deals are yours to propose.');
    const p2 = partes({ texto: 'You buy quarterbacks in superflex.' });
    eq('una sola frase es todo titular', p2.titular, 'You buy quarterbacks in superflex.');
    eq('  y no deja un resto vacio que pintar', p2.resto, '');
    eq('sin texto no revienta', partes({}).titular, '');
  }
  if (inicial) {
    // Abrir por un eje mudo teniendo hallazgos al lado es una mala primera
    // pantalla, y era lo que hacia al fijar 'dynasty'.
    eq('abre por el eje que afirma algo', inicial({
      dynasty: { muestra: { patronesEmitidos: 0, tradesPropios: 33 } },
      redraft: { muestra: { patronesEmitidos: 2, tradesPropios: 30 } }
    }), 'redraft');
    eq('y al reves tambien', inicial({
      dynasty: { muestra: { patronesEmitidos: 3, tradesPropios: 10 } },
      redraft: { muestra: { patronesEmitidos: 1, tradesPropios: 99 } }
    }), 'dynasty');
    eq('a igualdad manda el historial mas largo', inicial({
      dynasty: { muestra: { patronesEmitidos: 0, tradesPropios: 5 } },
      redraft: { muestra: { patronesEmitidos: 0, tradesPropios: 40 } }
    }), 'redraft');
    eq('sin nada no revienta', inicial({}), 'dynasty');
  }
}

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

// ── 2b. Dos ejes: dynasty y redraft, separados ─────────────────────────────
console.log('\nParticion por eje');
{
  // Mismo fixture, pero declarando que la liga superflex es DYNASTY y la de un
  // solo QB es REDRAFT. Es el caso que importa: la senal de cada lado es
  // opuesta, asi que si la particion no funciona se anulan y no dice nada.
  const CTX2 = { ...CTX, formatoPorLiga: { LSF: 'dynasty', L1QB: 'redraft' },
    fuentePorLiga: { LSF: 'settings', L1QB: 'settings' } };
  const dos = construirPerfiles(armarTrades(14), PLAYERS, CTX2);
  ok('devuelve los dos ejes', !!(dos.dynasty && dos.redraft));
  eq('dynasty se queda con sus 14 trades', dos.dynasty.muestra.tradesPropios, 14);
  eq('redraft se queda con los suyos', dos.redraft.muestra.tradesPropios, 14);
  eq('los trades no se cuentan dos veces',
    dos.dynasty.muestra.tradesPropios + dos.redraft.muestra.tradesPropios, 28);
  // La prueba de que la particion sirve para algo: en dynasty compra QB y en
  // redraft los vende. Mezclados era 14 vs 14 y el tab callaba.
  const qbD = dos.dynasty.afirmaciones.find(a => a.label === 'qb_superflex');
  const qbR = dos.redraft.afirmaciones.find(a => a.label === 'qb_1qb');
  eq('en dynasty compra QB', qbD && qbD.lado, 'a');
  eq('en redraft los vende', qbR && qbR.lado, 'b');
  ok('un eje no ve las afirmaciones del otro',
    !dos.dynasty.afirmaciones.some(a => a.label === 'qb_1qb'));
  // Cada lado corre su propia familia de BH.
  ok('cada eje corrige su familia por separado',
    dos.dynasty.muestra.patronesEvaluados > 0 && dos.redraft.muestra.patronesEvaluados > 0);
}
{
  // Keeper cae con redraft, pero contado y declarado.
  const CTX3 = { ...CTX, formatoPorLiga: { LSF: 'dynasty', L1QB: 'keeper' },
    fuentePorLiga: { LSF: 'settings', L1QB: 'nombre' } };
  const dos = construirPerfiles(armarTrades(14), PLAYERS, CTX3);
  eq('la liga keeper cae del lado redraft', dos.redraft.muestra.tradesPropios, 14);
  eq('  y se declara que era keeper', dos.redraft.composicion.keeper, 1);
  eq('  y que se clasifico por su nombre', dos.redraft.composicion.porNombre, 1);
  eq('dynasty no se lleva ninguna keeper', dos.dynasty.composicion.keeper, 0);
}
{
  // Un dueno que solo juega dynasty no puede ver un tab de redraft inventado.
  const CTX4 = { ...CTX, formatoPorLiga: { LSF: 'dynasty', L1QB: 'dynasty' },
    fuentePorLiga: { LSF: 'settings', L1QB: 'settings' } };
  const dos = construirPerfiles(armarTrades(14), PLAYERS, CTX4);
  eq('todo a dynasty', dos.dynasty.muestra.tradesPropios, 28);
  eq('redraft queda vacio, no inventado', dos.redraft.muestra.tradesPropios, 0);
  ok('y un eje vacio no afirma nada',
    dos.redraft.afirmaciones.every(a => a.estado !== 'confirmado'));
}
{
  // El precio de partir, medido: cada lado afirma MENOS que el saco mezclado.
  // Se comprueba a proposito para que quede escrito que es esperado y no un bug.
  const CTX5 = { ...CTX, formatoPorLiga: { LSF: 'dynasty', L1QB: 'redraft' },
    fuentePorLiga: { LSF: 'settings', L1QB: 'settings' } };
  const junto = construirPerfil(armarTrades(6), PLAYERS, CTX);
  const dos = construirPerfiles(armarTrades(6), PLAYERS, CTX5);
  ok('partir la muestra puede bajar lo que se afirma, y es correcto',
    dos.dynasty.muestra.tradesPropios < junto.muestra.tradesPropios);
}

// ── 2c. Nada de vocabulario de dynasty en redraft ──────────────────────────
console.log('\nEl idioma de cada eje');
{
  const CTX_D = { ...CTX, eje: 'dynasty' };
  const CTX_R = { ...CTX, eje: 'redraft' };
  const conPicks = armarTrades(14).map(t => ({ ...t, draft_picks: [{ owner_id: t.roster_ids[0], previous_owner_id: t.roster_ids[1] }] }));
  const d = construirPerfil(conPicks, PLAYERS, CTX_D);
  const r = construirPerfil(conPicks, PLAYERS, CTX_R);
  const td = (d.afirmaciones.find(a => a.label === 'picks') || {}).texto || '';
  const tr = (r.afirmaciones.find(a => a.label === 'picks') || {}).texto || '';
  ok('dynasty habla de futuro', /future/i.test(td), 'texto: ' + td);
  ok('redraft NO habla de futuro', !/future/i.test(tr), 'texto: ' + tr);
  ok('redraft habla del draft de esta temporada', /draft/i.test(tr), 'texto: ' + tr);
  ok('los dos ejes no dicen lo mismo', td !== tr);
  // El vocabulario prohibido en redraft, tomado de la regla que ya rige a Mac.
  ok('ninguna afirmacion de redraft usa jerga de dynasty',
    r.afirmaciones.every(a => !/\b(future|win.?now|dynasty|rebuild|long.?term|runway)\b/i.test(a.texto || '')),
    JSON.stringify(r.afirmaciones.filter(a => /\b(future|win.?now|dynasty|rebuild)\b/i.test(a.texto || '')).map(a => a.texto)));
}
{
  // La edad es dato de dynasty. En redraft el equipo se disuelve en enero.
  const d = construirPerfil(armarTrades(14), PLAYERS, { ...CTX, eje: 'dynasty' });
  const r = construirPerfil(armarTrades(14), PLAYERS, { ...CTX, eje: 'redraft' });
  eq('en dynasty la edad es relevante', d.edad.relevante, true);
  eq('en redraft la edad NO es relevante', r.edad.relevante, false);
  ok('pero el numero sigue ahi por si se quiere mirar', r.edad.recibida != null);
}

// ── 2d. Waiver: medido contra los rivales de su propia liga ────────────────
console.log('\nWaiver');
{
  // Catorce liga-temporadas. En todas hago mas movimientos que la mediana de
  // mis rivales. Sin comparador esto seria un numero suelto sin significado.
  const movs = [], miRoster = {}, fmt = {};
  for (let i = 0; i < 14; i++) {
    const liga = 'L' + i;
    miRoster[liga] = 1; fmt[liga] = 'dynasty';
    for (let k = 0; k < 9; k++) movs.push({ liga, temporada: '2025', roster: 1, tipo: 'waiver', puja: 30 });
    for (const r of [2, 3, 4]) for (let k = 0; k < 2; k++) movs.push({ liga, temporada: '2025', roster: r, tipo: 'waiver', puja: 5 });
  }
  const w = analizarWaivers(movs, miRoster, fmt, 'dynasty');
  const vol = w.claims.find(c => c.label === 'waiver_volumen');
  const faab = w.claims.find(c => c.label === 'waiver_faab');
  eq('cuenta mis movimientos', w.misMovimientos, 14 * 9);
  eq('cuenta las liga-temporada', w.ligasTemporada, 14);
  eq('volumen: le gano a los 42 rivales-temporada', vol.ganados, 42);
  eq('  medido sobre todos los rivales, no sobre 14 liga-temporadas', vol.n, 42);
  eq('  y lo confirma', vol.estado, 'confirmado');
  eq('FAAB: 14 veces pujando mas', faab.a + '/' + faab.b, '14/0');
  eq('mediana de mis pujas', w.pujaMediana, 30);
}
{
  // El comparador es lo que da sentido al numero: los MISMOS 9 movimientos
  // mios, pero con rivales que hacen 20, tienen que dar la respuesta contraria.
  const movs = [], miRoster = {}, fmt = {};
  for (let i = 0; i < 14; i++) {
    const liga = 'L' + i;
    miRoster[liga] = 1; fmt[liga] = 'dynasty';
    for (let k = 0; k < 9; k++) movs.push({ liga, temporada: '2025', roster: 1, tipo: 'waiver', puja: 30 });
    for (const r of [2, 3, 4]) for (let k = 0; k < 20; k++) movs.push({ liga, temporada: '2025', roster: r, tipo: 'waiver', puja: 30 });
  }
  const vol = analizarWaivers(movs, miRoster, fmt, 'dynasty').claims.find(c => c.label === 'waiver_volumen');
  eq('los mismos 9 movimientos, contra rivales activos, dan lo contrario', vol.lado, 'b');
  ok('  y el texto lo dice', /sit still/i.test(vol.texto || ''), vol.texto);
}
{
  // Una liga sin FAAB no puede convertirse en "este manager es tacano".
  const movs = [], miRoster = {}, fmt = {};
  for (let i = 0; i < 14; i++) {
    const liga = 'L' + i;
    miRoster[liga] = 1; fmt[liga] = 'dynasty';
    for (let k = 0; k < 9; k++) movs.push({ liga, temporada: '2025', roster: 1, tipo: 'waiver', puja: null });
    for (const r of [2, 3, 4]) movs.push({ liga, temporada: '2025', roster: r, tipo: 'waiver', puja: null });
  }
  const w = analizarWaivers(movs, miRoster, fmt, 'dynasty');
  const faab = w.claims.find(c => c.label === 'waiver_faab');
  eq('sin pujas en ninguna liga, el FAAB no afirma nada', faab.estado, 'insuficiente');
  eq('  y no inventa una mediana', w.pujaMediana, null);
}
{
  // El eje filtra: los movimientos de redraft no pueden contaminar dynasty.
  const movs = [], miRoster = { LD: 1, LR: 1 }, fmt = { LD: 'dynasty', LR: 'redraft' };
  for (let k = 0; k < 9; k++) movs.push({ liga: 'LD', temporada: '2025', roster: 1, tipo: 'waiver', puja: 1 });
  for (let k = 0; k < 50; k++) movs.push({ liga: 'LR', temporada: '2025', roster: 1, tipo: 'waiver', puja: 1 });
  eq('dynasty solo ve los suyos', analizarWaivers(movs, miRoster, fmt, 'dynasty').misMovimientos, 9);
  eq('redraft solo ve los suyos', analizarWaivers(movs, miRoster, fmt, 'redraft').misMovimientos, 50);
}
{
  // Empatar con la mediana no es una tendencia y no puede contarse a un lado.
  const movs = [], miRoster = {}, fmt = {};
  for (let i = 0; i < 14; i++) {
    const liga = 'L' + i;
    miRoster[liga] = 1; fmt[liga] = 'dynasty';
    for (const r of [1, 2, 3, 4]) for (let k = 0; k < 5; k++) movs.push({ liga, temporada: '2025', roster: r, tipo: 'waiver', puja: null });
  }
  const vol = analizarWaivers(movs, miRoster, fmt, 'dynasty').claims.find(c => c.label === 'waiver_volumen');
  // Todos empatados: le "gano" a la mitad de cada rival por la regla del medio
  // punto, que es exactamente no tener ninguna tendencia.
  eq('con todos empatados el marcador es la mitad justa', vol.ganados, 42 / 2);
  eq('  y no se afirma nada', vol.estado, 'sin_senal');
}
{
  // El waiver entra en la MISMA familia de BH, no en una aparte.
  const movs = [];
  for (let i = 0; i < 14; i++) {
    for (let k = 0; k < 9; k++) movs.push({ liga: 'LSF', temporada: '20' + (10 + i), roster: 1, tipo: 'waiver', puja: 30 });
    for (const r of [2, 3, 4]) movs.push({ liga: 'LSF', temporada: '20' + (10 + i), roster: r, tipo: 'waiver', puja: 5 });
  }
  const p = construirPerfil(armarTrades(14), PLAYERS, { ...CTX, eje: 'dynasty', movimientos: movs, formatoPorLiga: { LSF: 'dynasty', L1QB: 'dynasty' } });
  ok('las afirmaciones de waiver llegan al perfil',
    p.afirmaciones.some(a => a.label === 'waiver_volumen'));
  ok('y cuentan en el denominador que ve el usuario', p.muestra.patronesEvaluados >= 7);
  eq('el bloque de waiver va en la salida', p.waiver.misMovimientos, 14 * 9);
}

{
  // Los empates son el caso NORMAL en una liga (media docena de managers hacen
  // el mismo par de movimientos), asi que la regla del medio punto tiene que
  // estar bien: si un empate contara entero a mi favor, no mover una ficha en
  // toda la temporada saldria como "trabajas el wire".
  const repartos = [];
  for (let i = 0; i < 10; i++) repartos.push({ mio: 4, otros: [4, 4, 4, 4] });
  const v = volumenWaiver(repartos, 12345);
  eq('con todo empatado el estadistico es exactamente la mitad', v.ganados, 20);
  ok('y el azar no puede distinguirlo del ruido', v.estado !== 'confirmado', 'p=' + v.p);
}
{
  // Mismo dato, misma p: el test va sembrado como el de socios.
  const repartos = [];
  for (let i = 0; i < 10; i++) repartos.push({ mio: 9, otros: [2, 3, 1, 4] });
  eq('la p del waiver no se mueve entre corridas',
    volumenWaiver(repartos, 999).p, volumenWaiver(repartos, 999).p);
  // Y es de dos colas: ser el MAS pasivo de la liga tambien es un rasgo.
  const alReves = repartos.map(r => ({ mio: 0, otros: [9, 8, 7, 6] }));
  const v = volumenWaiver(alReves, 999);
  eq('quedarse quieto tambien se detecta', v.lado, 'b');
  ok('  y se confirma igual que lo contrario', v.estado === 'confirmado', 'p=' + v.p);
}
{
  // Sin rivales suficientes no se afirma: tres liga-temporadas de dos rivales
  // no son una muestra por mucho que el patron parezca limpio.
  const v = volumenWaiver([{ mio: 9, otros: [1] }, { mio: 9, otros: [1] }], 1);
  eq('con muy pocos rivales no afirma', v.estado, 'insuficiente');
}

// ── 2e. Draft: que clase de drafter eres ───────────────────────────────────
console.log('\nDraft');
{
  // Doce drafts. Yo tomo 3 RB en las primeras cuatro rondas, mis rivales 0.
  const picks = [], miRoster = {}, fmt = {};
  for (let i = 0; i < 12; i++) {
    const liga = 'L' + i;
    miRoster[liga] = 1; fmt[liga] = 'dynasty';
    for (let r = 1; r <= 4; r++) picks.push({ liga, temporada: '2025', roster: 1, ronda: r, pos: r <= 3 ? 'RB' : 'WR' });
    for (const rv of [2, 3, 4]) for (let r = 1; r <= 4; r++) picks.push({ liga, temporada: '2025', roster: rv, ronda: r, pos: 'WR' });
  }
  const d = analizarDrafts(picks, miRoster, fmt, 'dynasty');
  const c = d.claims[0];
  eq('cuenta los drafts', d.drafts, 12);
  eq('cuenta mis RB tempranos', d.misRbTempranos, 36);
  eq('le gano a los 36 rivales', c.ganados, 36);
  eq('  y lo confirma', c.estado, 'confirmado');
  ok('  y me llama constructor sobre RB', /build on running backs/i.test(c.texto || ''), c.texto);
}
{
  // El espejo: los MISMOS cero RB mios, pero con rivales que toman tres.
  const picks = [], miRoster = {}, fmt = {};
  for (let i = 0; i < 12; i++) {
    const liga = 'L' + i;
    miRoster[liga] = 1; fmt[liga] = 'dynasty';
    for (let r = 1; r <= 4; r++) picks.push({ liga, temporada: '2025', roster: 1, ronda: r, pos: 'WR' });
    for (const rv of [2, 3, 4]) for (let r = 1; r <= 4; r++) picks.push({ liga, temporada: '2025', roster: rv, ronda: r, pos: r <= 3 ? 'RB' : 'WR' });
  }
  const c = analizarDrafts(picks, miRoster, fmt, 'dynasty').claims[0];
  eq('sin RB tempranos sale por el otro lado', c.lado, 'b');
  ok('  y me llama zero-RB', /zero-RB/i.test(c.texto || ''), c.texto);
  eq('  y tambien se confirma', c.estado, 'confirmado');
}
{
  // Un rival que tomo CERO RB tempranos tiene que seguir en el denominador: si
  // solo contaran los que tomaron alguno, nadie podria salir por abajo nunca.
  const picks = [], miRoster = { L: 1 }, fmt = { L: 'dynasty' };
  for (let r = 1; r <= 4; r++) picks.push({ liga: 'L', temporada: '2025', roster: 1, ronda: r, pos: 'RB' });
  for (const rv of [2, 3]) for (let r = 1; r <= 4; r++) picks.push({ liga: 'L', temporada: '2025', roster: rv, ronda: r, pos: 'WR' });
  const d = analizarDrafts(picks, miRoster, fmt, 'dynasty');
  eq('el rival de cero RB cuenta igual', d.claims[0].n, 2);
}
{
  // Solo las rondas tempranas. Un RB en la ronda 12 no dice nada del plan.
  const picks = [], miRoster = { L: 1 }, fmt = { L: 'dynasty' };
  picks.push({ liga: 'L', temporada: '2025', roster: 1, ronda: 12, pos: 'RB' });
  for (const rv of [2, 3]) picks.push({ liga: 'L', temporada: '2025', roster: rv, ronda: 12, pos: 'WR' });
  eq('las rondas tardias no entran', analizarDrafts(picks, miRoster, fmt, 'dynasty').drafts, 0);
}
{
  // El eje filtra tambien aqui.
  const picks = [], miRoster = { LD: 1, LR: 1 }, fmt = { LD: 'dynasty', LR: 'redraft' };
  for (let r = 1; r <= 4; r++) picks.push({ liga: 'LD', temporada: '2025', roster: 1, ronda: r, pos: 'RB' });
  for (let r = 1; r <= 4; r++) picks.push({ liga: 'LR', temporada: '2025', roster: 1, ronda: r, pos: 'RB' });
  eq('dynasty solo ve su draft', analizarDrafts(picks, miRoster, fmt, 'dynasty').drafts, 1);
  eq('redraft solo ve el suyo', analizarDrafts(picks, miRoster, fmt, 'redraft').drafts, 1);
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
