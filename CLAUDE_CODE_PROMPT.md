# Paste this into Claude Code when you first open it

---

I am building a web app called TradeMind — a dynasty fantasy football trade analyzer.

I have already set up the project structure in this folder. Please read the BRIEF.md file first to understand the full project, then read the existing server files.

After reading those, do the following:

1. Copy the `trade-mind.html` file into a `public/` folder and rename it `index.html`
2. In `public/index.html`, replace every instance of `fetch("https://api.sleeper.app/v1/` with `fetch("/api/sleeper/` so all Sleeper calls go through our backend proxy
3. Also replace the KTC fetch calls (keeptradecut.com URLs) with `fetch("/api/ktc/rankings")`
4. Run `npm install` to install dependencies
5. Run `npm run dev` to start the server
6. Test that visiting http://localhost:3000 loads the app and entering a Sleeper username works

The main goal is to fix the CORS errors that happened when the app was hosted on Netlify. With the backend proxy, all API calls go through our server and CORS is no longer an issue.

---

Files already created:
- BRIEF.md — full project description
- package.json — dependencies
- server/index.js — Express server
- server/routes/sleeper.js — Sleeper API proxy
- server/routes/ktc.js — KTC API proxy
- .env.example — environment variables template

File you need to bring:
- trade-mind.html — put this in the same folder before starting
