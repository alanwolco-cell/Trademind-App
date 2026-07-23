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

// CORS locked to TradeMind's own origins. A missing Origin (server-to-server,
// the Stripe webhook, health checks) is allowed; browser requests from any other
// website are refused, so nobody can build a front-end on top of this API.
// NOTE: when a custom domain is added, include it in the allow check below.
const _corsOk = (o) => !o
  || o === 'https://trademind-starter.vercel.app'
  || /^https:\/\/trademind-starter[a-z0-9-]*\.vercel\.app$/.test(o)
  || /^http:\/\/localhost(:\d+)?$/.test(o);
app.use(cors({ origin: (origin, cb) => cb(null, _corsOk(origin)) }));
// Capture the raw body so the Stripe webhook can verify its signature (the
// parsed JSON loses the exact bytes Stripe signed).
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

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

// Serve frontend
// Static assets: a short TTL so repeat views skip the revalidation round-trip,
// but short enough that a deploy is picked up in minutes. Filenames are not
// content-hashed, so a long max-age would serve stale JS after every deploy.
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (/\.(css|js|png|jpg|jpeg|svg|webp|woff2?)$/i.test(filePath)) {
      res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    }
  },
}));

// Public player pages: /player/jahmyr-gibbs — same SPA, SEO-friendly meta tags
const fs = require('fs');
let _indexHtml = null;
app.get('/player/:slug', (req, res) => {
  try {
    if (!_indexHtml) _indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const nice = String(req.params.slug).replace(/[^a-z0-9-]/gi, '').split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 60);
    const title = nice ? `${nice} - Dynasty Value, Trades & Sage's Take | TradeMind` : 'TradeMind';
    const desc = nice ? `${nice}'s live fantasy football market value, trade history and comps, and what Sage would pay. Updated daily on TradeMind.` : '';
    let html = _indexHtml.replace(/<title>[\s\S]*?<\/title>/, '<title>' + title + '</title>');
    if (desc) html = html.replace(/(<meta name="description" content=")[^"]*(">)/, '$1' + desc + '$2');
    res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
    res.send(html);
  } catch (e) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// Legal pages: real, standalone (not the SPA catch-all)
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, '../public/privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, '../public/terms.html')));

// Lightweight client error beacon -> Vercel logs. Zero-cost visibility into
// runtime breakage in the field. Point BEACON at Sentry later if wanted: the
// client just POSTs {msg, url, ua}; this logs it where `vercel logs` can see.
app.post('/api/log/error', (req, res) => {
  try {
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Local dev: start server. Vercel: export app for serverless handler.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TradeMind running on http://localhost:${PORT}`);
  });
}

module.exports = app;
