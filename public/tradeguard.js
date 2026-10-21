// TRADE GUARD (2026-10-21). Pedido del dueno, comisionado de Miami Boys Choir:
// "para que no hayan trades muy incomparados en mi liga... basado en records,
// equipos, league format". Detecta trades descompensados ANTES de que pasen
// (analizador) y revisa los que ya pasaron (tab League Trades).
//
// Dos capas, a proposito:
//   - tgEvaluate(ctx, trade): PURA. Sin DOM, sin fetch, sin Math.random. Todo
//     lo que necesita llega en ctx, y por eso scripts/qa-tradeguard.mjs la corre
//     en un vm contra el fixture real de la liga.
//   - tgPaintAnalyzer / tgLeagueBlock: pintan, y arman el ctx desde el estado
//     de app.js (leagueRosters, ktcById, window._leagueInfo...).
//
// El guard NO toca tradeScore ni su veredicto: es una lectura aparte, para el
// comisionado, y no mueve el score (qa-trades vigila simetria y monotonia).
//
// Nunca se pintan numeros crudos del proveedor: porcentajes, palabras y records.
'use strict';

// Bandas de la brecha relativa al tamaño del paquete: |in-out| / max(in,out).
// Ajuste del 2026-10-21 (segunda opinion de Codex, aplicada por el principal):
// la brecha sola llega como mucho a 'lopsided'. 'flag' se reserva al patron de
// dumping de un equipo ELIMINADO; mas de 50% de brecha se dice con palabras,
// pero un mal trade entre dos equipos vivos no es caso de comisionado.
var TG_LEVELS = ['even', 'lean', 'lopsided', 'flag'];
var TG_BAND_LEAN = 0.15, TG_BAND_LOPSIDED = 0.30, TG_BAND_HALF = 0.50;
// Que posiciones llena cada casilla de titular. K, DEF, BN e IDP quedan fuera:
// el valor de mercado no los precia y no deciden un trade de comisionado.
var TG_SLOT_ELIG = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
  WRT_FLEX: ['WR', 'RB', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE']
};
// Una alineacion "empeora" si pierde mas de esto de su valor titular. Con
// menos, un cambio de dos jugadores parejos ya contaria como golpe.
var TG_LINEUP_DROP = 0.03;
// Joven para keeper y para rebuild de dynasty; veterano para el mismo rebuild.
var TG_YOUNG_AGE = 24, TG_YOUNG_EXP = 2, TG_VET_AGE = 27, TG_KEEPER_SHARE = 0.25;
// Quien no juega esta semana no es titular usable (mismo criterio que
// ML_NO_JUEGA en myleagues.js: Sleeper y Yahoo). Questionable si juega.
var TG_NO_JUEGA = { Out: 1, IR: 1, PUP: 1, Sus: 1, SUSP: 1, NA: 1, COV: 1, DNR: 1, Doubtful: 1, O: 1, D: 1 };

function _tgNum(v) { v = Number(v); return isFinite(v) ? v : 0; }
function _tgOrd(n) {
  var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function _tgPlural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
// "Alanta Falcons'" y no "Alanta Falcons's".
function _tgPos(name) { return name + (/s$/i.test(name) ? '\'' : '\'s'); }

// El mejor once por valor con las casillas de la liga. Codicioso: primero las
// casillas fijas (QB/RB/WR/TE), luego las flex de la mas estrecha a la mas
// ancha. Con casillas anidadas asi, el codicioso da el optimo. Devuelve
// tambien cada casilla con quien la ocupa (o null si quedo vacia): eso dice
// donde hay un hueco de verdad.
function tgBestLineup(ids, slots, valueOf, posOf, noJuega) {
  var pool = [];
  (ids || []).forEach(function (id) {
    var pos = posOf(id), v = valueOf(id);
    if (noJuega && noJuega(id)) return;
    if (pos && v != null && v > 0) pool.push({ id: String(id), pos: pos, v: v });
  });
  pool.sort(function (a, b) { return b.v - a.v || (a.id < b.id ? -1 : 1); });
  var fijas = [], flex = [];
  (slots || []).forEach(function (s) {
    if (!TG_SLOT_ELIG[s]) return;
    if (TG_SLOT_ELIG[s].length === 1) fijas.push(s); else flex.push(s);
  });
  flex.sort(function (a, b) { return TG_SLOT_ELIG[a].length - TG_SLOT_ELIG[b].length; });
  var usado = {}, total = 0, starters = [], casillas = [];
  fijas.concat(flex).forEach(function (s) {
    var el = TG_SLOT_ELIG[s];
    for (var i = 0; i < pool.length; i++) {
      var p = pool[i];
      if (usado[p.id] || el.indexOf(p.pos) < 0) continue;
      usado[p.id] = 1; total += p.v; starters.push(p.id);
      casillas.push({ slot: s, id: p.id, v: p.v });
      return;
    }
    casillas.push({ slot: s, id: null, v: 0 });
  });
  return { total: total, starters: starters, slots: casillas };
}

// El piso de lo "material": la mediana del valor de los titulares de la liga
// (el mejor once de cada equipo, todos juntos). Una brecha por debajo de un
// titular tipico no le cambia la temporada a nadie.
function tgStarterFloor(rosters, slots, valueOf, posOf) {
  var vs = [];
  (rosters || []).forEach(function (r) {
    tgBestLineup((r.players || []).map(String), slots, valueOf, posOf).slots.forEach(function (c) { if (c.id) vs.push(c.v); });
  });
  if (!vs.length) return 0;
  vs.sort(function (a, b) { return a - b; });
  var m = Math.floor(vs.length / 2);
  return vs.length % 2 ? vs[m] : (vs[m - 1] + vs[m]) / 2;
}

// Tabla y carrera. Orden por victorias (empate vale medio) y luego puntos a
// favor. La linea de playoffs es el equipo en la plaza playoff_teams.
//   remaining = playoff_week_start - week: semanas de temporada regular que
//     faltan, la actual incluida (en la semana N se han jugado N-1).
//   out: eliminacion practica, wins + remaining < lineWins
//   long_shot: a mas juegos de la linea que la mitad de lo que queda
//   bubble: a 1 juego o mas de la linea (tipicamente 1 o 2)
//   contender: dentro, o a menos de 1 juego
// Sin partidos jugados todos estan vivos.
function tgStandings(rosters, settings, week) {
  settings = settings || {};
  var rows = (rosters || []).map(function (r) {
    var st = r.settings || {};
    var w = _tgNum(st.wins), l = _tgNum(st.losses), t = _tgNum(st.ties);
    return { rid: r.roster_id, w: w, l: l, t: t, g: w + l + t,
      fp: _tgNum(st.fpts) + _tgNum(st.fpts_decimal) / 100 };
  });
  rows.sort(function (a, b) {
    return (b.w + b.t / 2) - (a.w + a.t / 2) || b.fp - a.fp || (a.rid < b.rid ? -1 : 1);
  });
  var n = rows.length;
  var pt = _tgNum(settings.playoff_teams);
  pt = pt > 0 ? Math.min(n, pt) : Math.max(1, Math.floor(n / 2));
  var jugados = rows.reduce(function (m, r) { return Math.max(m, r.g); }, 0);
  var pws = _tgNum(settings.playoff_week_start);
  var quedan = pws > 1 && week > 0 ? Math.max(0, pws - week) : null;
  var linea = rows[pt - 1] || null;
  var out = {};
  rows.forEach(function (r, i) {
    var gb = 0;
    if (linea && i >= pt) gb = ((linea.w - r.w) + (r.l - linea.l) + (linea.t - r.t) / 2) / 2;
    gb = Math.max(0, gb);
    var status = 'contender';
    if (jugados > 0 && i >= pt && gb >= 1) {
      if (quedan != null && linea && r.w + r.t / 2 + quedan < linea.w + linea.t / 2) status = 'out';
      else if (quedan != null && gb > quedan / 2) status = 'long_shot';
      else status = 'bubble';
    }
    out[r.rid] = {
      standing: i + 1, gb: gb, status: status, games: r.g,
      record: r.w + '-' + r.l + (r.t ? '-' + r.t : '')
    };
  });
  return { byRid: out, playoffTeams: pt, teams: n, played: jugados, left: quedan,
    lineWins: linea ? linea.w : null };
}

// Los hechos de la liga que un comisionado quiere a la vista. Solo lo que la
// liga trae: lo que falta no se rellena.
function tgFacts(league, week) {
  var S = (league && league.settings) || {};
  var n = _tgNum(league && league.total_rosters) || 0;
  var f = { lines: [] };
  var type = _tgNum(S.type), mk = _tgNum(S.max_keepers);
  f.format = type === 2 ? 'Dynasty' : type === 1 ? 'Keeper' :
    ('Redraft' + (mk > 0 ? ', ' + _tgPlural(mk, 'keeper') : ''));
  f.lines.push(f.format);
  var td = _tgNum(S.trade_deadline);
  if (td > 0 && td < 19 && week > 0) {
    var left = td - week;
    f.deadline = left > 0 ? 'Trade deadline week ' + td + ' (' + _tgPlural(left, 'week') + ' left)'
      : left === 0 ? 'Trade deadline is this week (week ' + td + ')'
      : 'Trade deadline passed (week ' + td + ')';
    f.lines.push(f.deadline);
  } else if (td >= 19) {
    f.deadline = 'No trade deadline'; f.lines.push(f.deadline);
  }
  var veto = _tgNum(S.veto_votes_needed);
  if (veto > 0) {
    var rd = S.trade_review_days != null ? _tgNum(S.trade_review_days) : null;
    f.veto = 'Veto needs ' + veto + (n ? ' of ' + n : '') + ' votes' +
      (rd != null ? ', ' + rd + '-day review' : '');
    f.lines.push(f.veto);
  }
  var pt = _tgNum(S.playoff_teams), pws = _tgNum(S.playoff_week_start);
  if (pt > 0) {
    f.playoffs = 'Playoffs: ' + pt + (n ? ' of ' + n : '') + ' teams' + (pws > 0 ? ', from week ' + pws : '');
    f.lines.push(f.playoffs);
  }
  return f;
}

// ctx: {league:{type?,settings,scoring_settings,roster_positions,total_rosters},
//       week, rosters, valueOf(id)->num|null, posOf(id), ageOf?(id), expOf?(id),
//       injuryOf?(id), byeOf?(id), playerName?(id), pickValue?(pick)->num|null,
//       faabValue?(dollars)->num|null, nameOf(rosterId)}
// trade: {sides:[{rosterId, gives:[ids], givesPicks:[{season,round,label}],
//         givesFaab:n}, {...}], completed?:bool}
//   completed=true: los rosters de ctx YA son los de despues del trade, y se
//   reconstruye el antes (se quita lo recibido, se devuelve lo enviado).
function tgEvaluate(ctx, trade) {
  ctx = ctx || {};
  var league = ctx.league || {};
  var S = league.settings || {};
  var week = _tgNum(ctx.week);
  var type = _tgNum(S.type != null ? S.type : league.type);
  var dynasty = type === 2;
  var keepers = type === 1 ? Math.max(1, _tgNum(S.max_keepers)) : _tgNum(S.max_keepers);
  var valueOf = ctx.valueOf || function () { return null; };
  var posOf = ctx.posOf || function () { return null; };
  var ageOf = ctx.ageOf || function () { return null; };
  var expOf = ctx.expOf || function () { return null; };
  var injuryOf = ctx.injuryOf || function () { return null; };
  var noJuega = function (id) { var s = injuryOf(id); return !!(s && TG_NO_JUEGA[s]); };
  var pname = ctx.playerName || function (id) { return String(id); };
  var nameOf = ctx.nameOf || function (rid) { return 'Team ' + rid; };
  var slots = league.roster_positions || [];

  var res = { level: 'unknown', favors: null, gapPct: null, reasons: [],
    facts: tgFacts(league, week), sides: [] };
  // Byes: solo si el dato existe (ctx.byeOf). Si no, se declara, no se inventa.
  if (!ctx.byeOf) res.facts.lines.push('Bye weeks not counted');
  var sides = (trade && trade.sides) || [];
  if (sides.length !== 2) {
    res.reasons.push('Trade Guard grades two-team trades only.');
    return res;
  }
  var tabla = tgStandings(ctx.rosters || [], S, week);
  if (trade.completed) res.facts.lines.push('Standings are today\'s, not the day of the trade');
  var rosterDe = {};
  (ctx.rosters || []).forEach(function (r) { rosterDe[r.roster_id] = r; });

  // Lo que manda cada lado, preciado. Lo que no tiene precio se junta y se
  // declara: un nivel sobre un paquete a medio preciar seria inventado.
  var faltan = [];
  var lados = sides.map(function (s) {
    var gives = (s.gives || []).map(String);
    var picks = s.givesPicks || [];
    var faab = _tgNum(s.givesFaab);
    var out = 0, top = null;
    gives.forEach(function (id) {
      var v = valueOf(id);
      if (v == null) { faltan.push(pname(id)); return; }
      out += v;
      if (!top || v > top.v) top = { id: id, v: v };
    });
    picks.forEach(function (pk) {
      var v = ctx.pickValue ? ctx.pickValue(pk) : null;
      if (v == null) { faltan.push(pk.label || (pk.season + ' round ' + pk.round)); return; }
      out += v;
    });
    if (faab > 0) {
      var fv = ctx.faabValue ? ctx.faabValue(faab) : null;
      if (fv == null) faltan.push('$' + faab + ' FAAB'); else out += fv;
    }
    var st = tabla.byRid[s.rosterId] || { standing: null, status: 'contender', record: '', gb: 0 };
    return { rosterId: s.rosterId, name: nameOf(s.rosterId), gives: gives, picks: picks,
      faab: faab, out: out, top: top, st: st };
  });
  var A = lados[0], B = lados[1];
  A.inn = B.out; B.inn = A.out;
  var floor = tgStarterFloor(ctx.rosters || [], slots, valueOf, posOf);

  // Alineacion titular antes y despues, por lado. Un lesionado no cuenta.
  lados.forEach(function (L, i) {
    var O = lados[1 - i];
    var r = rosterDe[L.rosterId] || { players: [] };
    var ahora = (r.players || []).map(String);
    var antes;
    if (trade.completed) {
      antes = ahora.filter(function (id) { return O.gives.indexOf(id) < 0; });
      L.gives.forEach(function (id) { if (antes.indexOf(id) < 0) antes.push(id); });
    } else {
      antes = ahora.slice();
      L.gives.forEach(function (id) { if (antes.indexOf(id) < 0) antes.push(id); });
    }
    var despues = antes.filter(function (id) { return L.gives.indexOf(id) < 0; }).concat(O.gives);
    var b = tgBestLineup(antes, slots, valueOf, posOf, noJuega);
    var a = tgBestLineup(despues, slots, valueOf, posOf, noJuega);
    L.lineupDelta = a.total - b.total;
    L.lineupDeltaPct = b.total > 0 ? L.lineupDelta / b.total : null;
    L.recibeTitular = O.gives.some(function (id) { return a.starters.indexOf(id) >= 0; });
    L.recibePicks = O.picks.length > 0;
    L.recibeFaab = O.faab > 0;
    L.jovenes = O.gives.filter(function (id) {
      var g = ageOf(id), x = expOf(id);
      return (g != null && g <= TG_YOUNG_AGE) || (x != null && x <= TG_YOUNG_EXP);
    });
    // Pieza de keeper: joven (24 o menos, o 2 temporadas o menos) Y con valor
    // de verdad (un cuarto o mas de lo que ese lado manda). Un relleno joven
    // no compensa a nadie, y por eso "barato" no basta: sin el costo de keeper
    // de la liga, barato en valor seria cualquier relleno.
    L.keeperPieza = keepers > 0 ? (L.jovenes.filter(function (id) {
      var v = valueOf(id); return v != null && L.out > 0 && v >= L.out * TG_KEEPER_SHARE;
    })[0] || null) : null;
    // Hueco posicional real: lo que recibe entra al once en una casilla fija de
    // su posicion que antes estaba vacia o cubierta por menos de medio titular
    // tipico de la liga.
    L.hueco = null;
    O.gives.forEach(function (id) {
      if (L.hueco || a.starters.indexOf(id) < 0) return;
      var p = posOf(id);
      var flojo = b.slots.some(function (c) { return c.slot === p && (!c.id || c.v < floor * 0.5); });
      if (flojo) L.hueco = { id: id, pos: p };
    });
    // Su jugador mas valioso antes del trade (para "manda su mejor valor").
    var mejor = antes.map(function (id) { return { id: id, v: valueOf(id) }; })
      .filter(function (x) { return x.v != null; })
      .sort(function (x, y) { return y.v - x.v; });
    L.rankTop = L.top ? mejor.map(function (x) { return x.id; }).indexOf(L.top.id) : -1;
  });

  res.sides = lados.map(function (L) {
    return { rosterId: L.rosterId, name: L.name, record: L.st.record, standing: L.st.standing,
      status: L.st.status, gamesBack: L.st.gb, valueOut: L.out, valueIn: L.inn,
      lineupDelta: L.lineupDelta, lineupDeltaPct: L.lineupDeltaPct };
  });

  if (faltan.length) {
    res.reasons.push('No market price for ' + faltan.slice(0, 3).join(', ') +
      (faltan.length > 3 ? ' and ' + (faltan.length - 3) + ' more' : '') +
      ', so Trade Guard will not grade this trade.');
    return res;
  }
  var maxv = Math.max(A.out, B.out);
  if (!(maxv > 0)) {
    res.reasons.push('Neither side has a market price, so Trade Guard will not grade this trade.');
    return res;
  }

  // 1. La brecha de valor: porcentaje Y piso absoluto.
  var gapAbs = Math.abs(A.out - B.out);
  var gap = gapAbs / maxv;
  var material = gapAbs >= floor;
  res.gapPct = Math.round(gap * 1000) / 10;
  var idx = gap < TG_BAND_LEAN ? 0 : gap < TG_BAND_LOPSIDED ? 1 : 2;
  var gana = null, pierde = null;
  if (idx > 0) { gana = A.inn > A.out ? A : B; pierde = gana === A ? B : A; }
  var vuelta = pierde ? Math.round(pierde.inn / pierde.out * 100) : null;
  var motivos = [];
  if (idx === 0) motivos.push({ p: 1, t: 'Both sides send close to the same value.' });
  else if (gap > TG_BAND_HALF) motivos.push({ p: 2, t: pierde.name + ' gets back less than half of the value it sends (' + vuelta + '%).' });
  else motivos.push({ p: 1, t: pierde.name + ' gets back ' + vuelta + '% of the value it sends.' });

  // 2. La alineacion titular. Un lado cuyo once empeora y que no recibe nada
  // usable (ni un titular sano, ni picks en dynasty, ni un keeper) sube un
  // escalon, hasta 'lopsided'.
  var golpeado = null;
  lados.forEach(function (L) {
    if (golpeado) return;
    var empeora = L.lineupDeltaPct != null && L.lineupDeltaPct < -TG_LINEUP_DROP;
    var usable = L.recibeTitular || (dynasty && L.recibePicks) || !!L.keeperPieza;
    if (empeora && !usable) golpeado = L;
  });
  if (golpeado) {
    idx = Math.min(2, idx + 1);
    if (!gana) { pierde = golpeado; gana = golpeado === A ? B : A; }
    motivos.push({ p: 3, t: _tgPos(golpeado.name) + ' starting lineup gets weaker and nothing coming back starts.' });
  }
  // Los lesionados del trade: su valor en papel no son puntos esta semana.
  var heridos = lados.reduce(function (acc, L) { return acc.concat(L.gives.filter(noJuega)); }, []);
  heridos.slice(0, 2).forEach(function (id) {
    motivos.push({ p: 2, t: pname(id) + ' is out (' + injuryOf(id) + '), his value on paper is not points this week.' });
  });

  // 3. La carrera (records). El patron de dumping: un equipo ELIMINADO manda su
  // mayor valor a un contender por menos, y lo que recibe no lo explica.
  var dump = false;
  if (gana && pierde && material && gap >= TG_BAND_LOPSIDED && gana.st.status === 'contender' &&
      (pierde.st.status === 'out' || pierde.st.status === 'long_shot') && pierde.rankTop >= 0 && pierde.rankTop <= 1) {
    var veteranos = pierde.gives.filter(function (id) { var g = ageOf(id); return g != null && g >= TG_VET_AGE; });
    var rebuild = dynasty && (pierde.recibePicks || pierde.jovenes.length > 0) && veteranos.length > 0;
    var que = pierde.rankTop === 0 ? 'its best value' : 'one of its two best players';
    if (rebuild) {
      motivos.push({ p: 4, t: pierde.name + ' is rebuilding and takes picks or youth for veterans. That is a normal dynasty sell, not a dump.' });
    } else if (pierde.keeperPieza && !dynasty) {
      motivos.push({ p: 4, t: pname(pierde.keeperPieza) + ' fits as a keeper for ' + pierde.name + ', which explains the trade. Not a dump.' });
    } else if (pierde.recibeFaab) {
      motivos.push({ p: 4, t: pierde.name + ' takes FAAB back, which explains part of the trade. Not a dump.' });
    } else if (pierde.hueco) {
      motivos.push({ p: 4, t: pname(pierde.hueco.id) + ' fills a real hole at ' + pierde.hueco.pos + ' for ' + pierde.name + '. Not a dump.' });
    } else if (pierde.st.status === 'long_shot') {
      motivos.push({ p: 5, t: 'A long shot is sending present value to a contender. Worth a look, not a veto.' });
      idx = Math.max(idx, 2);
    } else {
      dump = true;
      motivos.push({ p: 5, t: 'A team out of the race is sending ' + que + ' to a contender for less. That is the dumping pattern a commissioner should look at.' });
      idx = 3;
    }
  }
  // Entre dos contenders una brecha grande es un mal trade, no colusion.
  if (!dump && gana && A.st.status === 'contender' && B.st.status === 'contender' && idx >= 2) {
    motivos.push({ p: 4, t: 'Both teams are in the playoff race, so this reads as a bad trade, not a dump.' });
  }
  // El piso: una brecha que no llega a un titular tipico no pasa de 'lean'.
  if (!material && idx > 1) {
    idx = 1;
    motivos.push({ p: 6, t: 'The gap is real but small: less than one typical starter.' });
  } else if (!material && idx === 1) {
    motivos.push({ p: 0, t: 'The gap is real but small: less than one typical starter.' });
  }

  // 4. Formato: keeper (peso chico, solo texto), y solo para el lado que
  // recibe menos: es la unica lectura que puede explicar su lado del trade.
  if (!dynasty && keepers > 0 && pierde && pierde.keeperPieza && !dump && !motivos.some(function (m) { return /fits as a keeper/.test(m.t); })) {
    motivos.push({ p: 0, t: 'Keeper league: ' + pname(pierde.keeperPieza) + ' could be worth more to ' + pierde.name + ' next year.' });
  }

  res.level = TG_LEVELS[idx];
  res.favors = idx > 0 && gana ? gana.rosterId : null;
  motivos.sort(function (x, y) { return y.p - x.p; });
  res.reasons = motivos.map(function (m) { return m.t; });
  res.facts.floor = floor;
  res.facts.standings = { playoffTeams: tabla.playoffTeams, teams: tabla.teams, played: tabla.played, left: tabla.left, lineWins: tabla.lineWins };
  return res;
}

// ─── Lo que pinta (navegador) ────────────────────────────────────────────────

var TG_LABEL = { even: 'Even', lean: 'Lean', lopsided: 'Lopsided', flag: 'Flag', unknown: 'Not graded' };
var TG_STATUS = { contender: 'in the race', bubble: 'on the bubble', long_shot: 'a long shot', out: 'out of the race' };
// El guard da un nivel de riesgo con sus razones; decidir es del comisionado.
var TG_REVIEW = 'for commissioner review';

function _tgEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// El ctx sale del estado de app.js. valueOf devuelve null (no 0) cuando el
// mercado no tiene precio: el guard lo declara en vez de tratarlo como gratis.
function tgCtxFromApp() {
  var info = window._leagueInfo || {};
  var lf = (typeof leagueFormat !== 'undefined' && leagueFormat) || {};
  var league = {
    settings: info.settings || {},
    scoring_settings: info.scoring_settings || {},
    roster_positions: info.roster_positions || lf.rosterPositions || [],
    total_rosters: info.total_rosters || lf.totalTeams || (leagueRosters || []).length
  };
  var porNombre = {};
  return {
    league: league,
    week: (typeof NFL_WEEK === 'number' && NFL_WEEK > 0) ? NFL_WEEK : 0,
    rosters: leagueRosters || [],
    valueOf: function (id) {
      id = String(id);
      if (id.indexOf('nm:') === 0) {
        var n = id.slice(3);
        if (porNombre[n] === undefined) { var v0 = getKtcValue(n); porNombre[n] = v0 > 0 ? v0 : null; }
        return porNombre[n];
      }
      var v = ktcById[id];
      return v > 0 ? v : null;
    },
    posOf: function (id) { var p = allPlayers[String(id)]; return p ? p.pos : null; },
    ageOf: function (id) { var p = allPlayers[String(id)]; return p && p.age ? Number(p.age) : null; },
    expOf: function (id) { var p = allPlayers[String(id)]; return p && p.exp != null ? Number(p.exp) : null; },
    injuryOf: function (id) { var p = allPlayers[String(id)]; return p ? (p.inj || null) : null; },
    playerName: function (id) {
      id = String(id);
      if (id.indexOf('nm:') === 0) return id.slice(3);
      var p = allPlayers[id]; return p ? p.name : 'one player';
    },
    pickValue: function (pk) {
      var v = getKtcValue(pk.label || (pk.season + ' Round ' + pk.round));
      return typeof v === 'number' ? v : null;
    },
    faabValue: function (d) {
      try { if (!tmFaabCtx()) return null; return tmFaabValue(d); } catch (_) { return null; }
    },
    nameOf: function (rid) { try { return getRosterName(rid); } catch (_) { return 'Team ' + rid; } }
  };
}

function _tgSideHtml(s) {
  var bits = [];
  if (s.record) bits.push(s.record);
  if (s.standing) bits.push(_tgOrd(s.standing));
  bits.push(TG_STATUS[s.status] || '');
  return "<div class='tg-side'><div class='tg-side-name'>" + _tgEsc(s.name) + "</div>" +
    "<div class='tg-side-meta'>" + _tgEsc(bits.filter(Boolean).join(' · ')) + "</div></div>";
}

function tgChipHtml(r) {
  return "<span class='tg-chip tg-lv-" + r.level + "' title='Risk level " + TG_REVIEW + "'>" + TG_LABEL[r.level] + "</span>";
}

function tgFavorsText(r) {
  if (!r.favors) return r.level === 'even' ? 'Fair to both sides' : '';
  var s = (r.sides || []).filter(function (x) { return x.rosterId === r.favors; })[0];
  return s ? 'Favors ' + s.name : '';
}

// El cuerpo que explica: 1 a 3 razones, los dos lados con record y puesto, y
// los hechos de la liga.
function tgBodyHtml(r, conHechos) {
  var h = "<ul class='tg-reasons'>";
  (r.reasons || []).slice(0, 3).forEach(function (t) { h += '<li>' + _tgEsc(t) + '</li>'; });
  h += '</ul>';
  if (r.sides && r.sides.length === 2 && r.sides[0].name) {
    h += "<div class='tg-sides'>" + _tgSideHtml(r.sides[0]) + _tgSideHtml(r.sides[1]) + '</div>';
  }
  if (conHechos && r.facts && r.facts.lines && r.facts.lines.length) {
    h += "<div class='tg-facts'>" + _tgEsc(r.facts.lines.join(' · ')) + '</div>';
  }
  return h;
}

// Lo que el analizador tiene en pantalla, convertido en trade del guard.
function _tgSideFromInputs(sel, rid) {
  var side = { rosterId: rid, gives: [], givesPicks: [], givesFaab: 0 };
  document.querySelectorAll(sel + ' input').forEach(function (i) {
    var v = String(i.value || '').trim();
    if (!v) return;
    var fm = v.match(/^\$(\d{1,5})\s*FAAB$/i);
    if (fm) { side.givesFaab += parseInt(fm[1], 10); return; }
    var pm = v.match(/^(\d{4})\s+round\s+(\d{1,2})/i);
    if (pm) { side.givesPicks.push({ season: pm[1], round: parseInt(pm[2], 10), label: v }); return; }
    side.gives.push(i.dataset && i.dataset.playerId ? String(i.dataset.playerId) : 'nm:' + v);
  });
  return side;
}

function tgPaintAnalyzer() {
  var box = document.getElementById('trade-guard');
  if (!box) return null;
  try {
    var mine = (typeof _myRosterObj === 'function') ? _myRosterObj() : null;
    var os = document.getElementById('opp-select');
    var opp = (os && os.value && typeof _rosterForUser === 'function') ? _rosterForUser(os.value) : null;
    if (!mine || !opp) { box.hidden = true; box.innerHTML = ''; return null; }
    var trade = { sides: [_tgSideFromInputs('#give-players', mine.roster_id), _tgSideFromInputs('#get-players', opp.roster_id)] };
    var r = tgEvaluate(tgCtxFromApp(), trade);
    window._tgLast = r;
    box.innerHTML = "<div class='tg-head'><span class='tg-title'>Trade Guard</span><span class='tg-review'>" + TG_REVIEW + "</span>" + tgChipHtml(r) +
      "<span class='tg-fav'>" + _tgEsc(tgFavorsText(r)) + '</span></div>' + tgBodyHtml(r, true);
    box.hidden = false;
    return r;
  } catch (e) {
    box.hidden = true; box.innerHTML = '';
    return null;
  }
}

// Un trade de Sleeper (transactions) en el molde del guard.
function tgTradeFromSleeper(t) {
  var rids = t.roster_ids || [];
  var sides = rids.map(function (rid) { return { rosterId: rid, gives: [], givesPicks: [], givesFaab: 0 }; });
  var de = {}; sides.forEach(function (s) { de[s.rosterId] = s; });
  Object.keys(t.adds || {}).forEach(function (pid) {
    var to = t.adds[pid];
    var from = (t.drops || {})[pid];
    if (from == null && rids.length === 2) from = rids[0] === to ? rids[1] : rids[0];
    if (de[from]) de[from].gives.push(String(pid));
  });
  (t.draft_picks || []).forEach(function (pk) {
    var from = pk.previous_owner_id;
    if (de[from]) de[from].givesPicks.push({ season: pk.season, round: pk.round, label: pk.season + ' Round ' + pk.round });
  });
  (t.waiver_budget || []).forEach(function (w) { if (de[w.sender]) de[w.sender].givesFaab += _tgNum(w.amount); });
  return { sides: sides, completed: t.status === 'complete' };
}

// Para renderLeagueTrades: el bloque plegable de cada tarjeta.
var _tgSeq = 0;
function tgLeagueBlock(t, ctx) {
  var r = tgEvaluate(ctx, tgTradeFromSleeper(t));
  var id = 'tg_' + String(t.transaction_id || t.created || '').replace(/\W/g, '') + '_' + (++_tgSeq);
  return "<button type='button' class='tg-toggle' aria-expanded='false' aria-controls='" + id +
    "' data-level='" + r.level + "' onclick='tgToggle(this)'>" +
    "<span class='tg-title'>Trade Guard</span>" + tgChipHtml(r) +
    "<span class='tg-fav'>" + _tgEsc(tgFavorsText(r)) + "</span>" +
    "<svg class='tg-caret' viewBox='0 0 12 12' aria-hidden='true'><path d='M3 4.5l3 3 3-3' fill='none' stroke='currentColor' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>" +
    "</button><div class='tg-why' id='" + id + "' hidden>" + tgBodyHtml(r, false) + '</div>';
}

function tgToggle(btn) {
  var p = document.getElementById(btn.getAttribute('aria-controls'));
  if (!p) return;
  var abrir = p.hidden;
  p.hidden = !abrir;
  btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
}

if (typeof window !== 'undefined') {
  window.tgEvaluate = tgEvaluate;
  window.tgBestLineup = tgBestLineup;
  window.tgStandings = tgStandings;
  window.tgFacts = tgFacts;
  window.tgPaintAnalyzer = tgPaintAnalyzer;
  window.tgCtxFromApp = tgCtxFromApp;
  window.tgTradeFromSleeper = tgTradeFromSleeper;
  window.tgLeagueBlock = tgLeagueBlock;
  window.tgToggle = tgToggle;
}
