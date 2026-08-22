'use strict';
// Where does this player suit up RIGHT NOW.
//
// The matchup dataset is built from last season's nflverse file, so the team it
// carries is where a player FINISHED that season. Cross that with the current
// schedule and you tell a manager that A.J. Brown, a Patriot, faces Washington.
// This module is the single place that answers "where does he play now", so no
// future consumer of the dataset has to remember the trap.
const sleeper = require('../routes/sleeper');

// nflverse writes the Rams "LA"; Sleeper - and therefore the whole app - writes
// "LAR". Everything downstream speaks Sleeper, so normalise into its vocabulary.
// The rest are historical relocations that still appear on old player records.
const TEAM_FIX = { LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR', WSH: 'WAS', ARZ: 'ARI' };
function fixTeam(t) {
  const k = String(t || '').toUpperCase();
  return TEAM_FIX[k] || k;
}

const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
// Each source writes suffixes its own way: ESPN "James Cook III", Sleeper
// "James Cook", nflverse "Deebo Samuel Sr". Index both spellings, look up both.
const noSuffix = (k) => k.replace(/\s+(jr|sr|ii|iii|iv|v)$/, '');

let idx = null;
let idxTs = 0;
const IDX_TTL_MS = 60 * 60 * 1000;   // the same hour the player file cache lives

// Sleeper carries retired namesakes alongside the real player: a WR "Kenneth
// Walker" who last played in 2019 sits next to the KC running back. Keying by
// position separates most of them; for the rest, a rostered and active record
// beats a dormant one, and Sleeper's own search_rank breaks the final tie.
function score(p) {
  return (p.team ? 4 : 0) + (p.active === false ? 0 : 2) + (p.status === 'Active' ? 1 : 0);
}
function better(a, b) {
  const sa = score(a), sb = score(b);
  if (sa !== sb) return sa > sb;
  const ra = a.search_rank == null ? Infinity : a.search_rank;
  const rb = b.search_rank == null ? Infinity : b.search_rank;
  return ra < rb;
}

function buildIndex(master) {
  const out = {};
  Object.keys(master).forEach((id) => {
    const p = master[id];
    if (!p) return;
    const full = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    if (!full) return;
    const k = norm(full);
    if (!k) return;
    const b = noSuffix(k);
    const positions = [p.position].concat(p.fantasy_positions || []).filter(Boolean);
    positions.forEach((pos) => {
      (b !== k ? [k, b] : [k]).forEach((key) => {
        const kk = key + '|' + pos;
        if (!out[kk] || better(p, out[kk])) out[kk] = p;
      });
    });
  });
  return out;
}

async function index() {
  if (idx && Date.now() - idxTs < IDX_TTL_MS) return idx;
  let master = null;
  try { master = await sleeper.getPlayers(); } catch (_) {}
  if (!master) return idx;   // Sleeper down: keep the last good index, never wipe it
  idx = buildIndex(master);
  idxTs = Date.now();
  return idx;
}

/**
 * Current team for a player, by name and position.
 *   '<TEAM>' - rostered; Sleeper's abbreviation
 *   ''       - known player with no team (free agent): he has no game to show
 *   null     - not in Sleeper at all: the caller keeps whatever it had
 * The three cases are deliberately distinct. Collapsing '' into null is what
 * puts an unsigned free agent back on his old club's schedule.
 */
async function currentTeam(name, pos) {
  const i = await index();
  if (!i) return null;
  const k = norm(name), b = noSuffix(k);
  const hit = i[k + '|' + pos] || i[b + '|' + pos];
  if (!hit) return null;
  return hit.team ? fixTeam(hit.team) : '';
}

module.exports = { currentTeam, fixTeam, norm };
