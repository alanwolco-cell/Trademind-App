/* Draft Day: la subasta REAL, conducida por lo que canta la sala.
 *
 * Por que existe. El domingo el dueno drafea en Yahoo, que no nos deja leer
 * nada (el permiso de Fantasy Sports lleva sin aprobar desde el 4 de agosto).
 * Pero el motor de subasta de este repo YA sabe todo lo que hace falta saber:
 * cuanto vale un jugador en ESTA sala (auValue), como se mueve el mercado
 * segun se gasta el dinero (auInflation), cuanto pagaria cada rival segun su
 * arquetipo (auBotMax) y cual es su propio techo honesto (auMyWorth).
 *
 * Lo unico que le faltaba era que lo condujera la realidad en vez de los bots.
 * Eso es AU.live: tres cortes en app.js (auAdvance, auOpenLot, auSell) que
 * apagan los relojes del motor. Con AU.live apagado el comportamiento es
 * IDENTICO al de siempre, que es lo que mantiene verdes los 40 invariantes.
 *
 * O sea: el domingo corre el mismo codigo que paso las 600 salas del gate, no
 * uno nuevo escrito en cuatro dias.
 *
 * Tres cosas que pidio el dueno y que gobiernan el diseno de este archivo:
 *  1. "que vaya tanteando la sala": cada venta recalcula quien tiene dinero de
 *     verdad, a quien le falta que, y quien puede superarlo en el lote vivo.
 *  2. "reaction time muy rapido sin perder accuracy": todo lo caro se calcula
 *     UNA vez al abrir la sala. Una venta solo mueve presupuesto, huecos e
 *     inflacion. La busqueda sale de un indice, nunca de un recorrido.
 *  3. "basado en mis rankings": su lista propia entra en el precio, con una
 *     conversion declarada (ver lvMisValores) y nunca con un numero inventado.
 */
'use strict';

var LV = {
  on: false,
  pref: {},        // id -> 'love' | 'meh' | 'avoid'
  mine: {},        // id -> valor en dolares SEGUN MI lista
  myRank: {},      // id -> mi puesto
  idx: null,       // [{k:nombre normalizado, p:jugador}] para busqueda instantanea
  peso: 0.5,       // cuanto mandan mis rankings frente al mercado (0..1)
  loveP: 0.15,     // Love: pago hasta un 15% por encima de mi numero
  mehP: 0.15,      // No tanto: pido un 15% de descuento
  avoidP: 0.35,    // No es mi tipo: pido un 35% de descuento, pero SIGO comprando
  gangaP: 0.30,    // por debajo de este descuento sobre el valor puro, la emocion se calla
  desconocidos: [],// nombres pegados que no se reconocieron: se DECLARAN, no se tragan
  lastMs: 0,       // cuanto tardo la ultima respuesta, medido y visible
  listasAbierto: false,
  // RESERVA DE PRESUPUESTO. Pendiente viejo del repo ("la puerta reserva
  // huecos de roster, no dinero") que ahora tiene motivo concreto: el dueno
  // dice ser bueno en la franja media de WR, y su sala es de novatos que se
  // funden el presupuesto en los primeros lotes. Sin reserva, la unica forma
  // de llegar con dinero a esa franja es acordarse de no gastar, que en mitad
  // de una puja no funciona.
  reserva: 0,
  // El sesgo que el dueno declara de si mismo: "a veces me dejo llevar por top
  // receivers". Va como dato configurable y no clavado en el codigo, porque es
  // SUYO, no una verdad del juego. La herramienta lo usa para cazarlo en el
  // momento exacto en que esta por caer, que es lo unico que sirve: decirselo
  // despues del draft no cambia nada.
  sesgo: 'WR',
  panel: { x: null, y: null, min: false }
};

var LV_PREF_KEY = 'tm_lv_pref';
var LV_PANEL_KEY = 'tm_lv_panel';
// NINGUNA etiqueta veta a nadie. Regla explicita del dueno: "quiero llevarme
// jugadores que no me gustan si el valor es correcto, porque nunca sabes; la
// idea es que mis emociones afecten pero hasta un punto". Asi que el gusto
// mueve el PRECIO dentro de una banda, nunca borra al jugador del tablero, y
// el panel ensena siempre los dos numeros para que la emocion se pueda ver en
// dolares en vez de actuar a escondidas.
var LV_KIND = { love: 'Love', meh: 'Not so much', avoid: 'Not my guy' };

/* ── persistencia ───────────────────────────────────────────────────────── */
function lvSavePref() {
  try {
    localStorage.setItem(LV_PREF_KEY, JSON.stringify({
      pref: LV.pref, peso: LV.peso, loveP: LV.loveP, mehP: LV.mehP, avoidP: LV.avoidP,
      reserva: LV.reserva, sesgo: LV.sesgo
    }));
  } catch (_) { }
}
function lvLoadPref() {
  try {
    var d = JSON.parse(localStorage.getItem(LV_PREF_KEY) || 'null');
    if (!d) return;
    LV.pref = d.pref || {};
    if (typeof d.peso === 'number') LV.peso = d.peso;
    if (typeof d.loveP === 'number') LV.loveP = d.loveP;
    if (typeof d.mehP === 'number') LV.mehP = d.mehP;
    if (typeof d.avoidP === 'number') LV.avoidP = d.avoidP;
    if (typeof d.reserva === 'number') LV.reserva = d.reserva;
    if (d.sesgo) LV.sesgo = d.sesgo;
  } catch (_) { }
}
function lvSavePanel() {
  try { localStorage.setItem(LV_PANEL_KEY, JSON.stringify(LV.panel)); } catch (_) { }
}
function lvLoadPanel() {
  try {
    var d = JSON.parse(localStorage.getItem(LV_PANEL_KEY) || 'null');
    if (d) LV.panel = { x: d.x, y: d.y, min: !!d.min };
  } catch (_) { }
}

/* ── indice de nombres ──────────────────────────────────────────────────────
 * Se arma UNA vez por sala. Buscar por recorrido sobre 600 jugadores en cada
 * tecla es justo lo que el dueno pidio evitar: el indice deja la busqueda en
 * una pasada sobre cadenas ya normalizadas, y el resultado se cachea por
 * consulta porque el patron real es escribir el mismo prefijo letra a letra. */
function lvBuildIndex() {
  LV.idx = (MD.pool || []).map(function (p) {
    var k = _mdNormName(p.name);
    var sp = k.indexOf(' ');
    return { k: k, ape: sp > 0 ? k.slice(sp + 1) : k, p: p };
  });
  LV._qc = {};
}
/* EL APELLIDO MANDA. Medido con el primer test de esta sesion: escribir
 * "chase" devolvia a Chase Brown en vez de a Ja'Marr Chase, porque "Chase" es
 * el NOMBRE de pila del otro y el indice miraba la cadena entera. En una
 * subasta eso registra la venta equivocada y a partir de ahi el tanteo de la
 * sala esta envenenado: presupuestos, huecos e inflacion, todo mal.
 * Puntuacion, de mejor a peor: apellido exacto, apellido que empieza igual,
 * nombre completo que empieza igual, y por ultimo cualquier coincidencia
 * suelta. A igualdad, gana el mas caro de la sala: quien teclea un apellido a
 * medias en mitad de una puja quiere al jugador que se esta subastando, no a
 * su homonimo de la ronda 14. */
function lvFind(q) {
  q = _mdNormName(q || '');
  if (!q) return [];
  if (LV._qc && LV._qc[q]) return LV._qc[q];
  var hits = [];
  for (var i = 0; i < LV.idx.length; i++) {
    var e = LV.idx[i], sc = 0;
    if (e.ape === q) sc = 5;
    else if (e.ape.indexOf(q) === 0) sc = 4;
    else if (e.k.indexOf(q) === 0) sc = 3;
    else if (e.ape.indexOf(q) > 0) sc = 2;
    else if (e.k.indexOf(q) > 0) sc = 1;
    if (sc) hits.push({ sc: sc, p: e.p });
  }
  hits.sort(function (a, b) {
    if (b.sc !== a.sc) return b.sc - a.sc;
    var av = 0, bv = 0;
    try { av = auValue(a.p); bv = auValue(b.p); } catch (_) { }
    return bv - av;
  });
  var out = hits.slice(0, 8).map(function (h) { return h.p; });
  if (LV._qc) LV._qc[q] = out;
  return out;
}
function lvOne(q) { var r = lvFind(q); return r.length ? r[0] : null; }

/* ── mis rankings, convertidos a dinero ─────────────────────────────────────
 * La conversion, declarada porque el usuario la ve en pantalla: el jugador que
 * YO tengo en el puesto k vale lo que ESTA sala paga por su k-esimo jugador
 * mas caro. No inventa un precio: reusa la curva de precios que auPoolInit ya
 * normalizo al dinero exacto de la sala. Si mi lista pone a Nabers cuarto y el
 * cuarto valor de la sala son $46, por mi lista Nabers vale $46 aunque el
 * mercado lo tenga en $37.
 * Ojo con el sesgo: mi lista solo cubre el top 200 sin K ni DEF, asi que a
 * quien no este en ella no se le aplica NADA (se queda con el mercado puro),
 * en vez de castigarlo por ausencia. */
function lvMisValores() {
  LV.mine = {}; LV.myRank = {};
  if (typeof TMR === 'undefined' || !TMR.loaded || !TMR.rows.length) return 0;
  var curva = Object.keys(AU.val || {}).map(function (k) { return AU.val[k]; })
    .sort(function (a, b) { return b - a; });
  if (!curva.length) return 0;
  var n = 0;
  TMR.rows.forEach(function (r, i) {
    var p = lvOne(r.name);
    if (!p) return;                       // vendido ya, o fuera del pool de la sala
    LV.myRank[p.id] = i + 1;
    LV.mine[p.id] = curva[Math.min(i, curva.length - 1)];
    n++;
  });
  return n;
}

/* ── el techo, con su desglose ──────────────────────────────────────────────
 * Nunca devuelve solo un numero: devuelve de donde sale cada parte, porque un
 * numero sin procedencia en mitad de una subasta no se puede contradecir ni
 * creer. La regla del perfil ("solo dice lo que el dato aguanta") vale igual
 * aqui. */
function lvCeiling(p) {
  var t0 = (window.performance && performance.now) ? performance.now() : 0;
  var base = auMyWorth(p);               // motor: valor de sala x inflacion, necesidad, cap
  var mercado = base.worth;
  var mio = LV.mine[p.id] || null;
  var mezcla = mercado;
  if (mio != null) mezcla = Math.round(mercado * (1 - LV.peso) + mio * LV.peso);

  // El gusto sesga el precio y nada mas. 'avoid' NO es un veto: es pedir un
  // descuento grande. Un jugador que no me gusta a mitad de precio sigue
  // siendo la mejor compra de la sala, y esa puerta queda abierta a proposito.
  var pref = LV.pref[p.id] || null;
  var tras = mezcla;
  if (pref === 'love') tras = Math.round(mezcla * (1 + LV.loveP));
  else if (pref === 'meh') tras = Math.round(mezcla * (1 - LV.mehP));
  else if (pref === 'avoid') tras = Math.round(mezcla * (1 - LV.avoidP));

  // La ley del presupuesto manda sobre todo lo demas: no se puede pujar un
  // dolar que dejaria un hueco de roster sin llenar. Esto no es una opinion
  // de mercado, es aritmetica, y por eso va la ultima.
  var sl = AU.slotsLeft[MD.mySlot] || 0;
  var cap = sl > 0 ? AU.budgets[MD.mySlot] - (sl - 1) : 0;
  // La reserva se descuenta del techo, PERO se libera sola. Una reserva que no
  // se libera es dinero muerto, que es un fallo que este repo ya midio en
  // auInflation: 74 de 192 lotes cargaban ~$31 de dinero que nadie podia
  // gastar, y la sala creia que el mercado se derretia mientras los pujadores
  // estaban en la ruina. Se libera cuando la sala ya se quedo sin dinero (que
  // es justo la franja que la reserva venia a esperar) o cuando quedan pocos
  // huecos y guardar mas seria regalarlo.
  var resAct = 0, resLib = '';
  if (LV.reserva > 0 && sl > 0) {
    if ((AU.inflation || 1) <= 0.92) resLib = 'the room is already broke';
    else if (sl <= 4) resLib = 'only ' + sl + ' spots left';
    else resAct = Math.min(LV.reserva, Math.max(0, cap - 1));
  }
  var capRes = Math.max(0, cap - resAct);
  var techo = Math.max(0, Math.min(tras, capRes));
  // El numero LIMPIO, sin una gota de gusto: viaja siempre al lado del otro.
  // Ver la emocion cuantificada en dolares es lo que la mantiene "hasta un
  // punto"; escondida, no hay forma de saber cuanto esta costando.
  var puro = Math.max(0, Math.min(mezcla, cap));
  // Y cuando la puja viva cae MUY por debajo del valor limpio, el gusto se
  // calla del todo: a ese descuento hasta un jugador que no me gusta es la
  // compra correcta, que es exactamente lo que pidio el dueno.
  var bid = (AU.lot && AU.lot.p === p) ? AU.lot.bid : null;
  // GANGA: no basta con que el precio sea bajo. TODO lote abre en $1, asi que
  // comparar contra el valor a secas marcaba ganga en cada nominacion, y un
  // aviso que salta siempre deja de leerse justo en el lote que importa.
  // Una ganga real necesita las DOS cosas: que valga mucho mas de lo que se
  // esta pagando, y que la puja ya no tenga a quien la suba. Lo segundo se
  // calcula, no se supone: si ningun rival con hueco llega al precio actual,
  // el lote se cierra ahi.
  var ganga = false, nadieSube = false;
  if (bid != null && puro > 0 && bid <= puro * (1 - LV.gangaP)) {
    nadieSube = true;
    for (var rs = 1; rs <= MD.teams; rs++) {
      if (rs === MD.mySlot) continue;
      if ((AU.slotsLeft[rs] || 0) <= 0) continue;
      var rm = 0;
      try { rm = auBotMax(rs, p) || 0; } catch (_) { }
      var rcap = AU.budgets[rs] - (AU.slotsLeft[rs] - 1);
      if (Math.min(rm, rcap) > bid) { nadieSube = false; break; }
    }
    ganga = nadieSube;
  }

  LV.lastMs = t0 ? ((window.performance.now() - t0)) : 0;
  return {
    techo: techo, puro: puro, coste: puro - techo, ganga: ganga, bid: bid,
    mercado: mercado, mio: mio, mezcla: mezcla, pref: pref,
    cap: cap, capRes: capRes, resAct: resAct, resLib: resLib,
    topeAlcanzado: tras > capRes, necesita: base.needsIt,
    rank: LV.myRank[p.id] || null
  };
}

/* ── EL CONSEJO ─────────────────────────────────────────────────────────────
 * Lo que pidio el dueno, con sus palabras: "este es el ultimo RB de tu tier,
 * quemate la plata y despues usa tu talento para un receiver de 5 dolares".
 * O sea, no un numero: una decision con su motivo y con lo que viene despues.
 *
 * Reglas de esta funcion, heredadas de como habla Mac en el resto del repo:
 *  - UNA sola linea, la que mas cambie la decision. Nunca una lista.
 *  - Si no hay nada que decir, CALLA. Un consejero que habla en cada lote se
 *    convierte en ruido y deja de leerse justo cuando importa.
 *  - Ningun numero inventado: la escasez sale de MD.tierOf, los huecos de
 *    _auStarterGate, el dinero de la sala de auInflation. Todo ya medido.
 */
/* "QB and RB and WR and TE" no es una frase, es un volcado. Y cuando debe
 * cuatro titulares, enumerarlos no aporta: el numero lo dice mejor. */
function lvLista(a) {
  if (!a || !a.length) return '';
  if (a.length > 2) return a.length + ' starters';
  if (a.length === 2) return a[0] + ' and ' + a[1];
  return a[0];
}
function lvAdvice(p, c, read) {
  if (!p || !c) return '';
  var yo = MD.mySlot;
  var sl = AU.slotsLeft[yo] || 0;
  if (sl <= 0) return '';
  var ros = {}; (MD.mine || []).forEach(function (x) { ros[x.pos] = (ros[x.pos] || 0) + 1; });

  // cuantos quedan vivos de SU tier, en su posicion
  var quedan = 0, tier = MD.tierOf && MD.tierOf[p.id];
  if (tier) {
    var tk = {}; (MD.picks || []).forEach(function (k) { if (k && k.p) tk[k.p.id] = 1; });
    quedan = MD.pool.filter(function (x) {
      return !tk[x.id] && x.pos === p.pos && MD.tierOf[x.id] === tier;
    }).length;
  }

  // que titulares le debe todavia el roster
  var debe = [];
  try { debe = (_auStarterGate(ros, sl).positions) || []; } catch (_) { }
  var lonecesita = debe.indexOf(p.pos) >= 0;

  // donde es barato encontrar reemplazo: la posicion con mas cuerpos vivos
  // por debajo de la linea de dinero. No es una corazonada, se cuenta.
  // Solo cuentan los que ALGUIEN va a draftear. Contando el pool entero salian
  // "68 WRs under $6", que no es creible ni util: la cola larga de un board de
  // 600 nombres no es profundidad, es relleno que nadie mira.
  var baratos = {};
  var tk2 = {}; (MD.picks || []).forEach(function (k) { if (k && k.p) tk2[k.p.id] = 1; });
  var huecosSala = MD.teams * MD.rounds;
  var vivosOrd = MD.pool.filter(function (x) { return !tk2[x.id]; })
    .sort(function (a, b) { return auValue(b) - auValue(a); })
    .slice(0, Math.max(0, huecosSala - (MD.picks || []).length));
  vivosOrd.forEach(function (x) {
    if (x.pos !== 'RB' && x.pos !== 'WR' && x.pos !== 'TE') return;
    if (auValue(x) <= 6) baratos[x.pos] = (baratos[x.pos] || 0) + 1;
  });

  // 1. LA GANGA CONFIRMADA. Va la PRIMERA de todas porque es la unica senal
  //    que ya trae comprobado que no hay competencia: se calculo que ningun
  //    rival con hueco llega al precio actual. Estaba en tercer lugar y el
  //    test lo destapo: con una ganga detectada, la frase del tier decia "this
  //    is the price, not a bargain" mientras el aviso verde decia lo
  //    contrario. Dos avisos que se contradicen en el segundo de decidir son
  //    peor que ninguno. Ademas es lo coherente con la regla del dueno: un
  //    jugador que no le gusta al precio correcto se compra igual.
  if (c.ganga) {
    return 'At $' + c.bid + ' he is worth $' + c.puro + ' and nobody left can outbid you. '
      + 'Take the value, you can dislike him on your bench.';
  }

  // 2. EL SESGO QUE EL MISMO DECLARA. Va primero porque es el unico aviso que
  //    llega tarde si llega despues: cuando ya pujo, no sirve de nada.
  if (p.pos === LV.sesgo && c.mercado >= 25) {
    var titWR = LV.sesgo === 'WR' ? (MD.scoring >= 1 ? 3 : 2) : 2;
    var yaTiene = (ros[LV.sesgo] || 0);
    if (yaTiene >= titWR && debe.length) {
      return 'You already have ' + yaTiene + ' ' + LV.sesgo + 's and still owe ' + lvLista(debe)
        + '. This is the pull you told me you fall for. Let him go.';
    }
  }

  // 3. EL ULTIMO DE SU TIER, en algo que de verdad necesita. Es el momento de
  //    quemar dinero: la siguiente ficha de esa calidad no existe.
  if (quedan === 1 && lonecesita) {
    var salida = '';
    var mejorBarato = Object.keys(baratos).sort(function (a, b) { return baratos[b] - baratos[a]; })[0];
    if (mejorBarato && mejorBarato !== p.pos && baratos[mejorBarato] >= MD.teams) {
      salida = ' There are ' + baratos[mejorBarato] + ' draftable ' + mejorBarato
        + 's left under $6, so you can fill that side late.';
    }
    return 'Last ' + p.pos + ' in this tier and you still owe ' + lvLista(debe)
      + '. Spend here, up to your $' + c.techo + '.' + salida;
  }
  if (quedan === 2 && lonecesita) {
    return 'Two left in this ' + p.pos + ' tier. After them the drop is real, so this is the price, not a bargain.';
  }

  // 4. LA SALA SIN DINERO: la paciencia vale mas que cualquier puja
  if (read && read.inflacion <= 0.92 && !lonecesita) {
    return 'The room is broke and you do not need this spot. Sit on your $'
      + (AU.budgets[yo] || 0) + ' and let the next ones come cheap.';
  }

  // 5. PASADO DE PRECIO
  if (c.bid != null && c.bid >= c.techo && c.techo > 0) {
    return 'Past your number. Walking away here is the whole point of having one.';
  }

  return ''; // sin nada que aportar, silencio
}

/* ── quien me lo puede quitar ───────────────────────────────────────────────
 * auBotMax es el techo REAL de cada rival: su arquetipo, lo que le falta, su
 * dinero y la ley del presupuesto. Diez llamadas, O(1) cada una. */
function lvThreats(p) {
  var out = [];
  for (var s = 1; s <= MD.teams; s++) {
    if (s === MD.mySlot) continue;
    if ((AU.slotsLeft[s] || 0) <= 0) continue;
    var m = 0;
    try { m = auBotMax(s, p) || 0; } catch (_) { m = 0; }
    var sl = AU.slotsLeft[s];
    var cap = AU.budgets[s] - (sl - 1);
    out.push({ slot: s, name: lvSeatName(s), max: Math.min(Math.round(m), cap), cap: cap });
  }
  out.sort(function (a, b) { return b.max - a.max; });
  return out;
}

function lvSeatName(s) {
  if (typeof FZ26_SEATS !== 'undefined' && _mdFz26On() && FZ26_SEATS[s]) return FZ26_SEATS[s].name;
  if (s === MD.mySlot) return 'YOU';
  return (AU.bots[s] && AU.bots[s].name) || ('Team ' + s);
}

/* ── el tanteo de la sala ───────────────────────────────────────────────────
 * Lo que pidio el dueno: que mientras el va cantando resultados, la
 * herramienta vaya leyendo a la gente. Tres cosas por asiento, y ninguna es
 * una opinion:
 *  - dinero real: lo que puede pujar HOY sin quedarse sin roster
 *  - huecos titulares: lo que le obliga a comprar (via _auStarterGate)
 *  - desvio: lo que lleva pagado por encima o por debajo del valor de sala,
 *    que es su comportamiento en ESTE draft y no su arquetipo de fabrica */
function lvRead() {
  var filas = [];
  var vivos = 0, dinero = 0;
  for (var s = 1; s <= MD.teams; s++) {
    var sl = AU.slotsLeft[s] || 0;
    var bud = AU.budgets[s] || 0;
    var cap = sl > 0 ? bud - (sl - 1) : 0;
    var ros = MD.aiRosters[s] || {};
    var falta = [];
    try {
      var g = _auStarterGate(ros, sl);
      falta = g.positions || [];
    } catch (_) { }
    var gasto = 0, valor = 0;
    (AU.sold || []).forEach(function (v) {
      if (v.slot !== s) return;
      gasto += v.price; valor += v.value;
    });
    if (sl > 0) { vivos++; dinero += Math.max(0, bud - sl); }
    filas.push({
      slot: s, name: lvSeatName(s), me: s === MD.mySlot,
      bud: bud, sl: sl, cap: cap, falta: falta,
      desvio: gasto - valor, comprados: (AU.sold || []).filter(function (v) { return v.slot === s; }).length
    });
  }
  filas.sort(function (a, b) { return b.cap - a.cap; });

  // ── LA FASE DE LA SALA ────────────────────────────────────────────────────
  // Dato del dueno (2026-08-26): en su liga es el PRIMER auction de casi
  // todos. Los novatos fallan de una forma medible y siempre la misma: se
  // funden el presupuesto en los primeros lotes porque no tienen calibrado lo
  // que es caro, y llenan la segunda mitad del roster a $1. Contra eso no gana
  // quien puje mas fuerte, gana quien sepa CUANDO la sala se quedo sin dinero.
  // Esto no estima nada: compara el dinero que ya salio con los huecos que ya
  // se llenaron. Si el dinero va por delante, lo que viene sale barato.
  var totalDinero = MD.teams * MD.budget;
  var totalHuecos = MD.teams * MD.rounds;
  var huecosLlenos = totalHuecos;
  for (var s2 = 1; s2 <= MD.teams; s2++) huecosLlenos -= (AU.slotsLeft[s2] || 0);
  var dineroFuera = 0;
  (AU.sold || []).forEach(function (v) { dineroFuera += v.price; });
  var pctDinero = totalDinero ? dineroFuera / totalDinero : 0;
  var pctHuecos = totalHuecos ? huecosLlenos / totalHuecos : 0;
  // adelanto: cuanto se adelanta el gasto al llenado. >0 = la sala quema dinero
  var adelanto = pctDinero - pctHuecos;

  // cuantos rivales ya NO pueden pagar al mejor que queda en el board
  var mejor = 0, sinFondos = 0;
  try {
    MD.pool.forEach(function (pl) { var v = auValue(pl); if (v > mejor) mejor = v; });
    filas.forEach(function (f) { if (!f.me && f.sl > 0 && f.cap < mejor) sinFondos++; });
  } catch (_) { }

  return {
    filas: filas, vivos: vivos, dinero: dinero, inflacion: AU.inflation || 1,
    pctDinero: pctDinero, pctHuecos: pctHuecos, adelanto: adelanto,
    mejor: mejor, sinFondos: sinFondos, vendidos: (AU.sold || []).length
  };
}

/* La frase que sustituye al numero. Un "market 0.93" no cambia una decision;
 * "la sala se quedo sin dinero, espera" si. El umbral no es inventado: es la
 * misma inflacion que el motor usa para pujar, y el adelanto de gasto es
 * aritmetica de la sala, no un pronostico. */
function lvFase(r) {
  if (!r.vendidos) return { t: 'Nothing sold yet.', k: '' };
  var inf = r.inflacion;
  var adel = Math.round(r.adelanto * 100);
  if (inf <= 0.92) {
    return {
      k: 'cold',
      t: 'The room is running out of money. ' + (adel > 0 ? 'Spending is ' + adel + ' points ahead of roster spots filled. ' : '')
        + 'What comes next goes cheap, so let the board come to you.'
    };
  }
  if (inf >= 1.08) {
    return {
      k: 'hot',
      t: 'There is more money left than talent. Prices are about to spike, and money you sit on is money you hand back.'
    };
  }
  return {
    k: '',
    t: 'Market is tracking value' + (adel > 4 ? ', but spending is ' + adel + ' points ahead of spots filled' : '') + '.'
  };
}

/* ── entrar en modo Draft Day ──────────────────────────────────────────────
 * Reusa la ruta REAL de arranque de la sala (los mismos selects, el mismo
 * _startMockDraftRun), porque una segunda ruta de arranque es una segunda
 * verdad que se separa sola. Lo unico que cambia es AU.live, que hay que
 * poner ANTES: auStart termina llamando a auAdvance y el corte tiene que
 * estar puesto para entonces. */
async function lvEnter() {
  lvLoadPref(); lvLoadPanel();
  // la lista propia tiene que existir ANTES de valorar nada
  try { if (window.tmrHydrate) await window.tmrHydrate(); } catch (_) { }
  // el preset de SU liga: 10 equipos, $200, half PPR, 1QB, 15 rondas, subasta
  try { if (!_mdFz26On()) mdFantazy26Toggle(true); } catch (_) { }
  AU.live = 1;
  LV.on = true;
  await startMockDraft();
  lvBuildIndex();
  var n = lvMisValores();
  LV._nMine = n;
  lvPanel();
  return n;
}

function lvExit() {
  AU.live = 0; LV.on = false;
  var el = document.getElementById('lv-panel');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

/* ── aplicar lo que canta la sala ───────────────────────────────────────────
 * Una venta REAL. Se monta el lote y se deja que auSell haga su trabajo, que
 * ya actualiza presupuesto, huecos, roster, historial, inflacion y la nota de
 * la compra. Reimplementar eso aqui seria la segunda verdad otra vez. */
function lvSold(nameOrP, price, slot) {
  if (!AU.active) return { err: 'The room is not open.' };
  var p = (typeof nameOrP === 'string') ? lvOne(nameOrP) : nameOrP;
  if (!p) return { err: 'No player by that name is still on the board.' };
  price = parseInt(price, 10);
  if (!(price >= 1)) return { err: 'Price has to be a whole dollar amount.' };
  slot = parseInt(slot, 10);
  if (!(slot >= 1 && slot <= MD.teams)) return { err: 'Seat has to be 1 to ' + MD.teams + '.' };
  if ((AU.slotsLeft[slot] || 0) <= 0) return { err: lvSeatName(slot) + ' has a full roster.' };
  if (price > AU.budgets[slot]) return { err: lvSeatName(slot) + ' only has $' + AU.budgets[slot] + '.' };
  if (AU.stepT) clearTimeout(AU.stepT);
  AU.lot = { p: p, bid: price, holder: slot, going: 0, myMax: 0 };
  auSell();
  return { ok: true, p: p, price: price, slot: slot };
}

/* Quien esta en el bloque AHORA. No vende: solo abre el lote para que el
 * panel pinte el techo y las amenazas mientras la puja sube en Yahoo. */
function lvBlock(nameOrP) {
  if (!AU.active) return null;
  var p = (typeof nameOrP === 'string') ? lvOne(nameOrP) : nameOrP;
  if (!p) return null;
  if (AU.stepT) clearTimeout(AU.stepT);
  auOpenLot(MD.mySlot, p);   // el corte AU.live impide que arranque el reloj de pujas
  lvPanel();
  return p;
}

// app.js llama aqui al cerrar una venta en modo espejo
function lvAfterSale() {
  try { AU.inflation = auInflation(); } catch (_) { }
  lvPanel();
}

/* ── listas de preferencia pegadas ──────────────────────────────────────────
 * El dueno pega nombres, no marca doscientas casillas. Los que no se
 * reconocen se DEVUELVEN para pintarlos: un nombre tragado en silencio es un
 * jugador que el cree marcado y no lo esta, y eso se descubre pujando. */
function lvPrefPaste(kind, text) {
  if (!LV_KIND[kind] && kind !== 'normal') return { ok: 0, bad: [] };
  var nombres = String(text || '').split(/[\n,;]+/)
    .map(function (s) { return s.trim(); }).filter(Boolean);
  var ok = 0, bad = [];
  nombres.forEach(function (n) {
    var p = lvOne(n);
    if (!p) { bad.push(n); return; }
    if (kind === 'normal') delete LV.pref[p.id];
    else LV.pref[p.id] = kind;
    ok++;
  });
  LV.desconocidos = bad;
  lvSavePref();
  return { ok: ok, bad: bad };
}

function lvEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── el panel ───────────────────────────────────────────────────────────────
 * Flota sobre la sala en escritorio y es una hoja pegada abajo en el
 * telefono, con UN solo arbol de DOM: lo decide el CSS, igual que .rk-nums y
 * los dos ejes del perfil. Recuerda donde lo dejaste y si lo dejaste plegado. */
function lvPanel() {
  if (!LV.on) return;
  var el = document.getElementById('lv-panel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'lv-panel';
    el.className = 'lv-panel';
    document.body.appendChild(el);
    if (LV.panel.x != null) { el.style.left = LV.panel.x + 'px'; el.style.top = LV.panel.y + 'px'; el.style.right = 'auto'; }
  }
  el.classList.toggle('is-min', !!LV.panel.min);

  var lot = AU.lot;
  var c = lot ? lvCeiling(lot.p) : null;
  var th = lot ? lvThreats(lot.p) : [];
  var read = lvRead();
  var yo = read.filas.filter(function (f) { return f.me; })[0] || { bud: 0, sl: 0, cap: 0, falta: [] };

  var h = '';
  h += '<div class="lv-head" id="lv-drag">'
    + '<span class="lv-grip" aria-hidden="true"></span>'
    + '<b>Draft Day</b>'
    + '<span class="lv-money">$' + yo.bud + ' &middot; ' + yo.sl + ' spots &middot; max $' + yo.cap + '</span>'
    + '<button class="lv-x" onclick="lvToggleMin()" title="' + (LV.panel.min ? 'Expand' : 'Collapse') + '">' + (LV.panel.min ? '&#9650;' : '&#9660;') + '</button>'
    + '</div>';

  h += '<div class="lv-body">';

  // ── entrada rapida: una sola caja, porque el domingo no hay tiempo de
  //    buscar tres campos. "gibbs" pinta el techo mientras escribe; "gibbs 74 3"
  //    y Enter registra la venta.
  h += '<div class="lv-in-wrap">'
    + '<input id="lv-in" class="lv-in" autocomplete="off" spellcheck="false"'
    + ' placeholder="Type a name. Add price and seat to log a sale: gibbs 74 3"'
    + ' oninput="lvOnType(this.value)" onkeydown="if(event.key===\'Enter\')lvOnEnter(this)">'
    + '<div id="lv-hint" class="lv-hint"></div>'
    + '</div>';

  // ── el lote vivo
  if (lot && c) {
    var pr = lot.p;
    h += '<div class="lv-lot">';
    h += '<div class="lv-lot-top"><b>' + lvEsc(pr.name) + '</b>'
      + '<span class="lv-pos pos-' + pr.pos + '">' + pr.pos + '</span>'
      + '<span class="lv-team">' + lvEsc(pr.team || 'FA') + '</span></div>';
    h += '<div class="lv-num' + (c.ganga ? ' is-buy' : '') + '">$' + c.techo
      + '<span class="lv-why">your ceiling' + (c.necesita ? ' &middot; fills a starter' : '') + '</span></div>';
    // el precio sin emocion, solo cuando difiere: si no, seria ruido
    if (c.coste !== 0) {
      h += '<div class="lv-pure">Without your take: <b>$' + c.puro + '</b>'
        + '<i>' + (c.coste > 0 ? 'your read costs you $' + c.coste + ' of room here'
          : 'your read is paying $' + Math.abs(c.coste) + ' over') + '</i></div>';
    }
    if (c.ganga) {
      h += '<div class="lv-buy">At $' + c.bid + ' this is a buy'
        + (c.pref === 'avoid' || c.pref === 'meh' ? ' even though he is not your guy' : '')
        + ' &middot; worth $' + c.puro + ' and nobody left can outbid it</div>';
    }
    // el desglose: de donde sale cada parte del numero
    var partes = [];
    partes.push('market $' + c.mercado);
    if (c.mio != null) partes.push('your list #' + c.rank + ' = $' + c.mio);
    if (c.pref === 'love') partes.push('Love +' + Math.round(LV.loveP * 100) + '%');
    if (c.pref === 'meh') partes.push('Not so much -' + Math.round(LV.mehP * 100) + '%');
    if (c.resAct) partes.push('holding $' + c.resAct + ' back for later');
    if (c.resLib) partes.push('reserve released: ' + c.resLib);
    if (c.topeAlcanzado) partes.push('capped at $' + c.capRes);
    h += '<div class="lv-break">' + partes.join(' &middot; ') + '</div>';

    // EL CONSEJO. Va antes que las amenazas porque es lo que decide; las
    // amenazas son el respaldo del numero, no la decision.
    var adv = lvAdvice(pr, c, read);
    if (adv) h += '<div class="lv-adv">' + adv + '</div>';

    // quien te lo puede quitar: solo los que de verdad llegan
    var reales = th.filter(function (t) { return t.max >= Math.max(1, c.techo - 4); });
    if (!reales.length) {
      h += '<div class="lv-threat lv-clear">Nobody else reaches your number.</div>';
    } else {
      h += '<div class="lv-threat"><i>' + reales.length + (reales.length === 1 ? ' rival can go past you' : ' rivals can go past you') + '</i>'
        + reales.slice(0, 4).map(function (t) {
          return '<span>' + lvEsc(t.name) + ' <b>$' + t.max + '</b></span>';
        }).join('') + '</div>';
    }
    h += '</div>';
  } else {
    h += '<div class="lv-lot lv-empty">Nobody on the block. Type a name to see your number.</div>';
  }

  // ── el tanteo de la sala
  var fase = lvFase(read);
  h += '<div class="lv-room">'
    + '<div class="lv-room-h"><span>The room</span>'
    + '<i>' + read.vendidos + ' sold &middot; ' + Math.round(read.pctDinero * 100) + '% of the money gone</i></div>';
  if (fase.t) h += '<div class="lv-phase' + (fase.k ? ' is-' + fase.k : '') + '">' + fase.t + '</div>';
  // el numero que de verdad decide: cuantos rivales ya no alcanzan al mejor
  if (read.vendidos && read.sinFondos) {
    h += '<div class="lv-phase-sub">' + read.sinFondos + ' of your ' + (MD.teams - 1)
      + ' rivals can no longer afford the best player left ($' + read.mejor + ').</div>';
  }
  read.filas.forEach(function (f) {
    if (f.sl <= 0) return;
    var d = f.desvio;
    var dTxt = f.comprados ? (d > 0 ? '+$' + d : d < 0 ? '-$' + Math.abs(d) : '$0') : '';
    h += '<div class="lv-seat' + (f.me ? ' is-me' : '') + '">'
      + '<span class="lv-sn">' + f.slot + ' ' + lvEsc(f.name) + '</span>'
      + '<span class="lv-sc">$' + f.cap + '</span>'
      + '<span class="lv-ss">' + f.sl + '</span>'
      + '<span class="lv-sf">' + (f.falta.length ? f.falta.join(' ') : '&mdash;') + '</span>'
      + '<span class="lv-sd' + (d > 0 ? ' over' : d < 0 ? ' under' : '') + '">' + dTxt + '</span>'
      + '</div>';
  });
  h += '<div class="lv-room-f">seat &middot; max bid &middot; spots &middot; starters owed &middot; paid vs value</div>';
  h += '</div>';

  // ── las listas de gusto ──────────────────────────────────────────────────
  // Se pegan nombres, no se marcan doscientas casillas: el domingo no hay
  // tiempo para eso, y esto se prepara ANTES del draft. Cada grupo declara su
  // efecto en dolares, y ninguno veta a nadie.
  h += '<div class="lv-lists' + (LV.listasAbierto ? ' is-open' : '') + '">';
  h += '<button class="lv-lists-t" onclick="lvToggleLists()">Your lists'
    + '<i>' + Object.keys(LV.pref).length + ' tagged</i>'
    + '<span>' + (LV.listasAbierto ? '&#9650;' : '&#9660;') + '</span></button>';
  if (LV.listasAbierto) {
    [['love', '+' + Math.round(LV.loveP * 100) + '% on your ceiling'],
     ['meh', '-' + Math.round(LV.mehP * 100) + '%, still buys at a discount'],
     ['avoid', '-' + Math.round(LV.avoidP * 100) + '%, never a veto'],
     ['normal', 'clears any tag']].forEach(function (k) {
      h += '<div class="lv-list-row">'
        + '<label>' + (k[0] === 'normal' ? 'Normal' : LV_KIND[k[0]]) + '<i>' + k[1] + '</i></label>'
        + '<textarea id="lv-l-' + k[0] + '" rows="2" placeholder="Paste names, one per line or comma separated"></textarea>'
        + '<button onclick="lvApplyList(\'' + k[0] + '\')">Apply</button>'
        + '</div>';
    });
    h += '<div class="lv-res">'
      + '<label>Hold back for the middle rounds'
      + '<i>Comes off your ceiling early, and releases itself once the room is broke or you are down to 4 spots</i></label>'
      + '<input id="lv-res-in" type="number" min="0" max="' + (MD.budget - 1) + '" value="' + LV.reserva + '"'
      + ' oninput="lvSetReserva(this.value)"> <span>of $' + MD.budget + '</span>'
      + '</div>';
    h += '<div id="lv-list-msg" class="lv-list-msg"></div>';
    h += '<div class="lv-list-foot">Nothing here removes a player from the board. '
      + 'A guy you dislike at the right price is still the right buy, so the panel keeps '
      + 'showing his clean number next to yours.</div>';
  }
  h += '</div>';

  h += '</div>'; // lv-body
  el.innerHTML = h;
  lvWireDrag(el);
}

function lvToggleMin() { LV.panel.min = !LV.panel.min; lvSavePanel(); lvPanel(); }
function lvToggleLists() { LV.listasAbierto = !LV.listasAbierto; lvPanel(); }
function lvSetReserva(v) {
  var n = parseInt(v, 10);
  LV.reserva = (n >= 0) ? Math.min(n, MD.budget - 1) : 0;
  lvSavePref();
  // repinta solo el lote, no el cajon: repintar el panel entero mientras se
  // teclea en su propio input le roba el foco al usuario a cada digito
  var lot = AU.lot;
  if (!lot) return;
  var c = lvCeiling(lot.p);
  var n2 = document.querySelector('.lv-num');
  if (n2) n2.firstChild.nodeValue = '$' + c.techo;
}

/* Aplica una lista pegada. Los nombres que no se reconocen se PINTAN: un
 * nombre tragado en silencio es un jugador que el dueno cree marcado y no lo
 * esta, y eso solo se descubre pujando, que es el peor momento posible. */
function lvApplyList(kind) {
  var ta = document.getElementById('lv-l-' + kind);
  if (!ta) return;
  var r = lvPrefPaste(kind, ta.value);
  ta.value = '';
  lvPanel();
  var m = document.getElementById('lv-list-msg');
  if (!m) return;
  var txt = '<b>' + r.ok + '</b> tagged as ' + (kind === 'normal' ? 'Normal' : LV_KIND[kind]);
  if (r.bad.length) {
    txt += '<span class="lv-bad">Not found, so NOT tagged: ' + r.bad.map(lvEsc).join(', ') + '</span>';
  }
  m.innerHTML = txt;
}

/* Arrastre por la cabecera. Pointer events (no mouse) para que funcione igual
 * con el dedo, y solo en escritorio: en el telefono el panel es una hoja
 * pegada abajo y moverla no significa nada. */
function lvWireDrag(el) {
  var h = el.querySelector('#lv-drag');
  if (!h || h._wired) return;
  h._wired = 1;
  h.addEventListener('pointerdown', function (e) {
    if (window.innerWidth <= 700) return;
    if (e.target.closest('button')) return;
    var r = el.getBoundingClientRect();
    var dx = e.clientX - r.left, dy = e.clientY - r.top;
    var move = function (ev) {
      var x = Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx));
      var y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy));
      el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto';
      LV.panel.x = x; LV.panel.y = y;
    };
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      lvSavePanel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  });
}

/* ── la caja de entrada ─────────────────────────────────────────────────────
 * Mientras escribe el nombre, el numero ya esta en pantalla: ese es el
 * "reaction time" que pidio. No hay debounce a proposito - la busqueda sale de
 * un indice cacheado y el repintado es de un panel, no del board. */
function lvOnType(v) {
  var hint = document.getElementById('lv-hint');
  if (!hint) return;
  var m = String(v || '').trim().match(/^(.*?)\s+(\d+)(?:\s+(\d+))?$/);
  var q = m ? m[1] : v;
  var cand = lvFind(q);
  if (!cand.length) { hint.innerHTML = q.trim() ? '<i>no match</i>' : ''; return; }
  var p = cand[0];
  var c = lvCeiling(p);
  var extra = '';
  if (m && m[2]) {
    var price = parseInt(m[2], 10);
    var seat = m[3] ? parseInt(m[3], 10) : null;
    extra = ' &rarr; log <b>$' + price + '</b>' + (seat ? ' to ' + lvEsc(lvSeatName(seat)) : ' <i>(add seat)</i>');
  }
  hint.innerHTML = '<b>' + lvEsc(p.name) + '</b> ' + p.pos
    + ' &middot; ceiling <b>$' + c.techo + '</b>'
    + (c.rank ? ' &middot; your #' + c.rank : '')
    + (c.pref ? ' &middot; ' + LV_KIND[c.pref] : '')
    + extra
    + '<span class="lv-ms">' + LV.lastMs.toFixed(1) + 'ms</span>';
}

function lvOnEnter(input) {
  var v = String(input.value || '').trim();
  var m = v.match(/^(.*?)\s+(\d+)\s+(\d+)$/);
  var hint = document.getElementById('lv-hint');
  if (!m) {
    // sin precio ni asiento: es una nominacion, ponlo en el bloque
    var p = lvOne(v);
    if (!p) { if (hint) hint.innerHTML = '<i>no match</i>'; return; }
    lvBlock(p);
    input.value = '';
    return;
  }
  var r = lvSold(m[1], m[2], m[3]);
  if (r.err) { if (hint) hint.innerHTML = '<i class="lv-err">' + lvEsc(r.err) + '</i>'; return; }
  input.value = '';
  if (hint) hint.innerHTML = '<i class="lv-ok">' + lvEsc(r.p.name) + ' &rarr; ' + lvEsc(lvSeatName(r.slot)) + ' $' + r.price + '</i>';
}

/* ── puentes ────────────────────────────────────────────────────────────── */
if (typeof window !== 'undefined') {
  window.LV = LV;
  window.lvEnter = lvEnter;
  window.lvExit = lvExit;
  window.lvSold = lvSold;
  window.lvBlock = lvBlock;
  window.lvPanel = lvPanel;
  window.lvAfterSale = lvAfterSale;
  window.lvPrefPaste = lvPrefPaste;
  window.lvOnType = lvOnType;
  window.lvOnEnter = lvOnEnter;
  window.lvToggleMin = lvToggleMin;
  window.lvToggleLists = lvToggleLists;
  window.lvSetReserva = lvSetReserva;
  window.lvApplyList = lvApplyList;
  window.lvRead = lvRead;
  window.lvFase = lvFase;
  window.lvAdvice = lvAdvice;
  window.lvCeiling = lvCeiling;
  window.lvThreats = lvThreats;
  window.lvFind = lvFind;
  window.lvMisValores = lvMisValores;
  window.lvBuildIndex = lvBuildIndex;
}
