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
const { construirPerfil, construirPerfiles } = require('../lib/perfil');
const { clasificarLiga, ejeDeDosLados } = require('../lib/formato');
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

/**
 * Cuantas temporadas hacia atras se mina.
 *
 * Antes eran dos fijas, y dos son pocas: el perfil se parte ahora en dynasty y
 * redraft, y partir una muestra de dos temporadas deja los dos lados por debajo
 * del umbral, con lo que el tab se queda mudo teniendo historia de sobra sin
 * leer. Se camina hacia atras hasta encontrar VACIAS_SEGUIDAS temporadas
 * seguidas sin ninguna liga, que es la senal de que ahi empieza la prehistoria
 * de la cuenta. El tope duro existe para que una cuenta rara no dispare una
 * mineria infinita.
 */
const TEMPORADAS_TOPE = 10;
const VACIAS_SEGUIDAS = 2;

/** Las temporadas en las que este usuario tuvo alguna liga de NFL. */
async function temporadasConLigas(userId, anioActual) {
  const vivas = [];
  let vacias = 0;
  for (let i = 0; i < TEMPORADAS_TOPE && vacias < VACIAS_SEGUIDAS; i++) {
    const s = String(anioActual - i);
    const ligas = await traer(`/user/${userId}/leagues/nfl/${s}`);
    if (ligas && ligas.length) { vivas.push(s); vacias = 0; } else { vacias++; }
  }
  return vivas;
}

/**
 * Los picks de los drafts del usuario, con los de sus rivales.
 *
 * Se bajan los del rival igual que en el waiver y por la misma razon: "tomas
 * tres RB en las primeras cuatro rondas" no significa nada sin saber cuantos
 * tomaron los demas en ESA sala. Sleeper devuelve la posicion dentro de
 * metadata, asi que aqui no hace falta el maestro de jugadores.
 */
async function minarDrafts(userId, temporadas) {
  const picks = [];
  for (const s of temporadas) {
    const drafts = await traer(`/user/${userId}/drafts/nfl/${s}`) || [];
    const listas = await Promise.all(drafts
      .filter(d => d.status === 'complete' && d.league_id)
      .map(async (d) => ({ d, ps: await traer(`/draft/${d.draft_id}/picks`).catch(() => []) })));
    for (const { d, ps } of listas) {
      for (const k of (ps || [])) {
        // Sin roster no hay a quien atribuir el pick, y adivinarlo por
        // picked_by mezclaria co-owners: se descarta y ya.
        if (k.roster_id == null) continue;
        picks.push({
          liga: d.league_id, temporada: d.season || s, roster: k.roster_id,
          ronda: k.round, pos: k.metadata && k.metadata.position
        });
      }
    }
  }
  return picks;
}

/** Every trade this user was part of, across every league of the given seasons. */
async function minarTrades(userId, temporadas) {
  const trades = [], miRosterPorLiga = {}, ligas = [], movimientos = [];
  const formatoPorLiga = {}, fuentePorLiga = {};
  for (const s of temporadas) {
    for (const L of (await traer(`/user/${userId}/leagues/nfl/${s}`) || [])) {
      const rosters = await traer(`/league/${L.league_id}/rosters`) || [];
      // co_owners counts. A shared roster is still your roster, and missing
      // that is what locked co-owners out of their own league elsewhere today.
      const mio = rosters.find(r => r.owner_id === userId
        || (Array.isArray(r.co_owners) && r.co_owners.includes(userId)));
      if (!mio) continue;
      miRosterPorLiga[L.league_id] = mio.roster_id;
      // Dynasty, keeper o redraft. El criterio es UNO y vive en lib/formato.js:
      // hasta hoy estaba copiado a mano en el frontend y no llegaba aqui, que es
      // por lo que el perfil mezclaba los tres formatos en el mismo saco.
      const cls = clasificarLiga(L);
      formatoPorLiga[L.league_id] = cls.formato;
      fuentePorLiga[L.league_id] = cls.fuente;
      ligas.push({
        id: L.league_id, nombre: L.name, temporada: L.season, equipos: L.total_rosters,
        formato: cls.formato, fuenteFormato: cls.fuente, eje: ejeDeDosLados(cls.formato)
      });

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
          if (t.status !== 'complete') continue;
          if (t.type === 'trade') {
            // Only completed trades. A vetoed or pending one never happened, and
            // counting it would credit you with a decision you did not make.
            trades.push({ ...t, _liga: L.league_id, _superflex: superflex, _duenoPorRoster: duenoPorRoster });
          } else if (t.type === 'waiver' || t.type === 'free_agent') {
            // El waiver sale GRATIS: estas semanas ya se bajaban enteras y todo
            // lo que no era un trade se tiraba. Y trae las de TODOS los equipos,
            // no solo las mias, que es justo lo que hace comparable el dato: sin
            // saber cuanto se mueve el resto de la liga, "hace muchos
            // movimientos" no significa nada.
            const bid = t.settings && t.settings.waiver_bid;
            for (const rid of Object.values(t.adds || {})) {
              movimientos.push({
                liga: L.league_id, temporada: L.season, roster: rid,
                tipo: t.type, puja: (typeof bid === 'number' ? bid : null)
              });
            }
          }
        }
      }
    }
  }
  return { trades, miRosterPorLiga, ligas, formatoPorLiga, fuentePorLiga, movimientos };
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
    const temporadas = await temporadasConLigas(me.user_id, anio);
    if (!temporadas.length) return res.status(404).json({ error: 'No NFL leagues found on that Sleeper account.' });
    const { trades, miRosterPorLiga, ligas, formatoPorLiga, fuentePorLiga, movimientos } =
      await minarTrades(me.user_id, temporadas);
    const picksDraft = await minarDrafts(me.user_id, temporadas);
    const players = await traer('/players/nfl');
    if (!players) return res.status(502).json({ error: 'upstream unavailable' });

    const ctx = { miRosterPorLiga, miUserId: me.user_id, temporadaActual: anio, formatoPorLiga, fuentePorLiga, movimientos, picksDraft };
    // Se devuelven los dos: `ejes` es lo que pintan los dos tabs, y `global` es
    // el agregado de siempre, que sigue sirviendo para el recuento crudo y para
    // no romper a nadie que ya lo leyera.
    const salida = {
      generado: Date.now(), usuario: user, ligas,
      temporadas,
      ejes: construirPerfiles(trades, players, ctx),
      ...construirPerfil(trades, players, ctx)
    };
    cache.set(key, salida);
    res.json(salida);
  } catch (e) {
    console.error('[perfil]', e.message);
    res.status(500).json({ error: 'could not build profile' });
  }
});

module.exports = router;
