'use strict';
// Self-scouting: what your own trade history says about how you play.
//
// The product already profiles your RIVALS (manager archetypes, league
// personalities). This is the same lens turned inward. The whole feature lives
// or dies on one rule: it may only say what the data supports. A profile that
// calls you a panic seller off three trades is astrology, and it would burn the
// credibility of the parts of the product that are actually solid.
//
// So every claim carries its sample size, and a claim that cannot clear its
// threshold is NOT emitted - the caller is told "not enough yet" instead.
//
// Pure module on purpose: no network, no DOM, no clock. Feed it transactions
// and a player map, get metrics back. That is what makes it testable offline
// against a hand-computed baseline.

const { ejeDeDosLados } = require('./formato');

// ── Significance ───────────────────────────────────────────────────────────
// Below a dozen observations a proportion is barely an estimate: the 95% Wald
// half-width at p=0.5 is 0.98/sqrt(n), which at n=12 is still +-28 points. Any
// "tendency" we could describe is narrower than that, so under 12 we stay quiet.
const MIN_N = 12;
// Two-sided binomial tail against a fair split, then corrected for the fact that
// we run several tests on the same person.
//
// Monte Carlo, 200k runs of PURE NOISE at the real sample sizes, measuring how
// often the tab would state something anyway:
//   fixed 0.05 + a "leaning" tier at 0.20 ... 52.5%   <- what this had
//   fixed 0.05 alone ......................... 11.9%
//   Benjamini-Hochberg q = 0.10 ..............  6.7%
//   Holm-Bonferroni 0.05 .....................  3.5%
// The "leaning" tier was doing most of the damage, so it is gone: a hint that is
// wrong half the time is not a hint. BH over Holm because this explores several
// metrics about one person, so controlling the false DISCOVERY rate is the right
// trade; Holm is for when any single error is unacceptable, and it would also
// silence the one real signal in the data.
const P_CONFIRMED = 0.05;
const Q_FDR = 0.10;

/** Benjamini-Hochberg. Demotes every claim that does not survive the step-up. */
function aplicarFDR(claims) {
  const c = claims.filter(x => x.p != null).sort((a, b) => a.p - b.p);
  let k = 0;
  c.forEach((x, i) => { if (x.p <= ((i + 1) / c.length) * Q_FDR) k = i + 1; });
  c.forEach((x, i) => { if (i >= k) x.estado = 'sin_senal'; });
  // El candado va aparte y al final, sobre TODAS: una afirmacion que no quedo
  // confirmada no puede salir de aqui con su frase puesta.
  //
  // El paso de arriba solo miraba a las que caen fuera del prefijo del step-up,
  // asi que una p de 0.06 en buena compania sobrevivia marcada "sin senal" y con
  // el texto entero. Hoy la pantalla filtra por estado y no la pinta, pero esa
  // es una garantia que vive en la otra punta del proyecto: aqui basta que
  // alguien escriba `a.texto || ...` para publicar una afirmacion que el propio
  // motor rechazo. El unico sitio donde el candado no se olvida es este.
  claims.forEach(x => { if (x.estado !== 'confirmado') delete x.texto; });
  return claims;
}

function logFactorial(n) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}
/** Two-sided binomial p-value for k successes in n trials against p=0.5. */
function binomP(k, n) {
  if (!n) return 1;
  const lf = logFactorial;
  const pmf = (i) => Math.exp(lf(n) - lf(i) - lf(n - i) - n * Math.LN2);
  const target = pmf(k) * 1.0000001; // tolerance so the mirror case counts itself
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= target) p += pmf(i);
  return Math.min(1, p);
}

/**
 * Wraps a split into a claim the UI can trust.
 * Returns null when the sample cannot support saying anything, which is the
 * point: the caller renders "not enough data yet", never a guess.
 */
function claim(label, a, b, textos) {
  const n = a + b;
  if (n < MIN_N) return { label, n, estado: 'insuficiente', falta: MIN_N - n };
  const p = binomP(Math.max(a, b), n);
  // Redondear a tres decimales convertia en "p=0" cualquier reparto limpio a
  // partir de n=16 (2*0.5^16 = 0.0000305). Un cero ahi no se lee como "muy
  // improbable", se lee como "imposible por azar", que es justo la clase de
  // exageracion que este modulo entero existe para no cometer. Se guarda con
  // precision suficiente y se marca el piso para que la pantalla escriba
  // "menor que", igual que ya hacia concentracionSocios() al otro lado del
  // archivo: el mismo problema tenia el arreglo escrito y sin propagar.
  const PISO = 0.001;
  return {
    label,
    n, a, b,
    p: p < PISO ? +p.toPrecision(2) : +p.toFixed(3),
    pEsPiso: p < PISO, pPiso: PISO,
    estado: p <= P_CONFIRMED ? 'confirmado' : 'sin_senal',
    lado: a >= b ? 'a' : 'b',
    texto: (a >= b ? textos.a : textos.b)
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
const POS = ['QB', 'RB', 'WR', 'TE'];
// Orden fijo, no el de insercion de un objeto: la lista de afirmaciones se
// dibuja en pantalla y no puede reordenarse segun en que liga cayo el primer
// trade. Un formato sin un solo trade no genera fila.
const FORMATOS = ['superflex', '1qb'];
const ETIQUETA_FORMATO = { superflex: 'in superflex', '1qb': 'in one-QB leagues' };
// Union with the player master ALWAYS by id. Sleeper keeps every player in its
// history, so 215 names have a namesake: matching by name hands you a retired
// linebacker wearing a star receiver's stats. This bit already bit the project
// twice today, in the draft board and in Mac's own grounding block.
// Acepta las dos formas del maestro: el dump completo trae `position`, y el
// endpoint slim que sirve el propio proyecto NO lo expone, solo
// `fantasy_positions`. Leer solo `position` hacia que con el slim todo cayera en
// 'otro' SIN LANZAR: el tab decia "no te conozco lo suficiente" teniendo 15
// movimientos de QB. Un fallo silencioso es el peor modo posible aqui.
// Verificado: fantasy_positions[0] === position en los 59 jugadores de la
// muestra, 0 discrepancias.
const posDe = (players, pid) => {
  const p = players && players[String(pid)];
  const pos = p && ((p.fantasy_positions && p.fantasy_positions[0]) || p.position);
  return POS.includes(pos) ? pos : 'otro';
};

/**
 * Age the player actually was on the day of the trade.
 *
 * Se calcula desde `birth_date`, no desde `age`. Sleeper CONGELA `age` el dia
 * que deja de actualizar a un jugador, asi que para el que ya no esta vigente
 * queda parada en el ano de su retiro: Matt Ryan figura con 37 habiendo nacido
 * en 1985. Medido sobre el maestro completo del 2026-08-24, entre los 939
 * jugadores de posicion CON equipo la `age` acierta en 890 y se desvia hasta 9
 * anos en 49. Retroceder temporadas enteras desde ese numero no corregia el
 * error, lo arrastraba, y encima anadia hasta un ano propio de redondeo.
 *
 * El sesgo no era neutro: los congelados son los veteranos, que caen sobre todo
 * del lado que uno VENDE, justo el lado que define el delta de edad.
 *
 * `birth_date` cubre 939 de los 997 jugadores de posicion con equipo. Para el
 * resto se conserva el camino viejo, y la salida DECLARA cuantas edades vinieron
 * por ahi para que la pantalla no presente una estimacion como una medicion.
 *
 * @returns {{edad:number, exacta:boolean}|null}
 */
function edadEnFecha(players, pid, ts, temporadaActual) {
  const p = players && players[String(pid)];
  if (!p) return null;
  if (p.birth_date && ts) {
    const nace = new Date(String(p.birth_date) + 'T00:00:00Z');
    const dia = new Date(ts);
    if (!isNaN(nace.getTime()) && !isNaN(dia.getTime())) {
      let a = dia.getUTCFullYear() - nace.getUTCFullYear();
      const m = dia.getUTCMonth() - nace.getUTCMonth();
      // El cumpleanos que aun no llego ese ano resta uno. Sin esto, un trade de
      // enero envejece medio vestuario en doce meses de golpe.
      if (m < 0 || (m === 0 && dia.getUTCDate() < nace.getUTCDate())) a--;
      // Cota de cordura: una fecha corrupta no debe entrar al promedio.
      if (a >= 15 && a < 70) return { edad: a, exacta: true };
    }
  }
  if (p.age == null) return null;
  const anio = new Date(ts).getUTCFullYear();
  const atras = Math.max(0, Number(temporadaActual) - anio);
  return { edad: p.age - atras, exacta: false };
}

/**
 * Is your favourite trade partner a real preference, or just what 39 deals in
 * small leagues look like?
 *
 * Not a binomial: the chances are not uniform. In a 10-team league there are 9
 * possible partners, in a 12-team one there are 11, so concentration happens by
 * accident more often in small rooms. The null model shuffles each trade among
 * the rivals OF ITS OWN LEAGUE and asks how often the top partner reaches what
 * you actually did.
 *
 * Seeded on purpose. A p-value that moves between page loads is the same defect
 * as a trade that scores 91% once and 85% the next time: same input, same
 * number, always.
 */
function concentracionSocios(porTrade, semilla, corridas) {
  const obs = {};
  porTrade.forEach(t => (t.socios || []).forEach(q => { obs[q] = (obs[q] || 0) + 1; }));
  const maxObs = Object.keys(obs).length ? Math.max(...Object.values(obs)) : 0;
  const distintos = Object.keys(obs).length;
  if (porTrade.length < MIN_N || maxObs < 2) {
    return { label: 'socios', n: porTrade.length, estado: 'insuficiente', falta: Math.max(0, MIN_N - porTrade.length), maxObs, distintos };
  }
  let x = (semilla >>> 0) || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const N = corridas || 20000;
  let alMenos = 0;
  for (let i = 0; i < N; i++) {
    const c = {};
    let m = 0;
    for (const t of porTrade) {
      const riv = t.rivales || [];
      if (!riv.length) continue;
      const q = riv[Math.floor(rnd() * riv.length)];
      c[q] = (c[q] || 0) + 1;
      if (c[q] > m) m = c[q];
    }
    if (m >= maxObs) alMenos++;
  }
  // Estimador conservador (+1 arriba y abajo): nunca devuelve 0, porque "cero de
  // veinte mil" es un limite de la simulacion, no una imposibilidad. Se guarda
  // con precision suficiente para no colapsar a 0 al redondear, y se marca el
  // piso para que el tab pueda escribir "menor que" en vez de un cero falso.
  const p = (alMenos + 1) / (N + 1);
  const piso = 1 / (N + 1);
  return {
    label: 'socios', n: porTrade.length, maxObs, distintos,
    p: +p.toPrecision(2), pEsPiso: p <= piso * 1.0001, pPiso: +piso.toPrecision(2),
    estado: p <= P_CONFIRMED ? 'confirmado' : 'sin_senal',
    texto: 'You have a regular counterparty: ' + maxObs + ' of your ' + porTrade.length
      + ' trades are with the same person. That is not how randomness distributes.'
  };
}

/**
 * A cuantos rivales le ganas en movimientos de waiver, y si eso es mucho.
 *
 * No es un binomio sobre liga-temporadas. Ese fue el primer intento y estaba
 * mal medido: con doce liga-temporadas el umbral no se alcanza ni con un patron
 * evidente, y el tab se quedaba mudo teniendo 239 movimientos leidos. El
 * problema no era el dato, era la unidad.
 *
 * Aqui el estadistico usa a TODOS los rivales: cuantos de ellos hicieron menos
 * movimientos que yo, sumado sobre todas mis liga-temporadas. La hipotesis nula
 * es que dentro de cada liga-temporada da igual cual de los rosters soy yo, asi
 * que se baraja quien es "yo" y se mira cuantas veces el azar alcanza lo que
 * hice. Mismo esqueleto que el test de socios, por la misma razon: las
 * probabilidades no son uniformes entre ligas de distinto tamano.
 *
 * Sembrado, como el otro: el mismo historial tiene que dar la misma p siempre.
 */
function permutacionContraRivales(label, repartos, semilla, textos, corridas) {
  const rivales = repartos.reduce((s, r) => s + r.otros.length, 0);
  if (repartos.length < 3 || rivales < MIN_N) {
    return { label, n: rivales, estado: 'insuficiente',
      falta: Math.max(0, MIN_N - rivales), ligasTemporada: repartos.length };
  }
  // Los empates cuentan medio a cada lado: quien hizo exactamente mis
  // movimientos no es ni prueba a favor ni prueba en contra, y mandarlo entero
  // a un lado inclina el resultado.
  const gana = (yo, otros) => otros.reduce((s, o) => s + (yo > o ? 1 : yo === o ? 0.5 : 0), 0);
  const obs = repartos.reduce((s, r) => s + gana(r.mio, r.otros), 0);

  let x = (semilla >>> 0) || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const N = corridas || 20000;
  let alMenos = 0, alMenosBajo = 0;
  for (let i = 0; i < N; i++) {
    let sim = 0;
    for (const r of repartos) {
      const todos = [r.mio, ...r.otros];
      // Se saca al sorteado por su INDICE. La forma anterior lo buscaba por
      // valor con indexOf, lo que da el mismo resultado (quitar cualquier
      // elemento de igual valor deja el mismo multiconjunto, comprobado: p
      // identica sobre el mismo dato), pero obliga a razonar sobre empates para
      // convencerse. Por indice es correcto de un vistazo.
      const j = Math.floor(rnd() * todos.length);
      sim += gana(todos[j], todos.filter((_, k) => k !== j));
    }
    if (sim >= obs) alMenos++;
    if (sim <= obs) alMenosBajo++;
  }
  // Dos colas: trabajar el wire mucho MENOS que la liga tambien es un rasgo.
  const piso = 1 / (N + 1);
  const p = Math.min(1, 2 * Math.min((alMenos + 1) / (N + 1), (alMenosBajo + 1) / (N + 1)));
  const arriba = obs > rivales / 2;
  return {
    label, n: rivales, ligasTemporada: repartos.length,
    ganados: +obs.toFixed(1),
    p: +p.toPrecision(2), pEsPiso: p <= piso * 2.0001, pPiso: +(piso * 2).toPrecision(2),
    estado: p <= P_CONFIRMED ? 'confirmado' : 'sin_senal',
    lado: arriba ? 'a' : 'b',
    texto: (arriba ? textos.a : textos.b)(Math.round(obs), rivales)
  };
}

/** Volumen de waiver: el mismo test, con las palabras de su pregunta. */
const volumenWaiver = (repartos, semilla, corridas) => permutacionContraRivales(
  'waiver_volumen', repartos, semilla, {
    a: (g, n) => 'You work the wire. You out-move ' + g + ' of the ' + n
      + ' rival manager-seasons you have played against.',
    b: (g, n) => 'You sit still on the wire. You out-move only ' + g + ' of the ' + n
      + ' rival manager-seasons you have played against.'
  }, corridas);

/**
 * Que clase de drafter eres, dicho por tus drafts y no por tu opinion.
 *
 * El producto YA clasifica a sus bots en arquetipos (zerorb, robustrb: viven en
 * scripts/calibrate-room.mjs y se comprueban en cada gate) y nunca le habia
 * dicho al dueno cual es EL. Esto lo mide sobre sus drafts reales.
 *
 * La ventana son las rondas 1 a 4. Ahi es donde se toma la decision estructural
 * del equipo: quien va a cargar el backfield y quien los receptores. De la 5 en
 * adelante ya se draftea por techo y por hueco, y meterlo diluiria justo la
 * senal que se busca.
 *
 * El comparador vuelven a ser los rivales DE ESE MISMO DRAFT: cuantos RB
 * tempranos son muchos depende del formato, del tamano de la liga y del ano, y
 * los rivales de la sala controlan las tres cosas de una vez sin tener que
 * modelarlas.
 */
const RONDAS_TEMPRANAS = 4;
const draftRbTemprano = (repartos, semilla, corridas) => permutacionContraRivales(
  'draft_rb_temprano', repartos, semilla, {
    a: (g, n) => 'You build on running backs. In the first four rounds you take more of them than '
      + g + ' of the ' + n + ' rival drafters you have sat across from.',
    b: (g, n) => 'You are a zero-RB drafter. In the first four rounds you take fewer running backs than '
      + (n - g) + ' of the ' + n + ' rival drafters you have sat across from.'
  }, corridas);

/**
 * @param {Array} picks  [{ liga, temporada, roster, ronda, pos }]
 */
function analizarDrafts(picks, miRosterPorLiga, formatoPorLiga, eje) {
  const porDraft = {};
  for (const k of picks || []) {
    const fmt = formatoPorLiga[k.liga] || 'redraft';
    if (eje && ejeDeDosLados(fmt) !== eje) continue;
    if (k.ronda > RONDAS_TEMPRANAS) continue;
    (porDraft[k.liga + ':' + k.temporada] = porDraft[k.liga + ':' + k.temporada] || []).push(k);
  }
  const repartos = [];
  let misRb = 0, misPicks = 0, drafts = 0;
  for (const [key, ks] of Object.entries(porDraft)) {
    const mio = miRosterPorLiga[key.split(':')[0]];
    if (!mio) continue;
    const rb = {};
    // Todo roster que aparezca en el draft cuenta, aunque tomara CERO RB
    // tempranos: si solo se contaran los que tomaron alguno, el zero-RB
    // desapareceria del denominador y nadie podria salir por abajo.
    ks.forEach(k => { rb[k.roster] = rb[k.roster] || 0; if (k.pos === 'RB') rb[k.roster]++; });
    if (!(mio in rb)) continue;
    drafts++;
    misRb += rb[mio];
    misPicks += ks.filter(k => k.roster === mio).length;
    const otros = Object.entries(rb).filter(([r]) => Number(r) !== mio).map(([, n]) => n);
    if (otros.length >= 2) repartos.push({ mio: rb[mio], otros });
  }
  return {
    drafts, misRbTempranos: misRb, misPicksTempranos: misPicks,
    claims: [draftRbTemprano(repartos, misRb * 7919 + drafts)]
  };
}

/**
 * Como trabajas el waiver, medido contra LOS RIVALES DE TU PROPIA LIGA.
 *
 * El punto entero esta en el comparador. "Haces 40 movimientos al ano" no
 * significa nada suelto: en una liga de 14 con FAAB agresivo eso es poco y en
 * una liga tranquila de amigos es una barbaridad. Y un promedio global tampoco
 * sirve, porque mezcla ligas con reglas distintas. Asi que la unidad de
 * observacion es LA LIGA-TEMPORADA: en cada una se pregunta una sola cosa,
 * "estuve por encima de la mediana de mi liga, si o no", y eso es un binomio
 * limpio que entra en la misma maquinaria de significancia que el resto.
 *
 * Comparar contra la mediana y no contra la media es deliberado: un solo manager
 * obsesivo que hace 200 movimientos arrastra la media y hace que todos los demas
 * parezcan pasivos.
 *
 * El dato salio gratis: la ruta ya bajaba las semanas enteras para los trades y
 * tiraba todo lo demas, incluidos los movimientos de los rivales, que son
 * precisamente los que hacen comparable el numero.
 */
function analizarWaivers(movimientos, miRosterPorLiga, formatoPorLiga, eje) {
  const porLigaTemporada = {};
  for (const m of movimientos || []) {
    const fmt = formatoPorLiga[m.liga] || 'redraft';
    if (eje && ejeDeDosLados(fmt) !== eje) continue;
    const k = m.liga + ':' + m.temporada;
    (porLigaTemporada[k] = porLigaTemporada[k] || []).push(m);
  }

  const mediana = (a) => {
    if (!a.length) return null;
    const o = [...a].sort((x, y) => x - y), h = o.length >> 1;
    return o.length % 2 ? o[h] : (o[h - 1] + o[h]) / 2;
  };

  let misMovs = 0;
  let pujaArriba = 0, pujaAbajo = 0;
  const misPujas = [];
  // Cada liga-temporada aporta el reparto COMPLETO de movimientos entre sus
  // rosters. Guardarlo entero (y no solo un "estuve arriba, si o no") es lo que
  // permite despues un test de permutacion en vez de doce monedas: con 12
  // liga-temporadas un binomio no llega al umbral ni aunque el patron sea
  // brutal, y quedarse callado por elegir mal la unidad de medida no es
  // prudencia, es desperdiciar el dato.
  const repartos = [];

  for (const [k, movs] of Object.entries(porLigaTemporada)) {
    const liga = k.split(':')[0];
    const mio = miRosterPorLiga[liga];
    if (!mio) continue;

    // Volumen: cuantos movimientos hizo cada roster de la liga esa temporada.
    const porRoster = {};
    movs.forEach(m => { porRoster[m.roster] = (porRoster[m.roster] || 0) + 1; });
    const mios = porRoster[mio] || 0;
    misMovs += mios;
    // Un roster sin NINGUN movimiento tambien cuenta como cero: excluirlo
    // subiria la mediana y me haria parecer mas activo de lo que soy. Pero solo
    // se conocen los rosters que aparecen, asi que la mediana se toma sobre los
    // que hay y se compara contra ella sin fingir que se conoce a los ausentes.
    const otros = Object.entries(porRoster).filter(([r]) => Number(r) !== mio).map(([, n]) => n);
    if (otros.length >= 2) repartos.push({ mio: mios, otros });

    // FAAB: solo entre los que de verdad pujaron dinero. Un waiver sin puja (una
    // liga por orden inverso) no dice nada sobre agresividad y meterlo como cero
    // convertiria "esta liga no usa FAAB" en "este manager es tacano".
    const conPuja = movs.filter(m => typeof m.puja === 'number' && m.puja > 0);
    const misConPuja = conPuja.filter(m => m.roster === mio).map(m => m.puja);
    const otrosPuja = conPuja.filter(m => m.roster !== mio).map(m => m.puja);
    if (misConPuja.length && otrosPuja.length >= 3) {
      misPujas.push(...misConPuja);
      const medMia = mediana(misConPuja), medOtros = mediana(otrosPuja);
      if (medMia > medOtros) pujaArriba++; else if (medMia < medOtros) pujaAbajo++;
    }
  }

  return {
    misMovimientos: misMovs,
    ligasTemporada: Object.keys(porLigaTemporada).length,
    pujaMediana: misPujas.length ? mediana(misPujas) : null,
    nPujas: misPujas.length,
    claims: [
      volumenWaiver(repartos, misMovs * 7919 + repartos.length),
      claim('waiver_faab', pujaArriba, pujaAbajo, {
        a: 'You pay up on waivers: your bids run above what the rest of your league pays.',
        b: 'You bargain hunt on waivers: your bids run below what the rest of your league pays.'
      })
    ]
  };
}

/**
 * @param {Array} trades  [{ created, creator, roster_ids, adds, draft_picks, _liga }]
 * @param {Object} players  Sleeper player master, keyed by id
 * @param {Object} ctx  { miRosterPorLiga, miUserId, temporadaActual }
 */
function construirPerfil(trades, players, ctx) {
  const { miRosterPorLiga = {}, miUserId = '', temporadaActual = 2026, eje = null,
    movimientos = [], formatoPorLiga = {}, picksDraft = [] } = ctx || {};
  const recibido = { QB: 0, RB: 0, WR: 0, TE: 0, otro: 0 };
  const enviado = { QB: 0, RB: 0, WR: 0, TE: 0, otro: 0 };
  const porFormato = {}; // 1qb / superflex -> { qbRecibido, qbEnviado }
  let picksRecibidos = 0, picksEnviados = 0;
  let inicio = 0, respuesta = 0;
  const edadesR = [], edadesE = [];
  let edadAprox = 0; // edades que salieron del respaldo, NUNCA en silencio
  const contrapartes = {};
  const fechas = [];
  const porTrade = []; // { socios, rivales } para el test de permutacion
  let usados = 0;
  let sinPosicion = 0; // jugadores que no resolvieron a posicion: NUNCA en silencio
  let sinDueno = 0;    // rosters sin dueno resuelto: idem

  for (const t of trades || []) {
    const mio = miRosterPorLiga[t._liga];
    if (!mio || !(t.roster_ids || []).includes(mio)) continue;
    usados++;
    if (t.created) fechas.push(t.created);

    // Who put the deal on the table. Sleeper's `creator` is a user id, so it is
    // compared against the user id, never against a roster id.
    if (t.creator) (String(t.creator) === String(miUserId) ? inicio++ : respuesta++);

    // Counterparties are counted per PERSON, not per roster. The same friend can
    // own a roster in three of your leagues, and "who do you keep dealing with"
    // is a question about the human. Keying by league:roster split one partner
    // into three and hid the tendency completely.
    const socios = [];
    for (const rid of (t.roster_ids || [])) {
      if (rid === mio) continue;
      // Sin dueno resuelto NO se cae a liga:roster en silencio: eso es
      // exactamente el bug que partia a una persona en tres. Se cuenta aparte y
      // el tab lo puede declarar.
      const dueno = t._duenoPorRoster && t._duenoPorRoster[rid];
      if (!dueno) { sinDueno++; continue; }
      const quien = dueno;
      contrapartes[quien] = (contrapartes[quien] || 0) + 1;
      socios.push(quien);
    }
    // Los rivales posibles de ESTA liga son el universo del que se sortea bajo
    // la hipotesis nula. Sin ellos, el test de concentracion no sabe si nueve
    // trades con la misma persona es mucho o es que solo habia nueve personas.
    const rivales = Object.entries(t._duenoPorRoster || {})
      .filter(([rid]) => Number(rid) !== mio).map(([, quien]) => quien);
    porTrade.push({ socios, rivales });

    const fmt = t._superflex ? 'superflex' : '1qb';
    porFormato[fmt] = porFormato[fmt] || { qbRecibido: 0, qbEnviado: 0, trades: 0 };
    porFormato[fmt].trades++;

    // Recibido sale de `adds` hacia mi. Enviado sale de `drops` DESDE mi, no del
    // else de adds: en un trade de tres equipos, un `add` que va a otro roster
    // puede ser un jugador de un tercero que nunca estuvo en el mio, y contarlo
    // como enviado me atribuye una decision que no tome. Hoy no hay trades de
    // tres en la muestra y ambos caminos coinciden (47 y 47), pero el dia que
    // haga uno el numero se ensucia solo.
    for (const [pid, rid] of Object.entries(t.adds || {})) {
      if (rid !== mio) continue;
      const pos = posDe(players, pid);
      if (pos === 'otro') sinPosicion++;
      const edad = edadEnFecha(players, pid, t.created, temporadaActual);
      recibido[pos]++;
      if (edad) { edadesR.push(edad.edad); if (!edad.exacta) edadAprox++; }
      if (pos === 'QB') porFormato[fmt].qbRecibido++;
    }
    for (const [pid, rid] of Object.entries(t.drops || {})) {
      if (rid !== mio) continue;
      const pos = posDe(players, pid);
      if (pos === 'otro') sinPosicion++;
      const edad = edadEnFecha(players, pid, t.created, temporadaActual);
      enviado[pos]++;
      if (edad) { edadesE.push(edad.edad); if (!edad.exacta) edadAprox++; }
      if (pos === 'QB') porFormato[fmt].qbEnviado++;
    }

    for (const dp of (t.draft_picks || [])) {
      // owner_id / previous_owner_id are ROSTER ids in this payload, not users.
      if (dp.owner_id === mio) picksRecibidos++;
      else if (dp.previous_owner_id === mio) picksEnviados++;
    }
  }

  // El waiver entra en la MISMA familia de correccion que el resto: son mas
  // preguntas sobre la misma persona, y no corregirlas juntas seria exactamente
  // la trampa que Benjamini-Hochberg esta aqui para tapar.
  const waivers = analizarWaivers(movimientos, miRosterPorLiga, formatoPorLiga, eje);
  const drafts = analizarDrafts(picksDraft, miRosterPorLiga, formatoPorLiga, eje);

  const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const edadR = media(edadesR), edadE = media(edadesE);

  // Un pick NO significa lo mismo en los dos formatos, asi que no puede
  // describirse con las mismas palabras. En dynasty un pick es futuro: lo
  // acumulas para construir. En redraft el pick es del draft de ESTA
  // temporada, que se celebra en agosto y se acaba: acumularlos es moverte
  // dentro de ese draft, no guardar nada para despues. "You bank the future" en
  // una liga que termina en enero no describe nada.
  //
  // El proyecto ya tenia esta regla escrita para Mac ("a redraft league gets
  // zero dynasty talk", server/routes/sage.js) y el perfil se la saltaba.
  const esRedraft = eje === 'redraft';
  const afirmaciones = [
    claim('picks', picksRecibidos, picksEnviados, esRedraft ? {
      a: 'You buy draft capital: you move up in the draft more often than down.',
      b: 'You sell draft capital: you move down in the draft more often than up.'
    } : {
      a: 'You bank the future: more picks come in than go out.',
      b: 'You spend the future: more picks go out than come in.'
    }),
    claim('iniciativa', inicio, respuesta, {
      a: 'You open the table. The deals are yours to propose, not to answer.',
      b: 'You answer. The offer almost always arrives already made.'
    }),
    // Los QB van SEPARADOS por formato, nunca sumados. En superflex el QB es el
    // activo mas caro del tablero y en una liga de un solo QB es casi relleno,
    // asi que comprar uno en cada sitio no es la misma decision: es la contraria.
    // Sumarlos hace que un dueno que acumula QB en superflex y los suelta en
    // 1QB de exactamente el mismo tamano de muestra de 50/50, y el tab declare
    // que no tiene ninguna tendencia teniendo las dos. Solo se puede hacer
    // ahora que la deteccion de superflex mira los slots de QB de verdad y no
    // el nombre del slot.
    ...FORMATOS.filter(fmt => porFormato[fmt]).map(fmt => claim('qb_' + fmt,
      porFormato[fmt].qbRecibido, porFormato[fmt].qbEnviado, {
        a: 'You buy quarterbacks ' + ETIQUETA_FORMATO[fmt] + '.',
        b: 'You sell quarterbacks ' + ETIQUETA_FORMATO[fmt] + '.'
      })),
    claim('cuerpos', Object.values(recibido).reduce((s, x) => s + x, 0),
      Object.values(enviado).reduce((s, x) => s + x, 0), {
      a: 'You consolidate: more bodies in than out.',
      b: 'You spread: more bodies out than in.'
    }),
    // Semilla derivada del propio dato: mismo historial, misma p, siempre.
    concentracionSocios(porTrade, usados * 7919 + Object.keys(contrapartes).length),
    ...waivers.claims,
    ...drafts.claims
  ];
  aplicarFDR(afirmaciones);

  const salida = {
    // sinPosicion > 0 significa que el mapa de jugadores no traia posiciones. El
    // tab debe NEGARSE a dibujar el bloque posicional en ese caso en vez de
    // ensenar ceros que parecen "no hay datos".
    muestra: {
      tradesPropios: usados, conFecha: fechas.length, sinPosicion, sinDueno,
      patronesEvaluados: 0, patronesEmitidos: 0
    },
    flujo: { recibido, enviado, picksRecibidos, picksEnviados },
    iniciativa: { inicio, respuesta },
    // Averages carry their own n so the UI can refuse to draw a conclusion from
    // a handful of players, and the delta is what matters, not the absolute.
    edad: {
      recibida: edadR == null ? null : +edadR.toFixed(1), nRecibida: edadesR.length,
      enviada: edadE == null ? null : +edadE.toFixed(1), nEnviada: edadesE.length,
      delta: (edadR == null || edadE == null) ? null : +(edadR - edadE).toFixed(1),
      // La nota cambia con el dato: si todo salio de birth_date es una medicion
      // y se dice como tal; si algo cayo al respaldo se dice cuanto.
      nAprox: edadAprox,
      // En redraft la edad no dice nada: el equipo se disuelve en enero, asi que
      // un jugador de 23 y uno de 30 valen por lo que hagan ESTE domingo. El tab
      // no debe pintar el bloque de edad de ese lado. La regla ya existia para
      // Mac ("age is irrelevant in redraft"); aqui se hace explicita en el dato
      // para que la pantalla no tenga que volver a decidirlo.
      relevante: eje !== 'redraft',
      nota: edadAprox
        ? ('Age on the day of each trade, from date of birth. ' + edadAprox
           + ' of ' + (edadesR.length + edadesE.length)
           + ' players had no date on file and were estimated by season instead.')
        : 'Age on the day of each trade, from each player\'s date of birth.'
    },
    waiver: {
      misMovimientos: waivers.misMovimientos,
      ligasTemporada: waivers.ligasTemporada,
      pujaMediana: waivers.pujaMediana,
      nPujas: waivers.nPujas
    },
    draft: {
      drafts: drafts.drafts,
      rbTempranos: drafts.misRbTempranos,
      picksTempranos: drafts.misPicksTempranos
    },
    contrapartes: {
      distintas: Object.keys(contrapartes).length,
      maxRepeticion: Object.keys(contrapartes).length ? Math.max(...Object.values(contrapartes)) : 0
    },
    porFormato,
    ritmo: fechas.length ? { primero: Math.min(...fechas), ultimo: Math.max(...fechas) } : null,
    afirmaciones: afirmaciones.filter(Boolean)
  };
  // El denominador va a pantalla: sin el, el lector no puede saber que vio el
  // filtro. "1 de 5" dice mucho mas que un hallazgo suelto.
  salida.muestra.patronesEvaluados = salida.afirmaciones.length;
  salida.muestra.patronesEmitidos = salida.afirmaciones.filter(x => x.estado === 'confirmado').length;
  return salida;
}

/**
 * El perfil PARTIDO por eje: dynasty a un lado, redraft (con keeper dentro) al
 * otro. Es lo que ven los dos tabs.
 *
 * Por que partir, y por que cuesta: acumular picks en dynasty es construir un
 * equipo; en redraft es mover fichas de una temporada que se acaba. La edad
 * manda en dynasty y no significa nada en redraft. Un perfil que promedie los
 * dos no describe a un manager, promedia a dos managers distintos. Hasta hoy el
 * motor los mezclaba.
 *
 * El precio es real y hay que decirlo: partir la muestra en dos deja a cada lado
 * mas cerca del umbral, asi que cada tab AFIRMA MENOS que el saco mezclado. Eso
 * es correcto, no una regresion: lo que el saco mezclado afirmaba de mas eran
 * conclusiones sobre un manager que no existe.
 *
 * Cada eje corre su propia familia de Benjamini-Hochberg. Es lo que toca: son
 * preguntas distintas sobre formatos distintos, y corregirlas juntas castigaria
 * a un lado por las pruebas que se hicieron en el otro.
 */
function construirPerfiles(trades, players, ctx) {
  const { formatoPorLiga = {}, fuentePorLiga = {} } = ctx || {};
  const ejes = { dynasty: [], redraft: [] };
  for (const t of trades || []) {
    const fmt = formatoPorLiga[t._liga] || 'redraft';
    ejes[ejeDeDosLados(fmt)].push({ ...t, _formato: fmt });
  }

  const salida = {};
  for (const eje of ['dynasty', 'redraft']) {
    const p = construirPerfil(ejes[eje], players, { ...ctx, eje });
    const ligas = [...new Set(ejes[eje].map(t => t._liga))];
    // Cuantas ligas de este lado son keeper y cuantas se clasificaron
    // adivinando. Van a pantalla: agrupar keeper con redraft es una decision de
    // producto, y una liga clasificada por su nombre es una apuesta, no un dato.
    p.composicion = {
      ligas: ligas.length,
      keeper: ligas.filter(id => formatoPorLiga[id] === 'keeper').length,
      porNombre: ligas.filter(id => fuentePorLiga[id] === 'nombre').length,
      porDefecto: ligas.filter(id => fuentePorLiga[id] === 'defecto').length
    };
    salida[eje] = p;
  }
  return salida;
}

module.exports = { construirPerfil, construirPerfiles, analizarWaivers, analizarDrafts, volumenWaiver, permutacionContraRivales, RONDAS_TEMPRANAS, binomP, claim, aplicarFDR, concentracionSocios, edadEnFecha, MIN_N, P_CONFIRMED, Q_FDR };
