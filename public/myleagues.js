/* ============================================================================
   My Leagues: todas las ligas del usuario en una sola pantalla.

   Por que existe: un manager con catorce ligas hoy tiene que abrir catorce
   pantallas para saber a quien tiene, contra quien juega y como va. Esta
   pantalla junta las tres cosas y ademas cruza las ligas entre si, que es lo
   que ninguna app hace: a quien estas expuesto de verdad, y contra quien de
   los tuyos juegas este domingo.

   Vive aparte de app.js a proposito (app.js va por 17.400 lineas). No depende
   del orden de carga: si app.js todavia no llego, este modulo se hidrata solo.

   Las tres pestanas:
   - Leagues:    una tarjeta por liga, con tu record y tu duelo de la semana.
   - My Players: exposicion agregada y los conflictos de interes.
   - Odds:       tablero de casa de apuestas, linea del duelo y titulo.

   El numero del que sale TODO en Odds es la proyeccion semanal por jugador,
   reconstruida desde las lineas crudas con el reglamento de CADA liga. Media
   PPR y PPR entera no valen lo mismo, y un pase de anotacion a 6 no vale lo
   mismo que a 4: usar un solo numero para las catorce ligas seria decir
   "half PPR" y cobrar otra cosa.
   ============================================================================ */

var ML = {
  ready: false,        // datos cargados al menos una vez
  loading: false,
  err: null,
  season: '2026',
  week: 1,
  phase: 'regular',
  userId: null,
  username: (function () { try { return (localStorage.getItem('tm_username') || '').trim(); } catch (e) { return ''; } })(),
  leagues: [],         // [{id,name,teams,status,type,settings,roster_positions,scoring_settings, _hyd:{...}}]
  players: null,       // id -> {id,name,pos,team}
  props: null,         // nombre en minusculas -> {player_pass_yds, ...}
  propsAt: 0,
  proySite: null,      // id de Sleeper -> stats proyectadas (Rotowire via Sleeper)
  proySiteAt: 0,
  // La fuente de las proyecciones. 'site' = la oficial de Sleeper (la que el
  // usuario ve en su app, menos sorpresas); 'vegas' = la nuestra, reconstruida
  // de las lineas de las casas. Las DOS se precian con el reglamento de cada
  // liga. Se elige con el toggle del tablero y se recuerda.
  fuenteProy: (function () { try { return localStorage.getItem('tm_ml_proy') || 'site'; } catch (e) { return 'site'; } })(),
  sims: {},            // leagueId -> resultado de la simulacion
  tab: 'ml-leagues'
};

var ML_CACHE_KEY = 'tm_ml_cache_v1';
var ML_CACHE_MS = 15 * 60 * 1000;   // la caja manda hasta que el usuario refresque

/* ------------------------------------------------------------------ basicos */
function mlEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function mlN(n, d) { var v = Number(n); return isFinite(v) ? v.toFixed(d == null ? 1 : d) : '-'; }
function mlPct(p) { return Math.round(p * 1000) / 10; }

// Sleeper se cae a ratos y devuelve 500 sin motivo. Un tropiezo de una llamada
// no puede tumbar una pantalla que junta catorce ligas: se reintenta con espera
// creciente. Los errores del CLIENTE (400, 404) no se reintentan, porque
// repetir una peticion mal formada solo gasta tiempo.
async function mlGet(path, intentos) {
  var max = intentos == null ? 3 : intentos;
  var ultimo = null;
  for (var i = 0; i < max; i++) {
    try {
      var r = await fetch('/api/sleeper' + path);
      if (r.ok) return r.json();
      if (r.status < 500) throw new Error('Sleeper ' + r.status);
      ultimo = new Error('Sleeper ' + r.status);
    } catch (e) {
      if (/Sleeper 4/.test(e.message)) throw e;
      ultimo = e;
    }
    if (i < max - 1) await new Promise(function (x) { setTimeout(x, 400 + i * 900); });
  }
  throw ultimo || new Error('Sleeper unreachable');
}

// Concurrencia acotada: catorce ligas por tres llamadas son cuarenta y dos
// peticiones. De golpe, el navegador las encola igual y la primera tarjeta
// tarda lo mismo que la ultima; de a cuatro, la pantalla se llena por partes.
async function mlPool(items, n, fn) {
  var out = new Array(items.length), i = 0;
  async function worker() {
    while (i < items.length) {
      var k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; }
    }
  }
  var ws = []; for (var w = 0; w < Math.min(n, items.length); w++) ws.push(worker());
  await Promise.all(ws);
  return out;
}

/* -------------------------------------------------------------- el maestro */
// Reutiliza el maestro de app.js si ya esta cargado. Bajarlo dos veces son
// dos megas por gusto.
async function mlPlayersMap() {
  if (ML.players) return ML.players;
  if (typeof allPlayers !== 'undefined' && allPlayers && Object.keys(allPlayers).length > 50) {
    ML.players = allPlayers; return ML.players;
  }
  var raw = await mlGet('/players/nfl/slim').catch(function () { return null; });
  var map = {};
  if (raw) Object.keys(raw).forEach(function (id) {
    var p = raw[id]; if (!p) return;
    map[id] = {
      id: id,
      name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
      pos: (p.fantasy_positions && p.fantasy_positions[0]) || '?',
      team: p.team || 'FA',
      inj: p.injury_status || null
    };
  });
  ML.players = map;
  return map;
}

/* ------------------------------------------------------------ las proyecciones */
// Las lineas crudas. Sin ellas el tablero de Odds no se inventa nada: lo dice.
async function mlLoadProySite() {
  if (ML.proySite && Date.now() - ML.proySiteAt < 10 * 60 * 1000) return ML.proySite;
  try {
    var r = await fetch('/api/sleeper/projections/' + (ML.week || 1));
    if (!r.ok) { return ML.proySite; }
    var d = await r.json();
    if (d && d.players && Object.keys(d.players).length) {
      ML.proySite = d.players;
      ML.proySiteAt = Date.now();
      _mlImputCache = {};
    }
  } catch (e) { }
  return ML.proySite;
}

async function mlLoadProps() {
  if (ML.props && Date.now() - ML.propsAt < 6 * 3600 * 1000) return ML.props;
  // El gate inyecta esto para no depender de una API de pago ni de la red.
  if (window._ML_PROPS_FIXTURE) { ML.props = window._ML_PROPS_FIXTURE; ML.propsAt = Date.now(); return ML.props; }
  try {
    var r = await fetch('/api/odds/implied');
    if (!r.ok) { ML.props = null; return null; }   // 503 sin llave: no es un error del usuario
    var d = await r.json();
    ML.props = (d && d.props && Object.keys(d.props).length) ? d.props : null;
    ML.propsAt = Date.now();
  } catch (e) { ML.props = null; }
  return ML.props;
}

// Nombres: las casas escriben "Marvin Harrison Jr." y Sleeper "Marvin Harrison".
function mlNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/[.'`]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '')
    .replace(/\s+/g, ' ').trim();
}
var _mlPropIdx = null;
function mlPropsFor(name) {
  if (!ML.props) return null;
  if (!_mlPropIdx) {
    _mlPropIdx = {};
    Object.keys(ML.props).forEach(function (k) { _mlPropIdx[mlNorm(k)] = ML.props[k]; });
  }
  return _mlPropIdx[mlNorm(name)] || null;
}

// El reglamento de la liga, con los valores por defecto de Sleeper cuando falte.
function mlScoring(L) {
  var s = (L && L.scoring_settings) || {};
  var num = function (v, d) { var x = Number(v); return isFinite(x) ? x : d; };
  return {
    passYd: num(s.pass_yd, 0.04),
    passTd: num(s.pass_td, 4),
    rushYd: num(s.rush_yd, 0.1),
    recYd: num(s.rec_yd, 0.1),
    rec: num(s.rec, 0),
    rushTd: num(s.rush_td, 6),
    recTd: num(s.rec_td, 6),
    passInt: num(s.pass_int, -1),
    fumLost: num(s.fum_lost, -2)
  };
}

// Los pases de anotacion NO estan en las props (solo existe el "anytime TD",
// que en un QB es su anotacion corriendo). Sin esta linea todos los QB salen
// entre cuatro y ocho puntos por debajo y el tablero miente a favor de quien
// tiene un QB flojo. La tasa es la de la liga real: una anotacion de pase por
// cada ~150 yardas lanzadas.
var ML_PASS_TD_PER_YD = 1 / 150;

// K y DEF no existen ni en las props de Vegas ni en el feed de proyecciones:
// sin esto cada equipo perdia ~15 puntos (sus dos a cero) y los totales salian
// sistematicamente bajos, sobre todo en Yahoo donde la imputacion domina el
// resto. Media de la liga real, declarada: un kicker medio ronda 7.5 por
// semana y una defensa 7. Para el TOTAL del equipo, la media es el numero
// honesto cuando no hay dato que distinga.
var ML_PROJ_K = 7.5, ML_PROJ_DEF = 7.0;
// Un valor del feed que no es un numero (una cadena rara, un null que se colo
// dentro de una cuenta) sale por aqui como NaN, y un NaN dentro de un total se
// come el total entero: la tarjeta pasa de 118 puntos a "NaN" sin que nada se
// queje. Se devuelve null, que es lo que ya significa "no hay numero" y
// dispara la imputacion declarada.
function mlProjPlayer(p, sc) {
  var v = _mlProjPlayer(p, sc);
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}
function _mlProjPlayer(p, sc) {
  // K y DEF: su proyeccion REAL sale del feed de expertos (el dueno la pidio y
  // existe: 32 kickers y 32 defensas, las defensas por su abreviatura de
  // equipo). Su puntaje casi no varia entre formatos, asi que vale para las
  // dos fuentes; la media de liga queda solo de respaldo cuando el feed no
  // trae a ese jugador.
  if (p && (p.pos === 'K' || p.pos === 'DEF')) {
    if (ML.proySite) {
      var kid = p.pos === 'DEF'
        ? String(p.team || p.id || '').toUpperCase()
        : (p.id || mlIdPorNombre(p.name));
      var kst = kid && ML.proySite[kid];
      if (kst && kst.pts_std != null) return Math.round(kst.pts_std * 10) / 10;
    }
    return p.pos === 'K' ? ML_PROJ_K : ML_PROJ_DEF;
  }
  // FUENTE 'site': la proyeccion oficial (Rotowire via Sleeper), por
  // estadistica cruda y preciada con el reglamento de ESTA liga, incluyendo
  // intercepciones y fumbles que Vegas no trae. Los jugadores de Yahoo se
  // resuelven a su id de Sleeper por nombre. Si el jugador no esta en la
  // fuente elegida, se cae a la otra: un titular sin numero es peor que un
  // numero de la otra fuente.
  if (ML.fuenteProy === 'site' && ML.proySite) {
    var sid = p && (p.id || mlIdPorNombre(p.name));
    var st = sid && ML.proySite[sid];
    if (st) {
      var v = 0;
      if (st.pass_yd) v += st.pass_yd * sc.passYd;
      if (st.pass_td) v += st.pass_td * sc.passTd;
      if (st.pass_int) v += st.pass_int * sc.passInt;
      if (st.rush_yd) v += st.rush_yd * sc.rushYd;
      if (st.rush_td) v += st.rush_td * sc.rushTd;
      if (st.rec) v += st.rec * sc.rec;
      if (st.rec_yd) v += st.rec_yd * sc.recYd;
      if (st.rec_td) v += st.rec_td * sc.recTd;
      if (st.fum_lost) v += st.fum_lost * sc.fumLost;
      return Math.round(v * 10) / 10;
    }
  }
  var pr = mlPropsFor(p && p.name);
  if (!pr) return null;
  var pts = 0;
  if (pr.player_pass_yds != null) {
    pts += pr.player_pass_yds * sc.passYd;
    pts += pr.player_pass_yds * ML_PASS_TD_PER_YD * sc.passTd;
  }
  if (pr.player_rush_yds != null) pts += pr.player_rush_yds * sc.rushYd;
  if (pr.player_reception_yds != null) pts += pr.player_reception_yds * sc.recYd;
  if (pr.player_receptions != null) pts += pr.player_receptions * sc.rec;
  if (pr.td_price != null) {
    var am = Number(pr.td_price);
    var prob = am < 0 ? (-am) / ((-am) + 100) : 100 / (am + 100);
    // El precio de UN solo lado lleva la comision de la casa (~7% de
    // overround): la probabilidad implicita sobreestima. Sin el lado "No" en el
    // feed no se puede normalizar exacto, asi que se descuenta la comision
    // tipica (auditoria 2026-09-09).
    prob *= 0.93;
    // El "anytime" no dice si es corriendo o atrapando: se usa el valor de la
    // posicion, que en el 99% de las ligas es el mismo numero.
    pts += prob * (p.pos === 'RB' ? sc.rushTd : sc.recTd);
  }
  // DECLARADO, no restado: las intercepciones del QB (~1 pt/sem en ligas con
  // INT a -1) no estan en las props del feed. Sesga a los QB medio punto
  // arriba, parejo entre equipos.
  return Math.round(pts * 10) / 10;
}

/* --------------------------------------------------------------- alineacion */
// El valor de un jugador SIN linea de mercado: percentil 25 de su posicion
// entre todos los que SI tienen linea, con el reglamento de esta liga. Se
// calcula una vez por liga (firma: id + numero de lineas cargadas) y se cachea.
var _mlImputCache = {};
function mlImputacion(L, sc, players) {
  var firma = (L && L.id) + ':' + (ML.props ? Object.keys(ML.props).length : 0);
  if (_mlImputCache[firma]) return _mlImputCache[firma];
  var porPos = {};
  Object.keys(players || {}).forEach(function (id) {
    var p = players[id];
    if (!p || ['QB', 'RB', 'WR', 'TE'].indexOf(p.pos) < 0) return;
    var v = mlProjPlayer(p, sc);
    if (v != null) (porPos[p.pos] = porPos[p.pos] || []).push(v);
  });
  var out = {};
  Object.keys(porPos).forEach(function (k) {
    var a = porPos[k].sort(function (x, y) { return x - y; });
    out[k] = a[Math.floor(a.length * 0.25)] || 0;
  });
  _mlImputCache[firma] = out;
  return out;
}

// Estados de lesion que significan "no va a jugar". Un jugador asi no entra en
// la mejor alineacion posible, y por tanto NUNCA se recomienda meterlo. El caso
// que lo destapo (2026-09-10): el panel recomendaba "Brock Bowers in for AJ
// Barner" con Bowers en Doubtful. Recomendar a un lesionado es el consejo que
// hace que no te crean el resto de la pantalla.
// Questionable NO esta en la lista: jugar con un questionable es lo normal en
// fantasy, y sacarlos a todos seria pasarse de listo en la otra direccion.
// Cubre los dos vocabularios: Sleeper (Out, IR, PUP, Sus, NA, COV, DNR,
// Doubtful) y Yahoo (O, IR, PUP, SUSP, D, NA).
var ML_NO_JUEGA = { Out: 1, IR: 1, PUP: 1, Sus: 1, SUSP: 1, NA: 1, COV: 1, DNR: 1, Doubtful: 1, O: 1, D: 1 };
function mlNoJuega(p) { return !!(p && p.inj && ML_NO_JUEGA[p.inj]); }

var ML_FLEX = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_WRT: ['RB', 'WR', 'TE']
};
// Las casillas que NO son un titular. Sleeper manda BN/IR/TAXI; Yahoo manda
// ademas IR+ (la de lesionados ampliada) y las variantes IL. Una casilla de
// estas que se cuele en el once es un hueco que ningun jugador puede llenar:
// no suma puntos, pero cuenta contra la cobertura y contra los titulares que se
// le enseñan al usuario. Lista explicita a proposito: un patron ancho se
// llevaria por delante una casilla legitima que hoy no conocemos.
var ML_SKIP = { BN: 1, IR: 1, TAXI: 1, 'IR+': 1, IL: 1, 'IL+': 1, NA: 1 };

// El mejor once posible con lo que tiene, respetando las casillas de SU liga.
// Avaro por especificidad (primero las casillas fijas, luego los flex), que es
// como se llena una alineacion de verdad y es suficiente a esta escala.
function mlBestLineup(playerIds, L, sc, players) {
  var slots = (L.roster_positions || []).filter(function (s) { return !ML_SKIP[s]; });
  var pool = [];
  // Sleeper manda ids y Yahoo manda al jugador entero. Se aceptan los dos: la
  // alternativa era una segunda funcion identica, que es como se separan dos
  // caminos que deberian dar lo mismo.
  (playerIds || []).forEach(function (item) {
    var p = (item && typeof item === 'object') ? item : players[item];
    if (!p) return;
    if (mlNoJuega(p)) return;   // un Out/Doubtful no puede estar en el mejor once
    var proj = mlProjPlayer(p, sc);
    pool.push({ id: (p.id || p.name), p: p, proj: proj });
  });
  // Los que no tienen linea reciben el PERCENTIL 25 de su posicion entre
  // todos los que si la tienen EN EL MAESTRO ENTERO (108 RB, 165 WR), no la
  // mediana del propio roster. Ojo: no es "en la liga"; cambiarlo moveria
  // todos los totales de la pantalla y esta medido que el p25 global es mas
  // honesto que una mediana de 2 o 3 valores. Dos
  // correcciones de la auditoria (2026-09-09): las casas solo publican props de
  // los ~200 relevantes, asi que quien no tiene linea es PEOR que la mediana de
  // los que si (la mediana sesgaba arriba); y la mediana por roster salia de 2
  // o 3 valores, puro ruido. El p25 se calcula una vez por liga y se cachea.
  var imput = mlImputacion(L, sc, players);
  var covered = 0, needed = 0;
  pool.forEach(function (x) {
    // "no hay numero" incluye el numero que no lo es: sin el isFinite, un NaN
    // pasa el `== null` y se lleva por delante el total del equipo.
    if (x.proj == null || !isFinite(x.proj)) { x.proj = imput[x.p.pos] != null ? imput[x.p.pos] : 0; x.guess = true; }
  });

  var used = {}, lineup = [], total = 0;
  var order = slots.slice().sort(function (a, b) {
    return (ML_FLEX[a] ? 1 : 0) - (ML_FLEX[b] ? 1 : 0);   // fijas primero
  });
  // El indice original de la casilla: se rellenan primero las fijas y despues
  // los flex, pero para comparar con la alineacion REAL hace falta saber a que
  // puesto de la lista de la liga corresponde cada uno.
  var idxDe = {}, usadoIdx = {};
  slots.forEach(function (sl, i) { (idxDe[sl] = idxDe[sl] || []).push(i); });
  order.forEach(function (slot) {
    var ok = ML_FLEX[slot] || [slot];
    var best = null;
    pool.forEach(function (x) {
      if (used[x.id]) return;
      if (ok.indexOf(x.p.pos) === -1) return;
      // A igualdad, manda el que tiene linea REAL: un imputado no desplaza a un
      // titular con numero propio (auditoria 2026-09-09).
      if (!best || x.proj > best.proj + 0.01 || (Math.abs(x.proj - best.proj) <= 0.01 && best.guess && !x.guess)) best = x;
    });
    var libres = idxDe[slot] || [];
    var idx = null;
    for (var q = 0; q < libres.length; q++) {
      if (!usadoIdx[libres[q]]) { idx = libres[q]; usadoIdx[idx] = 1; break; }
    }
    if (best) {
      used[best.id] = 1;
      lineup.push({ slot: slot, idx: idx, x: best });
      total += best.proj;
      needed++; if (!best.guess) covered++;
    } else {
      needed++;   // casilla vacia: cuenta contra la cobertura
      lineup.push({ slot: slot, idx: idx, x: null });
    }
  });
  return {
    total: isFinite(total) ? Math.round(total * 10) / 10 : 0,
    lineup: lineup,
    covered: covered,
    needed: needed,
    coverage: needed ? covered / needed : 0
  };
}

/* --------------------------------------------------- revisar la alineacion */
// Lo que ninguna app hace: mirar TODAS tus ligas a la vez y decirte donde tienes
// a alguien en la banca que deberia estar jugando. Sleeper te avisa dentro de
// una liga; con catorce, el domingo por la mañana no te da la vida para abrirlas
// una por una.
//
// La comparacion es honesta y por eso es util: se mide TU alineacion real
// (starters, del enfrentamiento de la semana) contra la mejor alineacion
// posible con TU plantel y las casillas de TU liga, con los puntos proyectados
// segun el reglamento de esa liga. No es una opinion, es una resta.
// Puntos. Por debajo de esto no se abre la boca: un aviso por dos puntos de
// diferencia es ruido, y la mitad de las proyecciones llevan la mediana de su
// posicion dentro. Tres puntos en fantasy si cambian un domingo.
var ML_UMBRAL_CAMBIO = 3;

function mlRevisarAlineacion(L) {
  var H = L._hyd;
  if (!H || !H.mine || !mlDrafted(L)) return null;
  // En best ball la plataforma pone tu mejor alineacion sola: no hay nada que
  // arreglar, y decirle a alguien que mueva su banca en una liga de best ball
  // es la clase de error que hace que no te crean el resto.
  if (mlEsBestBall(L)) return null;
  var fila = (H.matchups || []).filter(function (m) { return m.roster_id === H.mine.roster_id; })[0];
  var titulares = (fila && fila.starters) || H.mine.starters || [];
  if (!titulares.length) return null;
  var players = ML.players || {};
  var sc = H.sc || mlScoring(L);
  var mejor = H.proj[H.mine.roster_id];
  if (!mejor || !mejor.lineup) return null;

  // Lo que vale lo que tienes puesto, con las mismas reglas.
  var puestos = titulares.filter(function (id) { return id && id !== '0'; });
  var valorActual = 0, sinNumero = 0;
  puestos.forEach(function (id) {
    var p = players[id];
    if (!p) { sinNumero++; return; }
    var v = mlProjPlayer(p, sc);
    if (v == null) { sinNumero++; return; }
    valorActual += v;
  });
  // Con la mitad del once sin numero propio, la resta no significa nada y no se
  // opina. Callarse es parte del trabajo.
  if (!puestos.length || sinNumero > puestos.length / 2) return null;

  // POR CONJUNTOS, no por casilla. La version por casilla comparaba
  // mejor.lineup[i] contra starters[i], y en una liga con DOS casillas de QB o
  // dos FLEX el mismo once reordenado salia como dos cambios: al dueno le
  // recomendo "Jeanty in for Parker Washington" y "Baker in for Willis" con los
  // CUATRO ya de titulares, solo que en otro orden (2026-09-10, su liga
  // Dynasty, QB/QB/.../FLEX/FLEX). Un cambio REAL es alguien que entra desde la
  // banca; todo lo demas es reacomodo, y el reacomodo entre alineaciones
  // validas no suma puntos.
  var enActual = {};
  titulares.forEach(function (id) { if (id && id !== '0') enActual[id] = 1; });
  var enMejor = {};
  mejor.lineup.forEach(function (sl) { if (sl.x) enMejor[sl.x.id] = 1; });

  var entran = [];
  mejor.lineup.forEach(function (sl) {
    if (!sl.x || !sl.x.p) return;
    if (enActual[sl.x.id]) return;        // ya es titular: reacomodo, no cambio
    if (sl.x.guess) return;               // no se recomienda a nadie sin numero propio
    entran.push({ p: sl.x.p, pts: sl.x.proj, slot: sl.slot });
  });
  var salen = [];
  puestos.forEach(function (id) {
    if (enMejor[id]) return;              // sigue en el mejor once
    var pa = players[id];
    var va = pa ? mlProjPlayer(pa, sc) : null;
    if (va == null) return;               // sin numero del que sale, no se opina
    salen.push({ p: pa, pts: va, id: id });
  });
  // El que mas suma entra por el que menos aporta. Cruzar posiciones aqui es
  // legitimo: en una liga con FLEX, sentar a un WR para arrancar a un RB es un
  // movimiento real.
  entran.sort(function (a, b) { return b.pts - a.pts; });
  salen.sort(function (a, b) { return a.pts - b.pts; });
  var pares = [];
  for (var q = 0; q < entran.length && q < salen.length; q++) {
    var gana = entran[q].pts - salen[q].pts;
    if (gana >= ML_UMBRAL_CAMBIO) pares.push({ entra: entran[q], sale: salen[q], gana: gana });
  }
  if (!pares.length) return { ok: true, gana: 0, cambios: [] };
  var total = pares.reduce(function (a, x) { return a + x.gana; }, 0);
  return { ok: pares.length === 0, gana: Math.round(total * 10) / 10, cambios: pares };
}

// Todas las ligas de un vistazo, ordenadas por lo que te estas dejando.
function mlAlineacionesRotas() {
  var out = [];
  (ML.leagues || []).forEach(function (L) {
    // En la demo no hay lineas de la semana, asi que no hay proyeccion por
    // jugador y esta revision no puede correr de verdad. Va escrita a mano para
    // que se VEA de que va, y la pantalla entera esta declarada como ejemplo en
    // las tres pestañas.
    var r = (ML.demo && L._demoFix) ? L._demoFix : mlRevisarAlineacion(L);
    if (r && !r.ok && r.cambios.length) out.push({ L: L, r: r });
  });
  return out.sort(function (a, b) { return b.r.gana - a.r.gana; });
}

/* --------------------------------------------------------------------- odds */
// Probabilidad de ganar el duelo. La varianza semanal de un equipo de fantasy
// ronda el 24% de su media; la del duelo es la suma de las dos.
// UNA sola constante para el ruido semanal de un equipo, usada por el duelo y
// por la simulacion. Tener 0.24 en uno y 0.26 en la otra era dar dos
// probabilidades distintas para la misma pregunta (auditoria 2026-09-09).
// 25% de la media esta en el borde alto de lo empirico (18-22%), y ancho es el
// error bueno: probabilidades humildes.
var ML_SD_SEMANAL = 0.25;
function mlSd(proj) { return Math.max(16, ML_SD_SEMANAL * proj); }
function mlNormCdf(z) {
  // El cero va aparte: la aproximacion devuelve 0.4999999995 y eso, redondeado
  // a precio americano, convierte un duelo exactamente parejo en un +100, o
  // sea en un no favorito. La cifra es despreciable, el signo no.
  if (z === 0) return 0.5;
  // Abramowitz y Stegun 7.1.26, error < 1.5e-7. Suficiente para pintar odds.
  var t = 1 / (1 + 0.2316419 * Math.abs(z));
  var d = 0.3989422804014327 * Math.exp(-z * z / 2);
  var p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}
function mlWinProb(a, b) {
  var sd = Math.sqrt(mlSd(a) * mlSd(a) + mlSd(b) * mlSd(b));
  if (!sd) return 0.5;
  return mlNormCdf((a - b) / sd);
}
// Precio americano SIN comision. Una casa se queda el jugo; nosotros no
// vendemos apuestas, asi que meter vig seria ensuciar el numero para que
// parezca mas real. Se declara en la pantalla.
function mlAmerican(p) {
  if (p <= 0.0001) return '+9900';
  if (p >= 0.9999) return '-9900';
  var v = p >= 0.5 ? -(100 * p / (1 - p)) : (100 * (1 - p) / p);
  var r = Math.round(v / 5) * 5;
  if (r > 0 && r < 100) r = 100;
  if (r < 0 && r > -100) r = -100;
  return (r > 0 ? '+' : '') + r;
}
function mlSpread(diff) {
  var s = Math.round(diff * 2) / 2;
  if (s === 0) s = 0.5;   // no existe el pick'em en un duelo de fantasy
  return s;
}

/* ------------------------------------------------------- montecarlo del titulo */
function mlGauss() {
  var u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Simula lo que queda de temporada N veces. Devuelve, por equipo, el titulo,
// los playoffs y el record proyectado.
function mlSimLeague(L, sims) {
  var H = L._hyd; if (!H || !H.rosters || !H.schedule) return null;
  // Sin calendario no hay temporada que simular, y con los planteles vacios
  // (liga sin draftear) el reparto del titulo sale del ORDEN de los equipos y
  // de nada mas. Las dos veces el numero seria inventado, asi que no sale.
  if (!H.schedule.length) return null;
  var vivo = Object.keys(H.proj || {}).some(function (k) { return (H.proj[k] || {}).total > 0; });
  if (!vivo) return null;
  sims = sims || 4000;
  var ids = H.rosters.map(function (r) { return r.roster_id; });
  var idx = {}; ids.forEach(function (id, i) { idx[id] = i; });
  var n = ids.length;
  var proj = ids.map(function (id) { return (H.proj[id] && H.proj[id].total) || 0; });
  var w0 = [], l0 = [], pf0 = [], jug = [];
  H.rosters.forEach(function (r, i) {
    var s = r.settings || {};
    w0[i] = Number(s.wins) || 0;
    l0[i] = Number(s.losses) || 0;
    pf0[i] = Number(s.fpts || 0) + Number(s.fpts_decimal || 0) / 100;
    jug[i] = w0[i] + l0[i] + (Number(s.ties) || 0);
  });

  /* ── POR QUE ESTO NO ES UNA SIMULACION INGENUA ─────────────────────────────
   * La primera version daba 30,4% de titulo al mejor equipo de una liga de
   * DIEZ, antes de jugarse un solo partido. El dueno lo cazo: en una liga de
   * diez, si todos fueran iguales seria 10%, y el mejor equipo de verdad ronda
   * el 15-20% en pretemporada. Un 30% es un modelo sobreconfiado.
   *
   * La causa era tratar la proyeccion COMO SI FUERA LA VERDAD. No lo es: es una
   * estimacion con error propio. Si uno simula con la proyeccion como media
   * exacta, el equipo que proyecta 87 gana el 66% de sus duelos TODAS las
   * semanas de TODAS las simulaciones, y eso compone hasta un titulo casi
   * seguro. En la realidad, media de la distancia que vemos entre equipos es
   * ruido de nuestros propios numeros.
   *
   * El arreglo es el estandar para "mi estimacion de la media tambien es
   * incierta": encoger hacia la media de la liga, y ademas sortear el talento
   * real de cada equipo en CADA temporada simulada.
   *
   *   FIABILIDAD (r): que parte de la distancia entre equipos es talento real.
   *     Sin partidos jugados vale 0.5 (la mitad de lo que medimos es error
   *     nuestro) y sube hacia 0.85 segun se juega, porque los puntos anotados
   *     de verdad si son informacion. r = 0.5 + 0.35 * g/(g+6).
   *   ENCOGIDO: mu_i = media + r * (base_i - media).
   *   INCERTIDUMBRE DEL TALENTO (tau): sqrt(r*(1-r)) * desviacion de las bases.
   *     Es la varianza que queda despues de encoger, y es lo que convierte
   *     "este equipo es mejor" en "este equipo es probablemente mejor".
   *   RUIDO SEMANAL: 26% de la media de la liga. Una semana de fantasy tiene
   *     una desviacion de ese orden, y se usa la MISMA para todos: darle mas
   *     varianza al que mas proyecta lo premia dos veces.
   *   LO QUE YA PASO manda cuanto mas se juega: base = mezcla de la proyeccion
   *     y los puntos por partido reales, con peso g/(g+4).
   * ─────────────────────────────────────────────────────────────────────────*/
  var jugados = jug.reduce(function (a, b) { return a + b; }, 0) / n;
  var pesoReal = jugados / (jugados + 4);
  var base = proj.map(function (p, i) {
    if (!jug[i]) return p;
    var ppg = pf0[i] / jug[i];
    return p * (1 - pesoReal) + ppg * pesoReal;
  });
  var media = base.reduce(function (a, b) { return a + b; }, 0) / n;
  var varBase = base.reduce(function (a, b) { return a + (b - media) * (b - media); }, 0) / n;
  var sdBase = Math.sqrt(varBase);
  var r = Math.min(0.85, 0.5 + 0.35 * (jugados / (jugados + 6)));
  var mu = base.map(function (b) { return media + r * (b - media); });
  var tau = Math.sqrt(Math.max(0, r * (1 - r))) * sdBase;
  var sigma = Math.max(14, ML_SD_SEMANAL * media);
  var playoffTeams = Math.min(n, Number((L.settings || {}).playoff_teams) || 6);
  var titles = new Array(n).fill(0), playoffs = new Array(n).fill(0);
  var winSum = new Array(n).fill(0);

  for (var s = 0; s < sims; s++) {
    var w = w0.slice(), pf = pf0.slice();
    // El talento real de cada equipo se sortea UNA VEZ por temporada: dentro de
    // una misma temporada el equipo es el que es, pero no sabemos cual es.
    var talento = [];
    for (var t = 0; t < n; t++) talento[t] = mu[t] + tau * mlGauss();
    H.schedule.forEach(function (wk) {
      var scores = [];
      for (var i = 0; i < n; i++) scores[i] = talento[i] + sigma * mlGauss();
      wk.forEach(function (pair) {
        var a = idx[pair[0]], b = idx[pair[1]];
        if (a == null || b == null) return;
        pf[a] += scores[a]; pf[b] += scores[b];
        if (scores[a] >= scores[b]) w[a]++; else w[b]++;
      });
    });
    // Siembra: primero victorias, despues puntos a favor, que es el desempate
    // por defecto de Sleeper.
    var seed = ids.map(function (_, i) { return i; }).sort(function (x, y) {
      return (w[y] - w[x]) || (pf[y] - pf[x]);
    });
    for (var k = 0; k < playoffTeams; k++) playoffs[seed[k]]++;
    for (var i2 = 0; i2 < n; i2++) winSum[i2] += w[i2];
    // Cuadro de eliminacion directa, con byes para los mejores sembrados.
    //
    // EL BUG QUE CAZO LA AUDITORIA DE FORMULAS (2026-09-09): "byes = impar ? 1
    // : 0" daba CERO byes con 6 equipos, o sea 1v6, 2v5, 3v4. El formato real
    // de 6 da bye a los sembrados 1 y 2 (juegan 3v6 y 4v5). Consecuencia
    // medida: el sembrado 1 jugaba TRES partidos en vez de dos y su titulo
    // salia deflactado ~40% relativo, con los sembrados 3-4 inflados. Ningun
    // gate podia verlo porque el reparto sumaba 100% igual.
    // La formula correcta: byes hasta completar la potencia de 2 siguiente
    // (6 -> 2 byes, 5 -> 3, 7 -> 1, potencias de 2 -> 0).
    var alive = seed.slice(0, playoffTeams);
    while (alive.length > 1) {
      var byes = Math.pow(2, Math.ceil(Math.log2(alive.length))) - alive.length;
      var next = alive.slice(0, byes);
      var rest = alive.slice(byes);
      for (var j = 0; j < rest.length / 2; j++) {
        var A = rest[j], B = rest[rest.length - 1 - j];
        var sa = talento[A] + sigma * mlGauss(), sb = talento[B] + sigma * mlGauss();
        next.push(sa >= sb ? A : B);
      }
      next.sort(function (x, y) { return seed.indexOf(x) - seed.indexOf(y); });
      alive = next;
    }
    titles[alive[0]]++;
  }
  var rows = ids.map(function (id, i) {
    return {
      rosterId: id,
      title: titles[i] / sims,
      playoff: playoffs[i] / sims,
      wins: winSum[i] / sims,
      proj: proj[i]
    };
  }).sort(function (a, b) { return b.title - a.title || b.proj - a.proj; });
  return { rows: rows, sims: sims, weeks: H.schedule.length,
    fiabilidad: Math.round(r * 100), jugados: Math.round(jugados * 10) / 10 };
}

/* ------------------------------------------------------------------ yahoo */
// Aprobado el 2026-09-08. El token vive en ESTE navegador, nunca en nuestro
// servidor: ver la nota de server/routes/yahoo.js. Aqui solo se guarda, se
// refresca cuando caduca, y se manda por cabecera a nuestro proxy.
var ML_YT_KEY = 'tm_yahoo_tok';

function mlYahooTok() {
  try { return JSON.parse(localStorage.getItem(ML_YT_KEY) || 'null'); } catch (e) { return null; }
}
function mlYahooSet(t) {
  try { t ? localStorage.setItem(ML_YT_KEY, JSON.stringify(t)) : localStorage.removeItem(ML_YT_KEY); } catch (e) {}
}
function mlYahooConectado() { var t = mlYahooTok(); return !!(t && t.access_token); }

// Devuelve un token vivo, refrescandolo si hace falta. Un token caducado no es
// un error que se le enseñe al usuario: se cambia y sigue.
async function mlYahooVivo() {
  var t = mlYahooTok();
  if (!t || !t.access_token) return null;
  if (t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;
  if (!t.refresh_token) { mlYahooSet(null); return null; }
  try {
    var r = await fetch('/api/yahoo/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: t.refresh_token })
    });
    if (!r.ok) { mlYahooSet(null); return null; }
    var d = await r.json();
    var nuevo = { access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token,
      expires_at: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
    mlYahooSet(nuevo);
    return nuevo.access_token;
  } catch (e) { return null; }
}

async function mlYahooGet(path) {
  var tok = await mlYahooVivo();
  if (!tok) throw new Error('yahoo not connected');
  var r = await fetch('/api/yahoo' + path, { headers: { 'X-Yahoo-Token': tok } });
  if (r.status === 401) { mlYahooSet(null); throw new Error('yahoo session expired'); }
  if (!r.ok) throw new Error('yahoo ' + r.status);
  return r.json();
}

// La ventana emergente devuelve el token por postMessage desde NUESTRO origen.
function mlYahooConnect() {
  var w = window.open('/api/yahoo/login', 'yahoo-login', 'width=520,height=680');
  if (!w) { alert('Allow pop-ups to connect Yahoo.'); return; }
  var listo = false;
  function alLlegar(ev) {
    if (ev.origin !== window.location.origin) return;
    var d = ev.data || {};
    if (d.type !== 'trademind-yahoo') return;
    var p = d.payload || {};
    if (p.token && p.token.access_token) {
      mlYahooSet(p.token);
      listo = true;
      window.removeEventListener('message', alLlegar);
      ML.ready = false; mlPaint();
      mlBoot(true);
    } else if (p.error) {
      ML.yahooErr = String(p.error).slice(0, 160);
      mlPaint();
    }
  }
  window.addEventListener('message', alLlegar);
  // Si la ventana se cierra sin contestar, no dejamos el oyente colgado.
  var reloj = setInterval(function () {
    if (w.closed) { clearInterval(reloj); if (!listo) window.removeEventListener('message', alLlegar); }
  }, 800);
}

function mlYahooDisconnect() {
  mlYahooSet(null);
  ML.leagues = (ML.leagues || []).filter(function (L) { return L.plat !== 'yahoo'; });
  mlPaint();
}

// Las casillas de Yahoo dicen lo mismo con otras letras. Se traducen al
// vocabulario que ya entiende la alineacion, en vez de duplicar la funcion.
var ML_YPOS = { 'W/R/T': 'FLEX', 'W/R': 'WRRB_FLEX', 'W/T': 'REC_FLEX', 'Q/W/R/T': 'SUPER_FLEX',
  'R/W/T': 'FLEX', 'D': 'DEF', 'DST': 'DEF' };
function mlYPos(p) { return ML_YPOS[p] || p; }

// Trae las ligas de Yahoo con el MISMO molde que las de Sleeper. Todo lo que
// viene despues (proyeccion, tablero, exposicion, simulacion) no sabe ni tiene
// que saber de que plataforma salio la liga.
async function mlIngestYahoo(players) {
  if (!mlYahooConectado()) return [];
  var d = await mlYahooGet('/leagues').catch(function (e) { ML.yahooErr = e.message; return null; });
  if (!d || !d.leagues) return [];
  var vivas = d.leagues.filter(function (l) { return !l.is_finished; });
  var out = [];
  await mlPool(vivas, 2, async function (l) {
    var det = await mlYahooGet('/league/' + encodeURIComponent(l.league_key)).catch(function () { return null; });
    if (!det || !det.teams) return null;
    var semana = l.current_week || ML.week;
    var sb = await mlYahooGet('/league/' + encodeURIComponent(l.league_key) + '/scoreboard?week=' + semana)
      .catch(function () { return null; });

    var L = {
      id: 'y:' + l.league_key,
      plat: 'yahoo',
      name: det.league.name || l.name,
      teams: det.league.num_teams || l.num_teams,
      status: /postdraft|midraft/.test(det.league.draft_status || '') ? 'in_season' : 'pre_draft',
      type: 0,
      settings: { playoff_teams: det.league.num_playoff_teams, playoff_week_start: det.league.playoff_start_week },
      roster_positions: (det.league.roster_positions || []).map(mlYPos),
      scoring_settings: det.league.scoring_settings || {}
    };
    // Si Yahoo no devolvio su reglamento, mlScoring cae a los valores por
    // defecto y los WR saldrian a precio de liga estandar sin que nadie se
    // entere. Se marca y la tarjeta lo dice: un numero con una suposicion
    // adentro tiene que declararla.
    L._scoringGuess = !Object.keys(L.scoring_settings).length;
    var sc = mlScoring(L);
    // Yahoo identifica por clave de equipo; adentro se usa un numero de asiento
    // para que el resto del codigo no cambie.
    var idPorClave = {};
    var rosters = det.teams.map(function (t, i) {
      idPorClave[t.team_key] = i + 1;
      return {
        roster_id: i + 1,
        owner_id: t.team_key,
        logo: t.logo || null,
        players: (t.players || []).map(function (p) {
          return { name: p.name, pos: String(p.pos || '').split(',')[0].replace('DEF', 'DEF'),
            team: p.team, inj: p.status || null, yahoo: true };
        }),
        settings: { wins: t.wins || 0, losses: t.losses || 0, ties: t.ties || 0, fpts: t.points_for || 0 },
        _mio: !!t.is_owned_by_current_login
      };
    });
    var users = {};
    det.teams.forEach(function (t, i) {
      users[t.team_key] = { display_name: t.name, metadata: { team_name: t.name } };
    });
    var mine = rosters.filter(function (r) { return r._mio; })[0] || null;
    var proj = {};
    rosters.forEach(function (r) { proj[r.roster_id] = mlBestLineup(r.players, L, sc, players); });

    // Los PUNTOS del scoreboard entran a los matchups: sin ellos, las ligas de
    // Yahoo mostraban proyeccion aunque hubiera partido en curso ("los scores
    // estan mal en algunas ligas", 2026-09-10).
    var muBy = {}, myMu = null, opp = null, matchups = [];
    ((sb && sb.matchups) || []).forEach(function (m, k) {
      var a = idPorClave[m.teams[0]], b = idPorClave[m.teams[1]];
      if (!a || !b) return;
      var fa = { roster_id: a, matchup_id: k + 1, points: Number((m.points || [])[0]) || 0 };
      var fb = { roster_id: b, matchup_id: k + 1, points: Number((m.points || [])[1]) || 0 };
      muBy[k + 1] = [fa, fb];
      matchups.push(fa, fb);
      if (mine && (a === mine.roster_id || b === mine.roster_id)) {
        myMu = { roster_id: mine.roster_id, matchup_id: k + 1 };
        opp = a === mine.roster_id ? b : a;
      }
    });
    L._hyd = { rosters: rosters, users: users, mine: mine, sc: sc, proj: proj,
      matchups: matchups, muBy: muBy, myMu: myMu, opp: opp, schedule: null };
    if (mine) out.push(L);
    return true;
  });
  return out;
}

/* ------------------------------------------------------------------- demo */
// Un desconocido no puede juzgar un producto que no puede ver. Sin esto, la
// unica forma de saber que hace Mac Draft era conectar una cuenta de Sleeper,
// que es justo lo que nadie hace antes de entender para que sirve.
//
// Se entra con /myleagues?demo=1 y NO toca nada real: no guarda, no sincroniza
// y la pantalla lo declara. Las ligas son inventadas (las de verdad se llaman
// como se les ocurrio a diez amigos y no son publicables), pero los JUGADORES
// son reales, con sus fotos y sus equipos: es lo que le da vida sin exponer a
// nadie.
var ML_DEMO_LIGAS = [
  ['Sunday Money', 2, 12, 1, '8-3', 128.4, 121.7, 'The Commissioner', 1],
  ['The Group Chat', 0, 10, 0.5, '7-4', 116.9, 124.2, 'Waiver Wire Willy', 0],
  ['Dinner Table', 0, 12, 1, '6-5', 109.5, 98.1, 'Backup Plan', 0],
  ['The Office', 0, 10, 0, '9-2', 121.0, 118.8, 'Copy Room Kings', 0],
  ['Dynasty Warehouse', 2, 12, 1, '5-6', 132.7, 126.3, 'Rebuild Rick', 0],
  ['Last Call', 0, 14, 0.5, '4-7', 104.2, 112.6, 'Sunday Scaries', 0]
];
// Jugadores REALES: sus fotos existen y se reconocen. El reparto por liga esta
// escrito a mano para que el cruce de "rooting against yourself" salga cierto.
var ML_DEMO_JUG = [
  ['9509', 'Bijan Robinson', 'RB', 'ATL', [0, 1, 2, 4], [3]],
  ['9493', 'Puka Nacua', 'WR', 'LAR', [0, 2, 4], [1, 3]],
  ['11604', 'Brock Bowers', 'TE', 'LV', [1, 3], [0]],
  ['7564', "Ja'Marr Chase", 'WR', 'CIN', [0, 3, 5], []],
  ['9221', 'Jahmyr Gibbs', 'RB', 'DET', [2, 5], [4]],
  ['6786', 'CeeDee Lamb', 'WR', 'DAL', [1, 4], []],
  ['4984', 'Josh Allen', 'QB', 'BUF', [0, 2], [5]],
  ['11632', 'Malik Nabers', 'WR', 'NYG', [3, 5], []],
  ['7547', 'Amon-Ra St. Brown', 'WR', 'DET', [4], []],
  ['11566', 'Jayden Daniels', 'QB', 'WAS', [1], [2]]
];

function mlEsDemo() {
  try { return new URL(location.href).searchParams.get('demo') === '1'; } catch (e) { return false; }
}

function mlCargarDemo() {
  var players = {};
  ML_DEMO_JUG.forEach(function (j) {
    players[j[0]] = { id: j[0], name: j[1], pos: j[2], team: j[3] };
  });
  ML.players = players;
  ML.demo = true; ML.week = 11; ML.season = '2026'; ML.username = 'demo';
  ML.err = null; ML.stale = null; ML.filtro = {};

  ML.leagues = ML_DEMO_LIGAS.map(function (d, i) {
    var mios = [], contra = [];
    ML_DEMO_JUG.forEach(function (j) {
      if (j[4].indexOf(i) !== -1) mios.push(j[0]);
      if (j[5].indexOf(i) !== -1) contra.push(j[0]);
    });
    var rosters = [
      { roster_id: 1, owner_id: 'me', players: mios, settings: { wins: +d[4].split('-')[0], losses: +d[4].split('-')[1], fpts: 1180 } },
      { roster_id: 2, owner_id: 'opp', players: contra, settings: { wins: 5, losses: 6, fpts: 1090 } }
    ];
    var L = {
      id: d[0].toLowerCase().replace(/[^a-z]+/g, '-'),
      plat: i === 3 ? 'yahoo' : 'sleeper',
      name: d[0], teams: d[2], status: 'in_season', type: d[1],
      settings: { playoff_teams: 6, playoff_week_start: 15 },
      roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN'],
      scoring_settings: { rec: d[3] }, avatar: null, logo: null,
      champId: d[8] ? 1 : null
    };
    L._hyd = {
      rosters: rosters,
      users: { me: { display_name: 'You', metadata: {} }, opp: { display_name: d[7], metadata: {} } },
      mine: rosters[0], sc: null,
      proj: { 1: { total: d[5], coverage: 1 }, 2: { total: d[6], coverage: 1 } },
      matchups: [], muBy: { 1: [{ roster_id: 1, matchup_id: 1 }, { roster_id: 2, matchup_id: 1 }] },
      myMu: { roster_id: 1, matchup_id: 1 }, opp: 2, schedule: null
    };
    return L;
  });
  // Sunday Money lleva un duelo COMPLETO: 9 titulares reales por lado con
  // puntos de un domingo a media tarde. Sin esto, tocar la tarjeta de la demo
  // abria un matchup vacio, que es enseñar la mejor pantalla en blanco.
  (function () {
    var extra = [
      ['4046', 'Patrick Mahomes', 'QB', 'KC'], ['4866', 'Saquon Barkley', 'RB', 'PHI'],
      ['9509', 'Bijan Robinson', 'RB', 'ATL'], ['6794', 'Justin Jefferson', 'WR', 'MIN'],
      ['1466', 'Travis Kelce', 'TE', 'KC'], ['4034', 'Christian McCaffrey', 'RB', 'SF'],
      ['11533', 'Brandon Aubrey', 'K', 'DAL'], ['3198', 'Derrick Henry', 'RB', 'BAL'],
      ['6813', 'Jonathan Taylor', 'RB', 'IND'], ['4227', 'Harrison Butker', 'K', 'KC'],
      ['PHI', 'Philadelphia Eagles', 'DEF', 'PHI'], ['KC', 'Kansas City Chiefs', 'DEF', 'KC']
    ];
    extra.forEach(function (j) { ML.players[j[0]] = { id: j[0], name: j[1], pos: j[2], team: j[3] }; });
    var mios = ['4046', '4866', '9509', '6794', '7564', '1466', '4034', '11533', 'PHI'];
    var suyos = ['4984', '9221', '3198', '6786', '9493', '11604', '6813', '4227', 'KC'];
    var pmios = { '4046': 21.4, '4866': 17.8, '9509': 6.3, '6794': 12.6, '7564': 15.1, '1466': 6.2, '4034': 9.9, '11533': 8.0, 'PHI': 5.0 };
    var psuyos = { '4984': 18.9, '9221': 22.3, '3198': 7.4, '6786': 8.7, '9493': 11.2, '11604': 4.8, '6813': 13.0, '4227': 6.0, 'KC': 3.0 };
    var suma = function (o) { var t = 0; Object.keys(o).forEach(function (k) { t += o[k]; }); return Math.round(t * 10) / 10; };
    var L0 = ML.leagues[0], H0 = L0._hyd;
    H0.rosters[0].players = mios.slice(); H0.rosters[1].players = suyos.slice();
    H0.matchups = [
      { roster_id: 1, matchup_id: 1, starters: mios, players: mios, points: suma(pmios), players_points: pmios },
      { roster_id: 2, matchup_id: 1, starters: suyos, players: suyos, points: suma(psuyos), players_points: psuyos }
    ];
  })();

  // Dos alineaciones con algo que arreglar, para que el ejemplo enseñe la unica
  // pantalla del producto sobre la que se puede ACTUAR.
  var pj = function (id) { return ML.players[id]; };
  ML.leagues[1]._demoFix = { ok: false, gana: 11.4, cambios: [
    { entra: { p: pj('9509'), pts: 18.2 }, sale: { p: pj('11566'), pts: 9.6 }, gana: 8.6, slot: 'FLEX' },
    { entra: { p: pj('11604'), pts: 12.1 }, sale: { p: pj('7547'), pts: 9.3 }, gana: 2.8, slot: 'TE' }
  ] };
  ML.leagues[4]._demoFix = { ok: false, gana: 6.1, cambios: [
    { entra: { p: pj('9221'), pts: 16.4 }, sale: { p: pj('6786'), pts: 10.3 }, gana: 6.1, slot: 'RB' }
  ] };

  ML.ready = true; ML.loading = false;
}

/* ------------------------------------------------------------------ carga */
async function mlBoot(force) {
  if (ML.loading) return;
  ML.loading = true; ML.err = null;
  try {
    var uname = (localStorage.getItem('tm_username') || '').trim();
    ML.username = uname;
    // Ninguna de las dos plataformas es obligatoria: se puede llegar con solo
    // Yahoo, con solo Sleeper, o con las dos.
    if (!uname && !mlYahooConectado()) { ML.loading = false; ML.ready = true; mlPaint(); return; }

    if (!force) {
      var cached = mlCacheRead();
      if (cached) { Object.assign(ML, cached); ML.ready = true; mlPaint(); }
    }

    var st = await mlGet('/state/nfl').catch(function () { return null; });
    if (st) { ML.week = st.week || 1; ML.season = st.season || ML.season; ML.phase = st.season_type || 'regular'; }

    var players = await mlPlayersMap();
    await Promise.all([mlLoadProps(), mlLoadProySite()]);

    var raw = [];
    if (uname) {
      var user = await mlGet('/user/' + encodeURIComponent(uname));
      ML.userId = user && user.user_id;
      if (!ML.userId) throw new Error('That Sleeper username does not exist.');
      raw = await mlGet('/user/' + ML.userId + '/leagues/nfl/' + ML.season);
    }

    var leagues = (raw || []).map(function (l) {
      var meta = l.metadata || {};
      return {
        id: l.league_id, plat: 'sleeper', name: l.name || 'League', teams: l.total_rosters || 0,
        status: l.status, type: (l.settings || {}).type,
        settings: l.settings || {}, roster_positions: l.roster_positions || [],
        scoring_settings: l.scoring_settings || {}, avatar: l.avatar || null,
        draftId: l.draft_id || null,
        // Sleeper guarda quien gano el ano pasado. Estaba ahi y no lo miraba nadie.
        champId: meta.latest_league_winner_roster_id != null
          ? Number(meta.latest_league_winner_roster_id) : null
      };
    });

    await mlPool(leagues, 4, async function (L) {
      var sc = mlScoring(L);
      var res = await Promise.all([
        mlGet('/league/' + L.id + '/rosters').catch(function () { return []; }),
        mlGet('/league/' + L.id + '/users').catch(function () { return []; }),
        mlGet('/league/' + L.id + '/matchups/' + ML.week).catch(function () { return []; })
      ]);
      var rosters = res[0] || [], users = res[1] || [], mus = res[2] || [];
      var uById = {}; users.forEach(function (u) { uById[u.user_id] = u; });
      var mine = null;
      rosters.forEach(function (r) {
        if (r.owner_id === ML.userId) mine = r;
        else if (!mine && r.co_owners && r.co_owners.indexOf(ML.userId) !== -1) mine = r;
      });
      var proj = {};
      rosters.forEach(function (r) {
        proj[r.roster_id] = mlBestLineup(r.players || [], L, sc, players);
      });
      var muBy = {};
      mus.forEach(function (m) { if (m.matchup_id != null) (muBy[m.matchup_id] = muBy[m.matchup_id] || []).push(m); });
      var myMu = null, oppRosterId = null;
      if (mine) {
        var row = mus.filter(function (m) { return m.roster_id === mine.roster_id; })[0];
        if (row && row.matchup_id != null) {
          myMu = row;
          var pair = (muBy[row.matchup_id] || []).filter(function (m) { return m.roster_id !== mine.roster_id; })[0];
          oppRosterId = pair ? pair.roster_id : null;
        }
      }
      L._hyd = {
        rosters: rosters, users: uById, mine: mine, sc: sc, proj: proj,
        matchups: mus, muBy: muBy, myMu: myMu, opp: oppRosterId, schedule: null
      };
      return true;
    });

    // La fecha del draft de las ligas que aun no draftean. Es informacion de SU
    // liga (cuando juega), no una funcion de mock draft.
    var sinDraftear = leagues.filter(function (L) {
      return L.draftId && L._hyd && L._hyd.mine && !mlDrafted(L);
    });
    await mlPool(sinDraftear, 3, async function (L) {
      var d = await mlGet('/draft/' + L.draftId).catch(function () { return null; });
      if (d && d.start_time) L.draftAt = Number(d.start_time);
      return true;
    });

    // Las ligas donde el usuario no tiene equipo no son suyas: fuera.
    var mias = leagues.filter(function (L) { return L._hyd && L._hyd.mine; });
    ML.yahooErr = null;
    var deYahoo = await mlIngestYahoo(players).catch(function () { return []; });
    ML.leagues = mias.concat(deYahoo || []);
    ML.stale = null;
    ML.ready = true; ML.err = null;
    mlCacheWrite();
  } catch (e) {
    // Con datos en la caja, un fallo de red no borra la pantalla: se sigue
    // enseñando lo ultimo bueno y se dice que no se pudo actualizar. Vaciar
    // catorce ligas por un 500 pasajero es la peor respuesta posible.
    if (ML.leagues && ML.leagues.length) {
      ML.err = null;
      ML.stale = e.message || String(e);
    } else {
      ML.err = e.message || String(e);
    }
    ML.ready = true;
  }
  ML.loading = false;
  mlPaint();
}

// El calendario que falta para simular: se pide solo cuando el usuario abre
// las odds de una liga, porque son hasta catorce llamadas mas.
async function mlLoadSchedule(L) {
  if (!L._hyd || L._hyd.schedule) return L._hyd && L._hyd.schedule;
  var last = Number((L.settings || {}).playoff_week_start) || 15;
  var weeks = [];
  for (var w = ML.week; w < last; w++) weeks.push(w);
  if (L.plat === 'yahoo') {
    var clave = L.id.slice(2);
    var idPorClave = {};
    (L._hyd.rosters || []).forEach(function (r) { idPorClave[r.owner_id] = r.roster_id; });
    var sem = await mlPool(weeks, 2, function (w) {
      return mlYahooGet('/league/' + encodeURIComponent(clave) + '/scoreboard?week=' + w);
    });
    var sy = [];
    sem.forEach(function (d) {
      if (!d || !d.matchups || !d.matchups.length) return;
      var pares = d.matchups.map(function (m) { return [idPorClave[m.teams[0]], idPorClave[m.teams[1]]]; })
        .filter(function (p) { return p[0] && p[1]; });
      if (pares.length) sy.push(pares);
    });
    L._hyd.schedule = sy;
    return sy;
  }
  var got = await mlPool(weeks, 4, function (w) { return mlGet('/league/' + L.id + '/matchups/' + w); });
  var sched = [];
  got.forEach(function (rows) {
    if (!rows || !rows.length) return;
    var by = {};
    rows.forEach(function (m) { if (m.matchup_id != null) (by[m.matchup_id] = by[m.matchup_id] || []).push(m.roster_id); });
    var pairs = Object.keys(by).map(function (k) { return by[k]; }).filter(function (p) { return p.length === 2; });
    if (pairs.length) sched.push(pairs);
  });
  L._hyd.schedule = sched;
  return sched;
}

/* ------------------------------------------------------------------- cache */
function mlCacheWrite() {
  try {
    localStorage.setItem(ML_CACHE_KEY, JSON.stringify({
      at: Date.now(), season: ML.season, week: ML.week, userId: ML.userId,
      username: ML.username, leagues: ML.leagues
    }));
  } catch (e) { /* almacenamiento lleno o bloqueado: la pantalla funciona igual */ }
}
function mlCacheRead() {
  try {
    var d = JSON.parse(localStorage.getItem(ML_CACHE_KEY) || 'null');
    if (!d || Date.now() - d.at > ML_CACHE_MS) return null;
    if ((d.username || '') !== (localStorage.getItem('tm_username') || '').trim()) return null;
    return { season: d.season, week: d.week, userId: d.userId, username: d.username, leagues: d.leagues || [] };
  } catch (e) { return null; }
}

/* --------------------------------------------------- identidad de cada liga */
// Catorce ligas con el mismo aspecto son catorce filas que hay que LEER. Con un
// escudo y un color propios, se reconocen de un vistazo.
//
// El color NO es aleatorio: sale del id de la liga, asi que "Gente seria" es
// siempre el mismo verde, aqui, en el tablero de odds y en el hub. Un color por
// sesion decoraria sin servir para reconocer. Saturacion y brillo van fijos
// para que catorce colores se lean como sistema y no como ensalada de frutas.
function mlHash(str) {
  var h = 0, x = String(str || '');
  for (var i = 0; i < x.length; i++) { h = (h * 31 + x.charCodeAt(i)) >>> 0; }
  return h;
}
function mlLigaColor(L) {
  var tono = mlHash(L && L.id) % 360;
  // El morado de la marca (250-290) se reserva para la interfaz: si una liga se
  // pinta del color del producto, deja de distinguirse de los botones.
  if (tono > 245 && tono < 295) tono = (tono + 70) % 360;
  return 'hsl(' + tono + ' 62% 58%)';
}
function mlIniciales(nombre) {
  var partes = String(nombre || '?').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}
// Nunca un circulo vacio: si no hay imagen, va un monograma con el color de la
// liga. Un hueco gris se lee como algo que no cargo.
function mlEscudo(url, nombre, color, clase) {
  var ini = mlEsc(mlIniciales(nombre));
  var mono = '<span class="ml-mono ' + (clase || '') + '" style="--c:' + color + '">' + ini + '</span>';
  if (!url) return mono;
  // Si la imagen falla, el monograma que ya esta debajo queda a la vista.
  return '<span class="ml-shield ' + (clase || '') + '" style="--c:' + color + '">'
    + '<span class="ml-mono-bg">' + ini + '</span>'
    + '<img src="' + mlEsc(url) + '" alt="" loading="lazy" onerror="this.remove()">'
    + '</span>';
}
function mlLigaEscudo(L, clase) {
  var url = L.plat === 'yahoo'
    ? (L.logo || null)
    : (L.avatar ? 'https://sleepercdn.com/avatars/thumbs/' + L.avatar : null);
  return mlEscudo(url, L.name, mlLigaColor(L), clase);
}
// El del manager: primero la foto que EL subio, que es la que se ve bien, y
// despues el avatar generico de Sleeper.
function mlTeamEscudo(L, rosterId, clase) {
  var H = L._hyd; if (!H) return '';
  var r = (H.rosters || []).filter(function (x) { return x.roster_id === rosterId; })[0];
  var u = r && H.users[r.owner_id];
  var url = null;
  if (L.plat === 'yahoo') url = (r && r.logo) || (u && u.logo) || null;
  else if (u) url = (u.metadata && u.metadata.avatar) || (u.avatar ? 'https://sleepercdn.com/avatars/thumbs/' + u.avatar : null);
  return mlEscudo(url, mlTeamName(L, rosterId), mlLigaColor(L), clase);
}

// Cuando juega una liga que todavia no drafteo. Es informacion de SU liga, no
// una funcion de mock draft.
function mlCuandoDraftea(L) {
  if (!L.draftAt) return null;
  var faltan = L.draftAt - Date.now();
  var d = new Date(L.draftAt);
  var dia = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  var hora = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (faltan < 0) return 'Drafting now';
  var horas = faltan / 3600000;
  if (horas < 1) return 'Drafts in ' + Math.max(1, Math.round(faltan / 60000)) + ' min';
  if (horas < 24) return 'Drafts today at ' + hora;
  if (horas < 48) return 'Drafts tomorrow at ' + hora;
  return 'Drafts ' + dia + ' at ' + hora;
}

// El marcador de verdad, cuando la jornada ya empezo. Una proyeccion a las dos
// de la tarde del domingo es un numero muerto: lo que quieres saber es como vas.
function mlEnVivo(L) {
  var H = L._hyd; if (!H || !H.mine || H.opp == null) return null;
  var fila = function (rid) {
    return (H.matchups || []).filter(function (m) { return m.roster_id === rid; })[0];
  };
  var mio = fila(H.mine.roster_id), suyo = fila(H.opp);
  var a = mio ? Number(mio.points) || 0 : 0;
  var b = suyo ? Number(suyo.points) || 0 : 0;
  if (a <= 0 && b <= 0) return null;   // todavia no ha jugado nadie
  return { mio: a, suyo: b };
}

/* ------------------------------------------------------------------ ayudas */
function mlTeamName(L, rosterId) {
  var H = L._hyd; if (!H) return 'Team ' + rosterId;
  var r = (H.rosters || []).filter(function (x) { return x.roster_id === rosterId; })[0];
  if (!r) return 'Team ' + rosterId;
  var u = H.users[r.owner_id];
  return (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || ('Team ' + rosterId);
}
function mlRecord(r) {
  var s = (r && r.settings) || {};
  var t = Number(s.ties) || 0;
  return (Number(s.wins) || 0) + '-' + (Number(s.losses) || 0) + (t ? '-' + t : '');
}
function mlEsBestBall(L) {
  // Sleeper lo marca de dos maneras: type 3, o una liga normal con la casilla
  // best_ball puesta. Mirar solo el type deja fuera a la mitad.
  return L.type === 3 || Number((L.settings || {}).best_ball) === 1;
}
function mlFormat(L) {
  if (mlEsBestBall(L)) return 'Best ball';
  if (L.type === 2) return 'Dynasty';
  if (L.type === 1) return 'Keeper';
  return 'Redraft';
}
// Una liga sin draftear no tiene plantel, asi que no tiene proyeccion, asi que
// no tiene linea. Se dice, no se pinta un 0.0 contra 0.0.
function mlDrafted(L) {
  var H = L._hyd; if (!H || !H.mine) return false;
  if (L.status === 'pre_draft' || L.status === 'drafting') return false;
  return ((H.mine.players || []).length > 0);
}
function mlIsHeadToHead(L) {
  // Los formatos "chopped" y best ball de Sleeper no tienen duelos ni playoffs
  // por siembra: simular un titulo ahi seria inventar un torneo que no existe.
  return !mlEsBestBall(L) && Number((L.settings || {}).playoff_teams) > 0;
}
function mlScoringLabel(L) {
  var r = mlScoring(L).rec;
  return r >= 1 ? 'PPR' : (r > 0 ? 'Half PPR' : 'Standard');
}
function mlSuperflex(L) {
  return (L.roster_positions || []).indexOf('SUPER_FLEX') !== -1;
}
// Ligas con jugadores defensivos individuales (IDP). Sus casillas (LB, DB, DL,
// IDP_FLEX) no tienen linea de mercado, asi que la proyeccion solo cubre el
// lado ofensivo. Se DECLARA: el duelo sigue siendo comparable (a los dos
// equipos les falta lo mismo), pero fingir que el numero es completo seria
// mentir.
var ML_IDP = { LB: 1, DB: 1, DL: 1, DE: 1, DT: 1, CB: 1, S: 1, IDP: 1, IDP_FLEX: 1 };
function mlEsIdp(L) {
  return (L.roster_positions || []).some(function (sl) { return ML_IDP[sl]; });
}

/* ------------------------------------------------------------------ pintado */
function mlPaint() {
  var host = document.getElementById('screen-myleagues');
  if (!host) return;
  mlPaintLeagues();
  mlPaintPlayers();
  mlPaintOdds();
  var sub = document.getElementById('ml-sub');
  if (sub) {
    // "Not connected" solo puede decirse cuando el arranque TERMINO y de
    // verdad no hay cuenta. El primer pintado corre antes de que mlBoot lea el
    // localStorage, y en ese hueco le decia "Not connected" a un usuario
    // conectado (reportado por el dueno, 2026-09-10).
    var guardado = '';
    try { guardado = localStorage.getItem('tm_username') || ''; } catch (e) { }
    var hayCuenta = ML.username || guardado || mlYahooConectado();
    sub.textContent = ML.ready && ML.username
      ? ('Week ' + ML.week)
      : (hayCuenta ? 'Loading...' : 'Not connected');
  }
}

// El aviso va en LAS TRES pestanas, no solo en la primera: quien entra directo a
// My Players tiene el mismo derecho a saber que esta viendo un ejemplo.
function mlAvisoDemo() {
  if (!ML.demo) return '';
  return '<div class="ml-demo-bar"><b>A live example.</b> Six made up leagues, real players. '
    + '<button class="ml-link" onclick="mlSalirDemo()">Connect mine</button></div>';
}

function mlSkeleton(rows) {
  var h = '';
  for (var i = 0; i < (rows || 3); i++) h += '<div class="ml-sk"></div>';
  return h;
}

function mlNeedsConnect() {
  return '<div class="ml-empty">'
    + '<div class="ml-empty-h">Bring your leagues in</div>'
    + '<p>Every league you play lands here: your record, who you face this week, and every player you own across all of them. Sleeper and Yahoo together, in one list.</p>'
    + '<div class="ml-conn"><input id="ml-user" placeholder="Sleeper username" autocapitalize="off" autocorrect="off" spellcheck="false">'
    + '<button class="btn-sm" onclick="mlConnect()">Connect Sleeper</button></div>'
    + '<div class="ml-or">or</div>'
    + mlYahooBtn()
    + '<div id="ml-conn-err" class="ml-err-line">' + (ML.yahooErr ? mlEsc(ML.yahooErr) : '') + '</div></div>';
}

function mlYahooBtn() {
  return mlYahooConectado()
    ? '<button class="ml-y is-on" onclick="mlYahooDisconnect()"><span class="ml-y-dot"></span>Yahoo connected. Disconnect</button>'
    : '<button class="ml-y" onclick="mlYahooConnect()">Sign in with Yahoo</button>';
}

function mlConnect() {
  var el = document.getElementById('ml-user');
  var v = (el && el.value || '').trim();
  var err = document.getElementById('ml-conn-err');
  if (!v) { if (err) err.textContent = 'Type your Sleeper username first.'; return; }
  try { localStorage.setItem('tm_username', v); } catch (e) {}
  if (err) err.textContent = '';
  ML.ready = false;
  mlPaint();
  mlBoot(true);
}

function mlRefresh() {
  ML.ready = false; ML.sims = {};
  ML.leagues.forEach(function (L) { if (L._hyd) L._hyd.schedule = null; });
  mlPaint();
  mlBoot(true);
}

/* ---------------------------------------------------------- pestana Leagues */
function mlPaintLeagues() {
  var box = document.getElementById('ml-leagues-body');
  if (!box) return;
  if (!ML.username && !mlYahooConectado()) { box.innerHTML = mlNeedsConnect(); return; }
  if (!ML.ready) { box.innerHTML = mlSkeleton(4); return; }
  if (ML.err) { box.innerHTML = '<div class="ml-empty"><div class="ml-empty-h">Could not load your leagues</div><p>' + mlEsc(ML.err) + '</p><button class="btn-sm" onclick="mlRefresh()">Try again</button></div>'; return; }
  if (!ML.leagues.length) {
    box.innerHTML = '<div class="ml-empty"><div class="ml-empty-h">No leagues on this account for ' + mlEsc(ML.season) + '</div><p>Check the username, or connect a different one.</p>'
      + '<div class="ml-conn"><input id="ml-user" value="' + mlEsc(ML.username) + '" placeholder="Sleeper username"><button class="btn-sm" onclick="mlConnect()">Connect</button></div>'
      + '<div class="ml-or">or</div>' + mlYahooBtn() + '</div>';
    return;
  }

  // Las ligas en juego arriba; las que aun no draftean, al final. Y dentro de
  // cada grupo, primero la mas APRETADA (el vivo mas cerrado, o el pronostico
  // mas cerca de la moneda al aire): es donde todavia puedes hacer algo.
  var apriete = function (L) {
    if (!mlDrafted(L) || !L._hyd || !L._hyd.mine || L._hyd.opp == null) return 999;
    var v = mlEnVivo(L);
    if (v) return Math.abs(v.mio - v.suyo);
    var m = (L._hyd.proj[L._hyd.mine.roster_id] || {}).total || 0;
    var o = (L._hyd.proj[L._hyd.opp] || {}).total || 0;
    return Math.abs(mlWinProb(m, o) - 0.5) * 100;
  };
  var orden = ML.leagues.slice().sort(function (a, b) {
    var da = mlDrafted(a) ? 0 : 1, db = mlDrafted(b) ? 0 : 1;
    if (da !== db) return da - db;
    var ua = apriete(a), ub = apriete(b);
    if (ua !== ub) return ua - ub;
    return (a.name || '').localeCompare(b.name || '');
  });
  var visibles = orden.filter(mlPasaFiltro);

  // Arriba SOLO lo que se usa a diario: tres controles por encima del contenido
  // son tres cosas que leer antes de llegar a lo que vienes a ver.
  var h = mlAvisoDemo()
    + mlFiltrosUI(orden, visibles)
    + (ML.stale ? '<p class="ml-hint" style="margin:-6px 0 12px">Showing your last saved copy: could not reach Sleeper just now.</p>' : '');

  if (!visibles.length) {
    return void (box.innerHTML = h + '<div class="ml-empty"><p>No leagues match that filter.</p></div>');
  }

  h += mlCabeceraSemana(visibles);
  h += mlPanelAlineaciones();
  h += mlRecapCard();

  h += '<div class="ml-grid">';
  visibles.forEach(function (L) {
    var H = L._hyd, mine = H.mine;
    var color = mlLigaColor(L);
    var myProj = (H.proj[mine.roster_id] || {}).total || 0;
    var oppId = H.opp;
    var oppProj = oppId != null ? ((H.proj[oppId] || {}).total || 0) : null;
    var vivo = mlEnVivo(L);
    var cuerpo = '';

    if (!mlDrafted(L)) {
      var cuando = mlCuandoDraftea(L);
      cuerpo = '<div class="ml-vs-none">' + (cuando
        ? '<b class="ml-when">' + mlEsc(cuando) + '</b>'
        : 'Rosters are not set yet.') + '</div>';
    } else if (oppId != null) {
      var wp = mlWinProb(myProj, oppProj);
      var favorito = myProj >= oppProj;
      // Con la jornada en marcha manda el MARCADOR; la proyeccion baja a letra
      // chica. Al reves seria enseñar el pronostico del tiempo durante la
      // tormenta.
      var izq = vivo ? mlN(vivo.mio) : mlN(myProj);
      var der = vivo ? mlN(vivo.suyo) : mlN(oppProj);
      cuerpo = '<div class="ml-vs">'
        + '<div class="ml-vs-side">' + mlTeamEscudo(L, mine.roster_id, 'is-sm')
        + '<span class="ml-vs-lbl">You</span><span class="mono ml-vs-num">' + izq + '</span></div>'
        + '<div class="ml-vs-mid"><span class="ml-vs-at">' + (vivo ? 'live' : 'vs') + '</span></div>'
        + '<div class="ml-vs-side ml-vs-opp">' + mlTeamEscudo(L, oppId, 'is-sm')
        + '<span class="ml-vs-lbl">' + mlEsc(mlTeamName(L, oppId)) + '</span>'
        + '<span class="mono ml-vs-num">' + der + '</span></div>'
        + '</div>'
        // UNA cifra de veredicto por tarjeta (veredicto Jobs 11-sep): en vivo
        // el delta del marcador; antes, el porcentaje en texto plano. El
        // spread firmado se leia al reves (el menos del favorito) y el aro
        // chico era el mismo trazo del aro grande a otra escala.
        + '<div class="ml-vs-odds ' + (favorito ? 'is-fav' : 'is-dog') + '">'
        + (vivo
          ? '<span class="ml-live"><i></i>' + (vivo.mio >= vivo.suyo ? 'winning by ' + mlN(vivo.mio - vivo.suyo) : 'down ' + mlN(vivo.suyo - vivo.mio)) + '</span>'
          : '<span>' + mlPct(wp) + '% to win</span>')
        + '</div>';
    } else {
      cuerpo = '<div class="ml-vs-none">No matchup this week</div>';
    }

    var flags = [mlFormat(L), mlScoringLabel(L) + (L._scoringGuess ? ' (assumed)' : ''), L.teams + ' teams'];
    if (mlSuperflex(L)) flags.push('Superflex');
    if (mlEsIdp(L)) flags.push('IDP');
    var esCampeon = L.champId != null && L.champId === mine.roster_id;

    // Toda la tarjeta abre el matchup (pedido del dueno): los botones de
    // adentro paran la propagacion por ser <button>, el manejador los filtra.
    var abre = mlDrafted(L) && H.opp != null
      ? ' role="button" tabindex="0" onclick="mlCardClick(event,\'' + L.id + '\')" onkeydown="if(event.key===\'Enter\')mlOpenMatchup(\'' + L.id + '\')"' : '';
    h += '<article class="ml-card' + (L === visibles[0] && mlDrafted(L) && H.opp != null ? ' is-lead' : '') + '" style="--liga:' + color + '"' + abre + '>'
      + '<header class="ml-card-h">' + mlLigaEscudo(L, 'is-lg')
      + '<div class="ml-card-id"><h3>' + mlEsc(L.name) + '</h3>'
      + '<span class="ml-card-sub">' + (L.plat === 'yahoo' ? 'Yahoo' : 'Sleeper') + '</span></div>'
      + (mlRecord(mine) === '0-0' ? '' : '<span class="ml-rec mono">' + mlRecord(mine) + '</span>') + '</header>'
      + (esCampeon ? '<div class="ml-champ-tag">Defending champion</div>' : '')
      + '<div class="ml-flags">' + flags.map(function (f) { return '<span>' + mlEsc(f) + '</span>'; }).join('') + '</div>'
      + cuerpo
      + '</article>';
  });
  h += '</div>';
  // El pie: las dos acciones de UNA VEZ (conectar Yahoo, abrir una liga con un
  // codigo). Encontrables, pero fuera del camino de lo que se mira a diario.
  if (!ML.demo) {
    h += '<footer class="ml-foot">'
      + (orden.length < ML_MIN_FILTROS
        ? '<button class="ml-link" onclick="mlRefresh()">Refresh</button>' : '')
      + (mlYahooConectado() ? '' : mlYahooBtn())
      + '<button class="ml-link" onclick="switchScreen(\'hub\')">Have a league code?</button>'
      + '<button class="ml-link" id="ml-push-btn">Get notified</button>'
      + (ML.yahooErr ? '<span class="ml-err-line">Yahoo: ' + mlEsc(ML.yahooErr) + '</span>' : '')
      + '</footer>';
  }
  box.innerHTML = h;
  if (window.tmPushMontar) tmPushMontar();
  mlCargarRecap();
}

/* ------------------------------------------------------------------ el aro */
// El patron WHOOP, traido a proposito: UN numero grande que resume, dentro de
// un aro, y la letra chica debajo que lo explica. El aro es el veredicto; la
// lista es el porque. Nunca los dos en el mismo plano.
// El color es semantico y sobrio (regla robada de Sleeper: color solo cuando
// dice algo): verde ganando o favorito, ambar moneda al aire, rojo por detras.
function mlAro(pct, size, etiqueta) {
  var p = Math.max(0, Math.min(100, pct));
  var r = (size / 2) - Math.max(3, size * 0.06);
  var c = 2 * Math.PI * r;
  var color = p >= 55 ? 'var(--green)' : (p >= 45 ? 'var(--yellow)' : 'var(--red)');
  var grosor = Math.max(3, Math.round(size * 0.065));
  var fs = Math.round(size * (size > 80 ? 0.24 : 0.3));
  return '<div class="ml-aro" style="width:' + size + 'px;height:' + size + 'px">'
    + '<svg viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">'
    + '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--surface3)" stroke-width="' + grosor + '"/>'
    + '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + grosor + '"'
    + ' stroke-linecap="round" stroke-dasharray="' + (c * p / 100).toFixed(1) + ' ' + c.toFixed(1) + '"'
    + ' transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>'
    + '</svg>'
    + '<div class="ml-aro-n"><b class="mono" style="font-size:' + fs + 'px">' + Math.round(p) + '<i>%</i></b>'
    + (etiqueta ? '<span>' + mlEsc(etiqueta) + '</span>' : '') + '</div></div>';
}

// La cabecera del domingo: el aro con tu probabilidad media, y las cuatro
// cifras que lo explican. Solo cuando hay duelos que resumir.
function mlCabeceraSemana(ligas) {
  var conDuelo = ligas.filter(function (L) {
    return mlDrafted(L) && L._hyd && L._hyd.mine && L._hyd.opp != null;
  });
  if (conDuelo.length < 2) return '';   // con una liga, la tarjeta ya lo dice todo
  var enVivo = 0, ganando = 0, puntos = 0, sumaWp = 0;
  var peor = null;
  conDuelo.forEach(function (L) {
    var H = L._hyd;
    var mio = (H.proj[H.mine.roster_id] || {}).total || 0;
    var suyo = (H.proj[H.opp] || {}).total || 0;
    var wp = mlWinProb(mio, suyo);
    var vivo = mlEnVivo(L);
    if (vivo) { enVivo++; puntos += vivo.mio; if (vivo.mio >= vivo.suyo) ganando++; }
    else { puntos += 0; if (wp >= 0.5) ganando++; }
    sumaWp += wp;
    if (!peor || wp < peor.wp) peor = { L: L, wp: wp };
  });
  var media = sumaWp / conDuelo.length * 100;
  var fix = mlAlineacionesRotas();
  var fixPts = fix.reduce(function (a, x) { return a + x.r.gana; }, 0);
  return '<section class="ml-week">'
    + mlAro(media, 118, 'avg win chance')
    + '<div class="ml-week-list">'
    + '<div class="ml-week-row"><span>' + (enVivo ? 'Winning' : 'Favored') + '</span>'
    + '<b class="mono">' + ganando + ' of ' + conDuelo.length + '</b></div>'
    + '<div class="ml-week-row"><span>Toughest matchup</span><b>' + (peor ? mlEsc(peor.L.name) : '-') + '</b></div>'
    + (fix.length ? '' : '<div class="ml-week-row"><span>Bench points to claim</span><b class="mono">none</b></div>')
    + '</div></section>';
}

/* ------------------------------------------------- el recap del martes */
function mlCargarRecap() {
  if (ML.recap !== undefined) return;
  ML.recap = null;
  fetch('/api/push/recap-doc').then(function (r) { return r.json(); }).then(function (d) {
    if (d && d.recap && Date.now() - d.recap.at < 3 * 24 * 3600 * 1000) {
      var visto = 0;
      try { visto = Number(localStorage.getItem('tm_recap_seen')) || 0; } catch (e) { }
      if (visto !== d.recap.at) { ML.recap = d.recap; mlPaintLeagues(); }
    }
  }).catch(function () { });
}
function mlCerrarRecap() {
  try { localStorage.setItem('tm_recap_seen', String((ML.recap || {}).at || Date.now())); } catch (e) { }
  ML.recap = null; mlPaintLeagues();
}
function mlRecapCard() {
  var r = ML.recap;
  if (!r) return '';
  var h = '<section class="ml-recap"><header class="ml-recap-h">'
    + '<div><h3>Tuesday recap · Week ' + r.week + '</h3>'
    + '<p class="ml-sub2">You went <b>' + r.wins + '-' + (r.total - r.wins) + '</b>'
    + (r.mejor ? ', best win in ' + mlEsc(r.mejor) : '') + '.</p></div>'
    + '<button class="ml-link" onclick="mlCerrarRecap()" aria-label="Dismiss">Close</button></header>';
  if ((r.takeaways || []).length > 1) {
    h += '<ul class="ml-recap-tk">' + r.takeaways.slice(1).map(function (t) {
      return '<li>' + mlEsc(t) + '</li>';
    }).join('') + '</ul>';
  }
  var buenas = (r.decisiones || []).filter(function (d) { return d.tipo === 'buena'; });
  var malas = (r.decisiones || []).filter(function (d) { return d.tipo === 'mala'; });
  if (buenas.length || malas.length) {
    h += '<div class="ml-recap-cols">';
    if (buenas.length) {
      h += '<div><h4>Good calls</h4>' + buenas.slice(0, 3).map(function (d) {
        return '<p><b>' + mlEsc(d.league) + '</b> ' + mlEsc(d.texto) + '</p>';
      }).join('') + '</div>';
    }
    if (malas.length) {
      h += '<div><h4>Went against you</h4>' + malas.slice(0, 3).map(function (d) {
        return '<p><b>' + mlEsc(d.league) + '</b> ' + mlEsc(d.texto) + '</p>';
      }).join('') + '</div>';
    }
    h += '</div>';
  }
  if ((r.targets || []).length) {
    h += '<div class="ml-recap-buy"><h4>Buy-low windows</h4>'
      + r.targets.map(function (t) {
        return '<div class="ml-recap-t">' + mlFace(t.id)
          + '<div><b>' + mlEsc(t.name) + '</b> <span>' + mlEsc(t.pos) + '</span>'
          + '<p>' + mlEsc(t.reason) + '</p></div></div>';
      }).join('') + '</div>';
  }
  return h + '</section>';
}

/* --------------------------------------------- el panel de las alineaciones */
// Va ARRIBA de las ligas y solo cuando hay algo que arreglar. Es la unica cosa
// de esta pantalla sobre la que se puede ACTUAR ahora mismo, y en domingo por la
// mañana es lo unico que importa: el resto es informacion.
function mlPanelAlineaciones() {
  var rotas = mlAlineacionesRotas();
  if (!rotas.length) return '';
  var total = Math.round(rotas.reduce(function (a, x) { return a + x.r.gana; }, 0) * 10) / 10;
  var h = '<section class="ml-fix"><header class="ml-fix-h">'
    + '<div><h3>' + rotas.length + ' lineup' + (rotas.length === 1 ? '' : 's') + ' to fix</h3>'
    + '<p>There are <b>' + mlN(total) + ' projected points</b> sitting on your bench right now.</p></div>'
    + '<span class="ml-fix-n mono">+' + mlN(total) + '</span></header>'
    + '<div class="ml-fix-list">';
  rotas.slice(0, 6).forEach(function (x) {
    var L = x.L;
    h += '<div class="ml-fix-row" style="--liga:' + mlLigaColor(L) + '">'
      + '<div class="ml-fix-liga">' + mlLigaEscudo(L, 'is-sm')
      + '<span>' + mlEsc(L.name) + '</span></div>'
      + '<div class="ml-fix-moves">'
      + x.r.cambios.slice(0, 2).map(function (c) {
        return '<span class="ml-fix-move"><b>' + mlEsc(c.entra.p.name) + '</b> in for '
          + mlEsc(c.sale.p ? c.sale.p.name : 'an empty slot')
          + ' <i class="mono">+' + mlN(c.gana) + '</i></span>';
      }).join('')
      + '</div></div>';
  });
  h += '</div><p class="ml-fine">Your starters against the best lineup your roster allows, '
    + 'scored with each league\'s own rules. Change it in Sleeper or Yahoo: this only tells you.</p></section>';
  return h;
}

/* ------------------------------------------------------------------ filtros */
// Con catorce ligas, mirar solo las de un formato o las de una plataforma deja
// de ser un lujo. Cada opcion lleva su conteo: un filtro que lleva a cero es
// una via muerta que se ve venir.
function mlPasaFiltro(L) {
  var f = ML.filtro || {};
  if (f.formato && f.formato !== 'all' && mlFormat(L) !== f.formato) return false;
  if (f.plat && f.plat !== 'all' && (L.plat || 'sleeper') !== f.plat) return false;
  return true;
}
function mlSetFiltro(clave, valor) {
  ML.filtro = ML.filtro || {};
  ML.filtro[clave] = valor;
  mlPaintLeagues();
}
// Umbral a partir del cual filtrar deja de ser ruido. Con tres ligas no hay
// nada que filtrar: enseñar el control es enseñar una solucion a un problema
// que esa persona no tiene, y es lo primero que ve al entrar.
var ML_MIN_FILTROS = 5;

function mlFiltrosUI(todas, visibles) {
  var f = ML.filtro || {};
  if (todas.length < ML_MIN_FILTROS) {
    // Sin filtros, Refresh baja al pie con las demas acciones sueltas.
    return '';
  }
  var formatos = {};
  todas.forEach(function (L) { formatos[mlFormat(L)] = (formatos[mlFormat(L)] || 0) + 1; });
  var plats = {};
  todas.forEach(function (L) { var k = L.plat || 'sleeper'; plats[k] = (plats[k] || 0) + 1; });

  var chip = function (clave, valor, texto, n, activo) {
    return '<button class="ml-chip' + (activo ? ' is-on' : '') + '" onclick="mlSetFiltro(\'' + clave + '\',\'' + valor + '\')">'
      + mlEsc(texto) + '<span>' + n + '</span></button>';
  };
  var h = '<div class="ml-filters">';
  // La misma regla que la plataforma tenia escrita abajo: un filtro con una
  // sola opcion es ruido. Un formato con conteo 1 no gana pastilla (la liga
  // ya esta a la vista), y con una sola categoria tampoco se pinta "All".
  var fmtKeys = Object.keys(formatos).sort().filter(function (k) { return formatos[k] > 1; });
  if (fmtKeys.length > 1) {
    h += chip('formato', 'all', 'All', todas.length, !f.formato || f.formato === 'all');
    fmtKeys.forEach(function (k) {
      h += chip('formato', k, k, formatos[k], f.formato === k);
    });
  }
  // La plataforma solo se ofrece cuando de verdad hay dos: un filtro con una
  // sola opcion es ruido.
  if (Object.keys(plats).length > 1) {
    h += '<span class="ml-filters-sep"></span>';
    h += chip('plat', 'all', 'Both', todas.length, !f.plat || f.plat === 'all');
    Object.keys(plats).forEach(function (k) {
      h += chip('plat', k, k === 'yahoo' ? 'Yahoo' : 'Sleeper', plats[k], f.plat === k);
    });
  }
  // Refresh va con los filtros y no en una fila propia: un boton solo ocupaba
  // una linea entera de un telefono para una accion que se usa poco.
  if (!ML.demo) {
    h += '<button class="ml-chip ml-chip-ref" onclick="mlRefresh()" title="Pull new scores">'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>Refresh</button>';
  }
  h += '</div>';
  if (visibles.length !== todas.length) {
    h += '<p class="ml-hint" style="margin:-6px 0 12px">Showing ' + visibles.length + ' of ' + todas.length + '.</p>';
  }
  return h;
}

/* ------------------------------------------------------- pestana My Players */
// El cruce que ninguna app hace: no "un jugador de la liga B", sino a quien
// estas expuesto de verdad, y contra quien de los tuyos juegas este domingo.
// La clave es el NOMBRE normalizado, no el id de la plataforma. Sin esto, el
// mismo jugador en una liga de Sleeper y en una de Yahoo serian dos personas
// distintas y toda la pantalla perderia su razon de ser.
var _mlNombreIdx = null, _mlNombreIdxN = 0;
function mlIdPorNombre(nombre) {
  var P = ML.players || {};
  var n = Object.keys(P).length;
  // Reconstruir si el maestro CRECIO: la primera version cacheaba el indice
  // para siempre, y si la primera llamada corria antes de cargar el maestro,
  // quedaba VACIO y ningun jugador de Yahoo volvia a tener foto (reportado por
  // el dueno: todas las fotos del matchup en blanco).
  if (!_mlNombreIdx || n !== _mlNombreIdxN) {
    _mlNombreIdx = {}; _mlNombreIdxN = n;
    // MANDA EL QUE TIENE EQUIPO DE VERDAD, no el primero que aparezca. El
    // maestro de Sleeper lleva a todo el que paso por la liga, asi que un
    // nombre repetido casi siempre son un titular y un retirado, y el orden de
    // las claves no distingue. Medido contra el maestro del 2026-09-10: 40
    // nombres repetidos, 8 se resuelven distinto con esta regla, 3 de ellos
    // pasan de NO tener proyeccion a tenerla, y ninguno la pierde.
    // Duele solo en las ligas de YAHOO, que es donde un jugador llega sin id y
    // esta es la unica forma de encontrarlo: Kenneth Walker (III) caia en un
    // receptor retirado y su titular de 14,1 puntos entraba al once como 1,0,
    // el percentil 25 de los RB. Trece puntos de menos por jugador, en el
    // lado bajo siempre.
    Object.keys(P).forEach(function (id) {
      var p = P[id];
      var k = mlNorm(p && p.name);
      if (!k) return;
      var antes = _mlNombreIdx[k];
      if (!antes) { _mlNombreIdx[k] = id; return; }
      var tiene = function (x) { var t = P[x] && P[x].team; return !!t && t !== 'FA'; };
      if (!tiene(antes) && tiene(id)) _mlNombreIdx[k] = id;
    });
  }
  return _mlNombreIdx[mlNorm(nombre)] || null;
}
// Un elemento de plantel puede ser un id de Sleeper o un jugador de Yahoo.
function mlResolver(item, players) {
  var p = (item && typeof item === 'object') ? item : (players || ML.players || {})[item];
  if (!p || !p.name) return null;
  var sid = p.id || mlIdPorNombre(p.name);
  return { clave: mlNorm(p.name), name: p.name, pos: p.pos || '?', team: p.team || 'FA', sid: sid };
}

function mlExposure() {
  var mine = {}, against = {}, ficha = {};
  var players = ML.players || {};
  var anotar = function (dest, item, L) {
    var r = mlResolver(item, players);
    if (!r || !r.clave) return;
    ficha[r.clave] = ficha[r.clave] || r;
    (dest[r.clave] = dest[r.clave] || []).push(L);
  };
  ML.leagues.forEach(function (L) {
    var H = L._hyd; if (!H || !H.mine) return;
    if (!mlDrafted(L)) return;   // sin draftear no tienes a nadie en ella
    (H.mine.players || []).forEach(function (it) { anotar(mine, it, L); });
    if (H.opp != null) {
      var opp = (H.rosters || []).filter(function (r) { return r.roster_id === H.opp; })[0];
      var fila = (H.myMu && (H.muBy[H.myMu.matchup_id] || []).filter(function (m) { return m.roster_id === H.opp; })[0]) || null;
      var lista = (fila && fila.starters && fila.starters.length) ? fila.starters : ((opp && opp.players) || []);
      lista.forEach(function (it) { if (it && it !== '0') anotar(against, it, L); });
    }
  });
  return { mine: mine, against: against, ficha: ficha };
}

function mlPaintPlayers() {
  var box = document.getElementById('ml-players-body');
  if (!box) return;
  if (!ML.username) { box.innerHTML = mlNeedsConnect(); return; }
  if (!ML.ready) { box.innerHTML = mlSkeleton(6); return; }
  if (!ML.leagues.length) { box.innerHTML = '<div class="ml-empty"><p>Connect an account with leagues to see this.</p></div>'; return; }

  var ex = mlExposure();
  var avisoDemo = mlAvisoDemo();
  var rows = Object.keys(ex.mine).map(function (k) {
    var p = ex.ficha[k];
    return { id: (p && p.sid) || '', p: p, own: ex.mine[k], vs: ex.against[k] || [] };
  }).filter(function (r) { return r.p && r.p.pos !== 'DEF'; });

  rows.sort(function (a, b) {
    return (b.own.length - a.own.length) || (b.vs.length - a.vs.length) || a.p.name.localeCompare(b.p.name);
  });

  // Solo las ligas DRAFTEADAS: una liga sin plantel no puede contener a nadie,
  // asi que contarla solo sirve para que "4 de 13" suene peor de lo que es.
  // La cifra de la sub-linea DECLARA que cuenta solo esas, para que no rina
  // con el "12 leagues" de la cabecera.
  var total = ML.leagues.filter(mlDrafted).length || ML.leagues.length;
  var enContra = rows.filter(function (r) { return r.own.length && r.vs.length; }).length;

  var h = avisoDemo;
  h += '<section class="ml-expo"><h3>Your players, all leagues</h3>'
    + '<p class="ml-sub2">' + rows.length + ' players in your ' + total + ' drafted league' + (total === 1 ? '' : 's')
    + (enContra ? ', <em>' + enContra + ' also playing against you</em>' : '') + '. Sorted by how exposed you are.</p>'
    + '<div class="ml-rows">';
  var tope = ML.playersAll ? 400 : 20;
  rows.slice(0, tope).forEach(function (r) {
    h += '<div class="ml-row">'
      + mlFace(r.id)
      + '<div class="ml-row-main"><b>' + mlEsc(r.p.name) + '</b>'
      + '<span class="ml-row-meta">' + mlEsc(r.p.pos) + ' · ' + mlEsc(r.p.team || 'FA')
      + (r.vs.length ? ' · <em>' + r.vs.length + ' against you</em>' : '') + '</span></div>'
      + '<div class="ml-row-n mono" title="in ' + r.own.length + ' of your ' + total + ' leagues">' + r.own.length + '<span>/' + total + '</span></div>'
      + '</div>';
  });
  if (rows.length > tope) {
    h += '<button class="ml-link ml-showall" onclick="ML.playersAll=true;mlPaintPlayers()">Show all ' + rows.length + ' players</button>';
  }
  h += '</div></section>';
  box.innerHTML = h;
}

function mlFace(pid) {
  return '<img class="ml-face" src="https://sleepercdn.com/content/nfl/players/thumb/' + mlEsc(pid) + '.jpg" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
}

/* ------------------------------------------------------------ pestana Odds */
function mlOpenOdds(id) {
  ML.oddsLeague = id;
  if (typeof switchInnerTab === 'function') {
    var t = document.querySelector('#screen-myleagues .inner-tab[data-tab="tab-ml-odds"]');
    if (t) switchInnerTab(t, 'tab-ml-odds', 'screen-myleagues');
  }
  mlPaintOdds();
  mlRunSim(id);
}

// Tu domingo entero en una pantalla: un duelo por liga, el tuyo, ordenado por
// donde estas en problemas. Es la vista que ninguna app da, porque todas asumen
// que juegas una sola liga.
function mlTableroTodas() {
  var filas = [], enJuego = 0;
  ML.leagues.forEach(function (L) {
    if (!mlDrafted(L)) return;
    var H = L._hyd;
    if (!H || !H.mine || H.opp == null) return;
    var mio = (H.proj[H.mine.roster_id] || {}).total || 0;
    var suyo = (H.proj[H.opp] || {}).total || 0;
    // Con la jornada en marcha manda el MARCADOR, aqui igual que en las
    // tarjetas. Que el tablero siguiera enseñando proyecciones el domingo por la
    // tarde dejaba media pantalla viviendo en el futuro y la otra en el
    // presente, con dos cifras distintas para el mismo duelo.
    var vivo = mlEnVivo(L);
    if (vivo) enJuego++;
    filas.push({
      L: L, mio: mio, suyo: suyo, vivo: vivo, wp: mlWinProb(mio, suyo),
      rival: mlTeamName(L, H.opp), yo: mlTeamName(L, H.mine.roster_id)
    });
  });
  if (!filas.length) {
    return '<div class="ml-board"><div class="ml-board-empty">'
      + 'None of your leagues has a matchup posted for week ' + ML.week + ' yet.</div></div>';
  }
  // De peor a mejor: donde vas perdiendo es donde todavia puedes hacer algo.
  var vivoManda = enJuego > 0;
  filas.sort(function (a, b) {
    if (vivoManda) {
      var da = a.vivo ? (a.vivo.mio - a.vivo.suyo) : 999;
      var db = b.vivo ? (b.vivo.mio - b.vivo.suyo) : 999;
      return da - db;
    }
    return a.wp - b.wp;
  });
  // La columna del margen era la resta de las dos de al lado, y el resumen de
  // tres cifras de aqui arriba repetia el panel de Leagues con OTRO numero bajo
  // el mismo rotulo (221 vs 86 "points scored"). Los dos fuera: cada dato vive
  // en un solo sitio.
  var h = '<div class="ml-board' + (vivoManda ? ' is-live' : '') + '"><div class="ml-board-h"><span>Your matchup</span>'
    + '<span>You</span><span>Them</span>' + (vivoManda ? '' : '<span>Win</span>') + '</div>';
  filas.forEach(function (f) {
    var fav = f.mio >= f.suyo;
    var voyGanando = f.vivo ? f.vivo.mio >= f.vivo.suyo : fav;
    // El marcador manda cuando existe; la linea de antes del partido baja a
    // letra chica, como hace una casa de apuestas de verdad.
    var izq = f.vivo ? f.vivo.mio : f.mio;
    var der = f.vivo ? f.vivo.suyo : f.suyo;
    h += '<div class="ml-game' + (voyGanando ? ((f.vivo || f.wp > 0.6) ? ' is-hot' : '') : ' is-cold')
      + '" role="button" tabindex="0" onclick="mlOpenOdds(\'' + mlEsc(f.L.id) + '\')"'
      + ' onkeydown="if(event.key===\'Enter\')mlOpenOdds(\'' + mlEsc(f.L.id) + '\')">'
      + '<div class="ml-game-tag">' + mlEsc(f.L.name) + (f.vivo ? ' <i class="ml-live-dot"></i>' : '') + '</div>'
      + '<div class="ml-bd-row">'
      + '<div class="ml-bd-team"><b>' + mlEsc(f.yo) + (/^you$/i.test(f.yo) ? '' : ' <span class="ml-you">you</span>') + ' vs ' + mlEsc(f.rival) + '</b>'
      + '<span class="mono">' + (f.vivo
        ? 'proj ' + mlN(f.mio) + ' - ' + mlN(f.suyo)
        : mlN(f.mio) + ' - ' + mlN(f.suyo) + (vivoManda ? ' · ' + mlPct(f.wp) + '% to win' : '')) + '</span></div>'
      + '<div class="ml-cell mono' + (voyGanando ? ' is-fav' : '') + '">' + mlN(izq) + '</div>'
      + '<div class="ml-cell mono">' + mlN(der) + '</div>'
      // Con la jornada en marcha la tercera columna es EL MARGEN. Un partido no
      // empezado no tiene margen: guion, y su % baja a la letra chica. Antes
      // salian porcentajes bajo la cabecera "Margin": dos unidades distintas en
      // la misma columna (visto en el recorrido de UX del 10-sep).
      + (vivoManda ? '' : '<div class="ml-cell mono ml-tot">' + mlPct(f.wp) + '%</div>')
      + '</div>'
      + '</div>';
  });
  return h + '</div>';
}

function mlPaintOdds() {
  var box = document.getElementById('ml-odds-body');
  if (!box) return;
  if (!ML.username) { box.innerHTML = mlNeedsConnect(); return; }
  if (!ML.ready) { box.innerHTML = mlSkeleton(5); return; }
  if (!ML.leagues.length) { box.innerHTML = '<div class="ml-empty"><p>Connect an account with leagues to see this.</p></div>'; return; }
  // En la demo las proyecciones ya vienen puestas: no hacen falta las lineas de
  // la semana, y enseñar "el tablero esta cerrado" a quien viene a entender que
  // hace esto seria la peor primera impresion posible.
  if (!ML.props && !ML.demo) {
    box.innerHTML = '<div class="ml-empty"><div class="ml-empty-h">Odds are not ready yet</div>'
      + '<p>Lines need this week\'s player numbers and they are not loaded right now. Everything else on this screen still works.</p></div>';
    return;
  }

  // El tablero abre en TODAS tus ligas: el domingo no juegas una, juegas las que
  // tengas. Elegir una liga es un filtro sobre el mismo tablero, no otra
  // pantalla: dos tableros serian el mismo codigo dos veces y se separan solos.
  var todas = !ML.oddsLeague || ML.oddsLeague === 'all';
  var sel = !todas && ML.leagues.filter(function (L) { return L.id === ML.oddsLeague; })[0];
  if (!todas && !sel) { todas = true; ML.oddsLeague = 'all'; }

  var h = mlAvisoDemo() + '<div class="ml-book">';
  h += '<div class="ml-proy-tog" role="group" aria-label="Projection source">'
    + '<span>Projections</span>'
    + '<button class="ml-chip' + (ML.fuenteProy === 'site' ? ' is-on' : '') + '" onclick="mlSetProy(\'site\')">Experts</button>'
    + '<button class="ml-chip' + (ML.fuenteProy === 'vegas' ? ' is-on' : '') + '" onclick="mlSetProy(\'vegas\')">Vegas</button>'
    + '</div>';
  h += '<div class="ml-book-top"><select id="ml-odds-sel" onchange="mlOpenOdds(this.value)" aria-label="League">'
    + '<option value="all"' + (todas ? ' selected' : '') + '>All leagues</option>'
    + ML.leagues.map(function (L) {
      return '<option value="' + mlEsc(L.id) + '"' + (!todas && L.id === sel.id ? ' selected' : '') + '>' + mlEsc(L.name) + '</option>';
    }).join('') + '</select>'
    + '</div>';

  if (todas) { box.innerHTML = h + mlTableroTodas() + '</div>'; return; }

  // ---- tablero de duelos
  var H = sel._hyd;
  var seen = {}, games = [];
  Object.keys(H.muBy || {}).forEach(function (k) {
    var pair = H.muBy[k];
    if (!pair || pair.length !== 2) return;
    var a = pair[0].roster_id, b = pair[1].roster_id;
    if (seen[a] || seen[b]) return;
    seen[a] = seen[b] = 1;
    games.push([a, b]);
  });
  // El duelo del usuario, primero: es el que abrio a mirar.
  games.sort(function (g1, g2) {
    var mineId = H.mine.roster_id;
    return (g2.indexOf(mineId) !== -1 ? 1 : 0) - (g1.indexOf(mineId) !== -1 ? 1 : 0);
  });

  h += '<div class="ml-board"><div class="ml-board-h"><span>Matchup</span><span>Spread</span><span>Money</span><span>Total</span></div>';
  if (!games.length) {
    h += '<div class="ml-board-empty">' + (mlDrafted(sel)
      ? ('No matchups posted for week ' + ML.week + '.')
      : 'This league has not drafted yet, so there is nothing to price.') + '</div>';
  }
  games.forEach(function (g) {
    var a = g[0], b = g[1];
    var pa = (H.proj[a] || {}).total || 0, pb = (H.proj[b] || {}).total || 0;
    var wa = mlWinProb(pa, pb), wb = 1 - wa;
    var tot = Math.round((pa + pb) * 2) / 2;
    var isMine = a === H.mine.roster_id || b === H.mine.roster_id;
    if (b === H.mine.roster_id) { var tmp = a; a = b; b = tmp; var tp = pa; pa = pb; pb = tp; wa = 1 - wa; wb = 1 - wa; }
    var side = function (rid, pts, wp, other) {
      var fav = pts >= other;
      return '<div class="ml-bd-row">'
        + '<div class="ml-bd-team"><b>' + mlEsc(mlTeamName(sel, rid))
        + (rid === H.mine.roster_id && !/^you$/i.test(mlTeamName(sel, rid)) ? ' <span class="ml-you">you</span>' : '') + '</b>'
        + '<span class="mono">' + mlN(pts) + ' proj</span></div>'
        + '<div class="ml-cell mono">' + (fav ? '-' : '+') + mlSpread(Math.abs(pts - other)) + '</div>'
        + '<div class="ml-cell mono ' + (wp >= 0.5 ? 'is-fav' : '') + '">' + mlAmerican(wp) + '</div>'
        + '<div class="ml-cell mono ml-tot">' + (rid === a ? 'o ' + tot : 'u ' + tot) + '</div>'
        + '</div>';
    };
    h += '<div class="ml-game' + (isMine ? ' is-mine' : '') + '">'
      + (isMine ? '<div class="ml-game-tag">Your matchup</div>' : '')
      + side(a, pa, wa, pb) + side(b, pb, wb, pa) + '</div>';
  });
  h += '</div>';

  // ---- titulo
  // El tablero se pinta ya, y la simulacion arranca sola: entrar por la pestana
  // y entrar por el boton de una tarjeta tienen que dar lo mismo. Que los dos
  // caminos hagan cosas distintas es como este repo se gano un bug de subasta.
  if (mlIsHeadToHead(sel) && mlDrafted(sel) && !ML.sims[sel.id]) mlRunSim(sel.id);
  var sim = ML.sims[sel.id];
  h += '<div class="ml-champ"><div class="ml-champ-h"><h3>Championship odds</h3>'
    + '<span class="ml-book-tag">' + (sim ? (sim.sims / 1000) + 'k seasons simulated' : 'simulating') + '</span></div>';
  if (ML.demo) {
    h += '<p class="ml-sub2">Title odds come from four thousand simulated seasons of your league\'s real remaining schedule, so this example does not have them. Connect a league and they show up here.</p>';
  } else if (!mlIsHeadToHead(sel)) {
    h += '<p class="ml-sub2">This league has no head to head bracket, so there is no title to price.</p>';
  } else if (!mlDrafted(sel)) {
    h += '<p class="ml-sub2">Nobody has a roster yet. A title race off empty rosters would be a made up number, so there is none.</p>';
  } else if (sel.plat === 'yahoo' && !sim) {
    h += '<p class="ml-sub2">Yahoo does not hand over the rest of the schedule yet, so there is no season to simulate. The matchup board above still works.</p>';
  } else if (!sim && ML.simNone && ML.simNone[sel.id]) {
    h += '<p class="ml-sub2">No schedule posted past this week, so there is no season to simulate yet.</p>';
  } else if (!sim) {
    h += mlSkeleton(4);
  } else {
    h += '<div class="ml-champ-rows">';
    h += '<div class="ml-champ-head"><span>Team</span><span>Playoffs</span><span>Title</span></div>';
    sim.rows.forEach(function (r) {
      var isMine = r.rosterId === H.mine.roster_id;
      h += '<div class="ml-champ-row' + (isMine ? ' is-mine' : '') + '">'
        + '<div class="ml-champ-team"><b>' + mlEsc(mlTeamName(sel, r.rosterId)) + '</b>'
        + '<span class="mono">' + mlN(r.wins, 1) + ' proj wins · ' + mlN(r.proj) + ' pts/wk</span></div>'
        + '<div class="ml-champ-po"><i style="--w:' + Math.max(2, Math.round(r.playoff * 100)) + '%"></i>'
        + '<b class="mono">' + mlPct(r.playoff) + '%</b></div>'
        + '<div class="ml-cell mono ml-champ-pct">' + mlPct(r.title) + '%'
        + '<i class="ml-champ-am mono">' + mlAmerican(r.title) + '</i></div>'
        + '</div>';
    });
    // Ordenados por SU propia cifra. Heredar el orden del titulo dejaba
    // 71.4% delante de 71.6% y se lee como un error de suma.
    // El modelo se declara: un porcentaje sin decir de donde sale es un adorno,
    // y ademas este cambia de confianza segun se juega.
    h += '</div><p class="ml-fine">' + (sim.sims / 1000) + ',000 simulated seasons. '
      + 'The projection is treated as an <b>estimate, not a fact</b>: every simulated season draws each '
      + 'team\'s true level around it, and the gap between teams is shrunk toward the league average. '
      + 'Right now <b>' + sim.fiabilidad + '%</b> of that gap is taken as real talent, and that rises as '
      + 'games are played, so these odds sharpen with the season.</p>';
  }
  h += '</div>';

  // La honestidad del tablero, escrita donde se ve: de donde sale el numero,
  // cuanto de tu alineacion cubre, y que no hay comision.
  var cov = (H.proj[H.mine.roster_id] || {}).coverage;
  var notaIdp = mlEsIdp(sel)
    ? 'This is an IDP league: defensive players have no market line, so these numbers cover the offensive side only (both teams miss the same). ' : '';
  h += '<p class="ml-fine">' + notaIdp + 'Lines come from this week\'s player numbers, priced with <b>' + mlEsc(mlScoringLabel(sel))
    + '</b> and your league\'s rules. '
    + (sel._scoringGuess ? 'Heads up: this league did not hand over its scoring rules, so these use standard scoring. ' : '') + (cov != null ? Math.round(cov * 100) + '% of your starters have a number of their own; the rest get their position\'s 25th percentile. ' : '')
    + 'No juice: these are straight probabilities, not a book\'s price.</p>';

  box.innerHTML = h + '</div>';
}

var _mlSimming = {};
async function mlRunSim(id) {
  var L = ML.leagues.filter(function (x) { return x.id === id; })[0];
  if (!L || !mlIsHeadToHead(L) || !mlDrafted(L)) return;
  if (ML.demo) return;   // la demo no sale a la red por nada
  if (_mlSimming[id]) return;
  _mlSimming[id] = 1;
  // Sin lineas todas las proyecciones son cero y la simulacion repartiria el
  // titulo por igual, que es una mentira con forma de dato. Ademas se ahorra
  // una decena de peticiones por el calendario.
  if (!ML.props) return;
  if (ML.sims[id]) return;
  try {
    await mlLoadSchedule(L);
    var res = mlSimLeague(L, 4000);
    if (res) { ML.sims[id] = res; mlPaintOdds(); }
    else { ML.simNone = ML.simNone || {}; ML.simNone[id] = 1; mlPaintOdds(); }
  } finally { _mlSimming[id] = 0; }
}

/* ------------------------------------------------------------- compartir */
// Crear el hub tarda: trae la liga y camina todas sus temporadas viejas. El
// boton dice lo que esta pasando en vez de quedarse mudo, y si la liga ya
// estaba compartida el servidor devuelve el MISMO codigo en vez de partir la
// conversacion de una liga en dos hubs.
async function mlShare(id, btn) {
  var L = ML.leagues.filter(function (x) { return x.id === id; })[0];
  if (!L) return;
  var txt = btn && btn.textContent;
  if (btn) { btn.textContent = 'Reading past seasons...'; btn.disabled = true; }
  try {
    var r = await fetch('/api/liga/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId: L.id })
    });
    var d = await r.json();
    if (!r.ok || !d.code) throw new Error(d.error || 'could not share');
    if (btn) { btn.textContent = txt || 'Share'; btn.disabled = false; }
    if (window.hbGo) {
      if (typeof switchScreen === 'function') switchScreen('hub');
      hbGo(d.code);
    }
  } catch (e) {
    if (btn) { btn.textContent = 'Could not share'; btn.disabled = false; }
  }
}

// Cambiar la fuente recalcula TODO lo derivado (proyecciones por equipo, sims,
// imputaciones): dos fuentes con la mitad de la pantalla cada una serian dos
// verdades a la vez.
function mlSetProy(f) {
  if (f !== 'site' && f !== 'vegas') return;
  if (ML.fuenteProy === f) return;
  ML.fuenteProy = f;
  try { localStorage.setItem('tm_ml_proy', f); } catch (e) { }
  _mlImputCache = {};
  ML.sims = {}; ML.simNone = {};
  var players = ML.players || {};
  (ML.leagues || []).forEach(function (L) {
    var H = L._hyd; if (!H) return;
    var sc = H.sc || mlScoring(L);
    (H.rosters || []).forEach(function (r) {
      H.proj[r.roster_id] = mlBestLineup(r.players || [], L, sc, players);
    });
  });
  mlPaint();
}

/* ------------------------------------------------------- el detalle del duelo */
// Entrar a un matchup y verlo como lo pinta Sleeper o Yahoo: las dos
// alineaciones lado a lado, casilla por casilla, con los puntos del que ya
// jugo y la proyeccion del que no. Los datos ya estaban bajados (starters,
// players_points y el reglamento de la liga): esta pantalla solo los pone de
// frente.
function mlOpenMatchup(id) {
  var L = (ML.leagues || []).filter(function (x) { return x.id === id; })[0];
  if (!L || !L._hyd || !L._hyd.mine || L._hyd.opp == null) return;
  var H = L._hyd;
  var players = ML.players || {};
  var sc = H.sc || mlScoring(L);
  var slots = (L.roster_positions || []).filter(function (x) { return !BANCA_MU[x]; });

  var fila = function (rid) {
    return (H.matchups || []).filter(function (m) { return m.roster_id === rid; })[0] || {};
  };
  var mia = fila(H.mine.roster_id), suya = fila(H.opp);
  var vivo = mlEnVivo(L);

  // Una celda de jugador: puntos REALES si ya jugo (players_points), y si no,
  // su proyeccion en gris. Nunca se mezclan sin decirlo: el real va en blanco.
  // Yahoo SI da la alineacion semanal (roster;week=N con selected_position y
  // player_points): se pide al abrir el panel y se rellena en cuanto llega. La
  // primera version asumio que no existia y pintaba "Lineup lives on Yahoo" en
  // todas las filas, que fue exactamente lo que el dueno reporto.
  if (L.plat === 'yahoo' && !(H.lineups && H.lineups[ML.week])) {
    mlCargarLineupYahoo(L);
  }
  var yhMio = (H.lineups && H.lineups[ML.week] && H.lineups[ML.week][H.mine.roster_id]) || null;
  var yhSuyo = (H.lineups && H.lineups[ML.week] && H.lineups[ML.week][H.opp]) || null;

  var celda = function (m, i, lado) {
    // En Yahoo la fila sale de la alineacion semanal pedida aparte.
    if (L.plat === 'yahoo') {
      var lst = (m === mia) ? yhMio : yhSuyo;
      if (!lst) return '<div class="ml-mu-p is-empty ' + lado + '"><span class="ml-mu-nom">Loading lineup...</span></div>';
      var y = lst[i];
      if (!y) return '<div class="ml-mu-p is-empty ' + lado + '"><span class="ml-mu-nom">Empty</span></div>';
      var yreal = (y.points != null && y.points !== 0) ? y.points : null;
      var yproj = mlProjPlayer({ name: y.name, pos: y.pos, team: y.team }, sc);
      var ypts = yreal != null ? mlN(yreal) : (yproj != null ? mlN(yproj) : '-');
      var sid = mlIdPorNombre(y.name);
      var foto = y.pos === 'DEF' && y.team
        ? '<img src="https://sleepercdn.com/images/team_logos/nfl/' + mlEsc(String(y.team).toLowerCase()) + '.png" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
        : (sid ? '<img src="https://sleepercdn.com/content/nfl/players/thumb/' + mlEsc(sid) + '.jpg" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' : '<span class="ml-mu-sinfoto"></span>');
      return '<div class="ml-mu-p ' + lado + '">' + foto
        + '<span class="ml-mu-txt"><b>' + mlEsc(y.name) + '</b><i>' + mlEsc(y.pos) + ' · ' + mlEsc(y.team || 'FA') + '</i></span>'
        + '<span class="ml-mu-pts mono' + (yreal != null ? ' is-real' : '') + '">' + ypts + '</span>'
        + '</div>';
    }
    var id = ((m.starters || [])[i]) || null;
    var p = id && id !== '0' ? players[id] : null;
    if (!p && id && id !== '0') p = { id: id, name: 'Player ' + id, pos: '?', team: '' };
    // El punto REAL solo existe cuando el duelo tiene puntos. Antes del
    // kickoff, players_points trae 0.0 para todos, y pintarlos en blanco como
    // "real" mientras la cabecera suma la proyeccion era decir dos cosas a la
    // vez: la celda enseña la proyeccion en gris hasta que el duelo arranca.
    var duelaVivo = (Number(m.points) || 0) > 0 || (Number((m === mia ? suya : mia).points) || 0) > 0;
    var real = duelaVivo && p && m.players_points ? m.players_points[id] : null;
    if (real === 0) real = null;
    var proj = p ? mlProjPlayer(p, sc) : null;
    var pts = real != null ? mlN(real) : (proj != null ? mlN(proj) : '-');
    if (!p) {
      return '<div class="ml-mu-p is-empty ' + lado + '"><span class="ml-mu-nom">' + (L.plat === 'yahoo' ? 'Lineup lives on Yahoo' : 'Empty') + '</span></div>';
    }
    var fotoS = (p.pos === 'DEF' || /^[A-Z]{2,3}$/.test(String(p.id)))
      ? '<img src="https://sleepercdn.com/images/team_logos/nfl/' + mlEsc(String(p.team || p.id).toLowerCase()) + '.png" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
      : '<img src="https://sleepercdn.com/content/nfl/players/thumb/' + mlEsc(p.id) + '.jpg" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">';
    return '<div class="ml-mu-p ' + lado + '">' + fotoS
      + '<span class="ml-mu-txt"><b>' + mlEsc(p.name) + '</b><i>' + mlEsc(p.pos) + ' · ' + mlEsc(p.team || 'FA') + '</i></span>'
      + '<span class="ml-mu-pts mono' + (real != null ? ' is-real' : '') + '">' + pts + '</span>'
      + '</div>';
  };

  var mioT = vivo ? vivo.mio : ((H.proj[H.mine.roster_id] || {}).total || 0);
  var suyoT = vivo ? vivo.suyo : ((H.proj[H.opp] || {}).total || 0);

  var h = '<div class="ml-mu-panel" style="--liga:' + mlLigaColor(L) + '">'
    + '<header class="ml-mu-h">'
    + '<button class="ml-mu-x" onclick="mlCloseMatchup()" aria-label="Close">&times;</button>'
    + '<span class="ml-mu-liga">' + mlEsc(L.name) + (vivo ? ' <i class="ml-live-dot"></i>' : '')
    + (L.plat === 'sleeper' ? ' <button class="ml-link ml-mu-share" onclick="mlShare(\'' + L.id + '\',this)">Share</button>' : '') + '</span>'
    + '<div class="ml-mu-score">'
    + '<div class="ml-mu-side"><span>' + mlEsc(mlTeamName(L, H.mine.roster_id)) + '</span><b class="mono">' + mlN(mioT) + '</b></div>'
    + '<span class="ml-mu-vs">' + (vivo ? 'live' : 'vs') + '</span>'
    + '<div class="ml-mu-side is-opp"><span>' + mlEsc(mlTeamName(L, H.opp)) + '</span><b class="mono">' + mlN(suyoT) + '</b></div>'
    + '</div>'
    + (function () {
      var pm = (H.proj[H.mine.roster_id] || {}).total || 0;
      var po = (H.proj[H.opp] || {}).total || 0;
      var wp = mlWinProb(pm, po);
      if (vivo) {
        var d = vivo.mio - vivo.suyo;
        return '<div class="ml-mu-line">' + (d >= 0 ? 'winning by ' + mlN(d) : 'down ' + mlN(-d))
          + ' · proj ' + mlN(pm) + ' - ' + mlN(po) + '</div>';
      }
      return '<div class="ml-mu-line"><span class="mono">' + (pm >= po ? '-' : '+') + mlSpread(Math.abs(pm - po))
        + '</span> · ' + mlPct(wp) + '% to win</div>';
    })()
    + '</header><div class="ml-mu-rows">';
  if (L.plat === 'yahoo' && yhMio) {
    // Los rotulos de casilla, de la alineacion real de Yahoo (W/R, etc).
    slots = yhMio.map(function (y) { return y.slot || '?'; });
  }
  for (var i = 0; i < slots.length; i++) {
    h += '<div class="ml-mu-row">'
      + celda(mia, i, 'is-me')
      + '<span class="ml-mu-slot">' + mlEsc(String(slots[i]).replace('SUPER_FLEX', 'SF').replace('_FLEX', '').replace('FLEX', 'FLX')) + '</span>'
      + celda(suya, i, 'is-opp')
      + '</div>';
  }
  h += '</div>'
    + '<p class="ml-fine" style="padding:0 16px 16px;margin:0">White numbers are real points from games already played; grey are projections'
    + '.</p>'
    + '</div>';

  var existente = document.getElementById('ml-mu-overlay');
  if (existente) {
    // Recarga en sitio (llegaron las alineaciones de Yahoo): mismo overlay,
    // mismo cierre, contenido nuevo.
    existente.innerHTML = h;
    return;
  }
  var ov = document.createElement('div');
  ov.className = 'ml-mu-overlay';
  ov.id = 'ml-mu-overlay';
  ov.innerHTML = h;
  ov.addEventListener('click', function (ev) { if (ev.target === ov) mlCloseMatchup(); });
  document.body.appendChild(ov);
  // En los dos: la pagina scrollea en <html>, y bloquear solo el body dejaba
  // la rueda moviendo el fondo mientras el panel se quedaba quieto (reportado
  // por el dueno la misma noche).
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  // El boton atras cierra el panel, no abandona la pantalla: mismo contrato que
  // el resto de los overlays de la app.
  if (typeof _overlayOpen === 'function') { try { _overlayOpen(function () { mlCloseMatchup(true); }); } catch (e) { } }
}
// Trae las dos alineaciones semanales de un duelo de Yahoo y repinta el panel
// si sigue abierto. Cacheado en la liga por semana: abrir dos veces no repide.
var _mlLineupEnVuelo = {};
async function mlCargarLineupYahoo(L) {
  var H = L._hyd;
  if (!H || _mlLineupEnVuelo[L.id]) return;
  _mlLineupEnVuelo[L.id] = 1;
  try {
    var claves = {};
    (H.rosters || []).forEach(function (r) { claves[r.roster_id] = r.owner_id; });
    var pares = [H.mine.roster_id, H.opp];
    var res = await Promise.all(pares.map(function (rid) {
      return mlYahooGet('/team/' + encodeURIComponent(claves[rid]) + '/lineup?week=' + (ML.week || 1))
        .catch(function () { return null; });
    }));
    H.lineups = H.lineups || {};
    var porSemana = {};
    pares.forEach(function (rid, i) {
      var d = res[i];
      if (!d || !d.players) return;
      // Solo titulares, en el orden de casillas que manda Yahoo.
      porSemana[rid] = d.players.filter(function (y) {
        return y.slot && ['BN', 'IR', 'IL'].indexOf(y.slot) === -1;
      });
    });
    if (Object.keys(porSemana).length) {
      H.lineups[ML.week] = porSemana;
      // Repintar solo si el panel de ESTE duelo sigue abierto.
      // Rellenar EN SITIO: cerrar y reabrir apilaria un segundo cierre en el
      // boton atras.
      var ov = document.getElementById('ml-mu-overlay');
      if (ov) { ov.dataset.relleno = '1'; mlOpenMatchup(L.id); }
    }
  } catch (e) { }
  finally { delete _mlLineupEnVuelo[L.id]; }
}

// El clic de la tarjeta: abre el matchup salvo que el toque haya caido en un
// control de verdad (Share, Odds, un enlace).
function mlCardClick(ev, id) {
  if (ev && ev.target && ev.target.closest && ev.target.closest('button, a, select, input')) return;
  mlOpenMatchup(id);
}

function mlCloseMatchup(desdeAtras) {
  var ov = document.getElementById('ml-mu-overlay');
  if (ov) ov.remove();
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  if (!desdeAtras && typeof _overlays !== 'undefined' && _overlays.length) {
    try { history.back(); } catch (e) { }
  }
}
var BANCA_MU = ML_SKIP;   // una sola lista de casillas de banca, no dos que derivan

/* -------------------------------------------------------------- entrada */
function renderMyLeagues() {
  if (mlEsDemo()) {
    if (!ML.demo) { mlCargarDemo(); }
    mlPaint();
    return;
  }
  mlPaint();
  if (!ML.ready && !ML.loading) mlBoot(false);
}

// Si el usuario abrio la pestana antes de que este archivo terminara de cargar,
// el onclick guardado no encontro la funcion. Al llegar, se pinta solo. Es el
// mismo fallo que ya se pago una vez con My Rankings.
(function () {
  var s = document.getElementById('screen-myleagues');
  if (s && s.classList.contains('active')) renderMyLeagues();
})();

window.renderMyLeagues = renderMyLeagues;
window.mlConnect = mlConnect;
window.mlRefresh = mlRefresh;
window.mlCerrarRecap = mlCerrarRecap;
window.mlOpenOdds = mlOpenOdds;
window.mlYahooConnect = mlYahooConnect;
window.mlYahooDisconnect = mlYahooDisconnect;
window.mlShare = mlShare;
window.mlSetFiltro = mlSetFiltro;
window.mlSalirDemo = function () { location.href = '/myleagues'; };
window.mlSetProy = mlSetProy;
window.mlOpenMatchup = mlOpenMatchup;
window.mlCardClick = mlCardClick;
window.mlCloseMatchup = mlCloseMatchup;
window.mlEsDemo = mlEsDemo;
// app.js guarda aqui el token cuando el usuario entra por la puerta vieja.
window.mlYahooSet = mlYahooSet;
window.mlYahooConectado = mlYahooConectado;
