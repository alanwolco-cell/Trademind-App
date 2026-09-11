// Push del producto (Web Push de la PWA). Dos avisos, elegidos por el dueno
// el 2026-09-11: actividad del hub (al momento del evento) y el resumen del
// lunes (cron). El resumen cubre SOLO ligas de Sleeper: el token de Yahoo
// vive en el navegador del usuario por decision de seguridad ya tomada, y el
// servidor no puede leer sus ligas sin el.
//
// Suscripciones en un documento del mismo almacen del perfil (Blob, con caida
// a archivo con PERFIL_RK_STORE=local, que es como corre el gate). Un
// documento para todos: hoy son decenas de suscriptores, no miles; el dia que
// crezca se parte por cuenta.
'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const router = express.Router();
const { requireAcctId, readAcctId } = require('../lib/identity');
const perfil = require('./perfil');

const DOC = 'perfil/push-subs.json';
const FILE = process.env.PUSH_FILE || path.join(os.tmpdir(), 'macdraft-push-subs.json');
const leer = async () => (await perfil.docRead(DOC, FILE)).doc || { accts: {} };
const escribir = (doc) => perfil.docWrite(DOC, FILE, doc);

function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY || '';
  const priv = process.env.VAPID_PRIVATE_KEY || '';
  return pub && priv ? { pub, priv } : null;
}

let _wp = null;
function webpush() {
  if (_wp) return _wp;
  const v = vapid();
  if (!v) return null;
  _wp = require('web-push');
  _wp.setVapidDetails('mailto:alanwolco@gmail.com', v.pub, v.priv);
  return _wp;
}

// GET /api/push/vapid: la llave publica para el navegador. Siempre 200 (un
// error de consola cuenta como bug; sin llave configurada se declara null).
router.get('/vapid', (req, res) => {
  const v = vapid();
  res.json({ key: v ? v.pub : null });
});

const hashEndpoint = (e) => crypto.createHash('sha256').update(String(e)).digest('hex').slice(0, 16);

// POST /api/push/subscribe { subscription, username }
router.post('/subscribe', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  const b = req.body || {};
  const sub = b.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)
    || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
    return res.status(400).json({ error: 'bad subscription' });
  }
  const username = typeof b.username === 'string' ? b.username.slice(0, 60) : null;
  try {
    const doc = await leer();
    doc.accts = doc.accts || {};
    const mio = doc.accts[acct] = doc.accts[acct] || { subs: {} };
    // Un dispositivo = un endpoint. Re-suscribirse reemplaza, no duplica.
    mio.subs[hashEndpoint(sub.endpoint)] = {
      sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      username, at: Date.now()
    };
    mio.username = username || mio.username || null;
    await escribir(doc);
    res.json({ ok: true, devices: Object.keys(mio.subs).length });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 160) }); }
});

// POST /api/push/unsubscribe { endpoint }
router.post('/unsubscribe', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  const endpoint = (req.body || {}).endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'bad endpoint' });
  try {
    const doc = await leer();
    const mio = (doc.accts || {})[acct];
    if (mio && mio.subs) { delete mio.subs[hashEndpoint(endpoint)]; await escribir(doc); }
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 160) }); }
});

// Envio a una lista de cuentas. PUSH_DRY=1 (el gate) no manda: apunta lo que
// HABRIA mandado en un archivo que el gate lee. Una suscripcion muerta
// (404/410 del proveedor) se borra en el acto.
async function sendPushTo(acctIds, payload) {
  const doc = await leer();
  const cartas = [];
  (acctIds || []).forEach(a => {
    const mio = (doc.accts || {})[a];
    if (!mio || !mio.subs) return;
    Object.keys(mio.subs).forEach(h => cartas.push({ acct: a, h, sub: mio.subs[h].sub }));
  });
  if (process.env.PUSH_DRY === '1') {
    const fs = require('fs');
    const f = process.env.PUSH_DRY_FILE || path.join(os.tmpdir(), 'macdraft-push-dry.json');
    let viejo = []; try { viejo = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { }
    viejo.push({ at: Date.now(), a: cartas.map(c => c.acct), payload });
    fs.writeFileSync(f, JSON.stringify(viejo));
    return { sent: 0, dry: cartas.length };
  }
  const wp = webpush();
  if (!wp) return { sent: 0, skipped: 'no vapid' };
  let sent = 0, muertos = 0;
  for (const c of cartas) {
    try { await wp.sendNotification(c.sub, JSON.stringify(payload), { TTL: 3600 }); sent++; }
    catch (e) {
      const st = e && e.statusCode;
      if (st === 404 || st === 410) {
        muertos++;
        const mio = (doc.accts || {})[c.acct];
        if (mio && mio.subs) delete mio.subs[c.h];
      }
    }
  }
  if (muertos) await escribir(doc);
  return { sent, dead: muertos };
}
router.sendPushTo = sendPushTo;

/* ------------------------------------------------- el recap del martes */
// Pedido del dueno (2026-09-11): "un full tuesday recap bien hecho y una
// lista de buenos buy low targets, con buenas razones. No quiero que solo
// pongas a Jamarr Chase porque hizo 59 yardas".
// La regla que lo gobierna: una recomendacion SOLO existe cuando se juntan
// TRES señales medibles, y las tres van escritas en la razon:
//   1. el MERCADO bajo (tendencia 30d de FantasyCalc, en el formato de ESA
//      liga: dynasty/redraft, 1QB/SF, su ppr);
//   2. el ROL sigue intacto (su proyeccion semanal sigue de titular claro);
//   3. la semana mala EXPLICA el descuento (puntos reales muy por debajo de
//      su proyeccion).
// Una semana mala sin caida de precio no es compra; una caida con el rol
// roto tampoco. Sin las tres, silencio.

const FC_CACHE = {};   // formato -> { ts, byId }
async function fcValores(numQbs, ppr, isDynasty) {
  const k = numQbs + ':' + ppr + ':' + isDynasty;
  const c = FC_CACHE[k];
  if (c && Date.now() - c.ts < 2 * 3600 * 1000) return c.byId;
  const r = await fetch('https://api.fantasycalc.com/values/current?isDynasty=' + isDynasty
    + '&numQbs=' + numQbs + '&ppr=' + ppr, { headers: { 'User-Agent': 'MacDraft/1.0', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('FantasyCalc ' + r.status);
  const players = await r.json();
  const byId = {};
  players.forEach(p => {
    if (!p.player || !p.player.sleeperId) return;
    byId[p.player.sleeperId] = {
      value: p.value || 0, trend30: p.trend30Day || 0,
      posRank: p.positionRank || null, name: p.player.name || '', pos: p.player.position || ''
    };
  });
  FC_CACHE[k] = { ts: Date.now(), byId };
  return byId;
}

let _proyCache = null;
async function proySemana(season, week) {
  if (_proyCache && _proyCache.k === season + ':' + week) return _proyCache.map;
  const r = await fetch('https://api.sleeper.com/projections/nfl/' + season + '/' + week
    + '?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE');
  if (!r.ok) throw new Error('proyecciones ' + r.status);
  const arr = await r.json();
  const map = {};
  (arr || []).forEach(p => {
    const st = p.stats || {};
    if (st.pts_half_ppr == null && st.pts_ppr == null && st.pts_std == null) return;
    map[p.player_id] = { std: st.pts_std, half: st.pts_half_ppr, ppr: st.pts_ppr, pos: p.player && p.player.position };
  });
  _proyCache = { k: season + ':' + week, map };
  return map;
}

// El titular claro por posicion, en puntos proyectados de la semana. Por
// debajo de esto el "rol intacto" no se puede afirmar y no se recomienda.
const ROL_MIN = { QB: 14, RB: 9, WR: 9, TE: 6 };

async function buyLows(ctx) {
  // ctx viene de recapDe: ligas con rosters, users, matchups de la semana
  // pasada, y el reglamento de cada una.
  // La primera version en datos reales recomendaba jugadores con CERO puntos:
  // un 0.0 no es una mala semana, es que NO JUGO (bye, lesion), y ahi el rol
  // no se puede afirmar. Y el "rol intacto" se mide por rank de PROYECCION de
  // la semana que viene, no por rank de mercado: el mercado es justamente lo
  // que estamos acusando de equivocarse.
  const out = [];
  for (const L of ctx.ligas) {
    let fc;
    try { fc = await fcValores(L.superflex ? 2 : 1, L.ppr, L.dynasty); } catch (_) { continue; }
    let proy;
    try { proy = await proySemana(ctx.season, ctx.semanaProxima); } catch (_) { continue; }
    const campo = L.ppr >= 1 ? 'ppr' : (L.ppr > 0 ? 'half' : 'std');
    // El rank de proyeccion por posicion, del feed de la semana que viene
    const rankProj = {};
    (function () {
      const porPos = {};
      Object.keys(proy).forEach(id => {
        const p = proy[id]; const pts = p[campo] != null ? p[campo] : p.half;
        if (pts == null || !p.pos) return;
        (porPos[p.pos] = porPos[p.pos] || []).push({ id, pts });
      });
      Object.keys(porPos).forEach(pos => {
        porPos[pos].sort((a, b) => b.pts - a.pts)
          .forEach((x, i) => { rankProj[x.id] = i + 1; });
      });
    })();
    const RANK_MAX = { QB: 18, RB: 30, WR: 36, TE: 14 };
    (L.rivales || []).forEach(rv => {
      (rv.players || []).forEach(pid => {
        const v = fc[pid]; if (!v || v.value < 500) return;
        const p = proy[pid]; if (!p) return;
        const projPts = p[campo] != null ? p[campo] : p.half;
        if (projPts == null || projPts < (ROL_MIN[v.pos] || 9)) return;   // rol no afirmable
        const rk = rankProj[pid];
        if (!rk || rk > (RANK_MAX[v.pos] || 30)) return;                  // titular claro o nada
        // caida contra la base de hace un mes, no contra el valor de hoy
        const caida = v.trend30 < 0 ? -v.trend30 / (v.value - v.trend30) : 0;
        if (caida < 0.08 || caida > 0.6) return;                          // sin caida no hay compra; una caida absurda es otra cosa (lesion larga)
        const real = L.puntosSemana[pid];
        if (real == null || real <= 0) return;                            // 0 = no jugo: no se afirma nada
        if (real > projPts * 0.6) return;                                 // la mala semana no existe
        out.push({
          id: pid, name: v.name, pos: v.pos, league: L.name, holder: rv.owner,
          caidaPct: Math.round(caida * 100), lastPts: Math.round(real * 10) / 10,
          projPts: Math.round(projPts * 10) / 10, projRank: rk
        });
      });
    });
  }
  // El mejor argumento primero; un jugador una sola vez (su mejor liga).
  const vistos = {};
  return out.sort((a, b) => b.caidaPct - a.caidaPct)
    .filter(t => (vistos[t.id] ? false : (vistos[t.id] = 1)))
    .slice(0, 3)
    .map(t => ({
      ...t,
      // La razon ES las tres señales, con sus numeros. Nada de opinion.
      reason: 'His price is ' + t.caidaPct + '% below a month ago, and last week\u2019s '
        + t.lastPts + ' points are why. The projection has not moved: ' + t.projPts
        + ' this week, the ' + t.pos + t.projRank + ' of the slate. The role is intact, the market blinked. '
        + t.holder + ' has him in ' + t.league + '.'
    }));
}

// GET /api/push/recap: el cron del MARTES. Con CRON_SECRET puesto exige su
// Bearer (asi lo manda Vercel); sin secreto (local, gate) pasa.
router.get('/recap', async (req, res) => {
  const sec = process.env.CRON_SECRET;
  if (sec && req.headers.authorization !== 'Bearer ' + sec) {
    return res.status(401).json({ error: 'not the cron' });
  }
  try {
    const doc = await leer();
    const cuentas = Object.keys(doc.accts || {}).filter(a =>
      doc.accts[a].username && Object.keys(doc.accts[a].subs || {}).length);
    let sent = 0;
    for (const a of cuentas) {
      const r = await recapDe(doc.accts[a].username).catch(() => null);
      if (!r || !r.total) continue;   // sin ligas jugadas no hay resumen que valga
      let targets = [];
      try { targets = await buyLows(r); } catch (_) { }
      // El documento completo se guarda por cuenta y la pantalla lo pinta;
      // el push es el titular, no el periodico.
      await perfil.docWrite('perfil/recap-' + a + '.json',
        path.join(os.tmpdir(), 'macdraft-recap-' + a + '.json'),
        { at: Date.now(), week: r.week, wins: r.wins, total: r.total, mejor: r.mejor,
          takeaways: r.takeaways, decisiones: r.decisiones, targets });
      sent++;
      await sendPushTo([a], {
        title: 'Tuesday recap: ' + r.wins + '-' + (r.total - r.wins),
        body: (r.takeaways[1] ? r.takeaways[1] + ' ' : '')
          + (targets.length ? targets.length + ' buy-low window' + (targets.length === 1 ? '' : 's') + ' open.' : ''),
        url: '/myleagues'
      });
    }
    res.json({ ok: true, users: cuentas.length, sent });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 160) }); }
});

// GET /api/push/recap-doc: el recap guardado de MI cuenta, para la tarjeta
// del martes en Leagues. Siempre 200; sin recap, {recap:null}.
router.get('/recap-doc', async (req, res) => {
  const acct = readAcctId(req);
  if (!acct) return res.json({ recap: null });
  try {
    const d = await perfil.docRead('perfil/recap-' + acct + '.json',
      path.join(os.tmpdir(), 'macdraft-recap-' + acct + '.json'));
    res.json({ recap: d.doc || null });
  } catch (e) { res.json({ recap: null }); }
});

// El recap COMPLETO de la semana pasada de un username de Sleeper, del lado
// del servidor. Yahoo declaradamente fuera (el token vive en el navegador).
// Ademas del W-L: las DECISIONES de la semana, medidas y no opinadas.
// - La peor: el banquillo que anoto mas que tu titular de la misma casilla
//   (y si ese delta era mas grande que el margen de la derrota, te costo el
//   partido y se dice).
// - La mejor: el titular que arranco por encima de su casilla y respondio.
// - Waivers: lo que subiste contra lo que soltaste, en puntos de ESA semana.
const POS_DE_SLOT = { QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], K: ['K'], DEF: ['DEF'] };
let _maestroCache = null;
async function maestro() {
  if (_maestroCache && Date.now() - _maestroCache.ts < 3600 * 1000) return _maestroCache.map;
  const r = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!r.ok) throw new Error('maestro ' + r.status);
  const all = await r.json();
  const map = {};
  Object.keys(all).forEach(id => {
    const p = all[id];
    map[id] = { name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(), pos: p.position };
  });
  _maestroCache = { ts: Date.now(), map };
  return map;
}

async function recapDe(username) {
  const api = 'https://api.sleeper.app/v1';
  const j = async (u) => { const r = await fetch(api + u); if (!r.ok) throw new Error('sleeper ' + r.status); return r.json(); };
  const st = await j('/state/nfl');
  const semana = Math.max(1, (st.week || 1) - (st.season_type === 'regular' ? 1 : 0));
  const user = await j('/user/' + encodeURIComponent(username));
  if (!user || !user.user_id) return null;
  const ligasRaw = await j('/user/' + user.user_id + '/leagues/nfl/' + st.season);
  const M = await maestro().catch(() => ({}));
  const clasificar = (() => { try { return require('../lib/formato').clasificarLiga; } catch (_) { return null; } })();

  let wins = 0, total = 0, mejor = null, mejorDelta = -1;
  const ligas = [], decisiones = [];
  let bancaTotal = 0, ligasConBanca = 0, costoPartidos = 0;

  for (const L of (ligasRaw || []).slice(0, 20)) {
    try {
      const [rosters, mus, users, txs] = await Promise.all([
        j('/league/' + L.league_id + '/rosters'),
        j('/league/' + L.league_id + '/matchups/' + semana),
        j('/league/' + L.league_id + '/users'),
        j('/league/' + L.league_id + '/transactions/' + semana).catch(() => [])
      ]);
      const mio = (rosters || []).filter(r => r.owner_id === user.user_id)[0];
      if (!mio) continue;
      const mi = (mus || []).filter(m => m.roster_id === mio.roster_id)[0];
      if (!mi || mi.matchup_id == null) continue;
      const riv = (mus || []).filter(m => m.matchup_id === mi.matchup_id && m.roster_id !== mio.roster_id)[0];
      if (!riv) continue;
      const a = Number(mi.points) || 0, b = Number(riv.points) || 0;
      if (a <= 0 && b <= 0) continue;
      total++;
      const gane = a > b;
      if (gane && a - b > mejorDelta) { mejorDelta = a - b; mejor = L.name; }
      if (gane) wins++;

      const nombreDe = id => (M[id] && M[id].name) || ('Player ' + id);
      const posDe = id => (M[id] && M[id].pos) || '';
      const pts = mi.players_points || {};
      const esBB = Number(L.settings && L.settings.type) === 3 || Number(L.settings && L.settings.best_ball) === 1;

      // La decision de alineacion, solo donde HAY decision (best ball no la tiene)
      if (!esBB) {
        const titulares = (mi.starters || []).filter(x => x && x !== '0');
        const banca = (mi.players || []).filter(p => titulares.indexOf(p) === -1);
        const slots = (L.roster_positions || []).filter(x => ['BN', 'IR', 'TAXI'].indexOf(x) === -1);
        let peor = null;
        banca.forEach(bid => {
          const bp = Number(pts[bid]);
          if (!isFinite(bp)) return;
          titulares.forEach((tid, i) => {
            const slot = slots[i]; if (!slot) return;
            const admite = POS_DE_SLOT[slot] || [slot];
            if (admite.indexOf(posDe(bid)) === -1) return;
            const tp = Number(pts[tid]) || 0;
            const delta = bp - tp;
            if (delta > 3 && (!peor || delta > peor.delta)) {
              peor = { delta: Math.round(delta * 10) / 10, entra: nombreDe(bid), sale: nombreDe(tid), slot };
            }
          });
        });
        if (peor) {
          bancaTotal += peor.delta; ligasConBanca++;
          const costo = !gane && peor.delta > (b - a);
          if (costo) costoPartidos++;
          decisiones.push({
            tipo: 'mala', league: L.name,
            texto: peor.entra + ' scored ' + peor.delta + ' more than ' + peor.sale
              + ' in your ' + peor.slot + ' spot' + (costo ? ', and that call cost you the game' : '') + '.'
          });
        }
        // La mejor: el titular que mas supero a TODA su banca de la casilla
        let mejorCall = null;
        titulares.forEach((tid, i) => {
          const slot = slots[i]; if (!slot) return;
          const tp = Number(pts[tid]); if (!isFinite(tp) || tp < 12) return;
          const rivalesBanca = banca.filter(bid => (POS_DE_SLOT[slot] || [slot]).indexOf(posDe(bid)) !== -1);
          if (!rivalesBanca.length) return;
          const mejorBanca = Math.max.apply(null, rivalesBanca.map(bid => Number(pts[bid]) || 0));
          if (mejorBanca < 4) return;   // sin alternativa real no hubo decision
          const delta = tp - mejorBanca;
          if (delta > 6 && (!mejorCall || delta > mejorCall.delta)) {
            mejorCall = { delta: Math.round(delta * 10) / 10, quien: nombreDe(tid), pts: Math.round(tp * 10) / 10 };
          }
        });
        if (mejorCall) decisiones.push({
          tipo: 'buena', league: L.name,
          texto: 'Starting ' + mejorCall.quien + ' paid: ' + mejorCall.pts + ' points, '
            + mejorCall.delta + ' more than your best bench option.'
        });
      }

      // Waivers de la semana: lo subido contra lo soltado, en puntos reales
      // Los puntos del que SOLTASTE solo se conocen si otro roster de la
      // liga lo levanto (estan en el mapa de la semana); si no, sobre el no
      // se afirma nada. Solo se dice lo que el dato aguanta.
      const ptsLiga = {};
      (mus || []).forEach(m => Object.assign(ptsLiga, m.players_points || {}));
      (txs || []).filter(t => t.status === 'complete' && (t.type === 'waiver' || t.type === 'free_agent')
        && t.roster_ids && t.roster_ids.indexOf(mio.roster_id) !== -1)
        .slice(0, 4).forEach(t => {
          const addId = t.adds && Object.keys(t.adds)[0];
          const dropId = t.drops && Object.keys(t.drops)[0];
          if (!addId) return;
          const ap = Number(ptsLiga[addId]);
          const dp = dropId != null && ptsLiga[dropId] != null ? Number(ptsLiga[dropId]) : null;
          if (!isFinite(ap)) return;
          if (ap >= 8 && (dp == null || ap > dp)) {
            decisiones.push({ tipo: 'buena', league: L.name, texto: 'Your pickup ' + nombreDe(addId) + ' scored ' + Math.round(ap * 10) / 10 + ' points' + (dp != null ? ', more than the ' + Math.round(dp * 10) / 10 + ' from ' + nombreDe(dropId) + ' you cut' : '') + '.' });
          } else if (dp != null && dp > ap + 5) {
            decisiones.push({ tipo: 'mala', league: L.name, texto: 'You cut ' + nombreDe(dropId) + ' (' + Math.round(dp * 10) / 10 + ' pts) for ' + nombreDe(addId) + ' (' + Math.round(ap * 10) / 10 + ').' });
          }
        });

      // El contexto para los buy-lows
      const cls = clasificar ? clasificar(L) : null;
      const puntosSemana = {};
      (mus || []).forEach(m => Object.assign(puntosSemana, m.players_points || {}));
      const userName = {};
      (users || []).forEach(u => { userName[u.user_id] = u.display_name; });
      ligas.push({
        name: L.name,
        ppr: Number((L.scoring_settings || {}).rec) || 0,
        superflex: (L.roster_positions || []).indexOf('SUPER_FLEX') !== -1,
        dynasty: cls ? cls.formato === 'dynasty' : false,
        rivales: (rosters || []).filter(r => r.owner_id !== user.user_id)
          .map(r => ({ owner: userName[r.owner_id] || 'a rival', players: r.players || [] })),
        puntosSemana
      });
    } catch (_) { }
  }

  // Takeaways: frases derivadas SOLO de lo medido arriba
  const takeaways = [];
  if (total) takeaways.push('You went ' + wins + '-' + (total - wins) + ' across your Sleeper leagues.');
  if (ligasConBanca) takeaways.push('You left ' + Math.round(bancaTotal * 10) / 10 + ' points on benches in '
    + ligasConBanca + ' league' + (ligasConBanca === 1 ? '' : 's')
    + (costoPartidos ? ', and it flipped ' + costoPartidos + ' game' + (costoPartidos === 1 ? '' : 's') + ' against you' : '') + '.');
  const buenas = decisiones.filter(d => d.tipo === 'buena').length;
  const malas = decisiones.filter(d => d.tipo === 'mala').length;
  if (buenas + malas) takeaways.push(buenas + ' call' + (buenas === 1 ? '' : 's') + ' went your way, ' + malas + ' went against you. The details are below.');

  return {
    wins, total, mejor, week: semana, season: st.season,
    semanaProxima: st.week || semana + 1,
    ligas, decisiones: decisiones.slice(0, 8), takeaways
  };
}

module.exports = router;
