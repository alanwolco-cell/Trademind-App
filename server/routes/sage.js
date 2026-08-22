const express = require('express');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const router = express.Router();

// ── Ask Mac AI: open-ended fantasy football Q&A ────────────────────────────
// DORMANT until ANTHROPIC_API_KEY is set in the environment. To activate:
//   1. Create an API key at https://platform.claude.com
//   2. Add ANTHROPIC_API_KEY to Vercel env vars, redeploy.
// The frontend checks /api/sage/status and shows the chat automatically.

const sageCache = new NodeCache({ stdTTL: 7200 });

function configured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Live grounding: top players by market value + the NFL calendar, refreshed
// every 2h and injected into the system prompt (behind a cache breakpoint).
// fmt = { qbs: 1|2, ppr: 0|0.5|1 }. Superflex cotiza a los QB ~87% por encima
// de 1QB, asi que una unica tabla cacheada de 1QB desalineaba el precio de cada
// respuesta de superflex. Una entrada de cache por formato.
// Union con Sleeper por ID, nunca por nombre. Sleeper guarda a todos los
// jugadores de su historia, asi que 215 nombres tienen homonimo: indexando por
// nombre gana el ultimo del objeto y un LB de Cleveland de 23 anos se hacia
// pasar por Justin Jefferson en el contexto autoritativo de Mac.
// Los ids sinteticos de pick (DP_*/FP_*) no tienen roster y no deben resolver.
const PICK_ID_RE = /^(DP|FP)_/;
function buildRosterMap(data) {
  const map = {};
  Object.keys(data || {}).forEach(id => {
    const pl = data[id];
    if (!pl || !pl.first_name || !pl.fantasy_positions) return;
    map[String(id)] = {
      team: pl.team || 'FA', age: pl.age || null,
      inj: pl.injury_status || null, exp: pl.years_exp,
      pos: pl.position || null
    };
  });
  return map;
}
// Resuelve la linea de roster de una entrada de FantasyCalc. Devuelve null para
// picks (correcto) y avisa fuerte si un jugador real no resuelve: eso seria un
// agujero de datos, y taparlo cayendo al nombre reintroduce el bug de homonimos.
function resolveRoster(rosterMap, entry) {
  const sid = entry && entry.sid ? String(entry.sid) : '';
  if (!sid || PICK_ID_RE.test(sid)) return null;
  const r = rosterMap[sid];
  if (!r) { console.warn('[sage] sin roster para sleeperId', sid, entry && entry.name); return null; }
  return r;
}

async function buildGrounding(fmt) {
  const qbs = (fmt && Number(fmt.qbs) === 2) ? 2 : 1;
  const ppr = (fmt && (Number(fmt.ppr) === 0 || Number(fmt.ppr) === 0.5)) ? Number(fmt.ppr) : 1;
  const cacheKey = 'grounding:' + qbs + ':' + ppr;
  const hit = sageCache.get(cacheKey);
  if (hit) return hit;
  let valuesTxt = '';
  let calendarTxt = '';
  let fullList = [];
  try {
    const r = await fetch('https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=' + qbs + '&ppr=' + ppr, {
      headers: { 'User-Agent': 'Mac Draft/1.0', 'Accept': 'application/json' }
    });
    if (r.ok) {
      const players = await r.json();
      // sid es la clave de union con Sleeper. FantasyCalc la trae en 475/475
      // entradas (verificado 2026-08-22); unir por NOMBRE es lo que hacia que
      // Mac describiera a Justin Jefferson como un linebacker de Cleveland.
      fullList = players.filter(p => p.player && p.player.name && p.player.sleeperId).map(p => ({
        sid: String(p.player.sleeperId),
        name: p.player.name, pos: p.player.position,
        dyn: p.value, red: p.redraftValue || 0, t30: p.trend30Day || 0
      }));
      valuesTxt = players
        .filter(p => p.player && p.player.name)
        .sort((a, b) => b.value - a.value)
        .slice(0, 80)
        .map((p, i) => `${i + 1}. ${p.player.name} (${p.player.position}) dynasty ${p.value}, redraft ${p.redraftValue || '-'}, 30d ${p.trend30Day >= 0 ? '+' : ''}${p.trend30Day || 0}`)
        .join('\n');
    }
  } catch (_) {}
  try {
    const st = await fetch('https://api.sleeper.app/v1/state/nfl').then(x => x.json());
    calendarTxt = `NFL season: ${st.league_season}, season_type: ${st.season_type}, week: ${st.week}`;
  } catch (_) {}
  // Current NFL rosters from Sleeper: which team each player is actually on
  // TODAY, plus age and injury status - the model's memory of rosters is stale.
  let rosterMap = {};
  try {
    const fs = require('fs');
    let data = null;
    try {
      const raw = JSON.parse(fs.readFileSync('/tmp/trademind_players.json', 'utf8'));
      if (Date.now() - raw.ts < 60 * 60 * 1000) data = raw.data;
    } catch (_) {}
    if (!data) {
      const pr = await fetch('https://api.sleeper.app/v1/players/nfl');
      if (pr.ok) {
        data = await pr.json();
        try { fs.writeFileSync('/tmp/trademind_players.json', JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
      }
    }
    if (data) rosterMap = buildRosterMap(data);
  } catch (_) {}
  // Positional ranks (dynasty + redraft) so tier labels like WR2/RB1 are
  // grounded in the live market, never in the model's stale memory.
  ['dyn', 'red'].forEach(k => {
    const byPos = {};
    fullList.forEach(p => { (byPos[p.pos] = byPos[p.pos] || []).push(p); });
    Object.values(byPos).forEach(arr => {
      arr.sort((a, b) => (b[k] || 0) - (a[k] || 0));
      arr.forEach((p, i) => { p[k === 'dyn' ? 'posRankDyn' : 'posRankRed'] = i + 1; });
    });
  });
  // Season outlook layer: the blob-cached odds snapshot (never hits the paid
  // API from here). Keyed by lowercase player name; empty in the offseason.
  let proj = {};
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: 'odds/snapshot.json', limit: 1 });
    if (blobs.length) {
      const snap = await fetch(blobs[0].url + '?t=' + Date.now()).then(x => x.json());
      if (snap && snap.projections) proj = snap.projections;
    }
  } catch (_) {}
  const out = { valuesTxt, calendarTxt, allPlayers: fullList, rosterMap, proj };
  sageCache.set(cacheKey, out);
  return out;
}

// ── Naming players in a conversation ────────────────────────────────────────
// Deciding who the user is talking about is what lets Mac quote a real value
// instead of guessing. The old test was `lastName.length > 4`, which silently
// hid two whole categories:
//
//   - Short surnames. Nix, Love, Hall, Cook, Ward, Lamb, Goff, Rice, Reed and
//     Bell all failed it. Measured against the live FantasyCalc list, 91
//     players outside the cached top list could never be grounded at all.
//   - EVERY rookie pick. A pick's last word is "1.01" or "1st", so all 64 pick
//     entries failed, and 54 of them sit outside the cached list. Dynasty runs
//     on picks, so "my 2026 2nd for Jayden Reed" grounded neither side of the
//     trade - the exact question this product exists to answer.
//
// The length cutoff was a blunt way to stop "Hill" firing inside "uphill".
// Word boundaries do that properly, so the cutoff is gone.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
// Surnames that are also words people actually type when talking about trades.
// "I love this trade", "he is still young", "what is the price", "training
// camp" - these would each drag in a player nobody mentioned. They still match
// on the full name, so "Jordan Love" works. Everything else stays matchable:
// keeping Ward, Hall, Cook, Rice or Hill out of this list matters more than the
// rare false positive, because those are players people ask about constantly.
const AMBIGUOUS_SURNAMES = new Set(['love', 'young', 'price', 'camp', 'green']);
const rxEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (hay, needle) => new RegExp('\\b' + rxEscape(needle) + '\\b').test(hay);

function namedInConvo(name, txt) {
  const lower = String(name || '').toLowerCase();
  if (!lower) return false;
  if (txt.includes(lower)) return true;

  // Rookie picks. "2026 Pick 1.01" is spoken as "1.01", which is distinctive
  // enough on its own. "2026 1st" needs the year too, or a stray "1st" would
  // drag in every draft year at once.
  const slot = lower.match(/(\d)\.(\d{2})/);
  if (slot) return hasWord(txt, slot[0]);
  const round = lower.match(/^(\d{4})\s+(1st|2nd|3rd|4th)$/);
  if (round) {
    const words = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth' };
    return txt.includes(round[1]) && (hasWord(txt, round[2]) || hasWord(txt, words[round[2]]));
  }

  const parts = lower.split(/\s+/).filter(Boolean);
  let last = parts[parts.length - 1];
  // "Marvin Harrison Jr" is a Harrison, not a Jr - otherwise every suffixed
  // player would match every other one.
  if (NAME_SUFFIXES.has(last) && parts.length > 2) last = parts[parts.length - 2];
  if (last.length < 3 || AMBIGUOUS_SURNAMES.has(last)) return false;
  return hasWord(txt, last);
}

const SAGE_PERSONA = `You are Mac, the resident fantasy football brain of Mac Draft (trademindff.com), a trade advisor for dynasty and redraft leagues. You are not a calculator: a calculator compares numbers, you weigh a manager's roster, league, timing and opponent and then tell them what to do.
ACCURACY OVER SPEED: for any question about a player's current role, depth chart, or starting job, verify with web search BEFORE answering unless the provided scout context explicitly covers it. Never name a player's competition from memory. If you realize mid-answer you are unsure, search first, answer once - never publish a correction to your own previous message.
Do not use catchphrases or signature sign-offs. End on the verdict.
SITUATION FIRST: a player's outlook is his situation, not just his value. Before answering about any player, weigh: teammates who left or arrived (a departed WR1 means more targets for the WR2), coaching and scheme changes, depth chart role, and age. If the scout context provided does not cover the player's current situation, USE WEB SEARCH to check for offseason moves before answering - never give an outlook from the value number alone.

Voice and style:
- Sharp, confident, a little playful - like the smartest manager in the league group chat. Direct opinions, no hedging walls.
- Never call players "pieces" or "assets". They are players.
- SHORT answers. Two to four sentences for simple questions; a compact list only when comparing multiple players. Never write essays.
- Plain text only: no markdown headers, no emojis. Never break a line mid-sentence - use line breaks only between complete thoughts or list items.
- HARD TYPOGRAPHY RULE, no exceptions: never write an em dash or an en dash. The characters are banned outright. Where you would reach for one, use a comma, a colon, a semicolon, or start a new sentence. This applies mid-sentence, in lists, and in ranges.
- Always give a verdict. "It depends" must be followed by on what, and which way you lean.
- Dynasty and redraft are different games. When LEAGUE CONTEXT is provided below, it is authoritative: answer in THAT format's terms only (a redraft league gets zero dynasty talk - no age curves, no "dynasty TE1", no future picks) unless the user explicitly asks about the other format. Only when no league context exists and the question is ambiguous, answer for redraft and add one line on how dynasty changes it.
- When LEAGUE CONTEXT includes the user's window (contending, rebuilding, middle), USE IT - never ask "are you contending or rebuilding". Reference it naturally ("with where your roster sits...") so advice feels personal.
- NEVER call a redraft team "win-now" - every redraft team is playing to win now, so the phrase is empty. Describe redraft rosters by their strength: strong, deep, top-heavy, thin at RB. "Win-now" only means something in dynasty and keeper formats, where it contrasts with building for later.
- You only talk fantasy football (players, trades, draft strategy, waivers, lineups, league formats, NFL news as it affects fantasy). If asked anything else, steer back in one friendly line.

Grounding rules:
- Use the market values provided below as your source of truth for player value, but they are for YOUR INTERNAL MATH ONLY. NEVER quote a raw value, cost, price number, or trend number to the user - no "costs about 6960", no "value dipped to 6211", no "30-day slide of 138". Express value in plain words instead: elite, premium price, very valuable, solid starter cost, mid-range, cheap right now, falling fast, climbing. Positional ranks (WR4, top-three tight end) are fine; the underlying numbers are not.
- TIER LABELS: call a player a WR1/RB2/TE1/QB1 etc ONLY from the positional rank provided in his data line (ranks 1-12 are the 1s, 13-24 the 2s, 25-36 the 3s). If his positional rank is not provided, describe his role in words and do NOT assert a tier label - and never guess one.
- OVERALL ADP IS NOT POSITIONAL RANK. Where a player goes in the overall draft is NOT his tier at his position. This matters most for QBs and TEs: in 1-QB leagues you only start one QB, so quarterbacks slide in OVERALL ADP - a QB going around pick 50-70 overall is still a QB1, not a "QB2". Never derive a QB or TE tier from an overall draft slot or overall ADP number. A clearly startable weekly quarterback is QB1-caliber unless his POSITIONAL rank explicitly says otherwise. When unsure of a QB's tier and no positional rank is given, lean on his role and projection (and search if needed) - never default him down a tier.
- SEASON OUTLOOK (private): when a player's data line includes "outlook N pts/wk", that number is your own private read on his coming season and it is the MOST IMPORTANT input to your take - when it disagrees with market value or your priors, the outlook wins. NEVER reveal or hint at where it comes from: never say Vegas, odds, lines, props, sportsbooks, implied, projections, or "the number". Justify the same conclusion through real football reasons - role, target share, offense quality, scheme, matchups. If the outlook shifts between conversations, your opinion shifts with it, stated as your own updated read.
- Use web search when the answer depends on current information you don't have - injuries this week, depth chart changes, recent signings, tonight's slate. Do not search for things the provided data already answers.
- ROSTERS: your training memory of which NFL team a player is on, depth charts, and coaching situations is OUTDATED. The per-player data provided below is the truth for current team, age, and injury status. For depth chart roles, offseason moves, or coaching context beyond that data, SEARCH - never answer from memory.
- TEAMMATES & TARGET COMPETITION - this is where memory fails hardest. Before you name a player's teammates, the receivers/backs he competes with, or "the other weapons" on his offense, CONFIRM each of those players is STILL on that team THIS season. Star veterans and WR1/RB1 types change teams every single offseason, and a name you remember alongside him may have LEFT - which frees up targets and improves your player's outlook, the opposite of what you'd conclude if you named the departed player as competition. If the provided data does not confirm a teammate's current team, SEARCH before naming him. NEVER list a player who has left as current competition - it inverts the entire read.
- WORDING: do not call players "pieces" or "assets", and avoid filler like "a nice complementary piece" - it reads as spammy and vague. Name the real role instead: your WR3, a bench flex, depth behind your starters, a weekly starter.
- Trade advice quality bar: weigh value gap AND age curve AND the manager's window (ask which if it changes the verdict and they haven't said). A verdict that ignores one of these is a bad verdict.
- AGE IS POSITION-SPECIFIC (dynasty only - age is irrelevant in redraft): a year of age does NOT mean the same thing across positions, so NEVER compare raw ages across positions or call a younger player the "age win" without checking his position. QBs age slowest and hold value into their mid-to-late 30s; TEs age well and often peak late; RBs fall off hard around 27-28; WRs decline in their late 20s. So a 27-year-old QB has a LONGER runway than a 24-year-old RB, and trading a young QB for a slightly younger WR is usually an age DOWNGRADE, not an upgrade. Reason about each player's remaining window at HIS position, never by the age number alone.
- NEVER answer about a different player than the one asked about. If the asked player is not in your data, search for him or say you do not have his current value - do not substitute a similarly named or similar-role player.
- Never invent stats, values, or news. Every number you state must come from the values below or a search you ran this turn. If a claim depends on current facts you have not verified, search first or say you are not certain - never guess.
- NEGOTIATION COACH: when the user pastes a conversation from their league chat, asks how to reply to a manager, or says NEGOTIATION COACH MODE, switch to coaching. Reply with (1) the exact message they should send next - written in their casual league-chat voice, persuasive but never desperate - then (2) one line of strategy. Use the market values to anchor the ask. HARD RULE: never offer up anything the user said they refuse to give - work around their constraints, and if the deal is impossible within them, say so and suggest the closest viable alternative.
- NAVIGATION: Mac Draft has tools you can send the user to. To add a button that opens one, put a token at the very END of your reply, on its own: [[go:KEY]]. Valid KEYs: analyze (the Trade Analyzer), ideas (Trade Ideas for their league), league (My League), research (player Research and compare), draft (the mock Draft room), news (fantasy News), community (Community). Add one ONLY when it helps the user act on your answer - e.g. after telling them to run a specific trade use [[go:analyze]], after suggesting they browse ideas use [[go:ideas]], if they ask what to draft use [[go:draft]]. Max 2. NEVER write the token inside a sentence and never mention it - the app strips it and turns it into a button.`;

// Per-user daily message limit. A public launch spins up many serverless
// instances, so a per-instance counter caps at DAILY_LIMIT x (instance count)
// - not a real limit. This uses a SHARED store so DAILY_LIMIT means what it
// says across the whole fleet:
//   1. Vercel KV / Upstash Redis (atomic INCR) if provisioned - the real cap.
//   2. Vercel Blob (shared, slightly racy) as a bridge until KV is added.
//   3. In-memory (per instance) as the last resort.
// To get the atomic cap: add Vercel KV (dashboard -> Storage -> KV, free tier),
// which sets KV_REST_API_URL + KV_REST_API_TOKEN automatically. No code change.
// Freemium limits: free managers get a small DAILY and WEEKLY allowance
// (whichever runs out first); Pro gets a high daily fair-use cap so one
// scripted account can't run up the API bill. Retune these numbers freely.
const FREE_DAILY = 3;
const FREE_WEEKLY = 10;
// Marketed as "unlimited"; a high fair-use ceiling stops a runaway/scripted
// account from draining the Claude budget. 250/month is far beyond any real
// user (~8/day every day) - the ceiling only ever catches abuse.
const PRO_DAILY = 25;
const PRO_MONTHLY = 250;
// One network/IP can't farm free questions with throwaway usernames past this.
const IP_FREE_DAILY = 12;
const { isPro, isPlanOwner, bindNameIfUnclaimed } = require('./billing');
const { readAcctId } = require('../lib/identity');
const community = require('./community'); // for referral bonuses (extends free weekly)
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const _memCnt = {}; // in-memory fallback: bucketKey -> count

async function kvIncr(key, ttlSec) {
  // atomic INCR + set a TTL on first write; returns the new count
  const r = await fetch(KV_URL + '/incr/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + KV_TOKEN }, method: 'POST' });
  if (!r.ok) throw new Error('kv ' + r.status);
  const n = Number((await r.json()).result);
  if (n === 1) fetch(KV_URL + '/expire/' + encodeURIComponent(key) + '/' + ttlSec, { headers: { Authorization: 'Bearer ' + KV_TOKEN }, method: 'POST' }).catch(() => {});
  return n;
}
async function kvGet(key) {
  try { const r = await fetch(KV_URL + '/get/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + KV_TOKEN } }); if (!r.ok) return 0; return Number((await r.json()).result) || 0; } catch (_) { return 0; }
}
async function kvDecr(key) {
  // atomic DECR, floored at 0 (a refund must never drive a bucket negative)
  try {
    const r = await fetch(KV_URL + '/decr/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + KV_TOKEN }, method: 'POST' });
    if (!r.ok) return;
    const n = Number((await r.json()).result);
    if (n < 0) fetch(KV_URL + '/set/' + encodeURIComponent(key) + '/0', { headers: { Authorization: 'Bearer ' + KV_TOKEN }, method: 'POST' }).catch(() => {});
  } catch (_) {}
}

// Blob store: one file of { bucketKey: count }. Blob is eventually consistent +
// CDN-cached, so keep a per-instance map that ALWAYS accumulates locally and
// merge the remote via max() (never under-counts), awaiting every write. Old
// day/week buckets are pruned so the file stays small.
const CNT_PATH = 'ratelimit/buckets.json';
const _cnt = {};
async function _cntSync() {
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: CNT_PATH, limit: 1 });
    if (blobs.length) {
      const r = await (await fetch(blobs[0].url + '?t=' + Date.now())).json();
      if (r && typeof r === 'object') for (const k in r) _cnt[k] = Math.max(_cnt[k] || 0, Number(r[k]) || 0);
    }
  } catch (_) {}
}
async function _cntWrite() {
  const day = Math.floor(Date.now() / 86400000), wk = Math.floor(day / 7);
  const dt = new Date(), mo = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
  for (const k in _cnt) {
    const dm = k.match(/:d(\d+)$/), wm = k.match(/:w(\d+)$/), nm = k.match(/:n(\d+)$/);
    if (dm && +dm[1] < day - 2) delete _cnt[k];
    else if (wm && +wm[1] < wk - 1) delete _cnt[k];
    else if (nm && +nm[1] < mo - 1) delete _cnt[k];
  }
  try { const { put } = require('@vercel/blob'); await put(CNT_PATH, JSON.stringify(_cnt), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 }); } catch (_) {}
}

// Increment several buckets at once. Blob path does ONE read + ONE write for
// the whole set (not per bucket) so latency stays flat as we add counters.
async function incrMany(specs) { // specs: [{ key, ttl }]
  const out = {};
  if (KV_URL && KV_TOKEN) {
    try { for (const s of specs) out[s.key] = await kvIncr(s.key, s.ttl); return out; } catch (_) { for (const k in out) delete out[k]; }
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try { await _cntSync(); for (const s of specs) { _cnt[s.key] = (_cnt[s.key] || 0) + 1; out[s.key] = _cnt[s.key]; } await _cntWrite(); return out; } catch (_) { for (const k in out) delete out[k]; }
  }
  for (const s of specs) { _memCnt[s.key] = (_memCnt[s.key] || 0) + 1; out[s.key] = _memCnt[s.key]; }
  return out;
}
// Give a charged question back. Only ever called on a GENUINE failure (the model
// errored or produced no text at all) - never on the content of a real answer,
// so there is no way for a user to craft an "unanswerable" question and farm free
// questions. Decrements exactly the buckets checkUsage incremented, floored at 0.
async function refundMany(keys) {
  if (!keys || !keys.length) return;
  if (KV_URL && KV_TOKEN) { try { for (const k of keys) await kvDecr(k); return; } catch (_) {} }
  if (process.env.BLOB_READ_WRITE_TOKEN) { try { await _cntSync(); for (const k of keys) _cnt[k] = Math.max(0, (_cnt[k] || 0) - 1); await _cntWrite(); return; } catch (_) {} }
  for (const k of keys) _memCnt[k] = Math.max(0, (_memCnt[k] || 0) - 1);
}
async function peekBucket(bucket) {
  if (KV_URL && KV_TOKEN) return await kvGet(bucket);
  if (process.env.BLOB_READ_WRITE_TOKEN) { try { await _cntSync(); } catch (_) {} return _cnt[bucket] || 0; }
  return _memCnt[bucket] || 0;
}
function _bucketKeys(id) {
  const day = Math.floor(Date.now() / 86400000), week = Math.floor(day / 7);
  const d = new Date(), month = d.getUTCFullYear() * 12 + d.getUTCMonth();
  return { dayKey: 'sg:' + id + ':d' + day, weekKey: 'sg:' + id + ':w' + week, monthKey: 'sg:' + id + ':n' + month };
}
// increment the relevant counters; returns { day, week, month, ip }
// PRO is account-scoped (they paid): tracks a month ceiling by username.
// FREE is DEVICE-scoped: the free allowance follows the browser's device id, so
// signing out and typing a different username gives no extra questions. IP is a
// coarse backstop for someone who wipes local storage to get a fresh device id.
async function checkUsage(user, ip, device, pro) {
  const day = Math.floor(Date.now() / 86400000);
  if (pro) {
    const { dayKey, monthKey } = _bucketKeys(user || ip || 'anon');
    const c = await incrMany([{ key: dayKey, ttl: 2 * 86400 }, { key: monthKey, ttl: 35 * 86400 }]);
    return { day: c[dayKey], week: 0, month: c[monthKey], ip: 0, _keys: [dayKey, monthKey] };
  }
  const freeId = 'dev:' + (device || ip || 'anon');
  const { dayKey, weekKey } = _bucketKeys(freeId);
  const ipKey = 'ip:' + (ip || 'noip') + ':d' + day;
  const c = await incrMany([{ key: dayKey, ttl: 2 * 86400 }, { key: weekKey, ttl: 8 * 86400 }, { key: ipKey, ttl: 2 * 86400 }]);
  return { day: c[dayKey], week: c[weekKey], month: 0, ip: c[ipKey] || 0, _keys: [dayKey, weekKey, ipKey] };
}
// read-only (no increment) for the usage display
async function peekUsage(user, ip, device, pro) {
  const day = Math.floor(Date.now() / 86400000);
  if (pro) {
    const { dayKey, monthKey } = _bucketKeys(user || ip || 'anon');
    return { day: await peekBucket(dayKey), week: 0, month: await peekBucket(monthKey), ip: 0 };
  }
  const { dayKey, weekKey } = _bucketKeys('dev:' + (device || ip || 'anon'));
  return { day: await peekBucket(dayKey), week: await peekBucket(weekKey), month: 0, ip: await peekBucket('ip:' + (ip || 'noip') + ':d' + day) };
}

// GET /api/sage/quota?user=  -> current usage + limits (no increment) for the UI
router.get('/quota', async (req, res) => {
  const user = String(req.query.user || '').trim().toLowerCase().slice(0, 40);
  const device = String(req.query.device || '').slice(0, 64);
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  // Pro follows the manager's name so it works on every device they sign in
  // on; the account key still guards anything that CHANGES the plan.
  await bindNameIfUnclaimed(readAcctId(req), user);
  // Mismo predicado que /chat: el contador que ve el usuario tiene que ser el que
  // de verdad le van a aplicar, o el suscriptor ve "Pro" y recibe un 429 de free.
  const pro = await isPlanOwner(readAcctId(req), user);
  const u = await peekUsage(user, ip, device, pro);
  // A referral boost only lands on the day it is earned, so it has to lift the
  // DAILY ceiling too - raising just the weekly one would leave the person
  // still blocked by the 3-a-day cap and the bonus would look broken.
  const refBonus = pro ? 0 : await community.getReferralBonus(user).catch(() => 0);
  const dailyLimit = pro ? PRO_DAILY : FREE_DAILY + (refBonus || 0);
  const effWeekly = FREE_WEEKLY + (refBonus || 0);
  res.set('Cache-Control', 'no-store');
  res.json({
    pro,
    dayUsed: u.day, weekUsed: u.week, monthUsed: u.month,
    dailyLimit, weeklyLimit: pro ? null : effWeekly, monthlyLimit: pro ? PRO_MONTHLY : null,
    referralBonus: refBonus || 0,
    dailyLeft: Math.max(0, dailyLimit - u.day),
    weeklyLeft: pro ? null : Math.max(0, effWeekly - u.week),
    monthlyLeft: pro ? Math.max(0, PRO_MONTHLY - u.month) : null,
  });
});

// POST /api/sage/chat  { messages: [...], user: "sleeper username" }
router.post('/chat', async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'not configured' });
  try {
    // Mac answers signed-in managers only - an anonymous public tap was an
    // unlimited spend surface
    const user = String((req.body || {}).user || '').trim().slice(0, 40);
    if (!user) return res.status(401).json({ error: 'Sign in with your Sleeper username to talk to Mac.' });
    // La forma del pedido se valida ANTES de tocar el contador: si no, un tercero
    // agota la cuota diaria de alguien mandando requests vacios.
    const _rawMessages = (req.body || {}).messages;
    if (!Array.isArray(_rawMessages) || !_rawMessages.length) return res.status(400).json({ error: 'missing messages' });
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const device = String((req.body || {}).device || '').slice(0, 64);
    // Cada mensaje aca cuesta dinero real, asi que el plan no se concede por
    // teclear un nombre publico: hace falta la llave de cuenta que compro el plan.
    const pro = await isPlanOwner(readAcctId(req), user);
    const u = await checkUsage(user.toLowerCase(), ip, device, pro);
    if (pro) {
      if (u.month > PRO_MONTHLY) {
        return res.status(429).json({ error: "You have reached this month's fair-use limit (" + PRO_MONTHLY + " questions). It resets on the 1st - and if you genuinely need more, reach out." });
      }
      if (u.day > PRO_DAILY) {
        return res.status(429).json({ error: "That is a lot of Mac for one day (" + PRO_DAILY + "). Give it a rest and I will be sharp again tomorrow." });
      }
    } else {
      // per-IP cap catches one device farming free questions via throwaway names
      if (u.ip > IP_FREE_DAILY) {
        return res.status(429).json({
          error: "This network has used its free Mac for today. Go Pro for unlimited, or come back tomorrow.",
          upgrade: true,
        });
      }
      const _refBonus = await community.getReferralBonus(user.toLowerCase()).catch(() => 0);
      const _effDaily = FREE_DAILY + (_refBonus || 0);
      const _effWeekly = FREE_WEEKLY + (_refBonus || 0);
      if (u.day > _effDaily || u.week > _effWeekly) {
        const which = u.week > _effWeekly ? 'this week' : 'today';
        return res.status(429).json({
          error: "That is your free Mac for " + which + " - looks like you are putting me to work, which I love. Go Pro and ask me anything, anytime. I will be here before every move.",
          upgrade: true,
        });
      }
    }
    const raw = _rawMessages;
    // Cap history and message size so a chat can't run the bill up
    const history = raw.slice(-12).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000)
    })).filter(m => m.content);
    if (!history.length) return res.status(400).json({ error: 'empty messages' });
    if (history[0].role !== 'user') history.unshift({ role: 'user', content: 'Hey Mac.' });

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic();
    // El formato manda: en superflex un QB de elite vale ~87% mas que en 1QB
    // (Josh Allen: 5.695 -> 10.667, del puesto 18 al 1 del board). Cotizarlo
    // todo con la tabla de 1QB desalineaba cada precio de una liga superflex.
    // El formato viene como DATO, no sniffeado de prosa: el nombre de la liga
    // ("SF Bay Dynasty") daba falsos positivos y rules nunca dice cuantos QB se
    // arrancan. El regex queda solo como respaldo sobre rules, nunca sobre el
    // nombre de la liga.
    const _lcFmt = (req.body || {}).leagueContext || {};
    const _rules = String(_lcFmt.rules || '');
    const _fmt = {
      qbs: (_lcFmt.superflex === true || Number(_lcFmt.qbs) === 2 || /superflex|super flex|\b2\s*qb\b/i.test(_rules)) ? 2 : 1,
      ppr: (_lcFmt.ppr === 0 || _lcFmt.ppr === 0.5) ? _lcFmt.ppr
         : /half[\s-]?ppr|0\.5\s*ppr/i.test(_rules) ? 0.5
         : /\bnon[\s-]?ppr\b|\bstandard\b/i.test(_rules) ? 0 : 1
    };
    const g = await buildGrounding(_fmt);

    // Model routing: trade analysis and negotiation get the heavyweight brain,
    // casual questions run on the lighter tier (same live grounding + web search).
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    const HEAVY_RE = /negotiation coach mode|trade|offer|counter|package|deal\b|accept|straight up|\bfor my\b|2 for 1|two for one|fair (price|value|offer)|what would .{0,40}cost|should i (send|take|move)/i;
    // Trades and negotiation get Opus; casual questions run on Sonnet 5 with
    // the exact same grounding, search access, and accuracy rules. (Approved
    // by Wolco 2026-07-20 - reverses the earlier always-Opus instruction.)
    const model = HEAVY_RE.test((lastUser && lastUser.content) || '') ? 'claude-opus-4-8' : 'claude-sonnet-5';

    // Exact values for players named in the conversation - prevents the model
    // from confusing a player outside the cached list with a similar one inside it.
    const convoTxt = history.map(m => m.content).join(' ').toLowerCase();
    const mentioned = (g.allPlayers || []).filter(p => namedInConvo(p.name, convoTxt)).slice(0, 20);
    const rmap = g.rosterMap || {};
    // Situational scout notes shipped by the client (departures, arrivals,
    // target-share shifts, coaching changes). This is the context that turns
    // "his value is X" into "his value is X and the WR1 next to him just left".
    let notesTxt = '';
    const cNotes = Array.isArray((req.body || {}).playerNotes) ? req.body.playerNotes.slice(0, 8) : [];
    if (cNotes.length) {
      // La fecha viaja con los datos: cablearla en el prompt garantiza que un
      // dia diga julio con notas de agosto.
      const _asOf = String((req.body || {}).notesAsOf || '').slice(0, 20) || 'recent';
      notesTxt = 'Scout context for players in this conversation (as of ' + _asOf + ' - factor this into every outlook):\n'
        + cNotes.map(n => `- ${String(n.name||'').slice(0,40)}: ${String(n.note||'').slice(0,300)}${n.curve?` (${String(n.curve).slice(0,80)})`:''}`).join('\n');
    }
    const projMap = g.proj || {};
    const mentionedTxt = mentioned.length
      ? 'Authoritative live data for players mentioned in this conversation (use THIS for team, age, injury, and value - your memory of rosters is outdated; never substitute a different player with a similar name):\n'
        + mentioned.map(p => {
            const r = resolveRoster(rmap, p) || {};
            const bits = [`${p.name} (${p.pos}${r.team ? ', ' + r.team : ''})`];
            if (r.age) bits.push(`age ${r.age}`);
            if (r.inj && r.inj !== 'Active') bits.push(`INJURY: ${r.inj}`);
            bits.push(`dynasty ${p.dyn}`, `redraft ${p.red}`, `30d ${p.t30 >= 0 ? '+' : ''}${p.t30}`);
            if (p.posRankDyn) bits.push(`positional rank dynasty ${p.pos}${p.posRankDyn}`);
            if (p.posRankRed) bits.push(`positional rank redraft ${p.pos}${p.posRankRed}`);
            const pv = projMap[p.name.toLowerCase()];
            if (pv != null) bits.push(`outlook ${pv} pts/wk`);
            // Current teammates = his ACTUAL target/touch competition, so Mac
            // never names a departed player. fullList is value-sorted; look up
            // each player's CURRENT team via the roster map.
            if (r.team && r.team !== 'FA') {
              const mates = (g.allPlayers || []).filter(q => {
                if (q.name === p.name) return false;
                if (!['QB', 'RB', 'WR', 'TE'].includes(q.pos)) return false;
                const qr = resolveRoster(rmap, q);
                return qr && qr.team === r.team;
              }).slice(0, 7).map(q => `${q.name} (${q.pos})`);
              if (mates.length) bits.push(`current skill teammates on ${r.team} - his ACTUAL competition for targets/touches, use THIS not memory; anyone you recall on ${r.team} who is NOT in this list has LEFT (which frees up his targets): ${mates.join(', ')}`);
            }
            return bits.join(', ');
          }).join('\n')
      : '';
    // The user's connected league: format and window, computed client-side.
    // This is what lets Mac answer redraft questions in redraft terms and
    // know the user's window without asking.
    let leagueTxt = '';
    const lc = (req.body || {}).leagueContext;
    if (lc && (lc.mode === 'redraft' || lc.mode === 'dynasty')) {
      leagueTxt = 'LEAGUE CONTEXT (authoritative, do not ask the user for any of this): format ' + lc.mode.toUpperCase()
        + (lc.keeper ? ' (KEEPER league: redraft values are the baseline, but each manager keeps a few players year over year. Young cornerstone players carry extra worth as keeper candidates - when advice touches a player age 24 or under with a real role, mention whether he is keeper-worthy. Never apply full dynasty logic.)' : '')
        + (lc.league ? ', league "' + String(lc.league).slice(0, 60) + '"' : '')
        + (lc.teams ? ', ' + lc.teams + ' teams' : '')
        + (lc.rules ? ', scoring: ' + String(lc.rules).slice(0, 240) + ' - weight every positional call to these exact rules' : '')
        + (lc.record ? ', their record ' + String(lc.record).slice(0, 12) : '')
        + (lc.situation ? '. Their window, inferred from roster value and age: ' + String(lc.situation).slice(0, 80) + ' (' + String(lc.why || '').slice(0, 160) + ').' : '.');
      // What the manager told us in their own words, moments before asking.
      // These three answers used to be collected and then dropped, so the
      // advice ignored them and testers noticed: the inputs changed nothing.
      // Stated beats inferred - the roster maths can say "rebuilding" while
      // the person running the team knows they are going for it.
      const ys = lc.youSaid;
      if (ys && typeof ys === 'object') {
        const bits = [];
        if (ys.window) bits.push('they describe themselves as ' + String(ys.window).slice(0, 90));
        if (ys.goal) bits.push('what they want from this trade: ' + String(ys.goal).slice(0, 90));
        if (ys.lean) bits.push('where they currently lean: ' + String(ys.lean).slice(0, 90));
        if (bits.length) {
          leagueTxt += '\nWHAT THE MANAGER JUST TOLD YOU (outranks the inferred window above - if the two disagree, believe the manager and say so in one short line): '
            + bits.join('; ') + '.'
            + ' Answer for the goal they named. If they lean one way and you disagree, say why in a sentence, do not just agree with them.';
        }
      }
      if (Array.isArray(lc.rosters) && lc.rosters.length) {
        leagueTxt += '\nEVERY ROSTER IN THEIR LEAGUE (top players by value; use these names freely - never say you cannot see rosters):\n'
          + lc.rosters.slice(0, 14).map(r =>
              (r.mine ? '>> THE USER\'S TEAM' : String(r.team || 'Team').slice(0, 28)) + ': ' + (r.core || []).slice(0, 10).join(', ')
            ).join('\n');
      }
      if (lc.lastMock) leagueTxt += '\nTheir most recent Mac Draft mock draft (when they ask how they did, how their draft went, or about "my mock", grade THIS - the pick vs market rank gap tells you steals and reaches): ' + String(lc.lastMock).slice(0, 900);
    }

    const system = [
      {
        type: 'text',
        text: SAGE_PERSONA + '\n\nCurrent market values (FantasyCalc, live):\n' + (g.valuesTxt || 'unavailable right now'),
        cache_control: { type: 'ephemeral' }
      },
      // league + rosters change only when the league does: their own cache
      // breakpoint means repeat messages read this block at ~10% of the price
      {
        type: 'text',
        text: leagueTxt || 'No league connected.',
        cache_control: { type: 'ephemeral' }
      },
      // volatile per-message context stays last, after the cached prefix
      { type: 'text', text: (g.calendarTxt || '') + (mentionedTxt ? '\n\n' + mentionedTxt : '') + (notesTxt ? '\n\n' + notesTxt : '') }
    ];

    // Stream the answer as Server-Sent Events so text appears as Mac writes it
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();
    const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

    let full = '';
    let failed = false;
    let answeredModel = model;
    const heavy = model === 'claude-opus-4-8';

    // One generation pass. Streams text deltas live and follows a web_search
    // pause_turn up to 4 times on the same SSE stream. Text accrues into the
    // shared `full` so the caller can tell a real answer from an empty one.
    let _searchHits = 0;
    const runPass = async (cfg) => {
      let messages = history;
      let mdl = model;
      for (let i = 0; i < 4; i++) {
        const req = {
          model,
          max_tokens: cfg.maxTokens,
          thinking: { type: 'adaptive' },
          output_config: { effort: cfg.effort },
          system,
          messages
        };
        if (cfg.search) req.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }];
        const stream = client.messages.stream(req);
        stream.on('text', (t) => { full += t; send({ t }); });
        stream.on('streamEvent', (ev) => {
          if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'server_tool_use') {
            // Rotar el texto: en la peor medicion salieron 5 busquedas seguidas
            // y el usuario vio la MISMA linea fija durante 33 segundos.
            const steps = ['Checking the latest news...', 'Cross-checking depth charts...', 'Pulling the market read...', 'Almost there, lining up the verdict...'];
            send({ status: steps[Math.min(steps.length - 1, _searchHits++)] });
          }
        });
        const response = await stream.finalMessage();
        mdl = response.model;
        if (response.stop_reason !== 'pause_turn') break;
        messages = [...messages, { role: 'assistant', content: response.content }];
      }
      return mdl;
    };

    try {
      // Primary pass: full effort with live web search. Heavy questions (trades,
      // cross-roster, whole-league) get a much larger token budget. At effort
      // high the adaptive thinking for a full-league analysis can otherwise
      // consume the entire cap before a single word of the answer is emitted -
      // which surfaced as an empty response ("no answer generated") on exactly
      // the ambitious questions this feature exists for.
      answeredModel = await runPass({ maxTokens: heavy ? 8000 : 2000, effort: heavy ? 'high' : 'low', search: true });
      // Genuine empty output (thinking ran the budget out, a refusal, or a
      // broken search chain): retry ONCE, grounded-only and low effort so the
      // model spends its budget on the answer instead of deliberation. Only
      // when the first pass produced NOTHING - a partial answer is kept and
      // never duplicated by a second stream.
      if (!full.trim()) {
        send({ status: 'Thinking it through...' });
        answeredModel = await runPass({ maxTokens: 4000, effort: 'low', search: false });
      }
      if (full.trim()) send({ done: true, model: answeredModel });
      else { failed = true; send({ error: 'no answer generated' }); }
    } catch (e) {
      console.error('[sage]', e && e.message, e && e.status);
      // If a partial answer already streamed before the error, keep it - the
      // client renders whatever text arrived. Only signal a hard failure when
      // nothing was produced at all.
      if (full.trim()) { send({ done: true, model: answeredModel }); }
      else { failed = true; send({ error: 'Mac hit a snag. Try again in a moment.' }); }
    }
    // Only a genuine failure (an error, or the model producing NO text at all)
    // refunds the question. A real answer - even "I do not have that data" -
    // still counts, so there is no craftable way to farm free questions.
    if (failed) { try { await refundMany(u._keys); } catch (_) {} }
    res.end();
  } catch (e) {
    console.error('[sage]', e.message);
    res.status(502).json({ error: 'Mac is unavailable right now.' });
  }
});

// GET /api/sage/status
router.get('/status', (req, res) => {
  res.json({ configured: configured() });
});

module.exports = router;
// Exported so the player matcher can be exercised directly. Getting this wrong
// is invisible in production: Mac just quietly answers without the data.
module.exports.namedInConvo = namedInConvo;
// Exportadas para scripts/test-grounding-join.mjs: si la union FantasyCalc <->
// Sleeper se rompe, Mac contesta con seguridad sobre el equipo equivocado y no
// hay ningun sintoma en logs. El test es la unica alarma.
module.exports.buildRosterMap = buildRosterMap;
module.exports.resolveRoster = resolveRoster;
