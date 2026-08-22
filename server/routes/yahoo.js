const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// ── Yahoo Fantasy OAuth import ──────────────────────────────────────────────
// DORMANT until credentials exist. To activate:
//   1. Create an app at https://developer.yahoo.com/apps/create/
//      - API Permissions: Fantasy Sports (Read)
//      - Redirect URI: https://trademindff.com/api/yahoo/callback
//   2. Add YAHOO_CLIENT_ID + YAHOO_CLIENT_SECRET to Vercel env, redeploy.
// The frontend checks /api/yahoo/status and shows the login button automatically.

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
    console.error('[yahoo] %d: %s', res.status, body.slice(0, 220));
    throw new Error('Yahoo Fantasy API returned ' + res.status);
  }
  return res.json();
}

function popupReply(res, payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  res.set('Content-Type', 'text/html').send(
    '<!doctype html><html><body style="font-family:sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
    '<div id="msg">Finishing up...</div>' +
    '<script>var p=' + json + ';' +
    'if(window.opener){window.opener.postMessage({type:"trademind-yahoo",payload:p},"*");' +
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
  const params = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'fspt-r', // Fantasy Sports read - requested at auth time (the app console no longer lists it)
    language: 'en-us'
  });
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
    if (!tokenData.access_token) throw new Error(tokenData.error_description || 'Token exchange failed.');
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
    if (!results.length) return popupReply(res, { error: 'Could not read any rosters from Yahoo.' });
    popupReply(res, { teams: results });
  } catch (e) {
    popupReply(res, { error: e.message });
  }
});

module.exports = router;
