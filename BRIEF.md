# TradeMind — Project Brief for Claude Code

## What is TradeMind
TradeMind is a dynasty fantasy football trade analyzer that uses psychology, not just math. It tells you:
1. Whether YOU should do a trade (based on your dynasty situation)
2. How to pitch the trade to get it accepted (based on opponent psychology)
3. The KTC value balance between both sides

It is currently a single `trade-mind.html` file. The goal is to convert it into a proper Node.js web app.

---

## The Core Problem to Fix
The app connects to the Sleeper Fantasy Football API (https://api.sleeper.app/v1) from the browser. This causes **CORS errors** on hosted environments like Netlify. The fix is a Node.js backend that proxies all Sleeper API calls server-side.

The KTC (KeepTradeCut) API also has CORS restrictions and needs a backend proxy.

---

## Current Features (all in the HTML file)

### Sleeper Integration
- User enters their Sleeper username
- App fetches their NFL leagues for the active season via `/state/nfl` then `/user/{id}/leagues/nfl/{season}`
- User selects a dynasty league
- App loads:
  - All NFL players via `/players/nfl` (huge 5MB payload — cache this server-side)
  - League rosters via `/league/{id}/rosters`
  - League users via `/league/{id}/users`
  - Traded picks via `/league/{id}/traded_picks`
- Player autocomplete shows player images from Sleeper CDN: `https://sleepercdn.com/content/nfl/players/thumb/{player_id}.jpg`

### Trade Builder
- Two sides: "You give" and "You get"
- Player search autocomplete with position badges and Sleeper CDN images
- Draft picks also appear in autocomplete (2025 Round 1, 2025 Round 2, etc.)
- Opponent selector dropdown (populated from league users)

### Opponent Profiler (3 questions)
1. Their dynasty direction (win now / rebuild / denial / perma-mid / young contender)
2. How they make trade decisions (data / hype / name brand / gut)
3. Trade history between you two (mutual / always counters / no history)

Output: assigns one of 9 personality profiles:
- The Closing Window, The True Rebuilder, The Denial Manager, The Young Contender
- The Flip Addict, The KTC Robot, The Star Hoarder, The Counter King, The Perma-Mid

### Your Situation (3 questions)
1. Your dynasty situation (contending / building / rebuilding / middle)
2. Why you are considering this trade (initiated / received offer / need / sell high)
3. How you feel about giving up your players (fine / hesitation / would regret / only for KTC numbers)

Output: one of 8 verdicts (DO NOT DO THIS TRADE / PULL THE TRIGGER / COUNTER FIRST / etc.)

### Results Panel
- Trade Balance bar (replaces acceptance % ring) — fills green if you win, red if you lose, based on KTC value gap
- KTC value strip showing exact values
- 3 fit cards: "Fits YOUR roster?", "Fits THEIR roster?", "Right timing?" — each YES/MAYBE/NO in color
- Opponent read: 3 mini cards for Deal urgency, Resistance level, Hype susceptibility
- Pitch section: talking angles, what to avoid, and a ready-to-copy message tailored to opponent profile

### Other Features
- Trade history (saved to localStorage)
- League leaderboard (KTC value won/lost per trade)
- Shareable trade link (base64 encoded URL param)

---

## Tech Stack to Build

### Backend (Node.js + Express)
```
/server
  index.js          — Express server
  routes/
    sleeper.js      — Proxy all Sleeper API calls
    ktc.js          — Proxy KTC API calls
    players.js      — Cache /players/nfl (refresh daily)
  cache/
    players.json    — Cached player database
```

### Frontend
Keep the existing HTML/CSS/JS from trade-mind.html but:
- Replace all `fetch('https://api.sleeper.app/v1/...')` calls with `fetch('/api/sleeper/...')`
- Replace KTC calls with `fetch('/api/ktc/...')`
- Serve the frontend as a static file from Express

### API Routes needed
```
GET /api/sleeper/state/nfl
GET /api/sleeper/user/:username
GET /api/sleeper/user/:userId/leagues/nfl/:season
GET /api/sleeper/league/:leagueId/rosters
GET /api/sleeper/league/:leagueId/users
GET /api/sleeper/league/:leagueId/traded_picks
GET /api/sleeper/players/nfl          (cached, refreshes daily)
GET /api/ktc/rankings                 (cached, refreshes daily)
```

---

## Design
- Colors: Sleeper-inspired dark navy (#0f0f13, #1a1a2e, #22223b)
- Accent: purple (#7c5cbf / #9b72e8)
- Fonts: Space Grotesk (headings) + Inter (body)
- Fully responsive

---

## Deployment Target
Vercel or Railway (Node.js). Keep it simple.

---

## First Steps for Claude Code
1. Read `trade-mind.html` to understand the full current implementation
2. Create the folder structure above
3. Build the Express server with the proxy routes
4. Refactor the frontend JS to use `/api/...` routes instead of direct Sleeper calls
5. Test that the Sleeper username login works end to end

---

## Owner
Alan — dynasty fantasy football player, building this as a public product.
