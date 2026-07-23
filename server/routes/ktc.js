const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { allowCron } = require('../lib/identity');

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — keeps dynasty values fresh

function cacheFile(numQbs, ppr, isDynasty) {
  const mode = isDynasty === false ? 'red' : 'dyn';
  return path.join('/tmp', `trademind_v2_qb${numQbs}_ppr${String(ppr).replace('.','p')}_${mode}.json`);
}

function readCache(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts < CACHE_TTL_MS) return data;
  } catch (_) {}
  return null;
}

function writeCache(file, data) {
  try { fs.writeFileSync(file, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
}

// GET /api/ktc/rankings?numQbs=1&ppr=1
// Returns { byId, byName, byIdFull } calibrated to league format
router.get('/rankings', async (req, res) => {
  const numQbs = req.query.numQbs === '2' ? 2 : 1;
  const ppr = req.query.ppr != null ? Math.min(1, Math.max(0, parseFloat(req.query.ppr) || 1)) : 1;
  const isDynasty = req.query.isDynasty !== 'false';
  const FC_URL = `https://api.fantasycalc.com/values/current?isDynasty=${isDynasty}&numQbs=${numQbs}&ppr=${ppr}`;
  const file = cacheFile(numQbs, ppr, isDynasty);
  try {
    const cached = readCache(file);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=7200, stale-while-revalidate=86400');
      return res.json(cached);
    }

    const r = await fetch(FC_URL, {
      headers: { 'User-Agent': 'TradeMind/1.0', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error(`FantasyCalc returned ${r.status}`);
    const players = await r.json();

    const byId = {};
    const byName = {};
    const ordinals = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };

    const byIdFull = {};

    players.forEach(p => {
      const val = p.value || 0;
      if (p.player.sleeperId) {
        byId[p.player.sleeperId] = val;
        byIdFull[p.player.sleeperId] = {
          value: val,
          overallRank: p.overallRank || null,
          positionRank: p.positionRank || null,
          trend30Day: p.trend30Day || 0,
          redraftValue: p.redraftValue || 0,
          rosterPercent: p.maybeRosterPercent != null ? Math.round(p.maybeRosterPercent * 100) : null,
          tradeFrequency: p.maybeTradeFrequency || null,
          tier: p.maybeTier || null,
          espnId: p.player.espnId || null,
          position: p.player.position || null,
          name: p.player.name || null,
        };
      }
      if (p.player.name) byName[p.player.name.toLowerCase()] = val;
      const normalized = p.player.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      byName[normalized] = val;

      // For picks like "2026 1st", add aliases matching Sleeper pick format "2026 Round 1"
      if (p.player.position === 'PICK') {
        const m = p.player.name.match(/^(\d{4})\s+(1st|2nd|3rd|4th)$/i);
        if (m) {
          const year = m[1];
          const round = ordinals[m[2].toLowerCase()];
          if (round) {
            byName[`${year} round ${round}`] = val;
            byName[`${year} round ${round} (via trade)`] = val;
            byName[`${year} ${round}`] = val;
          }
        }
      }
    });

    const result = { byId, byName, byIdFull };
    writeCache(file, result);
    console.log(`[TM] FantasyCalc loaded: ${Object.keys(byId).length} players (${numQbs}QB ppr=${ppr})`);
    res.json(result);
  } catch (e) {
    console.error('[TM] FantasyCalc error:', e.message);
    res.status(503).json({ error: e.message, byId: {}, byName: {} });
  }
});


// ── Value snapshots on Vercel Blob ───────────────────────────────────────────
// GET /api/ktc/snapshot  - hit daily by Vercel cron; appends today's values
// GET /api/ktc/history/:sleeperId - accumulated series for charts
const { put, list } = require('@vercel/blob');
const SNAP_PATH = 'snapshots/values.json';
let snapCache = null, snapCacheTs = 0;

async function readSnapshots() {
  if (snapCache && Date.now() - snapCacheTs < 60000) return snapCache;
  try {
    const { blobs } = await list({ prefix: SNAP_PATH, limit: 1 });
    if (!blobs.length) { snapCache = { days: [] }; snapCacheTs = Date.now(); return snapCache; }
    const r = await fetch(blobs[0].url + '?t=' + Date.now());
    snapCache = await r.json();
    snapCacheTs = Date.now();
    return snapCache;
  } catch (e) { return snapCache || { days: [] }; }
}

router.get('/snapshot', async (req, res) => {
  try {
    if (!allowCron(req, res)) return;
    if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'blob not configured' });
    const today = new Date().toISOString().slice(0, 10);
    const snaps = await readSnapshots();
    if (snaps.days.some(d => d.date === today)) return res.json({ ok: true, skipped: 'already snapshotted today', days: snaps.days.length });
    const r = await fetch('https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&ppr=1', {
      headers: { 'User-Agent': 'TradeMind/1.0', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error('FantasyCalc ' + r.status);
    const players = await r.json();
    const vals = {};
    players.filter(p => p.player.sleeperId && p.value > 300)
      .sort((a, b) => b.value - a.value).slice(0, 400)
      .forEach(p => { vals[p.player.sleeperId] = p.value; });
    snaps.days.push({ date: today, vals });
    if (snaps.days.length > 400) snaps.days.shift();
    await put(SNAP_PATH, JSON.stringify(snaps), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
    snapCache = snaps; snapCacheTs = Date.now();
    res.json({ ok: true, days: snaps.days.length, players: Object.keys(vals).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history/:sleeperId', async (req, res) => {
  try {
    const snaps = await readSnapshots();
    const id = req.params.sleeperId;
    const series = snaps.days
      .map(d => ({ date: d.date, value: d.vals[id] }))
      .filter(p => p.value != null);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ series });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
