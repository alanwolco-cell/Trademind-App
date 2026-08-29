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
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { requireAcctId, readAcctId } = require('../lib/identity');
const { construirPerfil, construirPerfiles } = require('../lib/perfil');
const tendenciasDraft = require('../lib/tendencias-draft');
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
  if (!acctId) return false;
  return acctsEnv().includes(acctId) || _extra.ids.includes(acctId);
}

/** La lista de env, que es la unica que sobrevive a un Blob caido. */
function acctsEnv() {
  return String(process.env.PERFIL_ACCTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// ── La segunda lista: los dispositivos vinculados con codigo ───────────────
// PERFIL_ACCTS solo entra con un deploy nuevo, y la cuenta de esta app es POR
// NAVEGADOR (sha256 de una llave aleatoria del localStorage). Reinstalar la PWA
// en el telefono crea almacenamiento nuevo, o sea un acctId nuevo, y el dueno
// se quedaba fuera de sus propias pantallas hasta que alguien redesplegara con
// el id copiado a mano. Por eso hay una segunda lista, en el mismo Blob que el
// resto del perfil, que el dueno alimenta desde un dispositivo YA permitido.
//
// Se cachea en memoria 60 s porque permitido() es sincrona y la llaman tres
// rutas por peticion. En Vercel cada instancia tiene su propia copia: tras un
// claim, la instancia que lo atendio la recarga en el acto (extraSync(true)) y
// las demas se ponen al dia dentro del minuto. La lista de env NUNCA depende
// de esto: si el Blob se cae, el dueno de siempre sigue entrando.
let _extra = { ids: [], at: 0 };
const EXTRA_TTL = 60 * 1000;

async function extraSync(forzar) {
  if (!forzar && _extra.at && Date.now() - _extra.at < EXTRA_TTL) return _extra.ids;
  try {
    const { doc } = await docRead(EXTRA_PATH, EXTRA_FILE);
    const ids = ((doc && Array.isArray(doc.accts)) ? doc.accts : [])
      .map(x => String((x && x.id) || ''))
      .filter(x => /^[0-9a-f]{32}$/.test(x));
    _extra = { ids, at: Date.now() };
  } catch (e) {
    // Fallar aqui no puede cerrar la puerta: se conserva lo ultimo leido y se
    // deja pasar el minuto antes de reintentar, para no golpear el Blob en cada
    // peticion cuando esta caido.
    _extra.at = Date.now();
    console.warn('[perfil] extra-accts:', e.message);
  }
  return _extra.ids;
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
          ronda: k.round, pos: k.metadata && k.metadata.position,
          // Largo del draft: sin el no se puede juzgar si un kicker en la
          // ronda 12 fue tarde o tempranisimo. Campo aditivo, nadie mas lo lee.
          rondasTotales: (d.settings && d.settings.rounds) || null
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
    await extraSync();
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
      // Auto-scouting de draft: cinco ejes probados contra los rivales de cada
      // sala, con correccion por comparaciones multiples. Clave nueva y aparte
      // a proposito: lo de arriba ya lo consume la pantalla y no se toca.
      tendenciasDraft: tendenciasDraft.analizarPorEjes(picksDraft, miRosterPorLiga, { formatoPorLiga }),
      ...construirPerfil(trades, players, ctx)
    };
    cache.set(key, salida);
    res.json(salida);
  } catch (e) {
    console.error('[perfil]', e.message);
    res.status(500).json({ error: 'could not build profile' });
  }
});

// ── Quien es el dueno, para la UI ─────────────────────────────────────────
// GET /api/perfil/owner -> { owner: true|false }. Siempre 200: My Rankings lo
// pregunta en cada apertura y una cuenta corriente NO puede ver un 403 en su
// consola por abrir un tab. La regla es la MISMA permitido() de arriba: no hay
// una segunda lista de duenos en ningun sitio.
router.get('/owner', async (req, res) => {
  const acct = readAcctId(req);
  res.set('Cache-Control', 'no-store');
  // El acctId propio viaja SIEMPRE, tambien cuando la respuesta es que no: es
  // lo que la pantalla necesita para poder decir "vincula este dispositivo" sin
  // abrir las herramientas de desarrollo. Es su propio hash, mostrado solo a el.
  if (acct) await extraSync();
  res.json({ owner: !!acct && permitido(acct), acctId: acct || '' });
});

// ── El documento de My Rankings del dueno ──────────────────────────────────
// UN solo documento, de nombre fijo, compartido por sus dos acctId (computadora
// y celular): la cuenta de esta app es POR NAVEGADOR, y lo que el dueno quiere
// es editar su lista desde el telefono y verla en la computadora. Vive en
// Vercel Blob con el mismo patron que los contadores de sage.js. Sin token
// (local, CI) cae a un archivo temporal, y la respuesta DECLARA en `store` de
// donde salio, para que un gate nunca crea que probo el blob sin probarlo.
//
// Tope: 200 KB de JSON. Ojo: el express.json global de server/index.js corta
// antes, en los 100 KB por defecto, asi que el tope efectivo es ese. El
// documento real (200 ids, precios y objetivos) anda por los 6 KB.
const RK_PATH = 'perfil/rankings-owner.json';
const RK_MAX = 200 * 1024;
const RK_FILE = process.env.PERFIL_RK_FILE
  || path.join(os.tmpdir(), 'macdraft-rankings-owner.json');
// Los codigos de vinculacion y las cuentas que ya se vincularon. Mismo almacen
// y mismo fallback que el documento de rankings: tres documentos, un solo
// mecanismo, para que un gate que prueba uno pruebe los tres.
const LINK_PATH = 'perfil/link-codes.json';
const LINK_FILE = process.env.PERFIL_LINK_FILE
  || path.join(os.tmpdir(), 'macdraft-link-codes.json');
const EXTRA_PATH = 'perfil/extra-accts.json';
const EXTRA_FILE = process.env.PERFIL_EXTRA_FILE
  || path.join(os.tmpdir(), 'macdraft-extra-accts.json');
const _mem = {};

function rkStore() {
  if (process.env.PERFIL_RK_STORE === 'local') return 'file';
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'file';
}

/** Lee un documento del Blob (o del archivo de respaldo). */
async function docRead(nombre, archivo) {
  const store = rkStore();
  if (store === 'blob') {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: nombre, limit: 1 });
    if (!blobs.length) return { doc: null, store };
    const r = await fetch(blobs[0].url + '?t=' + Date.now());
    if (!r.ok) throw new Error('blob read ' + r.status);
    const doc = await r.json();
    return { doc: (doc && typeof doc === 'object') ? doc : null, store };
  }
  try {
    const raw = require('fs').readFileSync(archivo, 'utf8');
    const doc = JSON.parse(raw);
    return { doc: (doc && typeof doc === 'object') ? doc : null, store };
  } catch (_) {
    return { doc: _mem[nombre] || null, store: _mem[nombre] ? 'memory' : store };
  }
}

async function docWrite(nombre, archivo, doc) {
  const store = rkStore();
  const raw = JSON.stringify(doc);
  if (store === 'blob') {
    const { put } = require('@vercel/blob');
    await put(nombre, raw, { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
    return store;
  }
  try { require('fs').writeFileSync(archivo, raw); return store; }
  catch (_) { _mem[nombre] = doc; return 'memory'; }
}

const rkRead = () => docRead(RK_PATH, RK_FILE);
const rkWrite = (doc) => docWrite(RK_PATH, RK_FILE, doc);

async function rkGuard(req, res) {
  const acct = requireAcctId(req, res);
  if (!acct) return '';
  await extraSync();
  if (!permitido(acct)) {
    res.status(403).json({ error: 'Rankings sync is not enabled for this account.', acctId: acct });
    return '';
  }
  return acct;
}

// GET /api/perfil/rankings -> { doc, updatedAt, store }
router.get('/rankings', async (req, res) => {
  if (!(await rkGuard(req, res))) return;
  res.set('Cache-Control', 'no-store');
  try {
    const r = await rkRead();
    res.json({ doc: r.doc, updatedAt: r.doc ? (Number(r.doc.updatedAt) || 0) : 0, store: r.store });
  } catch (e) {
    res.status(502).json({ error: 'Could not read the saved rankings.', detail: String(e.message || e).slice(0, 120) });
  }
});

// PUT /api/perfil/rankings  body: el documento entero. Se valida la forma,
// no el contenido: es la lista del dueno y el dueno manda.
router.put('/rankings', async (req, res) => {
  if (!(await rkGuard(req, res))) return;
  const doc = req.body;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return res.status(400).json({ error: 'Send a JSON object.' });
  if (doc.order != null && !Array.isArray(doc.order)) return res.status(400).json({ error: '`order` must be an array of ids.' });
  // Las respuestas del Tier Game. Se valida la FORMA de cada una, no su
  // contenido: una respuesta mal formada no rompe nada visible (la inferencia
  // la descarta), pero entra al documento y se sincroniza a los dos
  // dispositivos, y ahi ya es basura que sobrevive a un reinicio.
  if (doc.game != null) {
    if (!Array.isArray(doc.game)) return res.status(400).json({ error: '`game` must be an array of answers.' });
    for (const a of doc.game) {
      if (!a || typeof a !== 'object' || Array.isArray(a)
        || typeof a.a !== 'string' || typeof a.b !== 'string' || a.a === a.b
        || ![-2, -1, 0, 1, 2].includes(Number(a.v))) {
        return res.status(400).json({ error: '`game` entries must be {a, b, v} with v in -2..2 and a !== b.' });
      }
    }
  }
  for (const k of ['prices', 'targets', 'pref', 'breaks']) {
    if (doc[k] != null && typeof doc[k] !== 'object') return res.status(400).json({ error: '`' + k + '` must be an object or array.' });
  }
  const updatedAt = Number(doc.updatedAt) || Date.now();
  const out = Object.assign({}, doc, { updatedAt });
  const size = Buffer.byteLength(JSON.stringify(out));
  if (size > RK_MAX) return res.status(413).json({ error: 'Document is over 200 KB.', size });
  try {
    const store = await rkWrite(out);
    res.json({ ok: true, updatedAt, store, size });
  } catch (e) {
    res.status(502).json({ error: 'Could not save the rankings.', detail: String(e.message || e).slice(0, 120) });
  }
});

// ── Vincular otro dispositivo con un codigo ────────────────────────────────
// El problema que resuelve: la cuenta es por navegador, asi que reinstalar la
// PWA, estrenar telefono o abrir en otro navegador deja al dueno fuera de sus
// propias pantallas, y la unica salida era copiar un hash a mano dentro de una
// variable de Vercel y redesplegar. Ahora un dispositivo YA permitido pide un
// codigo de seis digitos y el dispositivo nuevo lo teclea.
//
// Por que un codigo corto es seguro aqui: vive diez minutos, sirve una sola
// vez, y solo existe mientras el dueno lo tiene en pantalla. Aun asi seis
// digitos son un millon de combinaciones, y la cuenta que adivina es gratis de
// fabricar (cualquiera puede minar llaves nuevas), asi que el limite por cuenta
// no basta: hay ADEMAS un limite global de intentos fallidos por ventana. Sin
// el, mil cuentas nuevas darian cinco mil tiros cada diez minutos.
const LINK_TTL = 10 * 60 * 1000;
const LINK_TRIES = 5;        // intentos por cuenta y ventana
const LINK_TRIES_ALL = 60;   // ...y de todas las cuentas juntas
const LINK_MAX = 20;         // codigos que se conservan en el documento
const _tries = new Map();
let _triesAll = { n: 0, until: 0 };

/** true cuando este intento NO se permite. Cuenta el intento cuando si. */
function linkThrottle(acct) {
  const ahora = Date.now();
  if (_triesAll.until < ahora) _triesAll = { n: 0, until: ahora + LINK_TTL };
  let t = _tries.get(acct);
  if (!t || t.until < ahora) { t = { n: 0, until: ahora + LINK_TTL }; _tries.set(acct, t); }
  if (t.n >= LINK_TRIES || _triesAll.n >= LINK_TRIES_ALL) return true;
  t.n++; _triesAll.n++;
  // El mapa no puede crecer sin fin con cuentas de un solo intento.
  if (_tries.size > 500) for (const [k, v] of _tries) if (v.until < ahora) _tries.delete(k);
  return false;
}

/** Los codigos que todavia importan: los vivos y los usados hace poco. Un
 *  usado se conserva hasta que expira para poder decir "ya se uso" en vez de
 *  "no existe", que es la diferencia entre saber que paso y no saberlo. */
function linkVigentes(doc, ahora) {
  return ((doc && Array.isArray(doc.codes)) ? doc.codes : [])
    .filter(c => c && typeof c.code === 'string' && Number(c.exp) > ahora - LINK_TTL);
}

// POST /api/perfil/link/new -> { code, expiresAt }
// Solo una cuenta que YA es del dueno reparte codigos. Si esto no fuera asi,
// cualquiera podria fabricarse su propia llave de entrada.
router.post('/link/new', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  await extraSync();
  if (!permitido(acct)) {
    return res.status(403).json({ error: 'Only a linked device can create a code.', acctId: acct });
  }
  res.set('Cache-Control', 'no-store');
  try {
    const ahora = Date.now();
    const { doc } = await docRead(LINK_PATH, LINK_FILE);
    const codes = linkVigentes(doc, ahora);
    let code = '';
    do { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
    while (codes.some(c => c.code === code && !c.used && Number(c.exp) > ahora));
    const expiresAt = ahora + LINK_TTL;
    codes.push({ code, exp: expiresAt, by: acct, at: ahora, used: false });
    await docWrite(LINK_PATH, LINK_FILE, { v: 1, codes: codes.slice(-LINK_MAX), updatedAt: ahora });
    res.json({ code, expiresAt, ttl: LINK_TTL });
  } catch (e) {
    res.status(502).json({ error: 'Could not create a code.', detail: String(e.message || e).slice(0, 120) });
  }
});

// POST /api/perfil/link/claim  body {code} -> { owner:true } | { owner:false, error }
// Cualquier cuenta con llave puede intentarlo; el codigo es lo que autoriza.
//
// Un codigo rechazado responde 200, no 400. No es purismo al reves: Chrome
// imprime en la consola CUALQUIER fetch que no sea 2xx, y en este repo un error
// de consola cuenta como bug, no como ruido. Teclear mal seis digitos es un
// camino normal de usuario, no una averia, y ya hay precedente en /owner, que
// tambien responde 200 para no ensuciar la consola de quien no es el dueno. Lo
// que si sigue siendo un codigo de error es lo que el usuario no puede
// provocar tecleando: sin llave (401), cuerpo mal formado (400) y el almacen
// caido (502).
router.post('/link/claim', async (req, res) => {
  const acct = requireAcctId(req, res);
  if (!acct) return;
  res.set('Cache-Control', 'no-store');
  const rechazo = (error) => res.json({ owner: false, error });
  const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ owner: false, error: 'Enter the 6 digit code.' });
  if (linkThrottle(acct)) {
    return rechazo('Too many tries. Wait a few minutes, then ask for a new code.');
  }
  try {
    const ahora = Date.now();
    const { doc } = await docRead(LINK_PATH, LINK_FILE);
    const codes = linkVigentes(doc, ahora);
    const hit = codes.find(c => c.code === code);
    if (!hit) return rechazo('That code is not valid.');
    if (hit.used) return rechazo('That code was already used. Ask for a new one.');
    if (!(Number(hit.exp) > ahora)) return rechazo('That code expired. Ask for a new one.');

    // Primero entra la cuenta, despues se quema el codigo: al reves, un fallo a
    // mitad de camino dejaria el codigo gastado sin haber vinculado a nadie, y
    // el dueno no tendria como saberlo desde el telefono.
    const prev = await docRead(EXTRA_PATH, EXTRA_FILE);
    const accts = ((prev.doc && Array.isArray(prev.doc.accts)) ? prev.doc.accts : [])
      .filter(x => x && /^[0-9a-f]{32}$/.test(String(x.id || '')));
    if (!accts.some(x => x.id === acct)) accts.push({ id: acct, at: ahora, by: hit.by || '' });
    await docWrite(EXTRA_PATH, EXTRA_FILE, { v: 1, accts, updatedAt: ahora });

    hit.used = true; hit.usedBy = acct; hit.usedAt = ahora;
    await docWrite(LINK_PATH, LINK_FILE, { v: 1, codes: codes.slice(-LINK_MAX), updatedAt: ahora });

    await extraSync(true);
    res.json({ owner: true, acctId: acct });
  } catch (e) {
    res.status(502).json({ error: 'Could not link this device.', detail: String(e.message || e).slice(0, 120) });
  }
});

module.exports = router;
