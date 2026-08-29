/* My Rankings: la lista del dueno de la cuenta, no la del consenso.
 *
 * Por que existe como archivo aparte: app.js pasa de 17.000 lineas y esto es un
 * modulo cerrado. No toca nada de app.js salvo por dos puentes explicitos al
 * final (tmMyRankOf y tmRankingsActivos), que son los que el board del mock
 * consulta para pintar con MIS puestos en vez del ADP.
 *
 * El dato de partida sale de /api/stats/adp, el mismo board que draftea el
 * motor. El usuario reordena y lo suyo manda: se guarda por ORDEN DE IDS, no
 * por posiciones absolutas, para que el dia que Sleeper mueva su ADP la lista
 * propia no se descoloque.
 *
 * Los cortes de tier se guardan como "despues de este jugador se corta", NO
 * como indices: un tier que vive en un indice se rompe en cuanto mueves a
 * alguien por encima, y la primera version hacia exactamente eso.
 */
'use strict';

var TMR = {
  fmt: 'ppr',
  rows: [],        // [{id,name,pos,team,adp,adpRank}]
  breakAfter: {},  // id -> true: despues de este jugador se corta el tier
  filter: 'ALL',
  q: '',
  loaded: false,
  drag: null,
  // ── el dinero ─────────────────────────────────────────────────────────
  sticker: null,   // id -> precio de la sala, tal cual lo saca auPoolInit
  price: {},       // id -> precio objetivo (sala mezclada con MI puesto)
  manual: {},      // id -> precio escrito a mano: manda sobre el calculado
  target: {},      // id -> true: entra en el plan de la barra Build
  room: null,      // la sala con la que se calculo, declarada en pantalla
  pricing: false,  // mientras el motor no responde, la columna va en skeleton
  _curva: null,    // los precios de la sala ordenados de mayor a menor
  _firma: '',      // firma de la sala: si cambia, hay que volver a calcular
  _edit: null,     // id que se esta editando ahora mismo
  _cancel: false,  // Escape: el blur que viene detras NO debe guardar
  // ── el dueno y su sincronizacion ──────────────────────────────────────
  owner: null,     // null = sin preguntar, true/false = lo que dijo el servidor
  _ownerP: null,   // la promesa de esa pregunta: se hace UNA vez
  _dirty: false,   // hay cambios locales que el servidor todavia no tiene
  _syncT: null,    // el debounce del PUT
  _syncing: false,
  seedMissing: [], // nombres del seed que no resolvieron: se declaran
  // ── el Tier Game ──────────────────────────────────────────────────────
  game: [],        // [{a,b,v,t}] v: 2 A claro, 1 A poco, 0 mismo tier, -1/-2 B
  gameOn: false,   // la pantalla del juego esta puesta encima de la lista
  gamePair: null,  // la pareja que se esta preguntando ahora mismo
  sheetOn: false   // la cheat sheet esta abierta
};

var TMR_KEY = 'tm_rankings_v1';
var TMR_USE_KEY = 'tm_rankings_use';
/* El plan (precios a mano y objetivos) vive en SU propia llave, no dentro de
 * la del orden: "Reset to consensus" borra el orden y los tiers, y perder
 * ademas los precios que uno escribio a mano no es lo que anuncia ese boton. */
var TMR_PLAN_KEY = 'tm_rankings_plan_v1';
var TMR_SEED_KEY = 'tm_rk_seed_v1';     // el seed corre UNA vez por dispositivo y por documento
var TMR_OWNER_KEY = 'tm_rk_owner';      // veredicto cacheado: decide el formato del board ANTES de pedir nada
var TMR_SYNC_AT_KEY = 'tm_rk_sync_at';  // updatedAt del ultimo estado que el servidor confirmo
var TMR_SYNC_MS = 800;                  // debounce del PUT
var TMR_LIMIT = 200; // top 200: mas abajo el ADP es ruido y la lista se vuelve inmanejable

/* El board de partida. Para el dueno es el de SU formato (half PPR), no el de
 * PPR entero: el veredicto de dueno viene del servidor y es asincrono, asi que
 * se cachea en el dispositivo y solo la PRIMERA carga de un navegador nuevo
 * tiene que rehacer la lista. Para cualquier otra cuenta esto es 'ppr' y la
 * pantalla es exactamente la de siempre. */
try {
  if (localStorage.getItem(TMR_OWNER_KEY) === '1') TMR.fmt = 'half-ppr';
} catch (_) { }

function _tmrNorm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/* ── persistencia ───────────────────────────────────────────────────────── */
function tmrSave() {
  try {
    localStorage.setItem(TMR_KEY, JSON.stringify({
      fmt: TMR.fmt,
      order: TMR.rows.map(function (r) { return r.id; }),
      breaks: Object.keys(TMR.breakAfter).filter(function (k) { return TMR.breakAfter[k]; }),
      updated: Date.now()
    }));
  } catch (_) { /* modo privado: la sesion sigue funcionando en memoria */ }
  var st = document.getElementById('rk-saved');
  if (st) {
    st.textContent = 'Saved';
    st.style.opacity = '1';
    clearTimeout(TMR._stT);
    TMR._stT = setTimeout(function () { st.style.opacity = '0'; }, 1400);
  }
}

function tmrLoadSaved() {
  try {
    var raw = localStorage.getItem(TMR_KEY);
    if (!raw) return null;
    var d = JSON.parse(raw);
    if (!d || !Array.isArray(d.order)) return null;
    return d;
  } catch (_) { return null; }
}

/* ── el plan: precios a mano y objetivos ────────────────────────────────────
 * Los dos se guardan POR ID DE SLEEPER, nunca por posicion en la lista, que
 * es la misma decision que ya gobierna el orden: el dia que uno mueva a un
 * jugador, su precio y su marca de objetivo se van con el. */
function tmrPlanSave() {
  try {
    localStorage.setItem(TMR_PLAN_KEY, JSON.stringify({
      prices: TMR.manual,
      targets: Object.keys(TMR.target).filter(function (k) { return TMR.target[k]; }),
      updated: Date.now()
    }));
  } catch (_) { /* modo privado: la sesion sigue funcionando en memoria */ }
  var st = document.getElementById('rk-saved');
  if (st) {
    st.textContent = 'Saved';
    st.style.opacity = '1';
    clearTimeout(TMR._stT);
    TMR._stT = setTimeout(function () { st.style.opacity = '0'; }, 1400);
  }
  tmrSyncQueue();
}

function tmrPlanLoad() {
  try {
    var d = JSON.parse(localStorage.getItem(TMR_PLAN_KEY) || 'null');
    if (!d) return;
    if (d.prices) Object.keys(d.prices).forEach(function (k) {
      var n = Number(d.prices[k]);
      if (isFinite(n) && n >= 0) TMR.manual[k] = Math.round(n);
    });
    (d.targets || []).forEach(function (k) { TMR.target[k] = true; });
  } catch (_) { }
}

/* Lo que lee Draft Day. No exige que el tab se haya abierto ni que la casilla
 * de "Use in mock drafts" este encendida: un precio escrito a mano es una
 * decision tomada, y tiene que valer venga por donde venga el usuario. */
function tmrPlanPrices() { return TMR.manual; }

/* Lo que la SALA va a pagar por el: la cifra con la que se planifica. Su
 * techo, el margen corto por encima, lo da tmrCeilOf. */
function tmrPriceOf(id) {
  if (TMR.manual[id] != null) return TMR.manual[id];
  return (TMR.price[id] != null) ? TMR.price[id] : null;
}

/* ── el precio, sacado del motor de subasta que ya existe ───────────────────
 * NO hay una segunda formula de precios en este archivo. auPoolInit reparte el
 * dinero de la sala entre los jugadores draftables (curva recalibrada contra
 * una subasta real el 2026-08-28) y esto lo llama TAL CUAL, prestandole a MD
 * la forma de la sala durante una vuelta sincrona y devolviendosela intacta.
 * Escribir aqui "precio = AAV x algo" seria la segunda verdad que este repo ya
 * pago caro en otros sitios.
 *
 * Que sala. La que este puesta en Mock Draft, que es la del dueno cuando el
 * preset Fantazy 2026 esta encendido (10 equipos, $200, 15 rondas, half PPR).
 * La barra Build DECLARA esa sala en pantalla: un precio sin su sala no
 * significa nada, porque el mismo jugador vale distinto en 10 que en 14.
 *
 * Lo que NO entra, y por que. lvCeiling (Draft Day) parte del mismo sitio pero
 * le suma inflacion viva, el hueco de titular que te falta y la ley del
 * presupuesto: tres cosas que solo existen con una sala abierta y que cambian
 * a cada venta. Antes del draft no hay ninguna, asi que el numero honesto es
 * el sticker de la sala mezclado con MI puesto, sin gusto: exactamente el
 * numero limpio que Draft Day llama "puro". Ademas, mezclar sobre la misma
 * curva conserva el dinero (los 150 huecos siguen sumando el bote de la sala),
 * que es justo lo que hace que la barra Build se pueda sumar contra $200. */
/* ── la sala del dueno ──────────────────────────────────────────────────────
 * Su liga es UNA: Fantazy 2026 en Yahoo, la misma que el preset FZ26 de
 * public/app.js (~9772). Los numeros de aqui son los que ese preset escribe en
 * los selects del mock (app.js ~9842), no una copia libre.
 *
 * Se FUERZA, y esto es un cambio deliberado sobre la sesion anterior: antes la
 * columna Pay leia la memoria del mock, asi que si el dueno se ponia a probar
 * una sala de 12 equipos PPR, sus precios de la subasta del domingo cambiaban
 * debajo de el sin que nadie se lo dijera. Su palabra: "toma en cuenta los
 * league settings y format de la liga". No se toca lo que el tenga elegido en
 * Mock Draft: se le presta la forma al motor durante una vuelta y se le
 * devuelve, que es lo que tmrPrices ya hacia.
 *
 * El TD de pase a 6 (md-6pt) se declara pero NO mueve el Pay, y se dice aqui
 * en vez de fingir que si: MD.sixPt solo entra en `dv` (app.js ~10498), la
 * proyeccion que usan las recomendaciones, y auPoolInit no lo mira. El precio
 * sale del AAV real y del ADP del formato. */
var TMR_FZ26 = {
  teams: 10, budget: 200, rounds: 15, scoring: 0.5, sf: false,
  sixPt: true, name: 'Fantazy 2026'
};

/* Que board pide esta sala. ESPEJO EXACTO de app.js ~10454, que es donde el
 * mock elige su feed; el gate lo extrae de los dos archivos y los compara, para
 * que no se separen en silencio (la misma vacuna que lleva tmClasificarLiga).
 * Importa de verdad: medido el 2026-08-28, entre PPR entero y half PPR se
 * mueven 86 de los 100 primeros y hasta 9 puestos. Preciar en half PPR con el
 * orden de PPR entero es decir "half PPR" y cobrar otra cosa. */
function tmrAdpFmt(cfg) {
  return cfg.sf ? '2qb' : (cfg.scoring === 0 ? 'standard' : cfg.scoring === 0.5 ? 'half-ppr' : 'ppr');
}

/* La alineacion de la sala. Misma regla que _mdLineupSlots (app.js ~13326)
 * para una sala SIN liga conectada, que es por construccion el caso de FZ26:
 * el preset ignora la liga de Sleeper a proposito (app.js ~9917). En FZ26 sale
 * QB1+RB2+WR2+TE1+FLEX1+K1+DEF1 = 9 titulares y 6 de banca, que es lo que ya
 * dice el comentario del preset en app.js ~9825. */
function tmrRosterShape(cfg) {
  var s = { QB: cfg.sf ? 2 : 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 };
  s.titulares = s.QB + s.RB + s.WR + s.TE + s.FLEX + s.K + s.DEF;
  s.banca = Math.max(0, (cfg.rounds || 15) - s.titulares);
  return s;
}

function tmrRoomCfg() {
  // El dueno tiene una sola subasta y es esta. Cualquier otra cuenta no ve
  // precios, asi que forzar aqui no le cambia la pantalla a nadie mas.
  if (TMR.owner === true) {
    return {
      teams: TMR_FZ26.teams, budget: TMR_FZ26.budget, rounds: TMR_FZ26.rounds,
      scoring: TMR_FZ26.scoring, sf: TMR_FZ26.sf, sixPt: TMR_FZ26.sixPt, fz26: true
    };
  }
  // De donde sale la sala, en este orden y por una razon medida: los selects
  // del mock NO estan puestos hasta que mdRestoreSettings corre, y esa funcion
  // vive en el arranque de la pantalla de Mock Draft. Entrando directo a
  // My Rankings los selects traen todavia sus valores del HTML (12 equipos, 8
  // rondas, PPR entera) y la columna habria pintado el precio de una sala que
  // no es la suya: medido, el mismo jugador pasaba de $76 a $104. La memoria
  // del dispositivo (tm_mock_settings, la misma que restaura el mock) es la
  // unica verdad. Sin memoria todavia, el respaldo NO son los defaults del
  // HTML (12 equipos, 8 rondas): ocho rondas son 96 huecos y en una subasta
  // eso no es un precio, es otro juego. El respaldo es la forma de una
  // subasta normal, que ademas es la de su liga: 10 equipos, $200, 15 rondas,
  // half PPR. Y la barra Build lo DECLARA en pantalla.
  var mem = null;
  try { mem = JSON.parse(localStorage.getItem('tm_mock_settings') || 'null'); } catch (_) { }
  var g = function (id, d) {
    return (mem && mem[id] != null && mem[id] !== '') ? mem[id] : d;
  };
  var sc = parseFloat(g('md-scoring', '0.5'));
  return {
    teams: parseInt(g('md-teams', '10'), 10) || 10,
    budget: parseInt(g('md-budget', '200'), 10) || 200,
    rounds: parseInt(g('md-rounds', '15'), 10) || 15,
    scoring: isFinite(sc) ? sc : 0.5,
    sf: g('md-format', '1qb') === 'sf'
  };
}

// El pool de precios se arma del MISMO board que la lista (window._adp) y con
// el mismo tamano que usa la sala de verdad, porque auPoolInit ancla el precio
// en el ULTIMO jugador draftable: un pool mas corto moveria ese ancla y con
// ella todos los precios.
function _tmrPricePool(n) {
  var src = window._adp;
  if (!src) return null;
  var out = [], vistos = {};
  Object.keys(src).forEach(function (k) {
    var p = src[k];
    if (!p || !p.adp || !p.pos) return;
    if (['QB', 'RB', 'WR', 'TE'].indexOf(p.pos) < 0) return;  // la sala tampoco los tiene
    out.push({ id: String(p._id || k), name: p.name || k, pos: p.pos, team: p.team || '', adp: p.adp });
  });
  out.sort(function (a, b) { return a.adp - b.adp; });
  out = out.slice(0, n);
  out.forEach(function (p) { vistos[p.id] = 1; });
  /* Y CUALQUIERA QUE ESTE EN LA LISTA y no en este board. Sleeper no cotiza a
   * todo el mundo en todos los formatos: medido el 2026-08-28, diez jugadores
   * del top 200 de PPR entero no tienen ADP de half PPR, y esos diez salian con
   * un "$-" en la columna del dinero. Un jugador en la lista sin precio es una
   * fila que no dice nada, asi que entra al pool con el ADP que tenga. Meterlos
   * no mueve el ancla del precio (esa la fija el jugador numero teams x rondas,
   * y estos caen por debajo), solo les da su numero. */
  for (var i = 0; i < TMR.rows.length; i++) {
    var r = TMR.rows[i];
    if (vistos[r.id] || ['QB', 'RB', 'WR', 'TE'].indexOf(r.pos) < 0 || !r.adp) continue;
    out.push({ id: r.id, name: r.name, pos: r.pos, team: r.team || '', adp: r.adp });
    vistos[r.id] = 1;
  }
  out.sort(function (a, b) { return a.adp - b.adp; });
  return out;
}

async function tmrPrices() {
  if (typeof MD === 'undefined' || typeof AU === 'undefined' || typeof auPoolInit !== 'function') return false;
  var cfg = tmrRoomCfg();
  var firma = [cfg.teams, cfg.budget, cfg.rounds, cfg.scoring, cfg.sf ? 1 : 0].join('/');
  if (TMR.sticker && TMR._firma === firma) { tmrBlend(); return true; }
  // Una sala VIVA es dueña de AU.val: no se le toca ni prestado. Lo mismo
  // vale mientras startMockDraft esta a medias, porque es asincrono y nuestro
  // prestamo le devolveria a MD los valores de ANTES de que empezara.
  // Pero con una sala abierta no hace falta pedir nada prestado: AU.val YA es
  // el precio de esa sala, que es exactamente la que el usuario esta jugando.
  if (AU.active) {
    if (AU.val && Object.keys(AU.val).length) {
      TMR.sticker = AU.val;
      TMR._curva = Object.keys(AU.val).map(function (k) { return AU.val[k]; }).sort(function (a, b) { return b - a; });
      TMR._firma = firma;
      TMR.room = cfg;
      tmrBlend();
      return true;
    }
    return false;
  }
  if (MD._starting) return false;
  // El board del formato de la sala. auPoolInit ordena por el ADP del formato
  // (app.js ~12948: "los RB suben, los WR bajan"), asi que darle el de PPR
  // entero y decirle scoring 0.5 es cobrar un precio que no es el de su liga.
  if (typeof loadAdp === 'function') { try { await loadAdp(tmrAdpFmt(cfg)); } catch (_) { } }
  if (typeof mdLoadAav === 'function') { try { await mdLoadAav(); } catch (_) { } }
  if (AU.active || MD._starting) return false;   // pudo abrirse una mientras llegaba el feed
  var pool = _tmrPricePool(Math.max(260, cfg.teams * cfg.rounds + 80));
  if (!pool || pool.length < 50) return false;

  // El prestamo. Sincrono de punta a punta: entre el guardado y la devolucion
  // no puede haber un await, o cualquier otro codigo veria un MD que no es el
  // suyo.
  var bak = { pool: MD.pool, teams: MD.teams, budget: MD.budget, rounds: MD.rounds, scoring: MD.scoring, sf: MD.sf, val: AU.val };
  var val = null;
  try {
    MD.pool = pool; MD.teams = cfg.teams; MD.budget = cfg.budget;
    MD.rounds = cfg.rounds; MD.scoring = cfg.scoring; MD.sf = cfg.sf;
    auPoolInit();
    val = AU.val;
  } catch (_) {
    val = null;
  } finally {
    MD.pool = bak.pool; MD.teams = bak.teams; MD.budget = bak.budget;
    MD.rounds = bak.rounds; MD.scoring = bak.scoring; MD.sf = bak.sf; AU.val = bak.val;
  }
  if (!val) return false;

  TMR.sticker = val;
  TMR._curva = Object.keys(val).map(function (k) { return val[k]; }).sort(function (a, b) { return b - a; });
  TMR._firma = firma;
  TMR.room = cfg;
  tmrBlend();
  return true;
}

/* ── el precio es el de la SALA, nunca el de su entusiasmo ──────────────────
 * Correccion del dueno, textual: "no quiero que me ponga a pagar mas por Swift
 * porque todavia puedo pagar menos".
 *
 * Tenia razon y es la regla que gobierna toda esta pantalla: en una subasta se
 * paga lo que cobra la sala, no lo que uno valora. Que el tenga a Swift de RB2
 * no lo hace mas caro; lo hace su objetivo. Subir el precio recomendado porque
 * a el le gusta seria cobrarle su propio entusiasmo, que es exactamente el
 * error que la version anterior cometia.
 *
 * Asi que hay DOS cosas y no se mezclan nunca:
 *  - EL PRECIO. Sale del motor (auPoolInit sobre la sala FZ26) y de ahi salen
 *    las dos cifras que el usa el domingo: `expect`, lo que la sala va a pagar,
 *    y el techo, un margen corto por encima para no perder un lote por un
 *    dolar. Ni una ni otra suben por su lista.
 *  - SU ORDEN, que NO es un precio: es prioridad. Decide a quien perseguir, por
 *    donde cortar los tiers, cuales son sus objetivos y donde esta la ganga
 *    (alguien alto en su lista que la sala vende barato). En pantalla aparece
 *    como texto, "your RB2", nunca como dolares.
 *
 * Un precio escrito a mano sigue mandando sobre las dos: ese numero ya es una
 * decision tomada. */
var TMR_TECHO = 1.2;   // margen corto sobre el precio de sala: perder un lote por $1 es peor

function tmrBlend() {
  var st = TMR.sticker;
  if (!st) return;
  var pr = {};
  for (var i = 0; i < TMR.rows.length; i++) {
    var r = TMR.rows[i];
    if (st[r.id] != null) pr[r.id] = Math.max(1, Math.round(st[r.id]));
  }
  TMR.price = pr;
}

/* Hasta donde subir sin arrepentirse. Un margen corto sobre el mercado, NUNCA
 * sobre su valoracion. Si el escribio un numero, ese numero es el techo. */
function tmrCeilOf(id) {
  if (TMR.manual[id] != null) return TMR.manual[id];
  var v = TMR.price[id];
  return (v != null) ? Math.max(1, Math.round(v * TMR_TECHO)) : null;
}

/* ── carga ──────────────────────────────────────────────────────────────── */
async function renderRankings() {
  var host = document.getElementById('rk-body');
  if (!host) return;
  if (TMR.loaded) {
    tmrPaint();
    if (!(await tmrOwner())) return;
    // Reabrir el tab es el momento de volver a preguntar: por el servidor (el
    // telefono pudo editar la lista mientras tanto) y por los precios, porque
    // un intento anterior pudo quedarse sin ellos (sala viva, feed caido) y el
    // usuario pudo cambiar la sala en Mock Draft. tmrPrices se corta sola por
    // firma si nada cambio, asi que reintentarlo es gratis.
    try { await tmrSyncPull(); } catch (_) { }
    try { await tmrPrices(); } catch (_) { }
    tmrPaint();
    return;
  }

  host.innerHTML = tmrSkeleton();

  try {
    if (typeof loadAdp === 'function') await loadAdp(TMR.fmt);
  } catch (_) { }

  var src = window._adp;
  if (!src) {
    host.innerHTML = '<div class="rk-empty">The board did not load. Check your connection and open the tab again.</div>';
    return;
  }

  // el board llega indexado por nombre normalizado: lo paso a lista y lo ordeno
  // por ADP, que es el punto de partida antes de que el usuario opine
  var list = [];
  Object.keys(src).forEach(function (k) {
    var p = src[k];
    if (!p || !p.adp || !p.pos) return;
    if (p.pos === 'K' || p.pos === 'DEF') return; // nadie hace tiers de kickers
    list.push({ id: String(p._id || k), name: p.name || k, pos: p.pos, team: p.team || '', adp: p.adp });
  });
  list.sort(function (a, b) { return a.adp - b.adp; });
  list = list.slice(0, TMR_LIMIT);
  list.forEach(function (r, i) { r.adpRank = i + 1; });

  // el orden guardado manda sobre el ADP; los que no estaban guardados caen
  // detras en su orden de consenso, para que un board nuevo no borre tu lista
  var saved = tmrLoadSaved();
  if (saved) {
    var byId = {};
    list.forEach(function (r) { byId[r.id] = r; });
    var out = [], seen = {};
    saved.order.forEach(function (id) {
      if (byId[id] && !seen[id]) { out.push(byId[id]); seen[id] = 1; }
    });
    list.forEach(function (r) { if (!seen[r.id]) out.push(r); });
    list = out;
    TMR.breakAfter = {};
    (saved.breaks || []).forEach(function (id) { TMR.breakAfter[id] = true; });
  }

  TMR.rows = list;
  TMR.loaded = true;

  // La lista se pinta YA. Lo que sigue (precios, objetivos, sincronizacion) es
  // SOLO del dueno: para cualquier otra cuenta My Rankings termina aqui y queda
  // identico a como estaba, con una sola pregunta al servidor que responde 200.
  tmrPaint();
  if (!(await tmrOwner())) return;

  /* El board del FORMATO de su liga. El PRECIO ya lo carga tmrPrices por su
   * cuenta, asi que aqui solo queda que la lista y la columna ADP salgan del
   * mismo sitio. Se apunta el formato y punto: NO se rehace la lista.
   *
   * Se intento rehacerla y fue peor, medido: la pantalla se vaciaba un
   * instante, y el gate cazo tres carreras (la lista en blanco a mitad de un
   * check, el documento del servidor leido antes de llegar, y peticiones
   * abortadas ensuciando la consola). El precio, que es lo unico que decide
   * dolares, ya era correcto en las dos ramas. Asi que la primera visita de un
   * navegador nuevo ve la columna ADP en PPR entero y a partir de la segunda,
   * con el veredicto ya cacheado, todo sale en half PPR desde la primera
   * linea. Es una diferencia de referencia, no de dinero. */
  TMR.fmt = tmrAdpFmt(tmrRoomCfg());

  // El servidor primero: si el telefono guardo una version mas nueva, es esa la
  // que se pinta, no la cache de este navegador. Y el seed va DESPUES de leer
  // el servidor, porque el documento dice si ya corrio en el otro dispositivo.
  try { await tmrSyncPull(); } catch (_) { }
  try { tmrSeed(); } catch (_) { }

  // La columna del dinero en skeleton mientras llega el feed de subasta:
  // esperar al feed para ensenar doscientos nombres que ya estan en memoria
  // seria cambiar una pantalla instantanea por una en blanco.
  TMR.pricing = true;
  tmrPaint();
  try { await tmrPrices(); } catch (_) { }
  TMR.pricing = false;
  tmrPaint();
}

/* ── el dueno ───────────────────────────────────────────────────────────────
 * Una sola pregunta por carga, con la MISMA regla del servidor (permitido() de
 * server/routes/perfil.js): aqui no hay una segunda lista de duenos. Mientras
 * no conteste, o si contesta que no, la pantalla es la de siempre. */
function tmrOwner() {
  if (TMR._ownerP) return TMR._ownerP;
  TMR._ownerP = (async function () {
    var own = false;
    try {
      var r = await fetch('/api/perfil/owner', { cache: 'no-store' });
      if (r.ok) { var j = await r.json(); own = !!(j && j.owner); }
    } catch (_) { own = false; }
    TMR.owner = own;
    try { localStorage.setItem(TMR_OWNER_KEY, own ? '1' : '0'); } catch (_) { }
    var tab = document.getElementById('tab-rankings');
    if (tab) tab.classList.toggle('rk-owner', own);
    // Los botones del dueno (Tier Game y Cheat Sheet) se escriben aqui, en el
    // unico punto por el que pasa la respuesta del servidor.
    try { tmrOwnerTools(); } catch (_) { }
    return own;
  })();
  return TMR._ownerP;
}

/* ── sincronizacion por servidor ────────────────────────────────────────────
 * Un documento del dueno en /api/perfil/rankings, compartido por sus dos
 * navegadores (computadora y celular). localStorage sigue siendo la cache y
 * lo que se pinta al instante; el servidor decide quien tiene la version mas
 * nueva por updatedAt. El PUT va con debounce, y si falla queda marcado como
 * pendiente: se reintenta con el siguiente cambio y al volver el foco. */
function tmrSyncDoc() {
  var pref = null;
  try {
    if (window.LV && LV.pref) pref = LV.pref;
    else { var d = JSON.parse(localStorage.getItem('tm_lv_pref') || 'null'); pref = (d && d.pref) || {}; }
  } catch (_) { pref = {}; }
  var seeded = false;
  try { seeded = localStorage.getItem(TMR_SEED_KEY) === '1'; } catch (_) { }
  var order = null;
  var saved = tmrLoadSaved();
  if (TMR.loaded && TMR.rows.length) order = TMR.rows.map(function (r) { return r.id; });
  else if (saved) order = saved.order;
  return {
    v: 1,
    fmt: TMR.fmt || (saved && saved.fmt) || null,
    order: order || [],
    breaks: Object.keys(TMR.breakAfter || {}).filter(function (k) { return TMR.breakAfter[k]; }),
    prices: TMR.manual,
    targets: Object.keys(TMR.target).filter(function (k) { return TMR.target[k]; }),
    // Las respuestas del Tier Game viajan enteras, no el resultado inferido:
    // el resultado se vuelve a calcular en cada dispositivo con la misma
    // funcion pura, y guardar el derivado en vez del dato haria que un cambio
    // de umbral dejara dos telefonos afirmando tiers distintos.
    game: TMR.game || [],
    pref: pref || {},
    seeded: seeded,
    updatedAt: Date.now()
  };
}

function tmrSyncAt() {
  try { return Number(localStorage.getItem(TMR_SYNC_AT_KEY)) || 0; } catch (_) { return 0; }
}

function tmrSyncStatus(txt, keep) {
  var el = document.getElementById('rk-sync');
  if (!el) return;
  el.textContent = txt || '';
  el.className = 'rk-sync' + (keep ? ' is-warn' : '');
}

/* Aplica el documento del servidor: cache local, memoria y pantalla. */
function tmrSyncApply(doc) {
  if (!doc || typeof doc !== 'object') return;
  try {
    if (Array.isArray(doc.order) && doc.order.length) {
      localStorage.setItem(TMR_KEY, JSON.stringify({ fmt: doc.fmt || TMR.fmt, order: doc.order, breaks: doc.breaks || [], updated: Date.now() }));
    }
    localStorage.setItem(TMR_PLAN_KEY, JSON.stringify({ prices: doc.prices || {}, targets: doc.targets || [], updated: Date.now() }));
    if (doc.pref && typeof doc.pref === 'object') {
      var d = null;
      try { d = JSON.parse(localStorage.getItem('tm_lv_pref') || 'null'); } catch (_) { }
      d = d || {};
      d.pref = doc.pref;
      localStorage.setItem('tm_lv_pref', JSON.stringify(d));
      if (window.LV) LV.pref = doc.pref;
    }
    if (doc.seeded) localStorage.setItem(TMR_SEED_KEY, '1');
    if (Array.isArray(doc.game)) {
      localStorage.setItem(TMR_GAME_KEY, JSON.stringify({ answers: doc.game, updated: Date.now() }));
    }
  } catch (_) { }
  TMR.manual = {};
  TMR.target = {};
  tmrPlanLoad();
  // El juego se retoma desde el otro dispositivo: entra la lista de respuestas
  // del documento y la pareja en curso se recalcula de ellas, nunca se guarda.
  if (Array.isArray(doc.game)) {
    TMR.game = doc.game.filter(tmrGameOk);
    TMR.gamePair = null;
    if (TMR.gameOn) tmrGamePaint();
  }
  if (TMR.loaded && TMR.rows.length && Array.isArray(doc.order) && doc.order.length) {
    var byId = {}, out = [], seen = {};
    TMR.rows.forEach(function (r) { byId[r.id] = r; });
    doc.order.forEach(function (id) { if (byId[id] && !seen[id]) { out.push(byId[id]); seen[id] = 1; } });
    TMR.rows.forEach(function (r) { if (!seen[r.id]) out.push(r); });
    TMR.rows = out;
    TMR._idx = null; TMR._idxN = -1;
    TMR.breakAfter = {};
    (doc.breaks || []).forEach(function (id) { TMR.breakAfter[id] = true; });
  }
}

async function tmrSyncPull() {
  if (TMR.owner !== true) return false;
  var r;
  try { r = await fetch('/api/perfil/rankings', { cache: 'no-store' }); } catch (_) { tmrSyncStatus('Offline', true); return false; }
  if (!r.ok) { tmrSyncStatus('Offline', true); return false; }
  var j = null;
  try { j = await r.json(); } catch (_) { return false; }
  var at = Number(j && j.updatedAt) || 0;
  var mio = tmrSyncAt();
  if (j && j.doc && at > mio && !TMR._dirty) {
    tmrSyncApply(j.doc);
    try { localStorage.setItem(TMR_SYNC_AT_KEY, String(at)); } catch (_) { }
    tmrSyncStatus('Synced from your other device');
    setTimeout(function () { if (!TMR._dirty) tmrSyncStatus(''); }, 2200);
    if (TMR.loaded) tmrPaint();
    return true;
  }
  if (!j || !j.doc) {
    // El servidor no tiene nada todavia: lo que hay aqui es la version buena
    if (mio === 0 && (tmrLoadSaved() || Object.keys(TMR.manual).length || Object.keys(TMR.target).length)) tmrSyncQueue();
  }
  if (TMR._dirty) tmrSyncQueue();
  else tmrSyncStatus(j && j.store && j.store !== 'blob' ? 'Synced (' + j.store + ')' : 'Synced');
  return false;
}

function tmrSyncQueue() {
  if (TMR.owner !== true) return;
  TMR._dirty = true;
  tmrSyncStatus('Saving');
  clearTimeout(TMR._syncT);
  TMR._syncT = setTimeout(tmrSyncPush, TMR_SYNC_MS);
}

async function tmrSyncPush() {
  if (TMR.owner !== true || TMR._syncing) return;
  TMR._syncing = true;
  var doc = tmrSyncDoc();
  var ok = false, store = '';
  try {
    var r = await fetch('/api/perfil/rankings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc)
    });
    if (r.ok) {
      var j = null;
      try { j = await r.json(); } catch (_) { }
      ok = true; store = (j && j.store) || '';
      try { localStorage.setItem(TMR_SYNC_AT_KEY, String((j && j.updatedAt) || doc.updatedAt)); } catch (_) { }
    }
  } catch (_) { ok = false; }
  TMR._syncing = false;
  if (ok) {
    TMR._dirty = false;
    tmrSyncStatus(store && store !== 'blob' ? 'Synced (' + store + ')' : 'Synced');
  } else {
    // Se queda pendiente: se reintenta con el siguiente cambio y al volver el foco
    tmrSyncStatus('Offline, will retry', true);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', function () {
    if (TMR.owner !== true) return;
    if (TMR._dirty) { tmrSyncPush(); return; }
    if (TMR.loaded) tmrSyncPull().catch(function () { });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || TMR.owner !== true) return;
    if (TMR._dirty) tmrSyncPush();
    else if (TMR.loaded) tmrSyncPull().catch(function () { });
  });
  // Editar y cerrar la pestana en menos de 800 ms no puede perder el cambio:
  // el PUT pendiente sale con keepalive, que sobrevive a la descarga de la
  // pagina. (sendBeacon no sirve: no lleva la cabecera de cuenta.)
  window.addEventListener('pagehide', function () {
    if (TMR.owner !== true || !TMR._dirty) return;
    clearTimeout(TMR._syncT);
    try {
      fetch('/api/perfil/rankings', {
        method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tmrSyncDoc())
      }).catch(function () { });
    } catch (_) { }
  });
}

/* ── el seed: una sola vez ──────────────────────────────────────────────────
 * Los objetivos del plan que el dueno aprobo el 2026-08-28 y su lista Love de
 * Draft Day. Corre UNA vez: la bandera va en localStorage y TAMBIEN en el
 * documento del servidor, para que el otro dispositivo no lo repita encima de
 * lo que el dueno ya cambio. Nunca pisa nada que exista, y los nombres que no
 * resuelven contra el board se DECLARAN en la barra Build, no se tragan. */
var TMR_SEED_TARGETS = ['Jahmyr Gibbs', 'Ashton Jeanty', "De'Von Achane", 'Derrick Henry', 'Kyren Williams',
  "D'Andre Swift", 'Breece Hall', 'Travis Etienne', 'Cam Skattebo', 'Javonte Williams', 'Quinshon Judkins',
  'TreVeyon Henderson', 'Chris Olave', 'Ladd McConkey', 'DeVonta Smith', 'Emeka Egbuka', 'Zay Flowers',
  'Tee Higgins', 'Tetairoa McMillan', 'Colston Loveland', 'Tyler Warren', 'Tucker Kraft', 'Jalen Hurts',
  'Jayden Daniels', 'Drake Maye'];
var TMR_SEED_LOVE = ["D'Andre Swift", 'Breece Hall', 'Travis Etienne', 'Cam Skattebo', 'Javonte Williams',
  'Quinshon Judkins', 'TreVeyon Henderson', 'Jahmyr Gibbs'];

function tmrSeedFind(name) {
  var n = _tmrNorm(name);
  for (var i = 0; i < TMR.rows.length; i++) if (_tmrNorm(TMR.rows[i].name) === n) return TMR.rows[i];
  // el board a veces trae el nombre sin sufijo o con inicial: se acepta el
  // apellido completo con la misma inicial de pila, si es unico
  var partes = n.split(' '), ap = partes[partes.length - 1], cands = [];
  for (var k = 0; k < TMR.rows.length; k++) {
    var m = _tmrNorm(TMR.rows[k].name);
    if (m.split(' ').pop() === ap && m.charAt(0) === n.charAt(0)) cands.push(TMR.rows[k]);
  }
  return cands.length === 1 ? cands[0] : null;
}

function tmrSeed() {
  if (TMR.owner !== true || !TMR.loaded || !TMR.rows.length) return false;
  try { if (localStorage.getItem(TMR_SEED_KEY) === '1') return false; } catch (_) { }
  var missing = [];
  TMR_SEED_TARGETS.forEach(function (nm) {
    var r = tmrSeedFind(nm);
    if (!r) { missing.push(nm); return; }
    if (!TMR.target[r.id]) TMR.target[r.id] = true;
  });
  var pref = null;
  try { var d = JSON.parse(localStorage.getItem('tm_lv_pref') || 'null'); pref = (d && d.pref) || {}; } catch (_) { pref = {}; }
  if (window.LV && LV.pref) pref = LV.pref;
  TMR_SEED_LOVE.forEach(function (nm) {
    var r = tmrSeedFind(nm);
    if (!r) { if (missing.indexOf(nm) < 0) missing.push(nm); return; }
    if (!pref[r.id]) pref[r.id] = 'love';   // sin pisar lo que ya exista
  });
  try {
    if (window.LV && typeof lvSavePref === 'function') { LV.pref = pref; lvSavePref(); }
    else {
      var d2 = null;
      try { d2 = JSON.parse(localStorage.getItem('tm_lv_pref') || 'null'); } catch (_) { }
      d2 = d2 || {}; d2.pref = pref;
      localStorage.setItem('tm_lv_pref', JSON.stringify(d2));
    }
    localStorage.setItem(TMR_SEED_KEY, '1');
  } catch (_) { }
  TMR.seedMissing = missing;
  tmrPlanSave();   // guarda y encola el PUT con seeded:true
  return true;
}

// El esqueleto tiene que tener la FORMA de lo que va a llegar: circulo de la
// foto, nombre, y las CUATRO cifras de la derecha (pos, ADP, distancia y el
// precio). Uno generico hace que la pantalla salte al cargar, que es justo lo
// que un skeleton viene a evitar.
function tmrSkeleton() {
  var out = '<div class="rk-skel-wrap">';
  for (var i = 0; i < 12; i++) {
    out += '<div class="rk-skel-row">'
      + '<div class="rk-skel-num"></div><div class="rk-skel-pic"></div>'
      + '<div class="rk-skel-name"></div>'
      + '<div class="rk-skel-tag"></div><div class="rk-skel-tag"></div>'
      + '<div class="rk-skel-tag"></div><div class="rk-skel-tag"></div>'
      + '</div>';
  }
  return out + '</div>';
}

/* ── la celda del dinero ────────────────────────────────────────────────────
 * Un precio a mano se tiene que poder distinguir del calculado de un vistazo,
 * o el usuario no sabe cual de los doscientos toco: va en el color de acento y
 * subrayado, con el numero del motor en el title, y con su boton de volver al
 * calculado al lado. Sin la vuelta atras, escribir un precio seria una puerta
 * de un solo sentido. */
function tmrPriceCell(id, mio) {
  var man = TMR.manual[id], calc = TMR.price[id];
  if (TMR.pricing && man == null && calc == null) return '<span class="rk-pr-skel"></span>';
  // Lo que se pinta es el TECHO: hasta donde subir sin arrepentirse. El precio
  // que la sala va a pagar viaja al lado, en el tooltip, junto a SU puesto, que
  // es lo que decide si perseguirlo, no cuanto pagar.
  var v = (man != null) ? man : tmrCeilOf(id);
  var t = (man != null)
    ? 'Your price. The room pays about $' + (calc == null ? '?' : calc) + '.'
    : 'The room pays about $' + (calc == null ? '?' : calc) + ', do not go past $' + (v == null ? '?' : v)
    + (mio ? '. Your ' + mio + '.' : '') + ' Click to set your own.';
  var h = '<button type="button" class="rk-pr' + (man != null ? ' is-manual' : '') + '"'
    + ' title="' + tmrEsc(t) + '" onclick="tmrEditPrice(\'' + id + '\')">'
    + (v == null ? '$-' : '$' + v) + '</button>';
  if (man != null) {
    h += '<button type="button" class="rk-prx" title="Back to the room price"'
      + ' aria-label="Back to the room price" onclick="tmrClearPrice(\'' + id + '\')">' + TMR_SVG_BACK + '</button>';
  }
  return h;
}

/* El boton de objetivo vive PEGADO al precio, no con los de mover y cortar.
 * Dos razones, y la segunda es de medida:
 *  - "lo quiero" y "a este precio" son la misma decision, y la barra Build
 *    suma exactamente esas dos cosas.
 *  - en un telefono de 320px no caben cuatro botones en la columna de
 *    acciones al lado de un nombre de 96px: medido, se quedaban en 19px de
 *    ancho cada uno. En la linea del precio, que en movil baja bajo el
 *    nombre, sobra sitio. */
function tmrTargetBtn(r) {
  var on = !!TMR.target[r.id];
  return '<button type="button" class="rk-ib rk-tg' + (on ? ' on' : '')
    + '" title="' + (on ? 'Drop him from your build' : 'Add him to your build')
    + '" aria-pressed="' + (on ? 'true' : 'false')
    + '" aria-label="Target ' + tmrEsc(r.name) + '" onclick="tmrToggleTarget(\'' + r.id + '\')">'
    + TMR_SVG_TARGET + '</button>';
}

/* ── pintado ────────────────────────────────────────────── */
// La fila es una REJILLA, no una linea de texto: rank, foto, jugador, su rank
// por posicion, el ADP de consenso y la distancia contra el. Antes era un flex
// con el nombre a la izquierda y tres botones a la derecha, y en escritorio eso
// dejaba tres cuartas partes de cada fila vacias. Las columnas de la cabecera y
// las de la fila salen de la MISMA plantilla en el CSS, por eso quedan a plomo.
function tmrPaint() {
  var host = document.getElementById('rk-body');
  if (!host) return;

  // El precio depende de MI puesto, asi que mover a alguien lo mueve: la
  // mezcla se rehace en cada pintado (es un recorrido de 200, no una fetch).
  tmrBlend();

  var q = _tmrNorm(TMR.q);
  var i, r;

  // Pasada previa. Tres cosas que no se pueden decidir mirando una fila sola:
  // el rank por posicion (cuenta desde el principio de MI lista), a que tier
  // pertenece cada jugador, y cuantos VISIBLES tiene ese tier. El conteo va
  // sobre lo visible a proposito: con un filtro puesto, decir "12 players"
  // encima de tres filas seria mentir.
  var visible = [], tierDe = [], posRk = [], cuenta = {}, porTier = {}, t = 1, shown = 0;
  for (i = 0; i < TMR.rows.length; i++) {
    r = TMR.rows[i];
    cuenta[r.pos] = (cuenta[r.pos] || 0) + 1;
    posRk[i] = cuenta[r.pos];
    tierDe[i] = t;
    var pasa = (TMR.filter === 'ALL' || r.pos === TMR.filter)
      && (!q || _tmrNorm(r.name).indexOf(q) >= 0 || _tmrNorm(r.team).indexOf(q) >= 0);
    visible[i] = pasa;
    if (pasa) { shown++; porTier[t] = (porTier[t] || 0) + 1; }
    if (TMR.breakAfter[r.id]) t++;
  }

  var html = '', ultimoTier = 0;
  for (i = 0; i < TMR.rows.length; i++) {
    if (!visible[i]) continue;
    r = TMR.rows[i];

    // El rotulo del tier se pinta ANTES de su primera fila visible, no despues
    // del corte: asi un filtro que vacia un tier entero no deja el rotulo
    // huerfano colgando de nada.
    if (tierDe[i] !== ultimoTier) {
      ultimoTier = tierDe[i];
      var n = porTier[ultimoTier] || 0;
      html += '<div class="rk-tier' + (html ? '' : ' rk-tier-first') + '">'
        + '<span class="rk-tier-n">Tier ' + ultimoTier + '</span>'
        + '<span class="rk-tier-c">' + n + (n === 1 ? ' player' : ' players') + '</span>'
        + '</div>';
    }

    var mine = i + 1;
    var delta = r.adpRank - mine; // + = lo tengo mas alto que el consenso
    var dTxt = delta > 0 ? '+' + delta : String(delta);
    var dCls = delta > 0 ? ' rk-up' : (delta < 0 ? ' rk-down' : ' rk-even');

    html += '<div class="rk-row" draggable="true" data-i="' + i + '" data-id="' + r.id + '"'
      + ' ondragstart="tmrDragStart(event,' + i + ')" ondragover="tmrDragOver(event,' + i + ')"'
      + ' ondrop="tmrDrop(event,' + i + ')" ondragend="tmrDragEnd(event)">'
      + '<span class="rk-num">' + mine + '</span>'
      + '<span class="rk-pic rk-ring-' + r.pos + '"><img src="https://sleepercdn.com/content/nfl/players/thumb/'
      + tmrEsc(r.id) + '.jpg" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></span>'
      + '<span class="rk-name">' + tmrEsc(r.name) + '</span>'
      + '<span class="rk-nums">'
      + '<span class="rk-team">' + (r.team ? tmrEsc(r.team) : 'FA') + '</span>'
      + '<span class="rk-posrank rk-' + r.pos + '"><span class="rk-pos">' + r.pos + '</span>'
      + '<span class="rk-posn">' + posRk[i] + '</span></span>'
      + '<span class="rk-adp">' + r.adp.toFixed(1) + '</span>'
      + '<span class="rk-vs' + dCls + '" title="How far you move him off the consensus">' + dTxt + '</span>'
      + (TMR.owner === true
        ? '<span class="rk-pay" data-id="' + tmrEsc(r.id) + '">' + tmrPriceCell(r.id, r.pos + posRk[i]) + '</span>' + tmrTargetBtn(r)
        : '')
      + '</span>'
      + '<span class="rk-acts">'
      + '<button type="button" class="rk-ib" title="Move up" aria-label="Move up ' + tmrEsc(r.name) + '" onclick="tmrMove(' + i + ',-1)">' + TMR_SVG_UP + '</button>'
      + '<button type="button" class="rk-ib" title="Move down" aria-label="Move down ' + tmrEsc(r.name) + '" onclick="tmrMove(' + i + ',1)">' + TMR_SVG_DOWN + '</button>'
      + '<button type="button" class="rk-ib rk-cut' + (TMR.breakAfter[r.id] ? ' on' : '') + '" title="Tier break after this player" aria-label="Tier break after ' + tmrEsc(r.name) + '" onclick="tmrCut(\'' + r.id + '\')">' + 'TIER' + '</button>'
      + '</span></div>';
  }

  if (!shown) {
    host.innerHTML = '<div class="rk-empty">No players match that filter.</div>';
  } else {
    // La cabecera repite la plantilla de columnas de la fila. Sin ella las
    // cifras de la derecha son numeros sueltos: nadie sabe que 3.4 es el ADP
    // de consenso y +6 la distancia contra el.
    // Cada rotulo declara SU area, no se coloca por orden. Colocandolos por
    // orden, el envoltorio .rk-nums aportaba un hijo mas que la fila y toda la
    // cabecera salia corrida una columna a la derecha: POS encima de los ADP.
    host.innerHTML = '<div class="rk-colhead">'
      + '<span class="rk-ch-num">Rank</span>'
      + '<span class="rk-ch-name">Player</span>'
      + '<span class="rk-ch-pr">Pos</span>'
      + '<span class="rk-ch-adp">ADP</span>'
      + '<span class="rk-ch-vs">Vs ADP</span>'
      + (TMR.owner === true ? '<span class="rk-ch-pay">Pay</span>' : '')
      + '</div>' + html;
  }

  var c = document.getElementById('rk-count');
  if (c) c.textContent = shown + ' of ' + TMR.rows.length;
  tmrBuildPaint();
}

/* ── la barra Build ─────────────────────────────────────────────────────────
 * Lo que el dueno pidio con sus palabras: "de ahi sacar una lista para ver
 * cual es la manera mas eficiente de construir mi equipo". O sea, no la suma
 * de los objetivos a secas: la suma CONTRA su presupuesto, y contando que cada
 * hueco de roster que quede sin objetivo igual cuesta el dolar del suelo de la
 * subasta. Sin ese dolar por hueco, un plan de tres cracks parece que cabe en
 * $200 y el domingo se queda con doce sillas vacias y cero dolares. */
function tmrBuildData() {
  var cfg = TMR.room || tmrRoomCfg();
  var byId = {};
  TMR.rows.forEach(function (r) { byId[r.id] = r; });
  var pos = {}, gasto = 0, n = 0, sinPrecio = 0;
  Object.keys(TMR.target).forEach(function (id) {
    if (!TMR.target[id]) return;
    var r = byId[id];
    if (!r) return;                       // ya no esta en la lista: no cuenta
    n++;
    pos[r.pos] = (pos[r.pos] || 0) + 1;
    var v = tmrPriceOf(id);
    if (v == null) { sinPrecio++; return; }
    gasto += v;
  });
  var huecos = Math.max(0, cfg.rounds - n);
  var total = gasto + huecos;
  /* Los huecos ya no son "15 a secas": son los de SU liga. Un plan que cubre
   * cuatro RB y ningun TE cabe perfectamente en $200 y el domingo se alinea
   * con un hueco en la alineacion, que es un fallo que la suma no ve. K y DEF
   * salen siempre sin cubrir a proposito: no estan en la lista (nadie hace
   * tiers de kickers) y en la sala real se compran a $1 al final. */
  var shape = tmrRosterShape(cfg);
  var falta = {}, faltaN = 0;
  ['QB', 'RB', 'WR', 'TE'].forEach(function (ps) {
    var g = (shape[ps] || 0) - (pos[ps] || 0);
    if (g > 0) { falta[ps] = g; faltaN += g; }
  });
  // El FLEX lo llena lo que sobre de RB, WR o TE por encima de sus titulares
  var sobra = 0;
  ['RB', 'WR', 'TE'].forEach(function (ps) { sobra += Math.max(0, (pos[ps] || 0) - (shape[ps] || 0)); });
  var flexFalta = Math.max(0, (shape.FLEX || 0) - sobra);
  if (flexFalta) { falta.FLEX = flexFalta; faltaN += flexFalta; }
  return {
    n: n, gasto: gasto, huecos: huecos, total: total,
    left: cfg.budget - total, over: total > cfg.budget,
    pos: pos, cfg: cfg, sinPrecio: sinPrecio,
    shape: shape, falta: falta, faltaN: faltaN
  };
}

function tmrBuildPaint() {
  var el = document.getElementById('rk-build');
  if (!el) return;
  if (TMR.owner !== true) { el.hidden = true; el.innerHTML = ''; return; }
  var d = tmrBuildData(), cfg = d.cfg;
  // La sala DECLARADA con todos sus numeros, no tres de ellos: el scoring y el
  // 1QB mueven el precio tanto como el tamano de la sala, y un precio sin su
  // formato no dice nada.
  var room = tmrLigaTxt(cfg);
  var h = '<div class="rk-bd-head"><span class="rk-bd-k">Build</span>'
    + '<span class="rk-bd-room">' + tmrEsc(room) + '</span></div>';

  if (!d.n) {
    h += '<div class="rk-bd-empty">Target the players you actually want. This adds up what they cost'
      + ' and what is left of your $' + cfg.budget + '.</div>';
  } else {
    var posTxt = ['QB', 'RB', 'WR', 'TE'].filter(function (p) { return d.pos[p]; })
      .map(function (p) { return p + ' ' + d.pos[p]; }).join(' · ');
    h += '<div class="rk-bd-figs">'
      + '<span class="rk-bd-fig"><b>$' + d.total + '</b><i>' + d.n + (d.n === 1 ? ' target at $' : ' targets at $') + d.gasto
      + ', ' + d.huecos + (d.huecos === 1 ? ' spot at $1' : ' spots at $1') + '</i></span>'
      + '<span class="rk-bd-fig rk-bd-left"><b>' + (d.left < 0 ? '-$' + Math.abs(d.left) : '$' + d.left) + '</b>'
      + '<i>' + (d.over ? 'past your $' + cfg.budget : 'left of $' + cfg.budget) + '</i></span>'
      + (posTxt ? '<span class="rk-bd-pos">' + posTxt + '</span>' : '')
      + '</div>';
    if (d.over) {
      h += '<div class="rk-bd-warn">This plan does not fill ' + cfg.rounds + ' spots with $' + cfg.budget
        + '. Drop a target or lower a price.</div>';
    }
    if (d.faltaN) {
      h += '<div class="rk-bd-warn is-soft">Starters still open: '
        + ['QB', 'RB', 'WR', 'TE', 'FLEX'].filter(function (ps) { return d.falta[ps]; })
          .map(function (ps) { return d.falta[ps] + ' ' + ps; }).join(' · ')
        + '. K and DEF go for $1 at the end.</div>';
    }
    if (d.sinPrecio) {
      h += '<div class="rk-bd-warn is-soft">' + d.sinPrecio
        + (d.sinPrecio === 1 ? ' target has no room price yet and is not in the total.'
          : ' targets have no room price yet and are not in the total.') + '</div>';
    }
  }
  if (TMR.seedMissing && TMR.seedMissing.length) {
    h += '<div class="rk-bd-warn is-soft">Could not find on the board: ' + tmrEsc(TMR.seedMissing.join(', ')) + '.</div>';
  }
  el.className = 'rk-build' + (d.over ? ' is-over' : '');
  el.hidden = false;
  el.innerHTML = h;
}

function tmrEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var TMR_SVG_UP = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3.5 3.5 8h3v4.5h3V8h3z" fill="currentColor"/></svg>';
var TMR_SVG_DOWN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 12.5 12.5 8h-3V3.5h-3V8h-3z" fill="currentColor"/></svg>';
// Objetivo: la diana. Nada de emojis en interfaz, regla del proyecto.
var TMR_SVG_TARGET = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
  + '<circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.5"/>'
  + '<circle cx="8" cy="8" r="1.9" fill="currentColor"/></svg>';
// Volver al precio del motor: flecha de deshacer
var TMR_SVG_BACK = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">'
  + '<path d="M4.4 6.6a4.4 4.4 0 1 1-.9 3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
  + '<path d="M2.2 3.4v3.6h3.6z" fill="currentColor"/></svg>';

/* ── edicion ────────────────────────────────────────────────────────────── */
function tmrMove(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= TMR.rows.length) return;
  var t = TMR.rows[i];
  TMR.rows[i] = TMR.rows[j];
  TMR.rows[j] = t;
  tmrSave();
  tmrPaint();
}

/* ── el precio a mano y los objetivos ───────────────────────────────────────
 * La edicion es en el sitio: la cifra ES el boton, tocarla la convierte en una
 * caja de numero. Enter y salir guardan, Escape cancela. No hay dialogo ni
 * pantalla aparte porque el gesto que esto tiene que aguantar es corregir
 * treinta precios seguidos sin levantar la mano del teclado. */
function tmrEditPrice(id) {
  var cell = document.querySelector('#rk-body .rk-pay[data-id="' + String(id).replace(/"/g, '') + '"]');
  if (!cell) return;
  var cur = tmrCeilOf(id);   // se edita desde el techo, que es lo que se ve
  var tope = (TMR.room ? TMR.room.budget : 200);
  TMR._edit = id;
  TMR._cancel = false;
  cell.innerHTML = '<input class="rk-pr-in" type="number" inputmode="numeric" min="0" max="' + tope + '"'
    + ' value="' + (cur == null ? '' : cur) + '" aria-label="What you would pay"'
    + ' onkeydown="tmrPriceKey(event)" onblur="tmrPriceBlur(this,\'' + id + '\')">';
  var inp = cell.querySelector('input');
  if (inp) { inp.focus(); try { inp.select(); } catch (_) { } }
}

function tmrPriceKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); TMR._cancel = false; e.target.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); TMR._cancel = true; e.target.blur(); }
}

function tmrPriceBlur(inp, id) {
  var cancelar = TMR._cancel;
  TMR._cancel = false;
  TMR._edit = null;
  if (cancelar) { tmrPaint(); return; }
  tmrSetPrice(id, inp ? inp.value : '');
}

// Vacio = quitar el precio a mano, no guardar un cero: un cero declarado es
// "no pago nada por el", y eso no es lo que hace quien borra la caja.
function tmrSetPrice(id, v) {
  var txt = String(v == null ? '' : v).trim();
  if (txt === '') {
    delete TMR.manual[id];
  } else {
    var n = Math.round(Number(txt));
    if (!isFinite(n) || n < 0) { tmrPaint(); return; }   // basura: no se guarda nada
    var tope = (TMR.room ? TMR.room.budget : 200);
    TMR.manual[id] = Math.max(0, Math.min(n, tope));
  }
  // Optimista: la cifra y la barra Build se repintan antes de guardar. El
  // guardado es localStorage y no puede fallar a medias, asi que no hay nada
  // que revertir.
  tmrPaint();
  tmrPlanSave();
}

function tmrClearPrice(id) {
  delete TMR.manual[id];
  tmrPaint();
  tmrPlanSave();
}

function tmrToggleTarget(id) {
  if (TMR.target[id]) delete TMR.target[id];
  else TMR.target[id] = true;
  tmrPaint();
  tmrPlanSave();
}

function tmrCut(id) {
  if (TMR.breakAfter[id]) delete TMR.breakAfter[id];
  else TMR.breakAfter[id] = true;
  tmrSave();
  tmrPaint();
}

function tmrDragStart(e, i) {
  TMR.drag = i;
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (_) { }
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('rk-dragging');
}
function tmrDragOver(e) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (_) { } }
function tmrDrop(e, to) {
  e.preventDefault();
  var from = TMR.drag;
  if (from == null || from === to) return;
  var moved = TMR.rows.splice(from, 1)[0];
  TMR.rows.splice(to, 0, moved);
  TMR.drag = null;
  tmrSave();
  tmrPaint();
}
function tmrDragEnd(e) {
  TMR.drag = null;
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('rk-dragging');
}

function tmrFilter(pos, el) {
  TMR.filter = pos;
  var bar = document.getElementById('rk-filters');
  if (bar) Array.prototype.forEach.call(bar.querySelectorAll('.rk-fb'), function (b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  tmrPaint();
}

function tmrSearch(v) { TMR.q = v || ''; tmrPaint(); }

function tmrReset() {
  if (!confirm('This puts the list back in consensus order and clears your tiers. It cannot be undone.')) return;
  try { localStorage.removeItem(TMR_KEY); } catch (_) { }
  TMR.breakAfter = {};
  TMR.loaded = false;
  // Un reset es un cambio local: el servidor NO puede devolver el orden viejo
  // al recargar la lista. Se marca sucio antes y se empuja despues.
  TMR._dirty = (TMR.owner === true);
  renderRankings().then(function () { if (TMR.owner === true) tmrSyncQueue(); });
}

/* Exportar en texto plano: es lo que la gente pega en su chat de liga o en una
 * hoja. Nada de descargas: el visor de artefactos y varios navegadores movil
 * bloquean la descarga que inicia la propia pagina. */
function tmrExport() {
  var out = [], tier = 1;
  out.push('Tier 1');
  TMR.rows.forEach(function (r, i) {
    out.push((i + 1) + '. ' + r.name + ' (' + r.pos + (r.team ? ' ' + r.team : '') + ')');
    if (TMR.breakAfter[r.id] && i < TMR.rows.length - 1) { tier++; out.push(''); out.push('Tier ' + tier); }
  });
  var txt = out.join('\n');
  var box = document.getElementById('rk-export-box');
  var ta = document.getElementById('rk-export-ta');
  if (box && ta) {
    ta.value = txt;
    box.style.display = 'block';
    ta.focus();
    ta.select();
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
  } catch (_) { }
}

function tmrCloseExport() {
  var box = document.getElementById('rk-export-box');
  if (box) box.style.display = 'none';
}

/* ── hidratacion silenciosa ─────────────────────────────────────────────
 * MEDIDO, no supuesto (2026-08-26): con la casilla "Use in mock drafts"
 * ENCENDIDA y la lista guardada, entrar y draftear sin abrir antes el tab
 * daba tmRankingsActivos()=false y tmMyRankOf()=null, o sea que la casilla
 * no hacia NADA por el camino real del usuario. TMR solo se cargaba dentro
 * de renderRankings(), que solo corre al pulsar la pestana.
 * El gate qa-rankings no lo veia porque abre el tab primero: otra vez la
 * puerta de servicio. Esto construye la lista sin pintar UI, para que el
 * board del mock y la herramienta de subasta en vivo la tengan siempre.
 */
async function tmrHydrate() {
  if (TMR.loaded) return true;
  try { if (localStorage.getItem(TMR_USE_KEY) !== '1') return false; } catch (_) { return false; }
  if (!tmrLoadSaved()) return false;   // sin lista propia no hay nada que hidratar
  var host = document.getElementById('rk-body');
  var tmp = null;
  if (!host) { // la pantalla de rankings puede no estar montada: anfitrion de usar y tirar
    tmp = document.createElement('div');
    tmp.id = 'rk-body';
    tmp.style.display = 'none';
    document.body.appendChild(tmp);
  }
  try { await renderRankings(); } catch (_) { }
  if (tmp && tmp.parentNode) tmp.parentNode.removeChild(tmp);
  return TMR.loaded && TMR.rows.length > 0;
}

/* ── Tier Game: los tiers se descifran, no se dibujan a mano ────────────────
 * Pedido del dueno con sus palabras: "para los tiers me lo pudieras hacer como
 * un juego y despues tu mismo descifras los tiers y desde ahi los edito, para
 * no tener que hacer todo yo".
 *
 * O sea: el no ordena doscientas filas, contesta comparaciones de dos en dos y
 * de ahi sale el orden Y los cortes. Cinco respuestas, no dos, porque "same
 * tier" es exactamente el dato que un si/no tira a la basura: un tier ES un
 * grupo de jugadores entre los que da igual cual te toque.
 *
 * El universo son los top 100 de SU lista, no del consenso: mas abajo, en una
 * subasta de 15 rondas, la decision ya no se toma comparando, se toma por $1.
 *
 * Por que Bradley-Terry con margen y no un simple recuento de victorias: un
 * recuento no sabe la DISTANCIA. "Gibbs clearly sobre Bijan" y "Gibbs slightly
 * sobre Bijan" contarian igual, y la distancia es justo lo que decide donde
 * cae el corte. Aqui cada respuesta pide una separacion concreta en puestos y
 * el sistema busca los puntajes que menos contradigan a todas a la vez. */
var TMR_GAME_KEY = 'tm_rk_game_v1';
var TMR_GAME_N = 100;      // el universo del juego: los top 100 de MI lista
/* Los margenes van en PUESTOS DE LISTA, que es la unidad del puntaje: el
 * puntaje arranca siendo el puesto invertido, asi que "8" se lee como "ocho
 * puestos de distancia" y no como un numero magico. */
var TMR_G_CLEAR = 8;       // "clearly": otro escalon
var TMR_G_SLIGHT = 2;      // "slightly": el mismo escalon, distinto peldano
var TMR_W_SAME = 3;        // el empate ATRAE, y atrae mas fuerte que lo que separa
var TMR_W_ANS = 1;
var TMR_ANCLA = 0.5;       // el puesto de partida: sin el, un jugador sin respuestas flotaria
var TMR_CUT = 5;           // salto entre vecinos que corta tier
var TMR_ITER = 80;         // Gauss-Seidel con ancla converge mucho antes; fijo para ser reproducible

function tmrGameOk(a) {
  return !!a && typeof a === 'object' && a.a && a.b && a.a !== a.b
    && [-2, -1, 0, 1, 2].indexOf(Number(a.v)) >= 0;
}

function tmrGameLoad() {
  try {
    var d = JSON.parse(localStorage.getItem(TMR_GAME_KEY) || 'null');
    if (d && Array.isArray(d.answers)) TMR.game = d.answers.filter(tmrGameOk);
  } catch (_) { }
}

function tmrGameSave() {
  try { localStorage.setItem(TMR_GAME_KEY, JSON.stringify({ answers: TMR.game, updated: Date.now() })); } catch (_) { }
  var st = document.getElementById('rk-saved');
  if (st) {
    st.textContent = 'Saved';
    st.style.opacity = '1';
    clearTimeout(TMR._stT);
    TMR._stT = setTimeout(function () { st.style.opacity = '0'; }, 1400);
  }
  tmrSyncQueue();
}

/* El apellido, que es como se nombra a un jugador en voz alta y lo unico que
 * cabe en un boton de telefono. "Amon-Ra St. Brown" -> "St. Brown". */
function tmrCorto(n) {
  var p = String(n || '').trim().split(/\s+/);
  return p.length > 1 ? p.slice(1).join(' ') : (p[0] || '');
}

/* Las respuestas traducidas a indices del universo. Una respuesta que apunta a
 * alguien que ya no esta en los top 100 no se borra (el dueno puede volver a
 * subirlo): simplemente no participa en esta inferencia. */
function _tmrAnsIdx(uni, answers) {
  var idx = {}, out = [];
  for (var i = 0; i < uni.length; i++) idx[uni[i].id] = i;
  (answers || []).forEach(function (a) {
    if (!tmrGameOk(a)) return;
    if (idx[a.a] == null || idx[a.b] == null) return;
    out.push({ i: idx[a.a], j: idx[a.b], v: Number(a.v) });
  });
  return { idx: idx, ans: out };
}

/* El grafo de lo que YA se sabe: quien le gana a quien, quien empata con quien
 * y que parejas se preguntaron. Sirve para dos cosas distintas: no repetir una
 * pareja, y no gastar una pregunta en algo que ya se deduce. */
function _tmrRelGraph(ans) {
  var G = { dir: {}, win: {}, eq: {} };
  ans.forEach(function (a) {
    G.dir[a.i + '>' + a.j] = 1; G.dir[a.j + '>' + a.i] = 1;
    if (a.v === 0) {
      (G.eq[a.i] = G.eq[a.i] || {})[a.j] = 1;
      (G.eq[a.j] = G.eq[a.j] || {})[a.i] = 1;
    } else if (a.v > 0) { (G.win[a.i] = G.win[a.i] || {})[a.j] = 1; }
    else { (G.win[a.j] = G.win[a.j] || {})[a.i] = 1; }
  });
  return G;
}

/* Transitividad de UN salto, a proposito. La transitividad completa cerraria
 * casi todo el grafo con veinte respuestas y el juego dejaria de preguntar
 * teniendo aun tiers sin decidir; un salto es lo que de verdad se deduce sin
 * arriesgar (A > B > C, o A = B y B ya se comparo con C). */
function _tmrKnown(G, i, j) {
  if (G.dir[i + '>' + j]) return true;
  var c, a = G.win[i] || {}, b = G.win[j] || {};
  for (c in a) if ((G.win[c] || {})[j]) return true;
  for (c in b) if ((G.win[c] || {})[i]) return true;
  var ei = G.eq[i] || {};
  for (c in ei) if (G.dir[c + '>' + j]) return true;
  var ej = G.eq[j] || {};
  for (c in ej) if (G.dir[c + '>' + i]) return true;
  return false;
}

/* ── los dos ejes, y por que son dos ────────────────────────────────────────
 * Regla del dueno, textual: "quiero que todo el proceso tome en cuenta que es
 * un auction draft y que no tengo que picar a un jugador por valor, puedo solo
 * pagar por los que me gustan aunque esten mas abajo". O sea: sus tiers son de
 * PREFERENCIA, no de valor de mercado. En una subasta no hay que alcanzar a
 * nadie: si lo quiere, paga el precio y ya. Aqui no se dice "reach" ni "por
 * encima del valor" en ningun sitio, y no es un detalle de copy, es el modelo.
 *
 * Por eso se resuelven DOS cosas distintas con las mismas respuestas:
 *
 *  - EL ORDEN (`rank`), en puestos de lista. Su prior es donde EL los tiene
 *    puestos. El mercado no entra: mover a alguien es decision suya.
 *  - EL CORTE (`money`), en dolares. Su prior es el Pay del motor, porque un
 *    tier de subasta es un escalon de precio: dos jugadores del mismo tier son
 *    intercambiables para el, y lo unico que los separa es lo que cuestan.
 *
 * El prior del dinero se rinde sin resistencia: su ancla pesa TMR_ANCLA_$ =
 * 0.15 contra el 1 de cada respuesta, asi que basta UN "same tier" para juntar
 * a dos jugadores que el mercado separaba por treinta dolares. Es literalmente
 * la regla: el mercado arranca la conversacion, el dueno la termina.
 *
 * Lo que esto compra: con CERO respuestas ya hay tiers utiles (salen del
 * escalon de precios), asi que una sesion de treinta preguntas vale, en vez de
 * dejar una lista plana sin un solo corte. */
var TMR_ANCLA_$ = 0.15;   // el prior de dinero cede ante una sola respuesta
var TMR_CUT_MIN = 0.015;  // fraccion del presupuesto: el escalon minimo que se lee como escalon
var TMR_CUT_K = 2.2;      // veces el salto tipico de la lista: asi se autoescala arriba y abajo

/* El Pay de cada jugador. Se puede inyectar (opts.pay) para poder probar la
 * funcion con casos armados; sin inyectar, sale de donde ya vive. */
function _tmrPayDe(uni, opts) {
  var pay = [], i, v;
  for (i = 0; i < uni.length; i++) {
    v = null;
    if (opts && opts.pay && opts.pay[uni[i].id] != null) v = Number(opts.pay[uni[i].id]);
    else if (typeof tmrPriceOf === 'function') v = tmrPriceOf(uni[i].id);
    pay[i] = (v != null && isFinite(v)) ? v : null;
  }
  // Sin precio (feed caido, o un caso de prueba sin dinero) el eje del dinero
  // no puede existir: se cae al puesto de lista, que es el prior de siempre.
  // Se DECLARA en la salida, nunca se disimula con un cero.
  var faltan = 0;
  for (i = 0; i < pay.length; i++) if (pay[i] == null) faltan++;
  return { pay: pay, faltan: faltan };
}

/* Gauss-Seidel sobre un sistema diagonalmente dominante: converge siempre.
 * `init` es el prior, `pull` las respuestas con su margen y su peso. */
function _tmrResolver(init, pull, ancla) {
  var score = init.slice(), i, k, m;
  for (k = 0; k < TMR_ITER; k++) {
    for (i = 0; i < init.length; i++) {
      var num = ancla * init[i], den = ancla, p = pull[i];
      for (m = 0; m < p.length; m++) { num += p[m].w * (score[p[m].o] + p[m].g); den += p[m].w; }
      score[i] = num / den;
    }
  }
  return score;
}

/* ── contradicciones ────────────────────────────────────────────────────────
 * A > B, B > C, C > A. No es un error del dueno: es lo que pasa cuando uno
 * compara de a dos durante media hora, y cualquier modelo que no lo mire se
 * come la contradiccion y saca un orden raro sin decir por que. Se buscan los
 * ciclos de tres, que son los que de verdad aparecen, y se ofrecen para volver
 * a preguntar. */
function tmrGameCycles(rows, answers, opts) {
  var uni = (rows || []).slice(0, (opts && opts.n) || TMR_GAME_N);
  var A = _tmrAnsIdx(uni, answers), ans = A.ans;
  var gana = {}, i;
  ans.forEach(function (a) {
    if (a.v === 0) return;
    var w = a.v > 0 ? a.i : a.j, l = a.v > 0 ? a.j : a.i;
    (gana[w] = gana[w] || {})[l] = 1;
  });
  var out = [], vistos = {};
  Object.keys(gana).forEach(function (x) {
    Object.keys(gana[x]).forEach(function (y) {
      Object.keys(gana[y] || {}).forEach(function (z) {
        if (!(gana[z] || {})[x]) return;
        var k = [x, y, z].map(Number).sort(function (p, q) { return p - q; }).join('|');
        if (vistos[k]) return;
        vistos[k] = 1;
        out.push({
          ids: [uni[x].id, uni[y].id, uni[z].id],
          nombres: [uni[x].name, uni[y].name, uni[z].name],
          // la pareja que se ofrece re-preguntar es la del eslabon que cierra
          // el circulo, que es el que menos evidencia tiene detras
          repreguntar: [uni[z].id, uni[x].id]
        });
      });
    });
  });
  return out.slice(0, 6);
}

/* ── la inferencia ──────────────────────────────────────────────────────────
 * Funcion PURA: entran la lista, las respuestas y (opcional) los precios; sale
 * el orden, los cortes, los dos puntajes y lo que sigue sin decidir. No toca el
 * DOM ni TMR, y por eso el gate la corre con casos armados a mano. */
function tmrTiersInfer(rows, answers, opts) {
  opts = opts || {};
  var n = Math.min((rows || []).length, opts.n || TMR_GAME_N);
  var uni = (rows || []).slice(0, n);
  var i, k, m;
  var A = _tmrAnsIdx(uni, answers), ans = A.ans;
  var bote = (opts.budget != null) ? opts.budget : ((TMR.room && TMR.room.budget) || 200);

  // EJE 1, el orden: prior = su puesto en la lista, margenes en puestos.
  var initR = [], pullR = [], pullD = [], rel = {};
  for (i = 0; i < uni.length; i++) { initR[i] = uni.length - i; pullR[i] = []; pullD[i] = []; }

  // EJE 2, el corte: prior = el Pay del motor, margenes en dolares.
  var P = _tmrPayDe(uni, opts);
  var conDinero = P.faltan < uni.length;
  var initD = [];
  for (i = 0; i < uni.length; i++) {
    // Sin precio, ese jugador se ancla donde le toque por puesto sobre la
    // misma escala, para no arrastrar al resto hacia cero.
    initD[i] = (P.pay[i] != null) ? P.pay[i] : (bote * 0.02 * (uni.length - i) / uni.length * 10);
  }
  var mR = function (v) {
    return v === 2 ? TMR_G_CLEAR : v === 1 ? TMR_G_SLIGHT
      : v === -1 ? -TMR_G_SLIGHT : v === -2 ? -TMR_G_CLEAR : 0;
  };
  var mD = function (v) {
    var claro = bote * 0.05, poco = bote * 0.01;   // $10 y $2 en una sala de $200
    return v === 2 ? claro : v === 1 ? poco : v === -1 ? -poco : v === -2 ? -claro : 0;
  };
  ans.forEach(function (a) {
    var w = (a.v === 0) ? TMR_W_SAME : TMR_W_ANS;
    var gr = mR(a.v), gd = mD(a.v);
    pullR[a.i].push({ o: a.j, g: gr, w: w }); pullR[a.j].push({ o: a.i, g: -gr, w: w });
    pullD[a.i].push({ o: a.j, g: gd, w: w }); pullD[a.j].push({ o: a.i, g: -gd, w: w });
    rel[a.i + '>' + a.j] = a.v; rel[a.j + '>' + a.i] = -a.v;
  });
  var score = _tmrResolver(initR, pullR, TMR_ANCLA);
  var dinero = _tmrResolver(initD, pullD, TMR_ANCLA_$);

  // Orden por puntaje. El desempate es el puesto de partida, nunca el azar:
  // dos jugadores declarados del mismo tier acaban con el mismo puntaje y sin
  // desempate estable la lista bailaria en cada pintado.
  var ord = [];
  for (i = 0; i < uni.length; i++) ord.push(i);
  ord.sort(function (x, y) { return (score[y] - score[x]) || (x - y); });

  /* EL CORTE. Un escalon de precio no es un numero fijo de dolares: arriba los
   * precios estan densos ($80, $75, $68) y abajo todo el mundo vale $2. Asi
   * que el umbral se mide contra el salto TIPICO de esta lista, con un suelo
   * en dolares para que un pelo de diferencia nunca cuente como escalon.
   * Un umbral fijo daba veinte tiers arriba y ninguno abajo, o al reves. */
  var saltos = [];
  for (i = 0; i + 1 < ord.length; i++) saltos.push(dinero[ord[i]] - dinero[ord[i + 1]]);
  var orden2 = saltos.slice().sort(function (a, b) { return a - b; });
  var mediana = orden2.length ? orden2[Math.floor(orden2.length / 2)] : 0;
  var umbral = Math.max(bote * TMR_CUT_MIN, TMR_CUT_K * Math.max(0, mediana));

  var breaks = {};
  for (i = 0; i + 1 < ord.length; i++) {
    var x = ord[i], y = ord[i + 1], d = rel[x + '>' + y];
    var corta;
    if (d === 0) corta = false;                              // lo nego con todas las letras
    else if (d != null && Math.abs(d) === 2) corta = true;   // dijo que hay escalon
    else corta = conDinero && (dinero[x] - dinero[y] >= umbral);
    if (corta) breaks[uni[x].id] = true;
  }

  /* Las dos reglas de vecinos no bastan, y esto salio probandolo, no leyendolo.
   * Un "clearly" entre dos jugadores que en el orden nuevo dejan de ser vecinos
   * (se colo un tercero en medio) no cortaba en ningun sitio: el dueno declaraba
   * un escalon y la hoja se lo tragaba. Asi que se cierra por los dos lados,
   * sobre la pareja entera y no sobre la casilla de al lado. */
  var lugar = {};
  ord.forEach(function (i2, p) { lugar[i2] = p; });
  var tramo = function (a) {
    var p1 = lugar[a.i], p2 = lugar[a.j];
    if (p1 == null || p2 == null) return null;
    return { lo: Math.min(p1, p2), hi: Math.max(p1, p2) };
  };
  // (1) Todo "clearly" queda separado por AL MENOS un corte. Si no hay ninguno
  //     en el tramo, se corta donde mas se separa el dinero, que es donde menos
  //     violencia le hace al resto de la lista.
  ans.forEach(function (a) {
    if (Math.abs(a.v) !== 2) return;
    var t = tramo(a);
    if (!t) return;
    for (var q = t.lo; q < t.hi; q++) if (breaks[uni[ord[q]].id]) return;
    var donde = t.lo, mayor = -Infinity;
    for (var q2 = t.lo; q2 < t.hi; q2++) {
      var s = dinero[ord[q2]] - dinero[ord[q2 + 1]];
      if (s > mayor) { mayor = s; donde = q2; }
    }
    breaks[uni[ord[donde]].id] = true;
  });
  // (2) Un "same tier" declarado manda sobre todo lo anterior, incluido el
  //     corte que acaba de poner la regla (1) y el que puso el prior del
  //     mercado: es la unica respuesta en la que el dueno niega el escalon con
  //     todas las letras, y su palabra vale mas que el precio. Por eso va la
  //     ultima. Si el se contradice, gana lo que nego.
  ans.forEach(function (a) {
    if (a.v !== 0) return;
    var t = tramo(a);
    if (!t) return;
    for (var q = t.lo; q < t.hi; q++) delete breaks[uni[ord[q]].id];
  });
  var cortes = [];
  ord.forEach(function (i2) { if (breaks[uni[i2].id]) cortes.push(uni[i2].id); });

  // Las parejas mas ambiguas: vecinas en el orden nuevo, sin respuesta directa
  // y con el dinero justo en el umbral, que es donde una respuesta decide si
  // hay corte o no. Son las que mas mueven el resultado.
  var amb = [];
  for (i = 0; i + 1 < ord.length; i++) {
    var u = ord[i], w2 = ord[i + 1];
    if (rel[u + '>' + w2] != null) continue;
    amb.push({ a: uni[u].id, b: uni[w2].id, gap: Math.round((dinero[u] - dinero[w2]) * 100) / 100 });
  }
  amb.sort(function (p, q) { return Math.abs(p.gap - umbral) - Math.abs(q.gap - umbral); });

  var byId = {}, dinById = {}, orden = [];
  ord.forEach(function (i2) { byId[uni[i2].id] = Math.round(score[i2] * 1000) / 1000; dinById[uni[i2].id] = Math.round(dinero[i2] * 100) / 100; orden.push(uni[i2].id); });
  var movidos = 0;
  orden.forEach(function (id, pos) { if (uni[pos] && uni[pos].id !== id) movidos++; });
  return {
    order: orden, breaks: breaks, cuts: cortes, score: byId, money: dinById,
    umbral: Math.round(umbral * 100) / 100, sinPrecio: P.faltan,
    ambiguous: amb.slice(0, 12), moved: movidos, answers: ans.length, n: uni.length,
    cycles: tmrGameCycles(rows, answers, opts)
  };
}

/* ── el progreso, calculado de verdad ───────────────────────────────────────
 * "Resuelto" no es "cuantas conteste": es que fraccion de las FRONTERAS DE
 * TIER esta decidida. Y una frontera de tier es una pareja de vecinos DENTRO
 * de su posicion: el corte entre el RB4 y el RB5 es lo que hace que uno se
 * queme la plata en el RB4. Una barra que contara respuestas subiria igual
 * preguntando cosas que ya se deducen, o sea que mentiria. */
function tmrGameProgress(rows, answers) {
  var uni = (rows || []).slice(0, TMR_GAME_N);
  var A = _tmrAnsIdx(uni, answers), G = _tmrRelGraph(A.ans);
  var grupos = {};
  uni.forEach(function (r, i) { (grupos[r.pos] = grupos[r.pos] || []).push(i); });
  var total = 0, hechas = 0;
  Object.keys(grupos).forEach(function (p) {
    var g = grupos[p];
    for (var k = 0; k + 1 < g.length; k++) { total++; if (_tmrKnown(G, g[k], g[k + 1])) hechas++; }
  });
  return { answered: A.ans.length, resolved: hechas, total: total, pct: total ? Math.round(hechas / total * 100) : 0 };
}

/* Transitividad CON CONFIANZA: A > B clearly y B > C clearly implica A > C, y
 * preguntarlo seria gastarle un turno al dueno. Se exige que los dos eslabones
 * sean "clearly": una cadena de dos "slightly" no aguanta el peso (dos medios
 * escalones pueden ser el mismo escalon), asi que esa solo penaliza. */
function _tmrKnownFuerte(ans, i, j) {
  var claro = {};
  ans.forEach(function (a) {
    if (Math.abs(a.v) !== 2) return;
    var w = a.v > 0 ? a.i : a.j, l = a.v > 0 ? a.j : a.i;
    (claro[w] = claro[w] || {})[l] = 1;
  });
  var c, a1 = claro[i] || {}, b1 = claro[j] || {};
  for (c in a1) if ((claro[c] || {})[j]) return true;
  for (c in b1) if ((claro[c] || {})[i]) return true;
  return false;
}

/* ── la escalada ────────────────────────────────────────────────────────────
 * Regla del dueno, textual: "si ve que un jugador me gusta mucho quiero que
 * hasta lo pruebe con jugadores de mas arriba".
 *
 * Cuando alguien gana un "clearly" contra uno que estaba POR ENCIMA suyo (o
 * encadena dos victorias), la siguiente pregunta lo enfrenta con alguien del
 * tier de arriba de su posicion, y si sigue ganando, con el de mas arriba,
 * hasta que pierda o empate. Al reves tambien: si al escalador ya no le quedan
 * rivales arriba, se prueba al que perdio contra alguien de mas abajo.
 *
 * Por que importa: sin esto, un favorito suyo sube de uno en uno entre vecinos
 * y hacen falta quince preguntas para moverlo tres tiers. Con esto sube en
 * tres o cuatro. Es la diferencia entre un juego que se abandona y uno que
 * cabe en la cola del banco. */
function _tmrEscalada(uni, ans, res, opts) {
  if (!ans.length) return null;
  var lugar = {}, tierDe = {}, t = 1, i;
  res.order.forEach(function (id, p) { lugar[id] = p; });
  res.order.forEach(function (id) { tierDe[id] = t; if (res.breaks[id]) t++; });
  var idx = {};
  for (i = 0; i < uni.length; i++) idx[uni[i].id] = i;
  var preg = {};
  ans.forEach(function (a) { preg[Math.min(a.i, a.j) + '|' + Math.max(a.i, a.j)] = 1; });
  var yaFue = function (x, y) { return !!preg[Math.min(x, y) + '|' + Math.max(x, y)]; };

  var ult = ans[ans.length - 1];
  if (ult.v === 0) return null;                    // empato: la escalada termina
  var gan = ult.v > 0 ? ult.i : ult.j, per = ult.v > 0 ? ult.j : ult.i;
  /* "Venia de mas abajo" se mide en la lista que el dueno tenia ANTES de
   * contestar, no en el orden ya inferido. Medido: un solo "clearly" mueve al
   * ganador ocho puestos, asi que en el orden nuevo YA esta por encima y este
   * `subio` daba false justo en el caso que la escalada existe para atender.
   * Los indices del universo son ese orden de antes. */
  var subio = gan > per;
  if (!subio) {
    // gano el de arriba, que es lo esperado: solo se escala si viene
    // encadenando victorias, que tambien es senal de que le gusta.
    var prev = ans[ans.length - 2];
    if (!prev) return null;
    var g2 = prev.v > 0 ? prev.i : prev.j;
    if (prev.v === 0 || g2 !== gan) return null;
  } else if (Math.abs(ult.v) !== 2) {
    // gano de abajo pero por poco: hace falta la segunda para escalar
    var prev2 = ans[ans.length - 2];
    if (!prev2 || prev2.v === 0) return null;
    var g3 = prev2.v > 0 ? prev2.i : prev2.j;
    if (g3 !== gan) return null;
  }

  // ARRIBA: el mas cercano de SU posicion que este por encima y en un tier
  // estrictamente mas alto que el suyo.
  var pos = uni[gan].pos, miT = tierDe[uni[gan].id], miL = lugar[uni[gan].id];
  var cand = null;
  for (i = 0; i < uni.length; i++) {
    if (i === gan || uni[i].pos !== pos) continue;
    var L = lugar[uni[i].id];
    if (L >= miL || tierDe[uni[i].id] >= miT) continue;
    if (yaFue(gan, i)) continue;
    if (cand == null || lugar[uni[i].id] > lugar[uni[cand].id]) cand = i;  // el mas cercano por arriba
  }
  if (cand != null) return { a: uni[cand].id, b: uni[gan].id, cross: false, why: 'up' };

  // ABAJO: al escalador no le queda nadie arriba, asi que se prueba al que
  // perdio contra alguien de mas abajo todavia.
  var posP = uni[per].pos, suT = tierDe[uni[per].id], suL = lugar[uni[per].id], abajo = null;
  for (i = 0; i < uni.length; i++) {
    if (i === per || uni[i].pos !== posP) continue;
    var L2 = lugar[uni[i].id];
    if (L2 <= suL || tierDe[uni[i].id] <= suT) continue;
    if (yaFue(per, i)) continue;
    if (abajo == null || lugar[uni[i].id] < lugar[uni[abajo].id]) abajo = i;
  }
  if (abajo != null) return { a: uni[per].id, b: uni[abajo].id, cross: false, why: 'down' };
  return null;
}

/* ── que pareja toca: la que mas informacion da ─────────────────────────────
 * No es "la siguiente de la lista". Se elige la pareja cuya respuesta mas
 * reduce la incertidumbre sobre DONDE CAE UN CORTE, que es lo unico que este
 * juego esta decidiendo:
 *
 *  - Ganancia: cuanto mas cerca esta el salto de dinero de los dos del UMBRAL
 *    de corte, menos se sabe si van juntos o separados, y mas decide su
 *    respuesta. Una pareja separada por $40 no hay que preguntarla: ya se sabe.
 *  - Dinero en juego: una frontera entre dos jugadores de $60 vale mas que una
 *    entre dos de $2. Por eso se arranca por los vecinos del top y se va
 *    bajando, sin necesidad de una regla aparte que diga "primero el top 30".
 *  - Evidencia: lo que ya se deduce con confianza (dos "clearly" encadenados)
 *    no se pregunta; lo que se deduce flojo, penaliza.
 *
 * Y por encima de todo manda la escalada, que es una pregunta que el dueno
 * pidio por su nombre. */
function tmrGameNext(rows, answers, opts) {
  var uni = (rows || []).slice(0, TMR_GAME_N);
  if (uni.length < 2) return null;
  var A = _tmrAnsIdx(uni, answers), ans = A.ans, G = _tmrRelGraph(ans);
  var res = tmrTiersInfer(rows, answers, opts);
  var esc = _tmrEscalada(uni, ans, res, opts);
  if (esc) return esc;

  var i, j, k, d;
  var lugar = {}, din = {};
  res.order.forEach(function (id, p) { lugar[id] = p; });
  uni.forEach(function (r) { din[r.id] = res.money[r.id] != null ? res.money[r.id] : 0; });
  var maxD = 1;
  uni.forEach(function (r) { if (din[r.id] > maxD) maxD = din[r.id]; });
  var umbral = res.umbral || 1;

  // Los vecinos se toman sobre el ORDEN INFERIDO, no sobre el de partida: si
  // el dueno ya subio a alguien tres tiers, sus vecinos de ahora son otros.
  var grupos = {};
  uni.slice().sort(function (a, b) { return lugar[a.id] - lugar[b.id]; })
    .forEach(function (r) { (grupos[r.pos] = grupos[r.pos] || []).push(r); });

  var cands = [];
  Object.keys(grupos).forEach(function (p) {
    var g = grupos[p];
    for (k = 0; k < g.length; k++) {
      for (d = 1; d <= 4 && k + d < g.length; d++) {
        cands.push({ ra: g[k], rb: g[k + d], d: d, cross: 0 });
      }
    }
  });
  var top = uni.slice().sort(function (a, b) { return lugar[a.id] - lugar[b.id]; }).slice(0, 30);
  for (i = 0; i < top.length; i++) {
    for (j = i + 1; j < top.length && j <= i + 6; j++) {
      if (top[i].pos === top[j].pos) continue;
      cands.push({ ra: top[i], rb: top[j], d: j - i, cross: 1 });
    }
  }

  var idx = A.idx, mejor = null, mejorG = -1;
  var tocaCruce = (ans.length % 7) === 6;   // una de cada siete cruza posiciones
  for (k = 0; k < cands.length; k++) {
    var c = cands[k], ia = idx[c.ra.id], ib = idx[c.rb.id];
    if (ia == null || ib == null) continue;
    if (G.dir[ia + '>' + ib]) continue;                 // ya se pregunto
    if (_tmrKnownFuerte(ans, ia, ib)) continue;         // ya se deduce con confianza
    var gap = Math.abs(din[c.ra.id] - din[c.rb.id]);
    // 1 justo en el umbral, cayendo a medida que la pareja es obvia
    var g1 = 1 / (1 + Math.abs(gap - umbral) / Math.max(1, umbral));
    var g2 = 0.3 + Math.max(din[c.ra.id], din[c.rb.id]) / maxD;   // dinero en juego
    var g3 = _tmrKnown(G, ia, ib) ? 0.35 : 1;                     // evidencia floja
    var g4 = 1 / (1 + (c.d - 1) * 0.35);                          // los vecinos deciden el corte
    var g5 = c.cross ? (tocaCruce ? 1.4 : 0.12) : 1;              // el cruce, cuando toca
    var gan = g1 * g2 * g3 * g4 * g5;
    // Desempate estable por puesto: sin el, dos parejas identicas se turnarian
    // segun el orden de recorrido y el juego dejaria de ser reproducible.
    if (gan > mejorG + 1e-9
      || (Math.abs(gan - mejorG) <= 1e-9 && mejor && lugar[c.ra.id] < lugar[mejor.ra.id])) {
      mejorG = gan; mejor = c;
    }
  }
  if (!mejor) return null;
  // El de arriba va primero: la pregunta se lee "A o B" en el orden en que el
  // los tiene, no al azar.
  var pa = mejor.ra, pb = mejor.rb;
  if (lugar[pb.id] < lugar[pa.id]) { var tmp = pa; pa = pb; pb = tmp; }
  return { a: pa.id, b: pb.id, cross: !!mejor.cross, gain: Math.round(mejorG * 1000) / 1000 };
}

/* ── la pantalla del juego ──────────────────────────────────────────────────
 * Vive DENTRO del tab, no en una ruta aparte: es la misma lista vista de otra
 * manera, y salir tiene que devolverte exactamente donde estabas. El tab lleva
 * .rk-gaming y el CSS esconde herramientas, barra Build y las doscientas filas.
 * Un solo arbol de DOM. */
function tmrGameOpen() {
  if (TMR.owner !== true) return;
  TMR.gameOn = true;
  if (!TMR.gamePair) TMR.gamePair = tmrGameNext(TMR.rows, TMR.game);
  var tab = document.getElementById('tab-rankings');
  if (tab) tab.classList.add('rk-gaming');
  tmrGamePaint();
  try { window.scrollTo(0, 0); } catch (_) { }
}

function tmrGameClose() {
  TMR.gameOn = false;
  var tab = document.getElementById('tab-rankings');
  if (tab) tab.classList.remove('rk-gaming');
  tmrGamePaint();
  tmrPaint();
}

/* NI UN PRECIO en la tarjeta. Correccion del dueno, textual: "yo no se cuanto
 * deberian valer. yo quiero que tu me digas basado en los rankings que yo
 * haga". Ensenarle el Pay mientras elige es pedirle justo lo que dijo que no
 * sabe, y ademas contamina la respuesta: si ve $67 al lado de un nombre, deja
 * de contestar a quien prefiere y empieza a contestar quien vale mas. Foto,
 * nombre, posicion y equipo, y nada mas. */
function tmrGameCard(r) {
  return '<div class="rk-gm-card">'
    + '<span class="rk-pic rk-ring-' + r.pos + '"><img src="https://sleepercdn.com/content/nfl/players/thumb/'
    + tmrEsc(r.id) + '.jpg" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></span>'
    + '<b class="rk-gm-nm">' + tmrEsc(r.name) + '</b>'
    + '<span class="rk-gm-meta"><em class="rk-' + r.pos + '">' + r.pos + '</em> ' + tmrEsc(r.team || 'FA') + '</span>'
    + '</div>';
}

function tmrGamePaint() {
  var host = document.getElementById('rk-game');
  if (!host) return;
  if (!TMR.gameOn) { host.hidden = true; host.innerHTML = ''; return; }

  var byId = {};
  TMR.rows.forEach(function (r) { byId[r.id] = r; });
  var pr = TMR.gamePair;
  if (!pr || !byId[pr.a] || !byId[pr.b]) { pr = tmrGameNext(TMR.rows, TMR.game); TMR.gamePair = pr; }
  var pg = tmrGameProgress(TMR.rows, TMR.game);
  var uniN = Math.min(TMR_GAME_N, TMR.rows.length);

  var h = '<div class="rk-gm-top">'
    + '<div class="rk-gm-t"><b>Tier Game</b>'
    + '<span>Top ' + uniN + ' of your list. Just say who you prefer.'
    + ' Mac turns your order into what to pay.</span></div>'
    + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrGameClose()">Back to list</button>'
    + '</div>'
    + '<div class="rk-gm-prog"><div class="rk-gm-bar"><i style="width:' + pg.pct + '%"></i></div>'
    // Fronteras, no respuestas: el total sale del universo (los vecinos dentro
    // de cada posicion) y por eso la barra puede saltar varios puntos con una
    // sola respuesta, o quedarse quieta si lo que contesto ya se deducia.
    + '<span id="rk-gm-pg">' + pg.answered + (pg.answered === 1 ? ' answer' : ' answers')
    + ' · ' + pg.resolved + ' of ' + pg.total + ' tier boundaries resolved</span></div>';

  if (!pr) {
    h += '<div class="rk-gm-done">Nothing left to ask in the top ' + uniN
      + '. Build the tiers whenever you want.</div>';
  } else {
    var a = byId[pr.a], b = byId[pr.b];
    var op = function (v, txt) {
      return '<button type="button" class="rk-gm-b rk-gm-v' + String(v).replace('-', 'm')
        + '" onclick="tmrGameAnswer(' + v + ')">' + tmrEsc(txt) + '</button>';
    };
    h += (pr.why === 'up'
      ? '<div class="rk-gm-why">He just beat someone above him. Let us see how high he goes.</div>'
      : pr.why === 'down'
        ? '<div class="rk-gm-why">He just lost to someone below him. Let us see how far down he belongs.</div>'
        : '')
      + '<div class="rk-gm-pair">' + tmrGameCard(a) + '<span class="rk-gm-vs">vs</span>' + tmrGameCard(b) + '</div>'
      + '<p class="rk-gm-q">Who do you prefer?</p>'
      + '<div class="rk-gm-btns">'
      + op(2, tmrCorto(a.name) + ' clearly')
      + op(1, tmrCorto(a.name) + ' slightly')
      + op(0, 'Same tier')
      + op(-1, tmrCorto(b.name) + ' slightly')
      + op(-2, tmrCorto(b.name) + ' clearly')
      + '</div>';
  }

  /* Contradicciones. No son un error del dueno: comparando de a dos durante
   * media hora salen solas, y un modelo que se las traga saca un orden raro
   * sin decir por que. Se ensenan y se ofrece volver a preguntar ESA pareja,
   * que es el eslabon con menos evidencia detras. */
  var ciclos = tmrGameCycles(TMR.rows, TMR.game);
  if (ciclos.length) {
    h += '<div class="rk-gm-cyc"><b>' + ciclos.length
      + (ciclos.length === 1 ? ' answer loops back on itself' : ' answers loop back on themselves') + '</b>';
    ciclos.slice(0, 3).forEach(function (c) {
      h += '<div class="rk-gm-cyc-r"><span>' + tmrEsc(c.nombres.map(tmrCorto).join(' &gt; ')) + ' &gt; '
        + tmrEsc(tmrCorto(c.nombres[0])) + '</span>'
        + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrGameAskAgain(\'' + c.repreguntar[0]
        + '\',\'' + c.repreguntar[1] + '\')">Ask again</button></div>';
    });
    h += '</div>';
  }

  h += '<div class="rk-gm-foot">'
    + '<button type="button" class="rk-btn rk-btn-quiet" id="rk-gm-undo"' + (TMR.game.length ? '' : ' disabled')
    + ' onclick="tmrGameUndo()">Undo last</button>'
    + '<button type="button" class="rk-btn" onclick="tmrTiersPreview()">Build tiers from my answers</button>'
    + '</div><div id="rk-gm-prev" class="rk-gm-prev" hidden></div>';

  host.hidden = false;
  host.innerHTML = h;
}

/* Optimista: la respuesta se apunta y la pareja siguiente se pinta en el acto.
 * Guardar es localStorage y el PUT va con su debounce por detras. */
function tmrGameAnswer(v) {
  var pr = TMR.gamePair;
  if (!pr) return;
  // Volver a contestar una pareja la REEMPLAZA, no la duplica: si no, deshacer
  // una contradiccion dejaria las dos respuestas peleandose dentro del solver y
  // el ciclo seguiria ahi despues de que el dueno lo arreglo.
  for (var i = TMR.game.length - 1; i >= 0; i--) {
    var g = TMR.game[i];
    if ((g.a === pr.a && g.b === pr.b) || (g.a === pr.b && g.b === pr.a)) TMR.game.splice(i, 1);
  }
  TMR.game.push({ a: pr.a, b: pr.b, v: Number(v), t: Date.now() });
  TMR.gamePair = tmrGameNext(TMR.rows, TMR.game);
  tmrGameSave();
  tmrGamePaint();
}

/* Volver a preguntar una pareja concreta: la pone delante sin borrar nada. La
 * respuesta nueva sustituye a la vieja (lo hace tmrGameAnswer), asi que el
 * ciclo se deshace en el acto. */
function tmrGameAskAgain(a, b) {
  if (!a || !b) return;
  TMR.gamePair = { a: a, b: b, cross: false };
  tmrGamePaint();
  try { window.scrollTo(0, 0); } catch (_) { }
}

/* Deshacer devuelve la pareja que se acaba de contestar, no "la siguiente que
 * toque": el gesto es "me equivoque en ESA", y volver a otra pregunta obligaria
 * a buscarla. */
function tmrGameUndo() {
  if (!TMR.game.length) return;
  var ult = TMR.game.pop();
  TMR.gamePair = { a: ult.a, b: ult.b, cross: false };
  tmrGameSave();
  tmrGamePaint();
}

/* ── de las respuestas a la lista ───────────────────────────────────────────
 * Antes de aplicar se DICE que cambia. Reordenar cien filas y mover los cortes
 * es el cambio mas grande que esta pantalla puede hacer de un golpe, y hacerlo
 * sin avisar convierte un boton en una trampa. */
function tmrTiersPreview() {
  var box = document.getElementById('rk-gm-prev');
  if (!box) return;
  var res = tmrTiersInfer(TMR.rows, TMR.game);
  var antes = Object.keys(TMR.breakAfter).filter(function (k) { return TMR.breakAfter[k]; }).length;
  var n = res.cuts.length;
  if (!res.answers) {
    box.hidden = false;
    box.innerHTML = '<div class="rk-gm-prev-t">Answer at least one pair first. With no answers there is nothing to infer.</div>';
    return;
  }
  var amb = res.ambiguous.slice(0, 3).map(function (p) {
    var A = TMR.rows.filter(function (r) { return r.id === p.a; })[0];
    var B = TMR.rows.filter(function (r) { return r.id === p.b; })[0];
    return (A ? tmrCorto(A.name) : '?') + ' vs ' + (B ? tmrCorto(B.name) : '?');
  });
  box.hidden = false;
  box.innerHTML = '<div class="rk-gm-prev-t">This moves <b>' + res.moved + '</b> of the top ' + res.n
    + ' and leaves <b>' + n + '</b> tier ' + (n === 1 ? 'break' : 'breaks') + ' (you have ' + antes + ' now).'
    + ' Your order below the top ' + res.n + ' does not change.</div>'
    + (amb.length ? '<div class="rk-gm-prev-a">Still closest to call: ' + tmrEsc(amb.join(' · ')) + '</div>' : '')
    + '<div class="rk-gm-prev-b">'
    + '<button type="button" class="rk-btn" onclick="tmrTiersApply()">Apply tiers</button>'
    + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrTiersCancel()">Not yet</button>'
    + '</div>';
}

function tmrTiersCancel() {
  var box = document.getElementById('rk-gm-prev');
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

function tmrTiersApply() {
  var res = tmrTiersInfer(TMR.rows, TMR.game);
  if (!res.order.length) return;
  var byId = {}, out = [], seen = {};
  TMR.rows.forEach(function (r) { byId[r.id] = r; });
  res.order.forEach(function (id) { if (byId[id] && !seen[id]) { out.push(byId[id]); seen[id] = 1; } });
  TMR.rows.forEach(function (r) { if (!seen[r.id]) out.push(r); });
  TMR.rows = out;
  // Los cortes del juego mandan DENTRO del universo; por debajo se conservan
  // los que el dueno ya tenia, porque el juego no llego a preguntar por ellos
  // y borrarselos seria pasarse del encargo.
  var nuevos = {};
  Object.keys(TMR.breakAfter).forEach(function (k) {
    if (TMR.breakAfter[k] && res.score[k] == null) nuevos[k] = true;
  });
  Object.keys(res.breaks).forEach(function (k) { nuevos[k] = true; });
  TMR.breakAfter = nuevos;
  tmrSave();          // invalida el indice del mock y encola el PUT
  tmrGameClose();     // vuelve a la lista, que es donde el dueno los edita a mano
}

/* ── la cheat sheet ─────────────────────────────────────────────────────────
 * "basado en eso quiero que me hagas mi cheat sheet para el auction". Se lee en
 * el celular con una mano mientras la sala puja, o se imprime. Nada que haya
 * que tocar: es papel.
 *
 * La linea que la justifica es "Cheapest in": si dos jugadores estan en TU
 * mismo tier, te da igual cual te toque, asi que pagar por el caro es tirar la
 * diferencia. Es la regla que el dueno escribio con sus palabras: Swift en el
 * tier de Hall significa quemarse la plata en Gibbs y agarrar a Swift. */
/* Como se llama el scoring de esta sala. Media PPR NO es PPR: la mitad de la
 * calibracion del motor vive en esa diferencia, y la hoja tiene que decir
 * contra que esta calculada. */
function tmrScoringTxt(cfg) {
  return cfg.scoring >= 1 ? 'full PPR' : cfg.scoring === 0.5 ? 'half PPR' : cfg.scoring === 0 ? 'standard' : cfg.scoring + ' PPR';
}
function tmrLigaTxt(cfg) {
  return (cfg.fz26 ? 'Fantazy 2026: ' : '') + cfg.teams + ' teams, $' + cfg.budget + ', '
    + tmrScoringTxt(cfg) + ', ' + (cfg.sf ? 'superflex' : '1QB') + ', ' + cfg.rounds + ' rounds';
}

var TMR_SH_MIN = 5;     // por debajo de $5 el ahorro no cambia ninguna decision
var TMR_SH_PLAN = 20;   // a partir de $20 el ahorro compra otro jugador entero

/* Notas de una subasta REAL, medidas sobre
 * scripts/fixtures/auction-nfl-divas-2026-08-27.json (10 equipos, $200, 13
 * rondas, 130 lotes). No son opinion ni pronostico: son cuentas de ese
 * archivo, y por eso van con su fecha y su sala. */
var TMR_SH_NOTES = [
  'The #1 pick went for $86, 43% of one budget.',
  '38 of the 130 lots went for $1.',
  'RB2s sold at RB1 prices: C. Brown $56, Walker $55, Hampton $53.',
  'QBs ran hot: Allen $38, Burrow $30, Jackson $25.'
];
var TMR_SH_NOTES_SRC = 'Measured on a real 10-team $200 auction, Aug 27 2026.';

function tmrSheetData() {
  var plan = tmrBuildData();
  var uniN = Math.min(TMR_GAME_N, TMR.rows.length);
  var t = 1, filas = [], byId = {};
  for (var i = 0; i < TMR.rows.length; i++) {
    var r = TMR.rows[i];
    byId[r.id] = r;
    // El universo del papel: el top 100 mas cualquier objetivo que viva por
    // debajo. Un objetivo fuera de la hoja seria justo el que se olvida.
    if (i < uniN || TMR.target[r.id]) {
      filas.push({
        r: r, i: i, tier: t, pay: tmrPriceOf(r.id), target: !!TMR.target[r.id],
        // lo que la SALA cobra por el, que es otra cosa que lo que EL pagaria
        mercado: (TMR.sticker && TMR.sticker[r.id] != null) ? TMR.sticker[r.id] : null
      });
    }
    if (TMR.breakAfter[r.id]) t++;
  }
  // El objetivo mas caro: es donde va el ahorro de un tier. "Sin comprar" antes
  // del draft son todos, asi que manda el precio.
  var top = null;
  filas.forEach(function (x) {
    if (!x.target || x.pay == null) return;
    if (!top || x.pay > top.pay) top = x;
  });

  var porPos = {};
  filas.forEach(function (x) {
    var g = porPos[x.r.pos] = porPos[x.r.pos] || {};
    (g[x.tier] = g[x.tier] || []).push(x);
  });

  var secciones = [];
  ['RB', 'WR', 'TE', 'QB'].forEach(function (pos) {
    var g = porPos[pos];
    if (!g) return;
    var nT = Object.keys(g).length;
    var tiers = Object.keys(g).map(Number).sort(function (a, b) { return a - b; }).map(function (tn) {
      var men = g[tn], conPrecio = men.filter(function (x) { return x.pay != null; });
      var linea = null;
      /* Si el dueno nunca corto esta posicion, su unico "tier" son todos los
       * jugadores de la lista, y ahi la linea diria "el RB mas barato te ahorra
       * $85 contra Gibbs": es cierto y no significa nada. Lo destapo el gate
       * pintando la hoja sin cortes. Se calla y se le dice por que. */
      if (nT >= 2 && conPrecio.length >= 2) {
        var barato = conPrecio[0], caro = conPrecio[0];
        conPrecio.forEach(function (x) {
          if (x.pay < barato.pay) barato = x;
          if (x.pay > caro.pay) caro = x;
        });
        var ahorro = caro.pay - barato.pay;
        if (ahorro >= TMR_SH_MIN) {
          /* La frase del dueno, en dolares de SALA: "Swift te da el tier de
           * Hall por $12 en vez de $54 por Cook". Dentro de SU tier los dos le
           * dan igual, asi que la diferencia de precio es dinero tirado. */
          linea = { cheap: barato, exp: caro, saves: ahorro, spend: null, market: false };
          /* La ganga: alguien alto en su lista que la SALA vende barato. No es
           * un reach ni un sobreprecio; es su objetivo saliendo a mitad de
           * precio. Aqui no se dice "reach" ni "por encima del valor". */
          if (barato.pay <= caro.pay * 0.6) linea.market = true;
          // La linea de plan es derivada y determinista: sin modelo, sin LLM.
          if (ahorro >= TMR_SH_PLAN && top && top.r.id !== barato.r.id) linea.spend = top;
        }
      }
      /* EL HALLAZGO PRINCIPAL, y es la regla del dueno: "no tengo que picar a
       * un jugador por valor, puedo solo pagar por los que me gustan aunque
       * esten mas abajo". Si el lo tiene en un tier alto y la sala lo vende
       * barato, esa diferencia es dinero libre. No es un reach: en subasta
       * pagas el precio y ya. Aqui no se dice "reach" ni "por encima del
       * valor" en ningun sitio. */
      return { tier: tn, men: men, deal: linea };
    });
    secciones.push({ pos: pos, tiers: tiers, sinCortes: nT < 2 });
  });
  var market = [];
  secciones.forEach(function (s2) {
    s2.tiers.forEach(function (t) {
      if (t.deal && t.deal.market) market.push({ pos: s2.pos, tier: t.tier, cheap: t.deal.cheap, exp: t.deal.exp, saves: t.deal.saves });
    });
  });
  market.sort(function (a, b) { return b.saves - a.saves; });
  return {
    plan: plan, secciones: secciones, top: top, n: filas.length, market: market,
    sinCortes: secciones.length > 0 && secciones.every(function (s) { return s.sinCortes; })
  };
}

function tmrSheetOpen() {
  if (TMR.owner !== true) return;
  TMR.sheetOn = true;
  var tab = document.getElementById('tab-rankings');
  if (tab) tab.classList.add('rk-sheeting');
  tmrSheetPaint();
  try { window.scrollTo(0, 0); } catch (_) { }
}

function tmrSheetClose() {
  TMR.sheetOn = false;
  var tab = document.getElementById('tab-rankings');
  if (tab) tab.classList.remove('rk-sheeting');
  var host = document.getElementById('rk-sheet');
  if (host) { host.hidden = true; host.innerHTML = ''; }
}

function tmrSheetPrint() { try { window.print(); } catch (_) { } }

function tmrSheetPaint() {
  var host = document.getElementById('rk-sheet');
  if (!host) return;
  if (!TMR.sheetOn) { host.hidden = true; host.innerHTML = ''; return; }
  var d = tmrSheetData(), p = d.plan, cfg = p.cfg, sh = p.shape;
  // Contra que esta calculada esta hoja, con sus numeros. Un precio sin su
  // sala no significa nada: el mismo jugador vale distinto en 10 que en 14, y
  // el QB vale otra cosa en 1QB que en superflex.
  var sala = tmrLigaTxt(cfg);
  var linea2 = sh.titulares + ' starters (QB, ' + sh.RB + ' RB, ' + sh.WR + ' WR, TE, FLEX, K, DEF) + '
    + sh.banca + ' bench' + (cfg.sixPt ? ' · 6 pt passing TDs' : '');

  var h = '<div class="rk-sh-top">'
    + '<div><b>Auction cheat sheet</b><span id="rk-sh-liga">' + tmrEsc(sala) + '</span>'
    + '<span>' + tmrEsc(linea2) + '</span>'
    + '<span class="rk-sh-regla">Prices are what the room pays.'
    + ' Your ranking decides who to chase, never how much to pay.</span></div>'
    + '<div class="rk-sh-top-b">'
    + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrSheetPrint()">Print</button>'
    + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrSheetClose()">Close</button>'
    + '</div></div>';

  h += '<div class="rk-sh-plan"><div class="rk-sh-plan-k">The plan</div><div class="rk-sh-plan-f">'
    + '<span><b>$' + p.total + '</b><i>' + p.n + (p.n === 1 ? ' target at $' : ' targets at $') + p.gasto
    + ', ' + p.huecos + (p.huecos === 1 ? ' spot at $1' : ' spots at $1') + '</i></span>'
    + '<span><b>' + (p.left < 0 ? '-$' + Math.abs(p.left) : '$' + p.left) + '</b><i>'
    + (p.over ? 'past your $' + cfg.budget : 'left of $' + cfg.budget) + '</i></span>'
    + '</div>';
  if (!p.n) {
    h += '<div class="rk-sh-note">No targets yet. Mark the players you actually want in the list and they show up here.</div>';
  } else if (p.faltaN) {
    h += '<div class="rk-sh-note">Starters still open: '
      + ['QB', 'RB', 'WR', 'TE', 'FLEX'].filter(function (ps) { return p.falta[ps]; })
        .map(function (ps) { return p.falta[ps] + ' ' + ps; }).join(' · ')
      + '. K and DEF go for $1 at the end.</div>';
  }
  // Los hallazgos de mercado suben al plan: son lo que de verdad decide la
  // subasta, y en una hoja de cuatro secciones se pierden si viven abajo.
  if (d.market && d.market.length) {
    h += '<div class="rk-sh-gaps"><div class="rk-sh-tk">Same tier, less money</div><ul>';
    d.market.slice(0, 5).forEach(function (m) {
      h += '<li><b>' + tmrEsc(m.cheap.r.name) + ' $' + m.cheap.pay + '</b> gives you your '
        + m.pos + ' tier ' + m.tier + ' for $' + m.saves + ' less than '
        + tmrEsc(m.exp.r.name) + ' at $' + m.exp.pay + '.</li>';
    });
    h += '</ul></div>';
  }
  if (p.over) {
    h += '<div class="rk-sh-warn">This plan does not fill ' + cfg.rounds + ' spots with $' + cfg.budget + '.</div>';
  }
  if (d.sinCortes) {
    h += '<div class="rk-sh-note" id="rk-sh-notiers">No tier breaks yet, so this sheet cannot tell you who is'
      + ' interchangeable with who. Play the Tier Game and the cheapest-in-tier lines show up here.</div>';
  }
  h += '</div>';

  d.secciones.forEach(function (s) {
    h += '<section class="rk-sh-sec"><h4 class="rk-sh-h rk-' + s.pos + '">' + s.pos + '</h4>';
    s.tiers.forEach(function (t) {
      // El rango del tier: lo que cuesta el mas caro y el mas barato de un
      // grupo que para el es intercambiable. Es la cifra que decide cuanto
      // puede ahorrarse sin cambiar de jugador.
      var conP = t.men.filter(function (x) { return x.pay != null; });
      var rango = '';
      if (conP.length) {
        var lo = conP[0].pay, hi = conP[0].pay;
        conP.forEach(function (x) { if (x.pay < lo) lo = x.pay; if (x.pay > hi) hi = x.pay; });
        rango = ' · room pays ' + (lo === hi ? '$' + hi : '$' + lo + '-$' + hi);
      }
      h += '<div class="rk-sh-tier"><div class="rk-sh-tk">Tier ' + t.tier + tmrEsc(rango) + '</div><ul class="rk-sh-ul">';
      t.men.forEach(function (x) {
        h += '<li class="rk-sh-li' + (x.target ? ' is-target' : '') + '">'
          + '<span class="rk-sh-nm">' + tmrEsc(x.r.name) + '</span>'
          + '<span class="rk-sh-tm">' + tmrEsc(x.r.team || 'FA') + '</span>'
          + '<span class="rk-sh-pay">' + (x.pay == null ? '$-'
            : '$' + x.pay + '<i>up to $' + (tmrCeilOf(x.r.id) || x.pay) + '</i>') + '</span></li>';
      });
      h += '</ul>';
      if (t.deal) {
        h += '<div class="rk-sh-deal' + (t.deal.market ? ' is-market' : '') + '">'
          + 'Cheapest in: <b>' + tmrEsc(t.deal.cheap.r.name) + ' $' + t.deal.cheap.pay
          + '</b>, saves <b>$' + t.deal.saves + '</b> vs ' + tmrEsc(t.deal.exp.r.name) + '.'
          + (t.deal.market ? ' Target: the room has him cheap.' : '')
          + (t.deal.spend ? ' Spend it on <b>' + tmrEsc(t.deal.spend.r.name) + '</b>.' : '')
          + '</div>';
      }
      h += '</div>';
    });
    h += '</section>';
  });

  h += '<div class="rk-sh-notes"><div class="rk-sh-tk">What that room did</div><ul>';
  TMR_SH_NOTES.forEach(function (n) { h += '<li>' + tmrEsc(n) + '</li>'; });
  h += '</ul><p>' + tmrEsc(TMR_SH_NOTES_SRC) + '</p></div>';

  host.hidden = false;
  host.innerHTML = h;
}

/* Los dos botones existen SOLO para el dueno, y no como CSS escondido: se
 * escriben cuando el servidor confirma quien es. Un boton invisible sigue
 * estando en el DOM, y "solo para el" tiene que aguantar que alguien abra el
 * inspector. */
function tmrOwnerTools() {
  var box = document.getElementById('rk-owner-tools');
  if (!box) return;
  // Tres estados, no dos: dueno, cuenta corriente, y "todavia no se". Mientras
  // no se sepa no se escribe nada, para que la pantalla no cambie dos veces.
  var modo = TMR.owner === true ? 'owner' : (TMR.owner === false ? 'guest' : '');
  if (!modo) { box.innerHTML = ''; box.dataset.mode = ''; return; }
  if (box.dataset.mode === modo) return;
  box.dataset.mode = modo;
  if (modo === 'owner') {
    box.innerHTML = '<button type="button" class="rk-btn" onclick="tmrGameOpen()">Tier Game</button>'
      + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrSheetOpen()">Cheat Sheet</button>'
      + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrLinkOpen()">Link another device</button>';
  } else {
    // La puerta de vuelta del propio dueno. NO es un boton suyo escondido: no
    // descubre nada ni hace nada sin un codigo vivo, y sin ella un telefono que
    // reinstalo la app no tiene por donde entrar, porque su cuenta es nueva.
    box.innerHTML = '<button type="button" class="rk-linkq" onclick="tmrLinkAsk()">Have a code?</button>';
  }
}

/* ── vincular otro dispositivo ───────────────────────────────────────────────
 * La cuenta de esta app es POR NAVEGADOR (un secreto aleatorio del
 * localStorage), asi que reinstalar la PWA o estrenar telefono deja al dueno
 * fuera de sus propias pantallas. Un dispositivo ya vinculado pide un codigo de
 * seis digitos y el nuevo lo teclea. Lo autoriza el servidor; aqui solo se
 * pinta. */
var TMR_LINK_T = null;

function tmrLinkHost() { return document.getElementById('rk-link'); }

function tmrLinkClose() {
  if (TMR_LINK_T) { clearInterval(TMR_LINK_T); TMR_LINK_T = null; }
  var h = tmrLinkHost();
  if (!h) return;
  h.hidden = true;
  h.innerHTML = '';
}

function tmrLinkMsg(txt, clase) {
  var m = document.getElementById('lk-msg');
  if (!m) return;
  m.textContent = txt || '';
  m.className = 'lk-msg' + (clase ? ' ' + clase : '');
}

/* El codigo se pide al ABRIR, no antes: un codigo guardado "por si acaso" es un
 * codigo vivo mas tiempo del que hace falta. */
async function tmrLinkOpen() {
  var h = tmrLinkHost();
  if (!h) return;
  if (TMR_LINK_T) { clearInterval(TMR_LINK_T); TMR_LINK_T = null; }
  h.hidden = false;
  h.innerHTML = '<div class="lk-box"><div class="lk-k">Link another device</div>'
    + '<div class="lk-skel" aria-hidden="true"></div>'
    + '<p class="lk-p">Asking the server for a code.</p></div>';
  var j = null, err = '';
  try {
    var r = await fetch('/api/perfil/link/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    try { j = await r.json(); } catch (_) { j = null; }
    if (!r.ok || !j || !j.code) err = (j && j.error) || ('Could not create a code (' + r.status + ').');
  } catch (_) { err = 'No connection. Try again in a moment.'; }
  if (err) {
    h.innerHTML = '<div class="lk-box"><div class="lk-k">Link another device</div>'
      + '<p class="lk-p lk-bad">' + tmrEsc(err) + '</p>'
      + '<div class="lk-form"><button type="button" class="rk-btn rk-btn-quiet" onclick="tmrLinkClose()">Close</button></div></div>';
    return;
  }
  var hasta = Number(j.expiresAt) || (Date.now() + 10 * 60 * 1000);
  h.innerHTML = '<div class="lk-box"><div class="lk-k">Link another device</div>'
    + '<div class="lk-code" id="lk-code-out">' + tmrEsc(j.code) + '</div>'
    + '<p class="lk-p">On the other device: My Rankings &gt; Have a code?</p>'
    + '<div class="lk-form"><span class="lk-left" id="lk-left" aria-live="polite"></span>'
    + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrLinkClose()">Done</button></div></div>';
  tmrLinkTick(hasta);
  TMR_LINK_T = setInterval(function () { tmrLinkTick(hasta); }, 1000);
}

function tmrLinkTick(hasta) {
  var el = document.getElementById('lk-left');
  if (!el) { if (TMR_LINK_T) { clearInterval(TMR_LINK_T); TMR_LINK_T = null; } return; }
  var s = Math.max(0, Math.round((hasta - Date.now()) / 1000));
  if (s <= 0) {
    el.textContent = 'Expired. Ask for a new one.';
    if (TMR_LINK_T) { clearInterval(TMR_LINK_T); TMR_LINK_T = null; }
    return;
  }
  var m = Math.floor(s / 60), q = s % 60;
  el.textContent = 'Expires in ' + m + ':' + (q < 10 ? '0' + q : q);
}

/* El lado del dispositivo nuevo. */
function tmrLinkAsk() {
  var h = tmrLinkHost();
  if (!h) return;
  h.hidden = false;
  h.innerHTML = '<div class="lk-box"><div class="lk-k">Have a code?</div>'
    + '<p class="lk-p">Get one on a device that is already linked, under My Rankings.</p>'
    + '<div class="lk-form">'
    + '<input id="lk-code" class="lk-input" type="text" inputmode="numeric" pattern="[0-9]*" '
    + 'autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Six digit code" '
    + 'onkeydown="tmrLinkKey(event)">'
    + '<button type="button" class="rk-btn" onclick="tmrLinkSubmit()">Link</button>'
    + '<button type="button" class="rk-btn rk-btn-quiet" onclick="tmrLinkClose()">Cancel</button>'
    + '</div><div class="lk-msg" id="lk-msg" aria-live="polite"></div></div>';
  var i = document.getElementById('lk-code');
  if (i) try { i.focus(); } catch (_) { }
}

function tmrLinkKey(e) {
  if (e && e.key === 'Enter') { e.preventDefault(); tmrLinkSubmit(); }
}

async function tmrLinkSubmit() {
  var inp = document.getElementById('lk-code');
  if (!inp) return;
  var code = String(inp.value || '').replace(/[^0-9]/g, '').slice(0, 6);
  if (code.length !== 6) { tmrLinkMsg('Type the six digits.', 'is-bad'); return; }
  tmrLinkMsg('Checking');
  var r = null, j = null;
  try {
    r = await fetch('/api/perfil/link/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code })
    });
    try { j = await r.json(); } catch (_) { j = null; }
  } catch (_) { r = null; }
  if (!r || !r.ok || !j || !j.owner) {
    tmrLinkMsg((j && j.error) || 'Could not link this device.', 'is-bad');
    return;
  }
  tmrLinkMsg('Linked. Bringing your list down.', 'is-ok');
  await tmrLinkAdopt();
}

/* Pasar a dueno SIN recargar: se rehace la unica pregunta que decide (tmrOwner)
 * y detras la cola del arranque que solo corre para el dueno, que es la misma
 * de renderRankings. Recargar tambien funcionaria, pero perderia el scroll y
 * parpadearia por algo que ya esta entero en memoria. Si la pregunta no
 * confirma, entonces si se recarga: nunca se deja la pantalla a medias. */
async function tmrLinkAdopt() {
  TMR._ownerP = null;
  var own = false;
  try { own = await tmrOwner(); } catch (_) { own = false; }
  if (!own) { try { location.reload(); } catch (_) { } return; }
  try { await tmrSyncPull(); } catch (_) { }
  try { tmrSeed(); } catch (_) { }
  TMR.pricing = true;
  tmrPaint();
  try { await tmrPrices(); } catch (_) { }
  TMR.pricing = false;
  tmrPaint();
  var h = tmrLinkHost();
  if (h) {
    h.innerHTML = '<div class="lk-box"><div class="lk-k">Device linked</div>'
      + '<p class="lk-p">Your list, your prices and Draft Day are on this device now.</p>'
      + '<div class="lk-form"><button type="button" class="rk-btn rk-btn-quiet" onclick="tmrLinkClose()">Done</button></div></div>';
  }
  return true;
}

/* ── puentes hacia el resto de la app ───────────────────────────────────── */
/* El board del mock pregunta por aqui. Devuelve MI puesto (1-based) o null si
 * el jugador no esta en mi lista, para que quien llame decida si cae de vuelta
 * al ADP en vez de recibir un cero que parece un puesto buenisimo. */
function tmMyRankOf(name) {
  if (!TMR.loaded || !TMR.rows.length) return null;
  var n = _tmrNorm(name);
  if (!TMR._idx || TMR._idxN !== TMR.rows.length) {
    TMR._idx = {};
    TMR.rows.forEach(function (r, i) { TMR._idx[_tmrNorm(r.name)] = i + 1; });
    TMR._idxN = TMR.rows.length;
  }
  return TMR._idx[n] || null;
}

function tmRankingsActivos() {
  try { return localStorage.getItem(TMR_USE_KEY) === '1' && TMR.loaded && TMR.rows.length > 0; } catch (_) { return false; }
}

function tmrToggleUse(on) {
  try { localStorage.setItem(TMR_USE_KEY, on ? '1' : '0'); } catch (_) { }
}

/* El indice cacheado tiene que morir con cada reordenamiento, o el mock sigue
 * leyendo los puestos viejos. Se invalida donde se guarda, que es el unico
 * punto por el que pasan TODAS las ediciones. */
var _tmrSaveInner = tmrSave;
tmrSave = function () { TMR._idx = null; TMR._idxN = -1; _tmrSaveInner(); tmrSyncQueue(); };

/* El plan se carga al ARRANCAR el modulo, no al abrir el tab: Draft Day
 * pregunta por los precios a mano sin pasar por esta pantalla, y una lectura
 * de localStorage no cuesta nada. */
try { tmrPlanLoad(); } catch (_) { }
try { tmrGameLoad(); } catch (_) { }

if (typeof window !== 'undefined') {
  window.renderRankings = renderRankings;
  window.tmrMove = tmrMove;
  window.tmrCut = tmrCut;
  window.tmrFilter = tmrFilter;
  window.tmrSearch = tmrSearch;
  window.tmrReset = tmrReset;
  window.tmrExport = tmrExport;
  window.tmrCloseExport = tmrCloseExport;
  window.tmrDragStart = tmrDragStart;
  window.tmrDragOver = tmrDragOver;
  window.tmrDrop = tmrDrop;
  window.tmrDragEnd = tmrDragEnd;
  window.tmrToggleUse = tmrToggleUse;
  window.tmrEditPrice = tmrEditPrice;
  window.tmrPriceKey = tmrPriceKey;
  window.tmrPriceBlur = tmrPriceBlur;
  window.tmrSetPrice = tmrSetPrice;
  window.tmrClearPrice = tmrClearPrice;
  window.tmrToggleTarget = tmrToggleTarget;
  window.tmrPriceOf = tmrPriceOf;
  window.tmrCeilOf = tmrCeilOf;
  window.tmrPlanPrices = tmrPlanPrices;
  window.tmrPrices = tmrPrices;
  window.tmrOwner = tmrOwner;
  window.tmrSyncQueue = tmrSyncQueue;
  window.tmrSyncPush = tmrSyncPush;
  window.tmrSyncPull = tmrSyncPull;
  window.tmrSyncDoc = tmrSyncDoc;
  window.tmrSeed = tmrSeed;
  // El Tier Game y la cheat sheet. tmrTiersInfer, tmrGameNext y
  // tmrGameProgress son PURAS y se exportan a proposito: el gate las corre con
  // casos armados a mano, sin navegar ni pintar nada.
  window.tmrTiersInfer = tmrTiersInfer;
  window.tmrGameNext = tmrGameNext;
  window.tmrGameProgress = tmrGameProgress;
  window.tmrGameOpen = tmrGameOpen;
  window.tmrGameClose = tmrGameClose;
  window.tmrGameAnswer = tmrGameAnswer;
  window.tmrGameUndo = tmrGameUndo;
  window.tmrGameAskAgain = tmrGameAskAgain;
  window.tmrGameCycles = tmrGameCycles;
  window.tmrRosterShape = tmrRosterShape;
  window.tmrAdpFmt = tmrAdpFmt;
  window.tmrGamePaint = tmrGamePaint;
  window.tmrTiersPreview = tmrTiersPreview;
  window.tmrTiersCancel = tmrTiersCancel;
  window.tmrTiersApply = tmrTiersApply;
  window.tmrSheetOpen = tmrSheetOpen;
  window.tmrSheetClose = tmrSheetClose;
  window.tmrSheetPrint = tmrSheetPrint;
  window.tmrSheetData = tmrSheetData;
  window.tmrOwnerTools = tmrOwnerTools;
  window.tmrLinkOpen = tmrLinkOpen;
  window.tmrLinkAsk = tmrLinkAsk;
  window.tmrLinkClose = tmrLinkClose;
  window.tmrLinkSubmit = tmrLinkSubmit;
  window.tmrLinkKey = tmrLinkKey;
  window.tmrLinkAdopt = tmrLinkAdopt;
  window.tmMyRankOf = tmMyRankOf;
  window.tmRankingsActivos = tmRankingsActivos;
  window.tmrHydrate = tmrHydrate;
  window.TMR = TMR;

  /* Red de seguridad de la carrera de carga: el tab lo abre un onclick inline, y
   * con la red lenta el usuario puede pulsarlo ANTES de que este archivo exista.
   * El onclick va guardado con window.renderRankings&&... asi que no revienta,
   * pero entonces nadie pinta nunca. Al terminar de cargar, si el tab ya quedo
   * abierto, se pinta solo. Medido: sin esto el tab se queda en blanco y la
   * consola imprime un ReferenceError, que cuenta como bug. */
  try {
    var _t = document.getElementById('tab-rankings');
    if (_t && (_t.classList.contains('active') || _t.style.display === 'block')) renderRankings();
  } catch (_) { }
}
