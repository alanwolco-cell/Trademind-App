'use strict';
/* ============================================================================
   EL HUB DE LIGA: una liga compartida, abierta con un codigo.

   QUE ES. Mac Draft no aloja tu liga: la transmite. La liga sigue viviendo en
   Sleeper o en Yahoo; aqui se le da a los diez o doce managers una sola
   pantalla comun, que su plataforma no les da: power rankings, la historia de
   todas las temporadas, quien tradea con quien, y el mercado.

   COMO ENTRA LA GENTE. El que la crea recibe un codigo corto. Lo pega en el
   grupo de WhatsApp. El que llega VE la liga sin cuenta y despues RECLAMA su
   equipo. Sin contrasenas: la identidad es la misma llave por navegador que ya
   usa el resto de la app.

   POR QUE UN DOCUMENTO VERSIONADO. Vercel Blob impone unos 60 segundos de cache
   sobre una ruta sobreescrita, letal para algo que cambia mientras diez
   personas lo miran. Cada escritura crea un blob NUEVO (vNNNNNN) y la lectura
   resuelve la version mas alta, igual que hace draftroom.js, que ya lleva
   meses en produccion con ese patron.

   LA HISTORIA SE CONGELA. Las temporadas cerradas no cambian nunca: se extraen
   UNA vez caminando previous_league_id hacia atras y se guardan dentro del
   documento. Solo la temporada viva se refresca.
   ============================================================================ */
const express = require('express');
const router = express.Router();
const { put, list, del } = require('@vercel/blob');
const crypto = require('crypto');
const { readAcctId, requireAcctId } = require('../lib/identity');

const PREFIX = 'ligas/';
const SLEEPER = 'https://api.sleeper.app/v1';
const cache = {};                 // code -> {ts, doc}
const CACHE_MS = 1200;            // corto: diez personas mirando la misma liga
const REFRESH_MS = 60 * 1000;     // un resync por liga por minuto, como mucho
const MAX_HISTORIA = 10;          // temporadas hacia atras

// Igual que perfil.js: sin token de Blob (o con LIGA_STORE=local) el hub cae a
// un archivo del disco. No es para produccion, es para que el gate pueda correr
// el flujo entero sin escribir en el almacen real ni depender de la red.
const fs = require('fs');
const path = require('path');
const os = require('os');
const LOCAL = process.env.LIGA_STORE === 'local' || !process.env.BLOB_READ_WRITE_TOKEN;
const DIR_LOCAL = process.env.LIGA_DIR || path.join(os.tmpdir(), 'macdraft-ligas');
function configurado() { return true; }   // siempre hay donde escribir
function almacen() { return LOCAL ? 'local' : 'blob'; }
function rutaLocal(code) { return path.join(DIR_LOCAL, code + '.json'); }

// Sin I ni O ni 0 ni 1: el codigo se dicta en voz alta y se teclea en un
// telefono. Un cero que alguien lee como o cuesta un mensaje de "no me sirve".
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function nuevoCodigo() {
  const b = crypto.randomBytes(6);
  let c = '';
  for (let i = 0; i < 6; i++) c += ALFA[b[i] % ALFA.length];
  return c;
}
const FORMA_CODIGO = /^[A-Z2-9]{6}$/;

async function sleeperGet(p) {
  const r = await fetch(SLEEPER + p);
  if (!r.ok) throw new Error('Sleeper ' + r.status + ' en ' + p);
  return r.json();
}

/* ------------------------------------------------------------ almacenamiento */
async function leer(code) {
  const c = cache[code];
  if (c && Date.now() - c.ts < CACHE_MS) return c.doc;
  if (LOCAL) {
    try {
      const doc = JSON.parse(fs.readFileSync(rutaLocal(code), 'utf8'));
      cache[code] = { ts: Date.now(), doc };
      return doc;
    } catch (_) { return null; }
  }
  const { blobs } = await list({ prefix: PREFIX + code + '-', limit: 100 });
  if (!blobs.length) return null;
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));   // vNNN descendente
  const r = await fetch(blobs[0].url);
  const doc = await r.json();
  // Nunca retroceder: si el CDN devolvio una version vieja, manda la que ya
  // teniamos en memoria.
  if (!c || (doc.v || 0) >= (c.doc.v || 0)) { cache[code] = { ts: Date.now(), doc }; return doc; }
  return c.doc;
}
async function escribir(doc) {
  doc.v = (doc.v || 0) + 1;
  doc.updatedAt = Date.now();
  cache[doc.code] = { ts: Date.now(), doc };
  if (LOCAL) {
    fs.mkdirSync(DIR_LOCAL, { recursive: true });
    fs.writeFileSync(rutaLocal(doc.code), JSON.stringify(doc));
    return doc;
  }
  const pathname = PREFIX + doc.code + '-' + String(doc.v).padStart(6, '0') + '.json';
  await put(pathname, JSON.stringify(doc), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0
  });
  try {
    const { blobs } = await list({ prefix: PREFIX + doc.code + '-', limit: 100 });
    const viejos = blobs.filter(b => b.pathname !== pathname);
    if (viejos.length) await del(viejos.map(b => b.url));
  } catch (_) { /* la limpieza es mejor-esfuerzo: nunca tumba una escritura */ }
  return doc;
}

/* ------------------------------------------------------------------ vista */
// Lo que sale a la calle. Los acctId son una llave de union interna: no se
// pueden reproducir como credencial, pero publicarlos dejaria a cualquiera
// correlacionar a la misma persona entre el foro, el mercado y sus ligas.
function publico(doc) {
  if (!doc) return null;
  const miembros = {};
  Object.keys(doc.members || {}).forEach(a => {
    const m = doc.members[a];
    miembros[m.teamId] = { claimed: true, name: m.name || null, role: m.role || 'member', at: m.joinedAt };
  });
  return {
    code: doc.code, v: doc.v, name: doc.name, season: doc.season,
    source: { kind: doc.source && doc.source.kind, teams: doc.teams },
    settings: doc.settings, roster_positions: doc.roster_positions,
    scoring_settings: doc.scoring_settings,
    rosters: doc.rosters, historia: doc.historia || [],
    block: doc.block || {}, proposals: doc.proposals || [],
    members: miembros, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    refreshedAt: doc.refreshedAt || null
  };
}

/* --------------------------------------------------- ingesta desde Sleeper */
async function fotoSleeper(leagueId) {
  const [liga, rosters, users] = await Promise.all([
    sleeperGet('/league/' + leagueId),
    sleeperGet('/league/' + leagueId + '/rosters'),
    sleeperGet('/league/' + leagueId + '/users')
  ]);
  const porId = {};
  (users || []).forEach(u => { porId[u.user_id] = u; });
  return {
    liga,
    rosters: (rosters || []).map(r => {
      const u = porId[r.owner_id] || {};
      const s = r.settings || {};
      return {
        teamId: r.roster_id,
        owner: (u.metadata && u.metadata.team_name) || u.display_name || ('Team ' + r.roster_id),
        manager: u.display_name || null,
        avatar: u.avatar || null,
        players: r.players || [],
        starters: r.starters || [],
        wins: Number(s.wins) || 0,
        losses: Number(s.losses) || 0,
        ties: Number(s.ties) || 0,
        fpts: Number(s.fpts || 0) + Number(s.fpts_decimal || 0) / 100,
        fpts_against: Number(s.fpts_against || 0) + Number(s.fpts_against_decimal || 0) / 100
      };
    })
  };
}

// La historia: se camina previous_league_id hacia atras. Existe solo si el
// comisionado RENOVO la liga cada ano; si creo una liga nueva a mano, no hay
// hilo y esto devuelve lo que haya, sin fingir lo que falta.
async function historiaSleeper(leagueId) {
  const out = [];
  let id = leagueId;
  for (let i = 0; i < MAX_HISTORIA && id && id !== '0'; i++) {
    let liga;
    try { liga = await sleeperGet('/league/' + id); } catch (_) { break; }
    const previo = liga.previous_league_id;
    if (i > 0) {   // la temporada viva no es historia
      let rosters = [], users = [], bracket = null;
      try {
        [rosters, users, bracket] = await Promise.all([
          sleeperGet('/league/' + id + '/rosters').catch(() => []),
          sleeperGet('/league/' + id + '/users').catch(() => []),
          sleeperGet('/league/' + id + '/winners_bracket').catch(() => null)
        ]);
      } catch (_) { /* una temporada que no se deja leer se salta */ }
      const porId = {};
      (users || []).forEach(u => { porId[u.user_id] = u; });
      const tabla = (rosters || []).map(r => {
        const u = porId[r.owner_id] || {};
        const s = r.settings || {};
        return {
          teamId: r.roster_id,
          // El nombre de ESE ano, no el de hoy: Sleeper guarda los usuarios por
          // liga-temporada y usar el actual reescribiria la historia.
          owner: (u.metadata && u.metadata.team_name) || u.display_name || ('Team ' + r.roster_id),
          wins: Number(s.wins) || 0, losses: Number(s.losses) || 0, ties: Number(s.ties) || 0,
          fpts: Number(s.fpts || 0) + Number(s.fpts_decimal || 0) / 100
        };
      }).sort((a, b) => (b.wins - a.wins) || (b.fpts - a.fpts));
      // El campeon sale del cuadro final (la llave con p === 1), que es el unico
      // sitio donde Sleeper lo dice sin ambiguedad.
      let campeon = null;
      if (Array.isArray(bracket)) {
        const final = bracket.filter(m => m && m.p === 1)[0];
        if (final && final.w != null) campeon = final.w;
      }
      out.push({
        season: String(liga.season || ''),
        name: liga.name || null,
        leagueId: id,
        teams: liga.total_rosters || tabla.length,
        champion: campeon,
        standings: tabla
      });
    }
    id = previo;
  }
  return out;
}

/* ------------------------------------------------------------------ rutas */

// POST /api/liga/new  {leagueId}
router.post('/new', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  const leagueId = String((req.body || {}).leagueId || '').trim();
  if (!/^\d{6,25}$/.test(leagueId)) return res.status(400).json({ error: 'bad league id' });
  try {
    // Una liga ya compartida no se comparte dos veces: el segundo codigo
    // partiria la conversacion de la misma liga en dos hubs.
    const yaHay = await buscarPorLiga(leagueId);
    if (yaHay) return res.json({ code: yaHay.code, reused: true, hub: publico(yaHay) });

    const foto = await fotoSleeper(leagueId);
    const historia = await historiaSleeper(leagueId).catch(() => []);
    const code = nuevoCodigo();
    const doc = {
      code, v: 0,
      createdAt: Date.now(), createdBy: acct,
      source: { kind: 'sleeper', leagueId },
      name: foto.liga.name || 'League',
      season: String(foto.liga.season || ''),
      teams: foto.liga.total_rosters || foto.rosters.length,
      settings: foto.liga.settings || {},
      roster_positions: foto.liga.roster_positions || [],
      scoring_settings: foto.liga.scoring_settings || {},
      rosters: foto.rosters,
      historia,
      members: {},
      block: {},
      proposals: [],
      refreshedAt: Date.now()
    };
    await escribir(doc);
    await anotarIndice(leagueId, code).catch(function () { });
    res.json({ code, hub: publico(doc), store: almacen() });
  } catch (e) {
    res.status(502).json({ error: String(e.message).slice(0, 180) });
  }
});

// Indice de liga -> codigo. Un documento chico y aparte, porque la alternativa
// (recorrer todos los hubs y abrir cada uno) es una lectura por liga existente
// CADA VEZ que alguien comparte una: barato hoy y carisimo en un ano.
const INDICE = PREFIX + '_index.json';
let idxCache = null, idxTs = 0;
async function leerIndice() {
  if (idxCache && Date.now() - idxTs < 5000) return idxCache;
  if (LOCAL) {
    try { idxCache = JSON.parse(fs.readFileSync(path.join(DIR_LOCAL, '_index.json'), 'utf8')); }
    catch (_) { idxCache = {}; }
    idxTs = Date.now();
    return idxCache;
  }
  try {
    const { blobs } = await list({ prefix: INDICE, limit: 1 });
    if (!blobs.length) { idxCache = {}; idxTs = Date.now(); return idxCache; }
    const r = await fetch(blobs[0].url);
    idxCache = await r.json(); idxTs = Date.now();
  } catch (_) { idxCache = idxCache || {}; }
  return idxCache;
}
async function anotarIndice(leagueId, code) {
  const idx = await leerIndice();
  idx[leagueId] = code;
  idxCache = idx; idxTs = Date.now();
  if (LOCAL) {
    fs.mkdirSync(DIR_LOCAL, { recursive: true });
    fs.writeFileSync(path.join(DIR_LOCAL, '_index.json'), JSON.stringify(idx));
    return;
  }
  await put(INDICE, JSON.stringify(idx), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0
  });
}
async function buscarPorLiga(leagueId) {
  const idx = await leerIndice();
  const code = idx[leagueId];
  if (!code) return null;
  const d = await leer(code).catch(() => null);
  // Un indice que apunta a un hub borrado no puede bloquear al que quiere
  // compartir: si no esta, se crea uno nuevo y el indice se corrige solo.
  return d || null;
}

// GET /api/liga/:code
router.get('/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!FORMA_CODIGO.test(code)) return res.status(400).json({ error: 'bad code' });
  if (!configurado()) return res.status(503).json({ error: 'sharing is not configured' });
  try {
    const doc = await leer(code);
    // Un codigo que no existe es un camino normal (alguien lo tecleo mal), no
    // una averia: 200 con found:false, porque Chrome imprime en consola
    // cualquier respuesta que no sea 2xx y en este repo eso cuenta como bug.
    if (!doc) return res.json({ found: false });
    const acct = readAcctId(req);
    const mio = acct && doc.members && doc.members[acct] ? doc.members[acct].teamId : null;
    res.json({ found: true, hub: publico(doc), myTeamId: mio });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 180) }); }
});

// POST /api/liga/:code/claim  {teamId}
router.post('/:code/claim', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  const code = String(req.params.code || '').toUpperCase();
  if (!FORMA_CODIGO.test(code)) return res.status(400).json({ error: 'bad code' });
  const teamId = Number((req.body || {}).teamId);
  try {
    const doc = await leer(code);
    if (!doc) return res.json({ found: false });
    if (!doc.rosters.some(r => r.teamId === teamId)) return res.status(400).json({ error: 'no such team' });
    // Un equipo ya reclamado por OTRO no se roba. El propio dueno puede
    // cambiarse de equipo (se equivoco al elegir), que es el caso real.
    const duenoActual = Object.keys(doc.members || {}).filter(a => doc.members[a].teamId === teamId)[0];
    if (duenoActual && duenoActual !== acct) return res.json({ ok: false, taken: true });
    doc.members = doc.members || {};
    doc.members[acct] = {
      teamId,
      name: (doc.rosters.filter(r => r.teamId === teamId)[0] || {}).owner || null,
      role: acct === doc.createdBy ? 'commish' : 'member',
      joinedAt: (doc.members[acct] && doc.members[acct].joinedAt) || Date.now()
    };
    await escribir(doc);
    res.json({ ok: true, myTeamId: teamId, hub: publico(doc) });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 180) }); }
});

// POST /api/liga/:code/refresh
router.post('/:code/refresh', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!FORMA_CODIGO.test(code)) return res.status(400).json({ error: 'bad code' });
  try {
    const doc = await leer(code);
    if (!doc) return res.json({ found: false });
    // Un tope por liga, no por persona: diez managers mirando la misma pantalla
    // dispararian diez resyncs identicos contra Sleeper.
    if (doc.refreshedAt && Date.now() - doc.refreshedAt < REFRESH_MS) {
      return res.json({ ok: true, skipped: true, hub: publico(doc) });
    }
    const foto = await fotoSleeper(doc.source.leagueId);
    doc.rosters = foto.rosters;
    doc.settings = foto.liga.settings || doc.settings;
    doc.name = foto.liga.name || doc.name;
    doc.refreshedAt = Date.now();
    await escribir(doc);
    res.json({ ok: true, hub: publico(doc) });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 180) }); }
});

/* -------------------------------------------------------------- el mercado */

// POST /api/liga/:code/block  {selling:[ids], wanting:[pos], note}
router.post('/:code/block', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  const code = String(req.params.code || '').toUpperCase();
  if (!FORMA_CODIGO.test(code)) return res.status(400).json({ error: 'bad code' });
  const b = req.body || {};
  try {
    const doc = await leer(code);
    if (!doc) return res.json({ found: false });
    const yo = doc.members && doc.members[acct];
    // Publicar en el mercado exige tener equipo: si no, cualquiera con el
    // codigo pondria en venta a los jugadores de otro.
    if (!yo) return res.json({ ok: false, needsTeam: true });
    const limpiar = (a, n) => Array.isArray(a) ? a.slice(0, n).map(x => String(x).slice(0, 24)) : [];
    doc.block = doc.block || {};
    doc.block[yo.teamId] = {
      selling: limpiar(b.selling, 25),
      wanting: limpiar(b.wanting, 8),
      note: String(b.note || '').slice(0, 140),
      at: Date.now()
    };
    await escribir(doc);
    res.json({ ok: true, hub: publico(doc) });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 180) }); }
});

// POST /api/liga/:code/proposal  {toTeamId, give:[ids], get:[ids], note}
router.post('/:code/proposal', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  const code = String(req.params.code || '').toUpperCase();
  if (!FORMA_CODIGO.test(code)) return res.status(400).json({ error: 'bad code' });
  const b = req.body || {};
  try {
    const doc = await leer(code);
    if (!doc) return res.json({ found: false });
    const yo = doc.members && doc.members[acct];
    if (!yo) return res.json({ ok: false, needsTeam: true });
    const to = Number(b.toTeamId);
    if (!doc.rosters.some(r => r.teamId === to) || to === yo.teamId) {
      return res.status(400).json({ error: 'bad target team' });
    }
    const ids = a => Array.isArray(a) ? a.slice(0, 10).map(x => String(x).slice(0, 24)) : [];
    doc.proposals = doc.proposals || [];
    if (doc.proposals.length >= 60) doc.proposals = doc.proposals.slice(-40);
    doc.proposals.push({
      id: crypto.randomBytes(6).toString('hex'),
      from: yo.teamId, to,
      give: ids(b.give), get: ids(b.get),
      note: String(b.note || '').slice(0, 200),
      by: acct,                      // se usa para permisos, nunca sale al publico
      at: Date.now(), votes: {}
    });
    await escribir(doc);
    res.json({ ok: true, hub: publico(doc) });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 180) }); }
});

// POST /api/liga/:code/vote  {id, vote:'yes'|'no'}
router.post('/:code/vote', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  const code = String(req.params.code || '').toUpperCase();
  if (!FORMA_CODIGO.test(code)) return res.status(400).json({ error: 'bad code' });
  const b = req.body || {};
  const voto = b.vote === 'yes' ? 'yes' : (b.vote === 'no' ? 'no' : null);
  if (!voto) return res.status(400).json({ error: 'bad vote' });
  try {
    const doc = await leer(code);
    if (!doc) return res.json({ found: false });
    const yo = doc.members && doc.members[acct];
    if (!yo) return res.json({ ok: false, needsTeam: true });
    const p = (doc.proposals || []).filter(x => x.id === String(b.id))[0];
    if (!p) return res.status(400).json({ error: 'no such proposal' });
    // Un voto por equipo, y las dos partes implicadas no votan lo suyo: el veto
    // lo decide la liga, no los que hicieron el trato.
    if (yo.teamId === p.from || yo.teamId === p.to) return res.json({ ok: false, involved: true });
    p.votes[String(yo.teamId)] = voto;
    await escribir(doc);
    res.json({ ok: true, hub: publico(doc) });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 180) }); }
});

// El servidor necesita leer un hub para pintar la previa del enlace (Open
// Graph) ANTES de servir el HTML. Se expone la lectura, no la escritura.
router.hubPorCodigo = async function (code) {
  const c = String(code || '').toUpperCase();
  if (!FORMA_CODIGO.test(c)) return null;
  try { return publico(await leer(c)); } catch (_) { return null; }
};

module.exports = router;
