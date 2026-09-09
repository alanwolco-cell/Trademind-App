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
  username: '',
  leagues: [],         // [{id,name,teams,status,type,settings,roster_positions,scoring_settings, _hyd:{...}}]
  players: null,       // id -> {id,name,pos,team}
  props: null,         // nombre en minusculas -> {player_pass_yds, ...}
  propsAt: 0,
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
    recTd: num(s.rec_td, 6)
  };
}

// Los pases de anotacion NO estan en las props (solo existe el "anytime TD",
// que en un QB es su anotacion corriendo). Sin esta linea todos los QB salen
// entre cuatro y ocho puntos por debajo y el tablero miente a favor de quien
// tiene un QB flojo. La tasa es la de la liga real: una anotacion de pase por
// cada ~150 yardas lanzadas.
var ML_PASS_TD_PER_YD = 1 / 150;

function mlProjPlayer(p, sc) {
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
    // El "anytime" no dice si es corriendo o atrapando: se usa el valor de la
    // posicion, que en el 99% de las ligas es el mismo numero.
    pts += prob * (p.pos === 'RB' ? sc.rushTd : sc.recTd);
  }
  return Math.round(pts * 10) / 10;
}

/* --------------------------------------------------------------- alineacion */
var ML_FLEX = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_WRT: ['RB', 'WR', 'TE']
};
var ML_SKIP = { BN: 1, IR: 1, TAXI: 1 };

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
    var proj = mlProjPlayer(p, sc);
    pool.push({ id: (p.id || p.name), p: p, proj: proj });
  });
  // Los que no tienen linea reciben la mediana de su posicion entre los que si
  // la tienen. Ni se inventan estrellas ni se les pone cero, que seria peor:
  // un titular en cero hunde a su equipo entero por un hueco de la casa.
  var byPos = {};
  pool.forEach(function (x) { if (x.proj != null) (byPos[x.p.pos] = byPos[x.p.pos] || []).push(x.proj); });
  var med = {};
  Object.keys(byPos).forEach(function (k) {
    var a = byPos[k].slice().sort(function (x, y) { return x - y; });
    med[k] = a[Math.floor(a.length / 2)];
  });
  var covered = 0, needed = 0;
  pool.forEach(function (x) {
    if (x.proj == null) { x.proj = med[x.p.pos] != null ? med[x.p.pos] : 0; x.guess = true; }
  });

  var used = {}, lineup = [], total = 0;
  var order = slots.slice().sort(function (a, b) {
    return (ML_FLEX[a] ? 1 : 0) - (ML_FLEX[b] ? 1 : 0);   // fijas primero
  });
  order.forEach(function (slot) {
    var ok = ML_FLEX[slot] || [slot];
    var best = null;
    pool.forEach(function (x) {
      if (used[x.id]) return;
      if (ok.indexOf(x.p.pos) === -1) return;
      if (!best || x.proj > best.proj) best = x;
    });
    if (best) {
      used[best.id] = 1;
      lineup.push({ slot: slot, x: best });
      total += best.proj;
      needed++; if (!best.guess) covered++;
    } else {
      needed++;   // casilla vacia: cuenta contra la cobertura
      lineup.push({ slot: slot, x: null });
    }
  });
  return {
    total: Math.round(total * 10) / 10,
    lineup: lineup,
    covered: covered,
    needed: needed,
    coverage: needed ? covered / needed : 0
  };
}

/* --------------------------------------------------------------------- odds */
// Probabilidad de ganar el duelo. La varianza semanal de un equipo de fantasy
// ronda el 24% de su media; la del duelo es la suma de las dos.
function mlSd(proj) { return Math.max(16, 0.24 * proj); }
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
  var sd = proj.map(mlSd);
  var w0 = [], l0 = [], pf0 = [];
  H.rosters.forEach(function (r, i) {
    var s = r.settings || {};
    w0[i] = Number(s.wins) || 0;
    l0[i] = Number(s.losses) || 0;
    pf0[i] = Number(s.fpts || 0) + Number(s.fpts_decimal || 0) / 100;
  });
  var playoffTeams = Math.min(n, Number((L.settings || {}).playoff_teams) || 6);
  var titles = new Array(n).fill(0), playoffs = new Array(n).fill(0);
  var winSum = new Array(n).fill(0);

  for (var s = 0; s < sims; s++) {
    var w = w0.slice(), pf = pf0.slice();
    H.schedule.forEach(function (wk) {
      var scores = [];
      for (var i = 0; i < n; i++) scores[i] = proj[i] + sd[i] * mlGauss();
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
    var alive = seed.slice(0, playoffTeams);
    while (alive.length > 1) {
      var byes = alive.length % 2 === 0 ? 0 : 1;
      var next = alive.slice(0, byes);
      var rest = alive.slice(byes);
      for (var j = 0; j < rest.length / 2; j++) {
        var A = rest[j], B = rest[rest.length - 1 - j];
        var sa = proj[A] + sd[A] * mlGauss(), sb = proj[B] + sd[B] * mlGauss();
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
  return { rows: rows, sims: sims, weeks: H.schedule.length };
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
        players: (t.players || []).map(function (p) {
          return { name: p.name, pos: String(p.pos || '').split(',')[0].replace('DEF', 'DEF'), team: p.team, yahoo: true };
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

    var muBy = {}, myMu = null, opp = null;
    ((sb && sb.matchups) || []).forEach(function (m, k) {
      var a = idPorClave[m.teams[0]], b = idPorClave[m.teams[1]];
      if (!a || !b) return;
      muBy[k + 1] = [{ roster_id: a, matchup_id: k + 1 }, { roster_id: b, matchup_id: k + 1 }];
      if (mine && (a === mine.roster_id || b === mine.roster_id)) {
        myMu = { roster_id: mine.roster_id, matchup_id: k + 1 };
        opp = a === mine.roster_id ? b : a;
      }
    });
    L._hyd = { rosters: rosters, users: users, mine: mine, sc: sc, proj: proj,
      matchups: [], muBy: muBy, myMu: myMu, opp: opp, schedule: null };
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
    await mlLoadProps();

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
function mlFormat(L) {
  if (L.type === 2) return 'Dynasty';
  if (L.type === 1) return 'Keeper';
  if (L.type === 3) return 'Best ball';
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
  return L.type !== 3 && Number((L.settings || {}).playoff_teams) > 0;
}
function mlScoringLabel(L) {
  var r = mlScoring(L).rec;
  return r >= 1 ? 'PPR' : (r > 0 ? 'Half PPR' : 'Standard');
}
function mlSuperflex(L) {
  return (L.roster_positions || []).indexOf('SUPER_FLEX') !== -1;
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
    sub.textContent = ML.username
      ? (ML.leagues.length + ' league' + (ML.leagues.length === 1 ? '' : 's') + ' · Week ' + ML.week + ' · @' + ML.username)
      : 'Not connected';
  }
}

// El aviso va en LAS TRES pestanas, no solo en la primera: quien entra directo a
// My Players tiene el mismo derecho a saber que esta viendo un ejemplo.
function mlAvisoDemo() {
  if (!ML.demo) return '';
  return '<div class="ml-demo-bar"><b>This is a live example.</b> Six made up leagues with real players, '
    + 'so you can see how it works before connecting anything. '
    + '<button class="ml-link" onclick="mlSalirDemo()">Connect my own leagues</button></div>';
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
  // cada grupo, primero la que esta mas apretada: es donde miras primero.
  var orden = ML.leagues.slice().sort(function (a, b) {
    var da = mlDrafted(a) ? 0 : 1, db = mlDrafted(b) ? 0 : 1;
    if (da !== db) return da - db;
    return (a.name || '').localeCompare(b.name || '');
  });
  var visibles = orden.filter(mlPasaFiltro);

  var h = mlAvisoDemo()
    + '<div class="ml-tools">' + (ML.demo ? '' : '<button class="btn-sm" onclick="mlRefresh()">Refresh</button>'
    + mlYahooBtn())
    + (ML.stale ? '<span class="ml-hint">Showing your last saved copy: could not reach Sleeper just now.</span>' : '')
    + '</div>'
    + (ML.yahooErr ? '<div class="ml-err-line">Yahoo: ' + mlEsc(ML.yahooErr) + '</div>' : '')
    + mlFiltrosUI(orden, visibles);

  if (!visibles.length) {
    return void (box.innerHTML = h + '<div class="ml-empty"><p>No leagues match that filter.</p></div>');
  }

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
        + '<div class="ml-vs-odds ' + (favorito ? 'is-fav' : 'is-dog') + '">'
        + (vivo
          ? '<span class="ml-live"><i></i>' + (vivo.mio >= vivo.suyo ? 'winning by ' + mlN(vivo.mio - vivo.suyo) : 'down ' + mlN(vivo.suyo - vivo.mio)) + '</span>'
            + '<span class="ml-dot">·</span><span>proj ' + mlN(myProj) + ' - ' + mlN(oppProj) + '</span>'
          : '<span class="mono">' + (favorito ? '-' : '+') + mlSpread(Math.abs(myProj - oppProj)) + '</span>'
            + '<span class="ml-dot">·</span><span class="mono">' + mlAmerican(wp) + '</span>'
            + '<span class="ml-dot">·</span><span>' + mlPct(wp) + '% to win</span>')
        + '</div>';
    } else {
      cuerpo = '<div class="ml-vs-none">No matchup this week</div>';
    }

    var flags = [mlFormat(L), mlScoringLabel(L) + (L._scoringGuess ? ' (assumed)' : ''), L.teams + ' teams'];
    if (mlSuperflex(L)) flags.push('Superflex');
    var esCampeon = L.champId != null && L.champId === mine.roster_id;

    h += '<article class="ml-card" style="--liga:' + color + '">'
      + '<header class="ml-card-h">' + mlLigaEscudo(L, 'is-lg')
      + '<div class="ml-card-id"><h3>' + mlEsc(L.name) + '</h3>'
      + '<span class="ml-card-sub">' + (L.plat === 'yahoo' ? 'Yahoo' : 'Sleeper') + ' · ' + mlEsc(mlTeamName(L, mine.roster_id)) + '</span></div>'
      + '<span class="ml-rec mono">' + mlRecord(mine) + '</span></header>'
      + (esCampeon ? '<div class="ml-champ-tag">Defending champion</div>' : '')
      + '<div class="ml-flags">' + flags.map(function (f) { return '<span>' + mlEsc(f) + '</span>'; }).join('') + '</div>'
      + cuerpo
      + '<div class="ml-card-f">'
      + (L.plat === 'sleeper' ? '<button class="ml-link" onclick="mlShare(\'' + L.id + '\',this)">Share</button>' : '<span></span>')
      + '<button class="ml-link" onclick="mlOpenOdds(\'' + L.id + '\')">Odds →</button></div>'
      + '</article>';
  });
  box.innerHTML = h + '</div>';
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
function mlFiltrosUI(todas, visibles) {
  var f = ML.filtro || {};
  var formatos = {};
  todas.forEach(function (L) { formatos[mlFormat(L)] = (formatos[mlFormat(L)] || 0) + 1; });
  var plats = {};
  todas.forEach(function (L) { var k = L.plat || 'sleeper'; plats[k] = (plats[k] || 0) + 1; });

  var chip = function (clave, valor, texto, n, activo) {
    return '<button class="ml-chip' + (activo ? ' is-on' : '') + '" onclick="mlSetFiltro(\'' + clave + '\',\'' + valor + '\')">'
      + mlEsc(texto) + '<span>' + n + '</span></button>';
  };
  var h = '<div class="ml-filters">';
  h += chip('formato', 'all', 'All', todas.length, !f.formato || f.formato === 'all');
  Object.keys(formatos).sort().forEach(function (k) {
    h += chip('formato', k, k, formatos[k], f.formato === k);
  });
  // La plataforma solo se ofrece cuando de verdad hay dos: un filtro con una
  // sola opcion es ruido.
  if (Object.keys(plats).length > 1) {
    h += '<span class="ml-filters-sep"></span>';
    h += chip('plat', 'all', 'Both', todas.length, !f.plat || f.plat === 'all');
    Object.keys(plats).forEach(function (k) {
      h += chip('plat', k, k === 'yahoo' ? 'Yahoo' : 'Sleeper', plats[k], f.plat === k);
    });
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
var _mlNombreIdx = null;
function mlIdPorNombre(nombre) {
  if (!_mlNombreIdx) {
    _mlNombreIdx = {};
    var P = ML.players || {};
    Object.keys(P).forEach(function (id) {
      var n = mlNorm(P[id] && P[id].name);
      if (n && !_mlNombreIdx[n]) _mlNombreIdx[n] = id;
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

  var conflicts = rows.filter(function (r) { return r.own.length && r.vs.length; });
  var total = ML.leagues.length;

  var h = avisoDemo;
  if (conflicts.length) {
    h += '<section class="ml-conf"><h3>Rooting against yourself</h3>'
      + '<p class="ml-sub2">These are yours in one league and across the field in another. Sunday is not simple.</p><div class="ml-conf-list">';
    conflicts.slice(0, 8).forEach(function (r) {
      h += '<div class="ml-conf-row">' + mlFace(r.id)
        + '<div class="ml-conf-txt"><b>' + mlEsc(r.p.name) + '</b>'
        + '<span>' + r.own.length + ' for you · ' + r.vs.length + ' against you</span></div>'
        + '<span class="ml-conf-tag mono">' + r.own.length + 'v' + r.vs.length + '</span></div>';
    });
    h += '</div></section>';
  }

  h += '<section class="ml-expo"><h3>Your players, all leagues</h3>'
    + '<p class="ml-sub2">' + rows.length + ' players across ' + total + ' league' + (total === 1 ? '' : 's') + '. Sorted by how exposed you are.</p>'
    + '<div class="ml-rows">';
  rows.slice(0, 120).forEach(function (r) {
    var pctOwn = Math.round(r.own.length / total * 100);
    h += '<div class="ml-row">'
      + mlFace(r.id)
      + '<div class="ml-row-main"><b>' + mlEsc(r.p.name) + '</b>'
      + '<span class="ml-row-meta">' + mlEsc(r.p.pos) + ' · ' + mlEsc(r.p.team || 'FA') + '</span></div>'
      + '<div class="ml-row-bar" title="' + pctOwn + '% of your leagues"><i style="width:' + pctOwn + '%"></i></div>'
      + '<div class="ml-row-n mono">' + r.own.length + '<span>/' + total + '</span></div>'
      + '</div>';
  });
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
  var filas = [];
  ML.leagues.forEach(function (L) {
    if (!mlDrafted(L)) return;
    var H = L._hyd;
    if (!H || !H.mine || H.opp == null) return;
    var mio = (H.proj[H.mine.roster_id] || {}).total || 0;
    var suyo = (H.proj[H.opp] || {}).total || 0;
    filas.push({
      L: L, mio: mio, suyo: suyo, wp: mlWinProb(mio, suyo),
      rival: mlTeamName(L, H.opp), yo: mlTeamName(L, H.mine.roster_id)
    });
  });
  if (!filas.length) {
    return '<div class="ml-board"><div class="ml-board-empty">'
      + 'None of your leagues has a matchup posted for week ' + ML.week + ' yet.</div></div>';
  }
  // De peor a mejor: donde vas perdiendo es donde todavia puedes hacer algo.
  filas.sort(function (a, b) { return a.wp - b.wp; });
  var favorito = filas.filter(function (f) { return f.wp >= 0.5; }).length;
  var puntos = filas.reduce(function (a, f) { return a + f.mio; }, 0);

  var h = '<div class="ml-slate"><div class="ml-slate-n"><b>' + favorito + '</b><span>of ' + filas.length
    + ' games favored</span></div>'
    + '<div class="ml-slate-n"><b class="mono">' + mlN(puntos, 0) + '</b><span>points on the field</span></div>'
    + '<div class="ml-slate-n"><b class="mono">'
    + mlPct(filas.reduce(function (a, f) { return a + f.wp; }, 0) / filas.length)
    + '%</b><span>average shot</span></div></div>';

  h += '<div class="ml-board"><div class="ml-board-h"><span>Your matchup</span><span>Spread</span><span>Money</span><span>Win</span></div>';
  filas.forEach(function (f) {
    var fav = f.mio >= f.suyo;
    var tot = Math.round((f.mio + f.suyo) * 2) / 2;
    h += '<div class="ml-game' + (f.wp < 0.4 ? ' is-cold' : (f.wp > 0.6 ? ' is-hot' : '')) + '">'
      + '<div class="ml-game-tag">' + mlEsc(f.L.name) + '</div>'
      + '<div class="ml-bd-row">'
      + '<div class="ml-bd-team"><b>' + mlEsc(f.yo) + ' vs ' + mlEsc(f.rival) + '</b>'
      + '<span class="mono">' + mlN(f.mio) + ' - ' + mlN(f.suyo) + '</span></div>'
      + '<div class="ml-cell mono">' + (fav ? '-' : '+') + mlSpread(Math.abs(f.mio - f.suyo)) + '</div>'
      + '<div class="ml-cell mono ' + (f.wp >= 0.5 ? 'is-fav' : '') + '">' + mlAmerican(f.wp) + '</div>'
      + '<div class="ml-cell mono ml-tot">' + mlPct(f.wp) + '%</div>'
      + '</div>'
      + '<button class="ml-link ml-game-go" onclick="mlOpenOdds(\'' + mlEsc(f.L.id) + '\')">Full board and title odds →</button>'
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
    box.innerHTML = '<div class="ml-empty"><div class="ml-empty-h">The board is closed</div>'
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
  h += '<div class="ml-book-top"><select id="ml-odds-sel" onchange="mlOpenOdds(this.value)" aria-label="League">'
    + '<option value="all"' + (todas ? ' selected' : '') + '>All leagues</option>'
    + ML.leagues.map(function (L) {
      return '<option value="' + mlEsc(L.id) + '"' + (!todas && L.id === sel.id ? ' selected' : '') + '>' + mlEsc(L.name) + '</option>';
    }).join('') + '</select>'
    + '<span class="ml-book-tag">Week ' + ML.week + '</span></div>';

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
    var side = function (rid, pts, wp, other) {
      var fav = pts >= other;
      return '<div class="ml-bd-row">'
        + '<div class="ml-bd-team"><b>' + mlEsc(mlTeamName(sel, rid)) + '</b>'
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
  } else if (!sim && ML.simNone && ML.simNone[sel.id]) {
    h += '<p class="ml-sub2">No schedule posted past this week, so there is no season to simulate yet.</p>';
  } else if (!sim) {
    h += mlSkeleton(4);
  } else {
    h += '<div class="ml-champ-rows">';
    sim.rows.forEach(function (r) {
      var isMine = r.rosterId === H.mine.roster_id;
      h += '<div class="ml-champ-row' + (isMine ? ' is-mine' : '') + '">'
        + '<div class="ml-champ-team"><b>' + mlEsc(mlTeamName(sel, r.rosterId)) + '</b>'
        + '<span class="mono">' + mlN(r.wins, 1) + ' proj wins · ' + mlN(r.proj) + ' pts/wk</span></div>'
        + '<div class="ml-champ-bar"><i style="width:' + Math.max(1, Math.round(r.title * 100)) + '%"></i></div>'
        + '<div class="ml-cell mono">' + mlAmerican(r.title) + '</div>'
        + '<div class="ml-cell mono ml-champ-pct">' + mlPct(r.title) + '%</div>'
        + '</div>';
    });
    // Ordenados por SU propia cifra. Heredar el orden del titulo dejaba
    // 71.4% delante de 71.6% y se lee como un error de suma.
    var pl = sim.rows.slice().sort(function (a, b) { return b.playoff - a.playoff; }).slice(0, 3);
    h += '</div><p class="ml-fine">Best playoff odds: '
      + pl.map(function (r) { return mlEsc(mlTeamName(sel, r.rosterId)) + ' ' + mlPct(r.playoff) + '%'; }).join(' · ')
      + '</p>';
  }
  h += '</div>';

  // La honestidad del tablero, escrita donde se ve: de donde sale el numero,
  // cuanto de tu alineacion cubre, y que no hay comision.
  var cov = (H.proj[H.mine.roster_id] || {}).coverage;
  h += '<p class="ml-fine">Lines come from this week\'s player numbers, priced with <b>' + mlEsc(mlScoringLabel(sel))
    + '</b> and your league\'s rules. '
    + (sel._scoringGuess ? 'Heads up: this league did not hand over its scoring rules, so these use standard scoring. ' : '') + (cov != null ? Math.round(cov * 100) + '% of your starters have a number of their own; the rest get their position\'s median. ' : '')
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
window.mlOpenOdds = mlOpenOdds;
window.mlYahooConnect = mlYahooConnect;
window.mlYahooDisconnect = mlYahooDisconnect;
window.mlShare = mlShare;
window.mlSetFiltro = mlSetFiltro;
window.mlSalirDemo = function () { location.href = '/myleagues'; };
window.mlEsDemo = mlEsDemo;
// app.js guarda aqui el token cuando el usuario entra por la puerta vieja.
window.mlYahooSet = mlYahooSet;
window.mlYahooConectado = mlYahooConectado;
