'use strict';
// Self-scouting endpoint. Private by design: one owner, his own history.
//
// Privacy note for phase 1: everything here is derived from Sleeper's PUBLIC
// API - the same transactions anyone can read without a credential. So this
// route exposes no new surface, it only assembles what is already open. That
// changes the day we start recording in-app behaviour (what you asked Mac,
// which trades you considered and walked away from). When that lands,
// public/privacy.html has to say so before a single event is stored.

const express = require('express');
const { requireAcctId } = require('../lib/identity');
const { construirPerfil } = require('../lib/perfil');
const NodeCache = require('node-cache');

const router = express.Router();

// Mining one profile is ~130 upstream calls (7 leagues x 18 weeks), so it is
// slow and must not run per page view. An hour is well inside how often a
// dynasty roster actually changes.
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
const SLEEPER = 'https://api.sleeper.app/v1';

/**
 * Who is allowed to see a profile at all.
 * Fail closed: with PERFIL_ACCTS unset nobody gets in, including me. The list
 * holds acctId hashes, never Sleeper usernames - a username is public and
 * proves nothing, which is the rule identity.js exists to enforce.
 */
function permitido(acctId) {
  const lista = String(process.env.PERFIL_ACCTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return lista.includes(acctId);
}

const traer = async (ruta) => {
  const r = await fetch(SLEEPER + ruta);
  return r.ok ? r.json() : null;
};

/** Every trade this user was part of, across every league of the given seasons. */
async function minarTrades(userId, temporadas) {
  const trades = [], miRosterPorLiga = {}, ligas = [];
  for (const s of temporadas) {
    for (const L of (await traer(`/user/${userId}/leagues/nfl/${s}`) || [])) {
      const rosters = await traer(`/league/${L.league_id}/rosters`) || [];
      // co_owners counts. A shared roster is still your roster, and missing
      // that is what locked co-owners out of their own league elsewhere today.
      const mio = rosters.find(r => r.owner_id === userId
        || (Array.isArray(r.co_owners) && r.co_owners.includes(userId)));
      if (!mio) continue;
      miRosterPorLiga[L.league_id] = mio.roster_id;
      ligas.push({ id: L.league_id, nombre: L.name, temporada: L.season, equipos: L.total_rosters });

      const duenoPorRoster = {};
      rosters.forEach(r => { duenoPorRoster[r.roster_id] = r.owner_id || ('roster' + r.roster_id); });
      // Superflex de facto, no solo el slot literal. La liga "Dynasty 2026" no
      // usa SUPER_FLEX: arranca DOS QB, que es superflex a todos los efectos.
      // Detectarlo por el nombre del slot clasificaba mal 15 de 39 trades y
      // contaminaba justo el control que existe para no confundir un QB de
      // superflex con uno de 1QB. Verificado: clasifica bien las 7 ligas.
      const rp = L.roster_positions || [];
      const superflex = rp.includes('SUPER_FLEX') || rp.includes('OP')
        || rp.filter(x => x === 'QB').length > 1;

      const semanas = await Promise.all(
        Array.from({ length: 18 }, (_, i) => traer(`/league/${L.league_id}/transactions/${i + 1}`).catch(() => []))
      );
      for (const semana of semanas) {
        for (const t of (semana || [])) {
          // Only completed trades. A vetoed or pending one never happened, and
          // counting it would credit you with a decision you did not make.
          if (t.type !== 'trade' || t.status !== 'complete') continue;
          trades.push({ ...t, _liga: L.league_id, _superflex: superflex, _duenoPorRoster: duenoPorRoster });
        }
      }
    }
  }
  return { trades, miRosterPorLiga, ligas };
}

// GET /api/perfil?user=<sleeper username>
router.get('/', async (req, res) => {
  try {
    const acct = requireAcctId(req, res);
    if (!acct) return;
    if (!permitido(acct)) {
      // The caller's own hash is echoed back so the owner can enable himself
      // without digging through devtools. It is his own id, shown only to him.
      return res.status(403).json({ error: 'Profile is not enabled for this account.', acctId: acct });
    }

    const user = String(req.query.user || '').trim().toLowerCase();
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(user)) return res.status(400).json({ error: 'Invalid username.' });

    const key = 'perfil:' + acct + ':' + user;
    const hit = cache.get(key);
    if (hit) return res.json({ ...hit, cacheado: true });

    const me = await traer(`/user/${user}`);
    if (!me || !me.user_id) return res.status(404).json({ error: 'Sleeper user not found.' });

    const anio = new Date().getUTCFullYear();
    const { trades, miRosterPorLiga, ligas } = await minarTrades(me.user_id, [String(anio), String(anio - 1)]);
    const players = await traer('/players/nfl');
    if (!players) return res.status(502).json({ error: 'upstream unavailable' });

    const perfil = construirPerfil(trades, players, {
      miRosterPorLiga, miUserId: me.user_id, temporadaActual: anio
    });
    const salida = { generado: Date.now(), usuario: user, ligas, ...perfil };
    cache.set(key, salida);
    res.json(salida);
  } catch (e) {
    console.error('[perfil]', e.message);
    res.status(500).json({ error: 'could not build profile' });
  }
});

module.exports = router;
