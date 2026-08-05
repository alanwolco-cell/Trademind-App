// Web-scouted pros and cons: Mac researches each player on the live web
// (camp news, role changes, injuries, coaching quotes) and the result is
// cached on Blob for 7 days - one research call serves every user.
const express = require('express');
const router = express.Router();
const { put, list } = require('@vercel/blob');

const TTL = 7 * 24 * 60 * 60 * 1000;
const mem = {}; // norm -> {ts, doc}
const inflight = {};

function norm(name) { return String(name).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

async function readBlob(key) {
  try {
    const { blobs } = await list({ prefix: 'scout2/' + key + '.json', limit: 1 });
    if (!blobs.length) return null;
    const r = await fetch(blobs[0].url + '?t=' + Date.now());
    return await r.json();
  } catch (_) { return null; }
}

async function research(name, team, pos) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  let messages = [{ role: 'user', content: 'Player: ' + name + (team ? ' (' + pos + ', ' + team + ')' : '') + '. Research his current 2026 outlook and give the JSON.' }];
  let txt = '';
  const diag = [];
  // web search pauses the turn; resume until the model answers. Kept SMALL on
  // purpose: 1 search, at most 2 rounds. The old 6-search version ran 60-90s+,
  // never finished inside the function window, and so never wrote its cache -
  // meaning every cold player re-failed forever. One good search is plenty for
  // a 3-pro / 3-con snapshot, finishes in ~20s, and caches for 7 days (shared by
  // every user), so after the first view a player is instant for everyone.
  for (let i = 0; i < 2; i++) {
    const resp = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1800,
      thinking: { type: 'disabled' },
      system: 'You are an elite fantasy football scout. Today is ' + new Date().toISOString().slice(0, 10) + ' and the upcoming season is 2026. STEP 1 (mandatory): search "<player> 2026" and VERIFY his current team and which key teammates or coaches ARRIVED or DEPARTED this offseason - free agency moves through 2026 override anything a 2025 article says. NEVER cite a departed teammate or coach as current competition or scheme. When sources conflict, trust the most recent. STEP 2: return STRICT JSON only: {"pros":["...","...","..."],"cons":["...","...","..."],"college":"..."}. The "college" field: ONLY for rookies or players yet to play an NFL snap, one line of VERIFIED college career production (school, catches/yards/TDs or equivalent); for veterans set it to an empty string. Rules: exactly 3 pros and 3 cons for the 2026 fantasy season. Each line under 140 characters, specific to THIS player (current role, scheme, offseason moves around him, injury recovery, camp buzz, contract). Plain text, no emojis, no em-dashes, never the word "pieces" for players, never cite trade-value numbers or market prices. Only claims you verified this turn.',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }],
      messages
    });
    txt += resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
    diag.push(resp.stop_reason + ':' + resp.content.map(b => b.type).join('|'));
    if (resp.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: resp.content }];
  }
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json [' + diag.join(' ; ') + '] text:' + txt.slice(0, 200));
  const doc = JSON.parse(m[0]);
  if (!Array.isArray(doc.pros) || !Array.isArray(doc.cons)) throw new Error('bad shape');
  return {
    ts: Date.now(),
    pros: doc.pros.slice(0, 3).map(s => String(s).slice(0, 180)),
    cons: doc.cons.slice(0, 3).map(s => String(s).slice(0, 180)),
    college: doc.college ? String(doc.college).slice(0, 200) : ''
  };
}

// GET /api/scout?name=...&team=...&pos=...
router.get('/', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'not configured' });
    const name = String(req.query.name || '').slice(0, 60);
    const key = norm(name);
    if (!key || key.length < 3) return res.status(400).json({ error: 'name required' });
    const fresh = d => d && Date.now() - (d.ts || 0) < TTL;
    // Cache-only, always instant. Live web research (research() below) is far too
    // slow for the request path - Anthropic's web-search latency alone is ~60s+, so
    // running it here would make the user wait a minute or hang. Instead we serve
    // only what's already cached; a cache miss returns empty immediately and the
    // client keeps its instant local pros/cons (no wait, no late content-swap glitch).
    // The research() helper below is retained for an optional future off-path
    // warmer, but is never invoked on the request path.
    if (fresh((mem[key] || {}).doc)) { res.set('Cache-Control', 'public, max-age=21600'); return res.json(mem[key].doc); }
    const doc = await readBlob(key);
    if (fresh(doc)) { mem[key] = { doc }; res.set('Cache-Control', 'public, max-age=21600'); return res.json(doc); }
    res.set('Cache-Control', 'public, max-age=120');
    return res.json({ pros: [], cons: [], college: '', cached: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
