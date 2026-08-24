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

// ── Significance ───────────────────────────────────────────────────────────
// Below a dozen observations a proportion is barely an estimate: the 95% Wald
// half-width at p=0.5 is 0.98/sqrt(n), which at n=12 is still +-28 points. Any
// "tendency" we could describe is narrower than that, so under 12 we stay quiet.
const MIN_N = 12;
// Two-sided binomial tail against a fair split. Three states instead of two,
// because "weak signal" is honest and "silence" would throw away real hints:
//   p <= 0.05  -> confirmed
//   p <= 0.20  -> leaning, explicitly labelled as unconfirmed
//   otherwise  -> not emitted at all
const P_CONFIRMED = 0.05;
const P_LEANING = 0.20;

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
  if (p > P_LEANING) return { label, n, estado: 'sin_senal', a, b, p: +p.toFixed(3) };
  return {
    label,
    n, a, b,
    p: +p.toFixed(3),
    estado: p <= P_CONFIRMED ? 'confirmado' : 'tendencia',
    lado: a >= b ? 'a' : 'b',
    texto: (a >= b ? textos.a : textos.b)
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
const POS = ['QB', 'RB', 'WR', 'TE'];
// Union with the player master ALWAYS by id. Sleeper keeps every player in its
// history, so 215 names have a namesake: matching by name hands you a retired
// linebacker wearing a star receiver's stats. This bit already bit the project
// twice today, in the draft board and in Mac's own grounding block.
const posDe = (players, pid) => {
  const p = players && players[String(pid)];
  const pos = p && p.position;
  return POS.includes(pos) ? pos : 'otro';
};

/**
 * Age the player actually was when the trade happened, not today.
 * Sleeper only exposes current age, so we walk it back by whole seasons. It is
 * an approximation and it is declared as one: good enough to compare the two
 * sides of the same deal, not good enough to quote as a birthday.
 */
function edadEnFecha(players, pid, ts, temporadaActual) {
  const p = players && players[String(pid)];
  if (!p || !p.age) return null;
  const anio = new Date(ts).getUTCFullYear();
  const atras = Math.max(0, Number(temporadaActual) - anio);
  return p.age - atras;
}

/**
 * @param {Array} trades  [{ created, creator, roster_ids, adds, draft_picks, _liga }]
 * @param {Object} players  Sleeper player master, keyed by id
 * @param {Object} ctx  { miRosterPorLiga, miUserId, temporadaActual }
 */
function construirPerfil(trades, players, ctx) {
  const { miRosterPorLiga = {}, miUserId = '', temporadaActual = 2026 } = ctx || {};
  const recibido = { QB: 0, RB: 0, WR: 0, TE: 0, otro: 0 };
  const enviado = { QB: 0, RB: 0, WR: 0, TE: 0, otro: 0 };
  const porFormato = {}; // 1qb / superflex -> { qbRecibido, qbEnviado }
  let picksRecibidos = 0, picksEnviados = 0;
  let inicio = 0, respuesta = 0;
  const edadesR = [], edadesE = [];
  const contrapartes = {};
  const fechas = [];
  let usados = 0;

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
    for (const rid of (t.roster_ids || [])) {
      if (rid === mio) continue;
      const quien = (t._duenoPorRoster && t._duenoPorRoster[rid]) || (t._liga + ':' + rid);
      contrapartes[quien] = (contrapartes[quien] || 0) + 1;
    }

    const fmt = t._superflex ? 'superflex' : '1qb';
    porFormato[fmt] = porFormato[fmt] || { qbRecibido: 0, qbEnviado: 0, trades: 0 };
    porFormato[fmt].trades++;

    for (const [pid, rid] of Object.entries(t.adds || {})) {
      const pos = posDe(players, pid);
      const edad = edadEnFecha(players, pid, t.created, temporadaActual);
      if (rid === mio) {
        recibido[pos]++;
        if (edad != null) edadesR.push(edad);
        if (pos === 'QB') porFormato[fmt].qbRecibido++;
      } else {
        enviado[pos]++;
        if (edad != null) edadesE.push(edad);
        if (pos === 'QB') porFormato[fmt].qbEnviado++;
      }
    }

    for (const dp of (t.draft_picks || [])) {
      // owner_id / previous_owner_id are ROSTER ids in this payload, not users.
      if (dp.owner_id === mio) picksRecibidos++;
      else if (dp.previous_owner_id === mio) picksEnviados++;
    }
  }

  const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const edadR = media(edadesR), edadE = media(edadesE);

  const afirmaciones = [
    claim('picks', picksRecibidos, picksEnviados, {
      a: 'Acumulas futuro: entran mas picks de los que salen.',
      b: 'Gastas futuro: salen mas picks de los que entran.'
    }),
    claim('iniciativa', inicio, respuesta, {
      a: 'Propones tu. La mesa la abres tu, no te la abren.',
      b: 'Respondes. Casi siempre te llega la oferta hecha.'
    }),
    claim('qb', recibido.QB, enviado.QB, {
      a: 'Compras QBs.',
      b: 'Vendes QBs.'
    }),
    claim('cuerpos', Object.values(recibido).reduce((s, x) => s + x, 0),
      Object.values(enviado).reduce((s, x) => s + x, 0), {
      a: 'Consolidas: recibes mas jugadores de los que sueltas.',
      b: 'Repartes: sueltas mas jugadores de los que recibes.'
    })
  ];

  return {
    muestra: { tradesPropios: usados, conFecha: fechas.length },
    flujo: { recibido, enviado, picksRecibidos, picksEnviados },
    iniciativa: { inicio, respuesta },
    // Averages carry their own n so the UI can refuse to draw a conclusion from
    // a handful of players, and the delta is what matters, not the absolute.
    edad: {
      recibida: edadR == null ? null : +edadR.toFixed(1), nRecibida: edadesR.length,
      enviada: edadE == null ? null : +edadE.toFixed(1), nEnviada: edadesE.length,
      delta: (edadR == null || edadE == null) ? null : +(edadR - edadE).toFixed(1),
      nota: 'Edad estimada al momento del trade restando temporadas completas.'
    },
    contrapartes: {
      distintas: Object.keys(contrapartes).length,
      maxRepeticion: Object.keys(contrapartes).length ? Math.max(...Object.values(contrapartes)) : 0
    },
    porFormato,
    ritmo: fechas.length ? { primero: Math.min(...fechas), ultimo: Math.max(...fechas) } : null,
    afirmaciones: afirmaciones.filter(Boolean)
  };
}

module.exports = { construirPerfil, binomP, claim, edadEnFecha, MIN_N, P_CONFIRMED, P_LEANING };
