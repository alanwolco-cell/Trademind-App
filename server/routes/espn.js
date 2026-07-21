const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// GET /api/espn/league/:leagueId?season=2026
// Reads PUBLIC ESPN fantasy football leagues (private leagues need cookies — not supported).
// Returns teams with player names so the frontend can map them to its own player DB.
router.get('/league/:leagueId', async (req, res) => {
  try {
    const { leagueId } = req.params;
    const season = parseInt(req.query.season) || new Date().getFullYear();
    if (!/^\d+$/.test(leagueId)) return res.status(400).json({ error: 'Invalid league id' });

    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mRoster&view=mTeam&view=mSettings`;
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (TradeMind)' }
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(403).json({ error: 'private_league', message: 'This ESPN league is private. Only public leagues can be imported.' });
    }
    if (!r.ok) throw new Error(`ESPN returned ${r.status}`);
    const data = await r.json();

    const teams = (data.teams || []).map(t => ({
      id: t.id,
      name: (t.name || `${t.location || ''} ${t.nickname || ''}`).trim() || `Team ${t.id}`,
      players: ((t.roster && t.roster.entries) || []).map(e => {
        const p = e.playerPoolEntry && e.playerPoolEntry.player;
        return p ? { name: p.fullName, espnId: p.id } : null;
      }).filter(Boolean),
    }));

    res.json({
      leagueName: (data.settings && data.settings.name) || `ESPN League ${leagueId}`,
      season,
      scoringPpr: (() => {
        try {
          const items = data.settings.scoringSettings.scoringItems || [];
          const rec = items.find(i => i.statId === 53);
          return rec ? rec.pointsOverrides ? Object.values(rec.pointsOverrides)[0] : rec.points : 0;
        } catch (_) { return 0; }
      })(),
      teams,
    });
  } catch (e) {
    console.error('[espn]', e.message);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
