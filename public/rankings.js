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
  _cancel: false   // Escape: el blur que viene detras NO debe guardar
};

var TMR_KEY = 'tm_rankings_v1';
var TMR_USE_KEY = 'tm_rankings_use';
/* El plan (precios a mano y objetivos) vive en SU propia llave, no dentro de
 * la del orden: "Reset to consensus" borra el orden y los tiers, y perder
 * ademas los precios que uno escribio a mano no es lo que anuncia ese boton. */
var TMR_PLAN_KEY = 'tm_rankings_plan_v1';
var TMR_LIMIT = 200; // top 200: mas abajo el ADP es ruido y la lista se vuelve inmanejable

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
function tmrRoomCfg() {
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
  var out = [];
  Object.keys(src).forEach(function (k) {
    var p = src[k];
    if (!p || !p.adp || !p.pos) return;
    if (['QB', 'RB', 'WR', 'TE'].indexOf(p.pos) < 0) return;  // la sala tampoco los tiene
    out.push({ id: String(p._id || k), name: p.name || k, pos: p.pos, team: p.team || '', adp: p.adp });
  });
  out.sort(function (a, b) { return a.adp - b.adp; });
  return out.slice(0, n);
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

/* La mezcla, que es barata y se rehace en cada pintado: el jugador que YO
 * tengo en el puesto k vale lo que esta sala paga por su k-esimo mas caro. Es
 * la MISMA conversion que usa Draft Day (lvMisValores), con el mismo peso, y
 * por eso mover a alguien en la lista le mueve el precio en el acto. A quien
 * no este en mi lista no se le aplica nada: se queda con el precio de sala. */
function tmrBlend() {
  var st = TMR.sticker, curva = TMR._curva;
  if (!st || !curva || !curva.length) return;
  var peso = (window.LV && typeof LV.peso === 'number') ? LV.peso : 0.5;
  var pr = {};
  for (var i = 0; i < TMR.rows.length; i++) {
    var r = TMR.rows[i], sk = st[r.id];
    if (sk == null) continue;
    var mio = curva[Math.min(i, curva.length - 1)];
    pr[r.id] = Math.max(1, Math.round(sk * (1 - peso) + mio * peso));
  }
  TMR.price = pr;
}

/* ── carga ──────────────────────────────────────────────────────────────── */
async function renderRankings() {
  var host = document.getElementById('rk-body');
  if (!host) return;
  if (TMR.loaded) {
    tmrPaint();
    // Reabrir el tab es el momento de volver a preguntar: un intento anterior
    // pudo quedarse sin precios (sala viva, feed caido) y, sobre todo, el
    // usuario pudo cambiar la sala en Mock Draft desde la ultima vez. tmrPrices
    // se corta sola por firma si nada cambio, asi que reintentarlo es gratis.
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

  // La lista se pinta YA, con la columna del dinero en skeleton: esperar al
  // feed de subasta para ensenar doscientos nombres que ya estan en memoria
  // seria cambiar una pantalla instantanea por una en blanco.
  TMR.pricing = true;
  tmrPaint();
  try { await tmrPrices(); } catch (_) { }
  TMR.pricing = false;
  tmrPaint();
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
function tmrPriceCell(id) {
  var man = TMR.manual[id], calc = TMR.price[id];
  if (TMR.pricing && man == null && calc == null) return '<span class="rk-pr-skel"></span>';
  var v = (man != null) ? man : calc;
  var t = (man != null)
    ? 'Your price. This room prices him at $' + (calc == null ? '?' : calc) + '.'
    : 'What this room should pay for him. Click to set your own.';
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
      + '<span class="rk-pay" data-id="' + tmrEsc(r.id) + '">' + tmrPriceCell(r.id) + '</span>'
      + tmrTargetBtn(r)
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
      + '<span class="rk-ch-pay">Pay</span>'
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
  return {
    n: n, gasto: gasto, huecos: huecos, total: total,
    left: cfg.budget - total, over: total > cfg.budget,
    pos: pos, cfg: cfg, sinPrecio: sinPrecio
  };
}

function tmrBuildPaint() {
  var el = document.getElementById('rk-build');
  if (!el) return;
  var d = tmrBuildData(), cfg = d.cfg;
  var room = ((typeof _mdFz26On === 'function' && _mdFz26On()) ? 'Fantazy 2026 · ' : '')
    + cfg.teams + ' teams · $' + cfg.budget + ' · ' + cfg.rounds + ' rounds';
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
    if (d.sinPrecio) {
      h += '<div class="rk-bd-warn is-soft">' + d.sinPrecio
        + (d.sinPrecio === 1 ? ' target has no room price yet and is not in the total.'
          : ' targets have no room price yet and are not in the total.') + '</div>';
    }
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
  var cur = tmrPriceOf(id);
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
  renderRankings();
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
tmrSave = function () { TMR._idx = null; TMR._idxN = -1; _tmrSaveInner(); };

/* El plan se carga al ARRANCAR el modulo, no al abrir el tab: Draft Day
 * pregunta por los precios a mano sin pasar por esta pantalla, y una lectura
 * de localStorage no cuesta nada. */
try { tmrPlanLoad(); } catch (_) { }

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
  window.tmrPlanPrices = tmrPlanPrices;
  window.tmrPrices = tmrPrices;
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
