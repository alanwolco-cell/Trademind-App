const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// ── Yahoo Fantasy OAuth import ──────────────────────────────────────────────
// NO FUNCIONA, y no es por el codigo. Medido contra Yahoo el 2026-08-24, con la
// app real y sus credenciales, cambiando UNA cosa por vez:
//
//   redirect_uri=macdraft.app      -> error=invalid_request "invalid redirect uri"
//   redirect_uri=trademindff.com   -> error=invalid_scope   "invalid scope"
//   trademindff.com + scope=openid -> 302 a login.yahoo.com, entra bien
//
// O sea dos bloqueos apilados, y el segundo es el que manda:
//
//   1. NUESTRO, barato: la app de Yahoo sigue registrada con el dominio viejo
//      (trademindff.com) y produccion ya manda macdraft.app. Se arregla anadiendo
//      https://macdraft.app/api/yahoo/callback a los Redirect URI de la app.
//   2. DE YAHOO, y es el de verdad: `fspt-r` sale rechazado incluso desde el
//      dominio registrado. El control con scope=openid pasa con la MISMA app,
//      asi que el OAuth esta sano: lo que falta es el permiso de Fantasy Sports.
//      Yahoo cerro el acceso self-serve; hoy hay que solicitarlo en
//      https://sports.yahoo.com/developer/ y esperar aprobacion, y la consola de
//      apps ya no ofrece ese permiso para marcarlo. Hasta que aprueben la
//      solicitud NO hay forma de conectar una liga de Yahoo, con ningun codigo.
//
// El frontend muestra el boton en cuanto /api/yahoo/status dice configured, y
// configured solo mira que existan las credenciales: por eso el boton esta vivo
// en produccion llevando a una pagina de error de Yahoo.

const YAHOO_AUTH = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_FANTASY = 'https://fantasysports.yahooapis.com/fantasy/v2';

function configured() {
  return !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);
}

function redirectUri(req) {
  if (process.env.YAHOO_REDIRECT_URI) return process.env.YAHOO_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/yahoo/callback`;
}

// Yahoo's fantasy JSON nests each entity as an array of small objects.
// Merge every object found under a node into one flat record.
function flattenEntity(node) {
  const out = {};
  (function walk(x) {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) {
        const v = x[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'name') continue;
        out[k] = v;
      }
      Object.assign(out, typeof x.name === 'object' ? { name: x.name } : {});
    }
  })(node);
  return out;
}

function deepCollect(node, key, acc) {
  if (!node || typeof node !== 'object') return acc;
  if (node[key] !== undefined) acc.push(node[key]);
  for (const k of Object.keys(node)) {
    if (node[k] && typeof node[k] === 'object') deepCollect(node[k], key, acc);
  }
  return acc;
}

async function yahooGet(pathPart, token) {
  const res = await fetch(`${YAHOO_FANTASY}${pathPart}?format=json`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[yahoo] %d %s: %s', res.status, pathPart, body.slice(0, 220));
    // El mensaje viaja hasta la ventana del usuario. Un "returned 401" a secas
    // obliga a una ronda de preguntas para saber que paso; el motivo que manda
    // Yahoo suele decirlo en una linea. Se recorta y se limpia de saltos.
    const motivo = String(body).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error('Yahoo Fantasy API returned ' + res.status + (motivo ? ': ' + motivo : ''));
  }
  return res.json();
}

function popupReply(res, payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  res.set('Content-Type', 'text/html').send(
    '<!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
    '<div id="msg">Finishing up...</div>' +
    '<script>var p=' + json + ';' +
    // Al propio origen y no a "*": desde que el mensaje lleva un token de
    // Yahoo, mandarlo a cualquier ventana seria repartirlo.
    'if(window.opener){window.opener.postMessage({type:"trademind-yahoo",payload:p},window.location.origin);' +
    'document.getElementById("msg").textContent=p.error?("Import failed: "+p.error):"Roster imported. You can close this window.";' +
    'setTimeout(function(){window.close();},1200);}' +
    'else{document.getElementById("msg").textContent=p.error?("Import failed: "+p.error):"Roster loaded. Open Mac Draft and try the Yahoo login again.";}' +
    '</script></body></html>'
  );
}

// GET /api/yahoo/status
router.get('/status', (req, res) => {
  res.json({ configured: configured() });
});

// GET /api/yahoo/login — kick off the OAuth dance in a popup
router.get('/login', (req, res) => {
  if (!configured()) return res.status(503).send('Yahoo login is not configured yet.');
  // SIN scope explicito, y esto NO es un descuido.
  //
  // Medido con el dueno el 2026-09-09, misma app, mismo redirect, cambiando solo
  // el scope:
  //   scope=fspt-r  -> tras el login, error=invalid_scope
  //   sin scope     -> pantalla de permiso normal, y vuelve al callback
  //
  // Yahoo aplica los permisos que la app tiene marcados en su consola (Fantasy
  // Sports - Read), asi que pedirlo por parametro no anade nada y ahi rompia.
  // Queda una valvula por si algun dia hace falta: YAHOO_SCOPE lo vuelve a
  // mandar sin tocar codigo.
  const params = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    language: 'en-us'
  });
  if (process.env.YAHOO_SCOPE) params.set('scope', process.env.YAHOO_SCOPE);
  res.redirect(`${YAHOO_AUTH}?${params}`);
});

// GET /api/yahoo/callback — exchange code, pull NFL teams + rosters, hand to opener
router.get('/callback', async (req, res) => {
  if (!configured()) return res.status(503).send('Yahoo login is not configured yet.');
  const { code, error, error_description } = req.query;
  if (error || !code) {
    const detail = error
      ? (String(error) + (error_description ? ': ' + error_description : ''))
      : (Object.keys(req.query).length
          ? 'Yahoo sent no login code (it returned: ' + Object.keys(req.query).join(', ') + '). This is usually a redirect URI mismatch in the Yahoo app.'
          : 'This page opened without a Yahoo login. Start from the "Sign in with Yahoo" button, do not open this link directly.');
    return popupReply(res, { error: detail });
  }
  try {
    const basic = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch(YAHOO_TOKEN, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(req)
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      // Distinguir "el codigo no sirve" de "las credenciales no cuadran" ahorra
      // una noche entera de suposiciones.
      throw new Error('Token exchange failed (' + tokenRes.status + ')'
        + (tokenData.error ? ': ' + tokenData.error : '')
        + (tokenData.error_description ? ' - ' + String(tokenData.error_description).slice(0, 140) : ''));
    }
    const token = tokenData.access_token;

    // All of the user's NFL fantasy teams (any season Yahoo still exposes; nfl = current)
    const teamsJson = await yahooGet('/users;use_login=1/games;game_keys=nfl/teams', token);
    const rawTeams = deepCollect(teamsJson, 'team', []);
    const teams = rawTeams.map(t => flattenEntity(t)).filter(t => t.team_key);
    if (!teams.length) return popupReply(res, { error: 'No Yahoo fantasy football teams found on this account.' });

    // Pull each roster (cap at 6 teams to keep the callback snappy)
    const results = [];
    for (const t of teams.slice(0, 6)) {
      try {
        const rosterJson = await yahooGet(`/team/${t.team_key}/roster`, token);
        const rawPlayers = deepCollect(rosterJson, 'player', []);
        const players = rawPlayers
          .map(p => flattenEntity(p))
          .filter(p => p.name && p.name.full)
          .map(p => ({
            name: p.name.full,
            position: p.display_position || '',
            team: p.editorial_team_abbr || ''
          }));
        if (players.length) {
          results.push({
            team_key: t.team_key,
            team_name: (typeof t.name === 'object' ? t.name.full : t.name) || 'My Yahoo Team',
            players
          });
        }
      } catch (_) { /* skip teams whose roster call fails */ }
    }
    // El token viaja al navegador del usuario, que es donde vive (ver la nota
    // larga mas abajo). Sin esto, My Leagues tendria que mandarlo a loguearse
    // otra vez en cada visita.
    const credenciales = {
      access_token: token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: Date.now() + (Number(tokenData.expires_in) || 3600) * 1000
    };
    if (!results.length) return popupReply(res, { error: 'Could not read any rosters from Yahoo.', token: credenciales });
    popupReply(res, { teams: results, token: credenciales });
  } catch (e) {
    popupReply(res, { error: e.message });
  }
});


/* ============================================================================
   LIGAS DE YAHOO (aprobado el 2026-09-08, despues de un mes de espera)

   Comprobado ese dia contra la app real: scope=fspt-r con
   redirect_uri=https://macdraft.app/api/yahoo/callback devuelve 302 al login de
   Yahoo. En agosto ese mismo par devolvia invalid_scope: el permiso de Fantasy
   Sports ya esta concedido.

   DONDE VIVE EL TOKEN, Y POR QUE. El token se queda en el NAVEGADOR del
   usuario, no en nuestro almacen. Guardarlo del lado del servidor convertiria
   nuestro Blob en un cofre de credenciales de terceros: una sola fuga se
   llevaria las cuentas de Yahoo de todos. Del lado del cliente, el peor caso es
   una cuenta, y el permiso es de SOLO LECTURA de fantasy. El token viaja en la
   cabecera a nuestro proxy y NUNCA se escribe en un log.
   Si algun dia hace falta refrescar sin el usuario presente (un aviso por
   correo, un resumen nocturno), esta decision hay que revisarla.
   ============================================================================ */

// El token entra por cabecera, nunca por la URL: las URLs se quedan escritas en
// los logs del servidor, del proxy y del navegador.
function tokenDe(req) {
  const h = req.headers['x-yahoo-token'];
  return (typeof h === 'string' && h.length > 20) ? h : null;
}
function exigeToken(req, res) {
  const t = tokenDe(req);
  if (!t) { res.status(401).json({ error: 'not connected to Yahoo' }); return null; }
  return t;
}
// Un token caducado no es un fallo nuestro ni del usuario: es el ciclo normal
// de OAuth, y el cliente sabe rehacerlo. Se responde 401 con una senal clara.
function respondeYahoo(res, e) {
  const msg = String(e && e.message || e);
  if (/ 401|token/i.test(msg)) return res.status(401).json({ error: 'yahoo session expired', expired: true });
  res.status(502).json({ error: msg.slice(0, 200) });
}

// Yahoo entrega numeros como cadenas y anida cada entidad en una lista de
// objetos sueltos. Estas dos aplanan sin perder lo que importa.
const numY = (v, d) => { const x = Number(v); return isFinite(x) ? x : d; };

// De las "stat modifiers" de Yahoo al mismo vocabulario que ya usa Sleeper,
// para que el resto del producto no tenga que saber de que plataforma vino la
// liga. Los stat_id son los de NFL en Yahoo.
const YSTAT = {
  4: 'pass_yd', 5: 'pass_td', 6: 'pass_int',
  9: 'rush_yd', 10: 'rush_td',
  11: 'rec', 12: 'rec_yd', 13: 'rec_td'
};
function scoringDeYahoo(ajustes) {
  // Yahoo esconde los modificadores en settings -> stat_modifiers -> stats ->
  // [{stat: {stat_id, value}}], y ADEMAS lista los mismos stat_id sin value en
  // stat_categories. La forma robusta: recoger TODAS las entidades 'stat' del
  // documento y quedarse solo con las que traen value, que son los
  // modificadores. El dueno confirmo que sus ligas de Yahoo son half PPR y
  // salian preciadas como standard: el parseo anterior devolvia vacio.
  const out = {};
  deepCollect(ajustes, 'stat', []).map(x => flattenEntity(x)).forEach(st => {
    if (!st || st.value == null) return;
    const k = YSTAT[numY(st.stat_id, -1)];
    if (k) out[k] = numY(st.value, 0);
  });
  return out;
}

// GET /api/yahoo/leagues - todas las ligas de NFL del usuario, normalizadas al
// mismo molde que devuelve Sleeper, que es lo que hace que My Leagues no tenga
// que ramificar por plataforma.
router.get('/leagues', async (req, res) => {
  const token = exigeToken(req, res); if (!token) return;
  try {
    const j = await yahooGet('/users;use_login=1/games;game_keys=nfl/leagues', token);
    const ligas = deepCollect(j, 'league', []).map(l => flattenEntity(l)).filter(l => l.league_key);
    // Las ligas repetidas salen dos veces por como Yahoo anida su respuesta.
    const vistas = {};
    const out = [];
    for (const l of ligas) {
      if (vistas[l.league_key]) continue;
      vistas[l.league_key] = 1;
      out.push({
        league_key: l.league_key,
        league_id: l.league_id,
        name: typeof l.name === 'object' ? l.name.full : l.name,
        logo: l.logo_url || null,
        season: String(l.season || ''),
        num_teams: numY(l.num_teams, 0),
        scoring_type: l.scoring_type || '',
        current_week: numY(l.current_week, 0),
        start_week: numY(l.start_week, 1),
        end_week: numY(l.end_week, 17),
        playoff_start_week: numY(l.playoff_start_week, 15),
        is_finished: numY(l.is_finished, 0) === 1,
        draft_status: l.draft_status || ''
      });
    }
    res.json({ leagues: out });
  } catch (e) { respondeYahoo(res, e); }
});

// GET /api/yahoo/league/:key - reglamento, equipos, standings y planteles.
// Es la llamada cara (una por liga), asi que trae todo de una vez.
router.get('/league/:key', async (req, res) => {
  const token = exigeToken(req, res); if (!token) return;
  const key = String(req.params.key || '');
  if (!/^[\w.-]{3,40}$/.test(key)) return res.status(400).json({ error: 'bad league key' });
  try {
    const [ajustes, equipos] = await Promise.all([
      yahooGet(`/league/${key}/settings`, token),
      yahooGet(`/league/${key}/teams`, token)
    ]);
    const liga = flattenEntity(deepCollect(ajustes, 'league', [])[0] || {});
    const set = flattenEntity(deepCollect(ajustes, 'settings', [])[0] || {});
    const roster_positions = deepCollect(ajustes, 'roster_position', [])
      .map(rp => flattenEntity(rp))
      .filter(rp => rp.position)
      .flatMap(rp => Array(Math.max(1, numY(rp.count, 1))).fill(String(rp.position)));

    const eqs = deepCollect(equipos, 'team', []).map(t => flattenEntity(t)).filter(t => t.team_key);
    const vistos = {};
    const teams = [];
    for (const t of eqs) {
      if (vistos[t.team_key]) continue;
      vistos[t.team_key] = 1;
      // DOS imagenes distintas, y hasta hoy solo pedia una:
      //   team_logos -> team_logo -> url   es el escudo del EQUIPO (muchas
      //     veces el generico que pone Yahoo);
      //   managers -> manager -> image_url es la FOTO DE PERFIL de la persona,
      //     que es la que de verdad identifica a un rival en una liga de
      //     amigos.
      // Se prefiere la foto de la persona y el escudo queda de respaldo. Si no
      // hay ninguna, la pantalla dibuja un monograma con el color de la liga:
      // nunca un circulo vacio.
      let escudo = null, cara = null;
      try {
        const logos = deepCollect(t, 'team_logo', []).map(x => flattenEntity(x));
        escudo = (logos.filter(x => x && x.url)[0] || {}).url || null;
      } catch (_) { }
      try {
        const gente = deepCollect(t, 'manager', []).map(x => flattenEntity(x));
        const conFoto = gente.filter(x => x && x.image_url)[0];
        cara = conFoto ? conFoto.image_url : null;
        // Yahoo sirve una silueta gris para el que no subio foto. Esa no es una
        // foto, es un hueco con forma de foto: mejor el monograma de color.
        if (cara && /profile_b1|default_user|silhouette/i.test(cara)) cara = null;
      } catch (_) { }
      teams.push({
        team_key: t.team_key,
        team_id: numY(t.team_id, 0),
        name: typeof t.name === 'object' ? t.name.full : t.name,
        // EL ESCUDO DEL EQUIPO MANDA (correccion del dueno, 2026-09-10: la foto
        // de "Family Feud" salia mal). El escudo es lo que la liga reconoce
        // dentro de Yahoo; la foto de perfil del manager puede ser vieja o de
        // otra cosa, y solo sirve de respaldo cuando no hay escudo.
        logo: escudo || cara,
        teamLogo: escudo,
        managerPhoto: cara,
        is_owned_by_current_login: numY(t.is_owned_by_current_login, 0) === 1,
        wins: null, losses: null, ties: null, points_for: null,
        players: []
      });
    }

    // Standings y planteles, en paralelo pero acotado: una liga de doce son doce
    // llamadas y Yahoo corta al que se le echa encima.
    const standings = await yahooGet(`/league/${key}/standings`, token).catch(() => null);
    if (standings) {
      deepCollect(standings, 'team', []).map(t => flattenEntity(t)).forEach(t => {
        const dest = teams.filter(x => x.team_key === t.team_key)[0];
        if (!dest) return;
        const out = flattenEntity(t.team_standings || {});
        const rec = (t.team_standings && t.team_standings.outcome_totals) || out.outcome_totals || {};
        dest.wins = numY(rec.wins, null);
        dest.losses = numY(rec.losses, null);
        dest.ties = numY(rec.ties, null);
        dest.points_for = numY(out.points_for != null ? out.points_for : (t.team_points && t.team_points.total), null);
      });
    }

    const tanda = 4;
    for (let i = 0; i < teams.length; i += tanda) {
      const trozo = teams.slice(i, i + tanda);
      await Promise.all(trozo.map(async t => {
        try {
          const rj = await yahooGet(`/team/${t.team_key}/roster`, token);
          t.players = deepCollect(rj, 'player', []).map(p => flattenEntity(p))
            .filter(p => p.name && p.name.full)
            .map(p => ({
              player_key: p.player_key,
              name: p.name.full,
              pos: p.display_position || (p.primary_position || ''),
              team: p.editorial_team_abbr || 'FA',
              status: p.status || ''
            }));
        } catch (_) { /* un plantel que falla no tumba la liga entera */ }
      }));
    }

    res.json({
      league: {
        league_key: key,
        logo: liga.logo_url || null,
        name: typeof liga.name === 'object' ? liga.name.full : liga.name,
        num_teams: numY(liga.num_teams, teams.length),
        season: String(liga.season || ''),
        current_week: numY(liga.current_week, 0),
        playoff_start_week: numY(set.playoff_start_week || liga.playoff_start_week, 15),
        num_playoff_teams: numY(set.num_playoff_teams, 6),
        draft_status: liga.draft_status || set.draft_status || '',
        roster_positions,
        scoring_settings: scoringDeYahoo(ajustes)
      },
      teams
    });
  } catch (e) { respondeYahoo(res, e); }
});

// GET /api/yahoo/league/:key/scoreboard?week=N - los duelos de una semana.
router.get('/league/:key/scoreboard', async (req, res) => {
  const token = exigeToken(req, res); if (!token) return;
  const key = String(req.params.key || '');
  const week = parseInt(req.query.week, 10);
  if (!/^[\w.-]{3,40}$/.test(key)) return res.status(400).json({ error: 'bad league key' });
  if (!Number.isInteger(week) || week < 1 || week > 22) return res.status(400).json({ error: 'week must be 1-22' });
  try {
    const j = await yahooGet(`/league/${key}/scoreboard;week=${week}`, token);
    const duelos = deepCollect(j, 'matchup', []).map(m => {
      // OJO: flattenEntity DESCARTA los objetos anidados (salvo name), asi que
      // team_points hay que sacarlo del nodo CRUDO de cada equipo, antes de
      // aplanar. El primer intento lo leia del aplanado y siempre daba cero.
      const crudos = deepCollect(m, 'team', []);
      const claves = [], puntos = [];
      crudos.forEach(nodo => {
        const t = flattenEntity(nodo);
        if (!t.team_key || claves.indexOf(t.team_key) !== -1) return;
        claves.push(t.team_key);
        // team_points -> total: el marcador EN VIVO del duelo. Sin esto las
        // ligas de Yahoo enseñaban proyeccion con el partido en curso.
        const tp = deepCollect(nodo, 'team_points', []).map(x => flattenEntity(x))
          .filter(x => x && x.total != null)[0] || {};
        puntos.push(Number(tp.total) || 0);
      });
      return { week, teams: claves.slice(0, 2), points: puntos.slice(0, 2) };
    }).filter(d => d.teams.length === 2);
    // El mismo duelo puede venir repetido por el anidamiento de Yahoo.
    const vistos = {}, out = [];
    duelos.forEach(d => {
      const k = d.teams.slice().sort().join('|');
      if (vistos[k]) return;
      vistos[k] = 1; out.push(d);
    });
    res.json({ week, matchups: out });
  } catch (e) { respondeYahoo(res, e); }
});

// POST /api/yahoo/refresh - un token de acceso dura una hora. El de refresco lo
// guarda el navegador y se cambia aqui, que es donde vive el secreto de la app.
router.post('/refresh', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'not configured' });
  const rt = req.body && req.body.refresh_token;
  if (!rt || typeof rt !== 'string') return res.status(400).json({ error: 'missing refresh_token' });
  try {
    const basic = Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64');
    const r = await fetch(YAHOO_TOKEN, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, redirect_uri: redirectUri(req) })
    });
    const d = await r.json();
    if (!d.access_token) return res.status(401).json({ error: 'refresh failed', expired: true });
    res.json({ access_token: d.access_token, refresh_token: d.refresh_token || rt, expires_in: numY(d.expires_in, 3600) });
  } catch (e) { res.status(502).json({ error: String(e.message).slice(0, 200) }); }
});

module.exports = router;
