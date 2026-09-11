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

// GET /api/push/recap: el cron del lunes. Con CRON_SECRET puesto exige su
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
    const resumen = [];
    for (const a of cuentas) {
      const r = await recapDe(doc.accts[a].username).catch(() => null);
      if (!r || !r.total) continue;   // sin ligas jugadas no hay resumen que valga
      resumen.push({ acct: a, r });
      await sendPushTo([a], {
        title: 'Your Sunday: ' + r.wins + '-' + (r.total - r.wins),
        body: r.wins + ' of your ' + r.total + ' Sleeper leagues went your way this week.'
          + (r.mejor ? ' Best win: ' + r.mejor + '.' : ''),
        url: '/myleagues'
      });
    }
    res.json({ ok: true, users: cuentas.length, sent: resumen.length });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 160) }); }
});

// El W-L de la semana pasada de un username de Sleeper, del lado del
// servidor. Solo cabeza a cabeza; best ball cuenta igual (su marcador
// tambien existe). Yahoo declaradamente fuera (token en el navegador).
async function recapDe(username) {
  const api = 'https://api.sleeper.app/v1';
  const j = async (u) => { const r = await fetch(api + u); if (!r.ok) throw new Error('sleeper ' + r.status); return r.json(); };
  const st = await j('/state/nfl');
  const semana = Math.max(1, (st.week || 1) - (st.season_type === 'regular' ? 1 : 0));
  const user = await j('/user/' + encodeURIComponent(username));
  if (!user || !user.user_id) return null;
  const ligas = await j('/user/' + user.user_id + '/leagues/nfl/' + st.season);
  let wins = 0, total = 0, mejor = null, mejorDelta = -1;
  for (const L of (ligas || []).slice(0, 20)) {
    try {
      const [rosters, mus] = await Promise.all([
        j('/league/' + L.league_id + '/rosters'),
        j('/league/' + L.league_id + '/matchups/' + semana)
      ]);
      const mio = (rosters || []).filter(r => r.owner_id === user.user_id)[0];
      if (!mio) continue;
      const mi = (mus || []).filter(m => m.roster_id === mio.roster_id)[0];
      if (!mi || mi.matchup_id == null) continue;
      const riv = (mus || []).filter(m => m.matchup_id === mi.matchup_id && m.roster_id !== mio.roster_id)[0];
      if (!riv) continue;
      const a = Number(mi.points) || 0, b = Number(riv.points) || 0;
      if (a <= 0 && b <= 0) continue;   // semana sin jugar: no cuenta
      total++;
      if (a > b) { wins++; if (a - b > mejorDelta) { mejorDelta = a - b; mejor = L.name; } }
    } catch (_) { }
  }
  return { wins, total, mejor };
}

module.exports = router;
