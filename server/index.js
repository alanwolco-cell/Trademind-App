const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const sleeperRoutes = require('./routes/sleeper');
const ktcRoutes = require('./routes/ktc');
const newsRoutes = require('./routes/news');
const communityRoutes = require('./routes/community');
const espnRoutes = require('./routes/espn');
const statsRoutes = require('./routes/stats');
const yahooRoutes = require('./routes/yahoo');
const sageRoutes = require('./routes/sage');
const { playerBySlug } = sleeperRoutes;

const app = express();
const PORT = process.env.PORT || 3000;

// Don't advertise the stack to anyone fingerprinting the service.
app.disable('x-powered-by');

// Baseline security headers. No CSP here on purpose: the UI relies on inline
// styles and inline on* handlers, so a real policy would black out the site.
// Adding one means moving those to external handlers first - worth doing, but
// it is a refactor, not a header.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // payment= must keep Stripe's embedded checkout iframe working.
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(self "https://js.stripe.com")');
  next();
});

// CORS locked to Mac Draft's own origins. A missing Origin (server-to-server,
// the Stripe webhook, health checks) is allowed; browser requests from any other
// website are refused, so nobody can build a front-end on top of this API.
// Add every new custom domain here, or its browser requests get refused.
const _corsOk = (o) => !o
  || o === 'https://macdraft.app'
  || o === 'https://www.macdraft.app'
  || o === 'https://trademindff.com'
  || o === 'https://www.trademindff.com'
  || /^https:\/\/trademind-starter[a-z0-9-]*\.vercel\.app$/.test(o)
  || /^http:\/\/localhost(:\d+)?$/.test(o);
app.use(cors({ origin: (origin, cb) => cb(null, _corsOk(origin)) }));
// Capture the raw body so the Stripe webhook can verify its signature (the
// parsed JSON loses the exact bytes Stripe signed).
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

// Un fallo interno no se describe a si mismo en publico. Cualquier 500/502 que lleve
// un campo `error` de texto sale con un mensaje generico; el texto real queda en los
// logs de Vercel, que es donde sirve. Los 4xx/429/503 conservan su copy tal cual: esa
// es la redaccion que el usuario SI tiene que leer.
app.use((req, res, next) => {
  const _json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && typeof body.error === 'string'
        && (res.statusCode === 500 || res.statusCode === 502)) {
      console.error('[api] %s %s -> %d %s', req.method, req.originalUrl, res.statusCode, body.error);
      return _json(Object.assign({}, body, { error: 'Something went wrong on our side. Try again in a moment.' }));
    }
    return _json(body);
  };
  next();
});

// API routes
app.use('/api/sleeper', sleeperRoutes);
app.use('/api/ktc', ktcRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/espn', espnRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/yahoo', yahooRoutes);
app.use('/api/sage', sageRoutes);
app.use('/api/odds', require('./routes/odds'));
app.use('/api/scout', require('./routes/scout'));
app.use('/api/room', require('./routes/draftroom'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/perfil', require('./routes/perfil'));

// Serve frontend
// Static assets: a short TTL so repeat views skip the revalidation round-trip,
// but short enough that a deploy is picked up in minutes. Filenames are not
// content-hashed, so a long max-age would serve stale JS after every deploy.
app.use(express.static(path.join(__dirname, '../public'), {
  // No trailing-slash redirect. public/sage/ holds Mac's PNGs, so /sage - the
  // real URL of the Ask Mac screen - was answered with a 301 to /sage/, and the
  // SPA could not restore a screen from a path with a trailing slash. Turning
  // the redirect off lets /sage fall through to the app, and the assets under
  // /sage/<file>.png keep being served exactly as before.
  redirect: false,
  setHeaders: (res, filePath) => {
    if (/\.(css|js|png|jpg|jpeg|svg|webp|avif|mp4|webm|ico|woff2?)$/i.test(filePath)) {
      res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    }
  },
}));

// Public player pages: /player/jahmyr-gibbs - same SPA, SEO-friendly meta tags
const fs = require('fs');
let _indexHtml = null;
const NOT_FOUND_PAGE = path.join(__dirname, '../public/404.html');

// Rewrites one meta/link tag in the shipped index.html. The head carries a
// single hard-coded canonical and og:url pointing at the home page, so without
// this every player page told Google it was a duplicate of the home page and
// every share card showed the generic site title.
function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<(?:meta|link)[^>]*\\b${attr}="${key}"[^>]*\\b(?:content|href)=")[^"]*(")`, 'i');
  return html.replace(re, '$1' + String(value).replace(/"/g, '&quot;') + '$2');
}

app.get('/player/:slug', async (req, res) => {
  try {
    if (!_indexHtml) _indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const slug = String(req.params.slug).toLowerCase().replace(/[^a-z0-9-]/g, '');

    // Resolve the slug against the real player list before promising anything.
    // If the lookup itself fails (cold instance, Sleeper down) we fail OPEN:
    // serve the app with the generic head rather than 404 a real player.
    let player = null, resolved = false;
    try { player = await playerBySlug(slug); resolved = true; } catch (_) {}

    // A slug that is not a player gets a real 404 with our own page, not a
    // 200. A redirect to search would answer 200 and tell Google the URL is
    // real, which is exactly how a site ends up with thousands of thin pages
    // for names nobody plays. The 404 page still hands the visitor back in.
    if (resolved && !player) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(404).sendFile(NOT_FOUND_PAGE);
    }

    if (!player) {
      // Unresolved: the app still opens the card client-side, but tell crawlers
      // not to bank this render, since its head is the generic one.
      res.set('Cache-Control', 'no-store');
      res.set('X-Robots-Tag', 'noindex');
      return res.send(_indexHtml);
    }

    const name = player.name;
    // Aliases (a suffix spelled the other way) point at ONE canonical URL, or
    // the same player competes with himself in the index.
    const url = 'https://macdraft.app/player/' + (player.slug || slug);
    const where = player.team ? `${player.pos} ${player.team}` : player.pos || '';
    const title = `${name} - Dynasty Value, Trades & Mac's Take | Mac Draft`;
    const desc = `${name}${where ? ` (${where})` : ''} live fantasy football market value, 30-day trend, ` +
      `trade comps and what Mac would pay. Updated daily on Mac Draft.`;

    let html = _indexHtml
      .replace(/<title>[\s\S]*?<\/title>/, '<title>' + title + '</title>');
    html = setMeta(html, 'name', 'description', desc);
    html = setMeta(html, 'rel', 'canonical', url);
    html = setMeta(html, 'property', 'og:url', url);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'name', 'twitter:description', desc);
    // og:image stays the Mac Draft card on purpose: Sleeper's headshot is a
    // 350x254 transparent PNG, which renders as a black-backed postage stamp
    // in a summary_large_image slot. A real per-player card needs a rendered
    // 1200x630 image (see the follow-up note), not a hotlinked cutout.

    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
    res.send(html);
  } catch (e) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Legal pages: real, standalone (not the SPA catch-all)
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '../public/privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '../public/terms.html')));

// Setup helper: shows this browser's account id. It has to be a page, not a
// bare API call - the account key travels in a header that only the app's fetch
// wrapper adds, so typing /api/community/whoami into the address bar always
// looks anonymous.
app.get('/whoami', (req, res) => res.sendFile(path.join(__dirname, '../public/whoami.html')));

// Lightweight client error beacon -> Vercel logs. Zero-cost visibility into
// runtime breakage in the field. Point BEACON at Sentry later if wanted: the
// client just POSTs {msg, url, ua}; this logs it where `vercel logs` can see.
// Techo por IP y por minuto. Es un buzon anonimo que escribe en los logs de Vercel:
// sin tope, cualquiera los inunda y deja `vercel logs` inservible cuando mas hace falta.
const _beacon = new Map();
app.post('/api/log/error', (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'noip';
    const minute = Math.floor(Date.now() / 60000);
    const cur = _beacon.get(ip);
    const n = (cur && cur.m === minute) ? cur.n + 1 : 1;
    _beacon.set(ip, { m: minute, n });
    if (_beacon.size > 5000) _beacon.clear();   // el mapa nunca crece sin freno
    if (n > 20) return res.status(204).end();
    const b = req.body || {};
    console.error('[client-error]', JSON.stringify({
      msg: String(b.msg || '').slice(0, 300),
      src: String(b.src || '').slice(0, 200),
      line: b.line, ua: String(b.ua || '').slice(0, 160),
      t: new Date().toISOString(),
    }));
  } catch (_) {}
  res.status(204).end();
});

// ── Not found ────────────────────────────────────────────────────────────────
// Everything below runs only when nothing above matched.

// An unknown API path has to answer like an API. It used to fall through to the
// SPA catch-all and reply 200 with 143KB of HTML, so r.ok was true and the
// caller's r.json() blew up on '<' instead of seeing a 404.
app.all(/^\/api\//, (req, res) => res.status(404).json({ error: 'not found' }));

// The client routes the SPA can restore from a cold URL. Keep in step with
// _VALID_SCREENS in public/app.js and SCREENS in scripts/gen-sitemap.mjs.
const SPA_ROUTES = new Set([
  '/', '/home', '/mock', '/sage', '/analyze', '/league', '/research',
  '/community', '/learn', '/news',
  // /perfil is deliberately NOT in gen-sitemap.mjs and is disallowed in
  // robots.txt: it is a private self-scouting tab for the owner, gated server
  // side by PERFIL_ACCTS. It still has to restore from a cold URL, so it
  // belongs here, but it must never be advertised to a crawler.
  '/perfil',
]);

// A missing file has to 404, not answer with HTML. Serving index.html for a
// missing .js or .css makes the browser refuse it on MIME grounds and prints an
// error in every visitor's console.
const ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|mp3|json|txt|xml)$/i;

app.use((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(404).json({ error: 'not found' });
  }
  if (ASSET_EXT.test(req.path)) {
    // Bodiless on purpose: any body would carry a content type the browser
    // then complains about ("refused to execute ... MIME type").
    return res.status(404).end();
  }
  const route = '/' + req.path.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (SPA_ROUTES.has(route)) {
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  }
  // Anything else is a wrong link. Our own page, an honest status, and two ways
  // back into the product - never the browser's default error screen.
  res.status(404).sendFile(path.join(__dirname, '../public/404.html'));
});

// Local dev: start server. Vercel: export app for serverless handler.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mac Draft running on http://localhost:${PORT}`);
  });
}

module.exports = app;
