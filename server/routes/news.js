const express = require('express');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');
const router = express.Router();

const playerCache = new NodeCache({ stdTTL: 1800 }); // 30-min cache per player

// RotoWire's public NFL news feed: player-level camp, injury and role notes.
// The live feed only holds the last few notes, so we accumulate them into a
// rolling 72h window in blob storage - the grid, ticker and player cards all
// draw from that window. Headlines link back to the full RotoWire story.
const rwCache = new NodeCache({ stdTTL: 600 });
async function fetchRotoNews() {
  const hit = rwCache.get('rw');
  if (hit) return hit;
  let stored = [];
  try {
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: 'rwnews/nfl.json', limit: 1 });
    if (blobs.length) {
      const j = await (await fetch(blobs[0].url + '?t=' + Date.now())).json();
      if (Array.isArray(j)) stored = j;
    }
  } catch (_) {}
  let fresh = [];
  try {
    const r = await fetch('https://www.rotowire.com/rss/news.php?sport=NFL', {
      headers: { 'User-Agent': 'Mozilla/5.0 (TradeMind)' }, redirect: 'follow'
    });
    if (r.ok) {
      const xml = await r.text();
      const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      fresh = xml.split('<item>').slice(1).map(it => {
        const pick = tag => { const m = it.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>')); return m ? dec(m[1]) : ''; };
        const title = pick('title');
        const link = pick('link').replace('.com//', '.com/');
        const description = pick('description').replace(/<[^>]+>/g, '').slice(0, 160);
        const guid = pick('guid') || link;
        const pub = Date.parse(pick('pubDate'));
        return title && link ? { guid, title, link, description, ts: isNaN(pub) ? Date.now() : pub } : null;
      }).filter(Boolean);
    }
  } catch (_) {}
  const now = Date.now(), seen = {}, merged = [];
  fresh.concat(stored).forEach(i => {
    if (!i || !i.title || seen[i.guid || i.link]) return;
    seen[i.guid || i.link] = 1;
    if (!i.ts) i.ts = now;
    if (now - i.ts < 72 * 3600 * 1000) merged.push(i);
  });
  const out = merged.slice(0, 150);
  rwCache.set('rw', out);
  try {
    const had = {}; stored.forEach(i => { had[i.guid || i.link] = 1; });
    const grew = fresh.some(i => !had[i.guid || i.link]);
    if (grew || out.length !== stored.length) {
      const { put } = require('@vercel/blob');
      await put('rwnews/nfl.json', JSON.stringify(out), { access: 'public', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
    }
  } catch (_) {}
  return out;
}

// GET /api/news/player/:espnId — ESPN player bio + stats
router.get('/player/:espnId', async (req, res) => {
  const { espnId } = req.params;
  const rwName = String(req.query.name || '').trim().slice(0, 60);
  const cacheKey = espnId + '|' + rwName.toLowerCase();
  const cached = playerCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const headers = { 'User-Agent': 'TradeMind/1.0', 'Accept': 'application/json' };
    const [playerRes, newsRes, listRes, gnewsRes] = await Promise.all([
      fetch(`https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${espnId}`, { headers }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/${espnId}/news?limit=3`, { headers }).catch(() => null),
      // ESPN's athlete news feed is often empty in the offseason - the main NFL
      // news list is always populated, so we filter it to this player below.
      fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50`, { headers }).catch(() => null),
      // Google News: broad, always-populated per-player coverage from every outlet.
      rwName ? fetch('https://news.google.com/rss/search?q=' + encodeURIComponent('"' + rwName + '" NFL') + '&hl=en-US&gl=US&ceid=US:en', { headers: { 'User-Agent': 'Mozilla/5.0 (TradeMind)' } }).catch(() => null) : Promise.resolve(null),
    ]);
    if (!playerRes.ok) throw new Error(`ESPN returned ${playerRes.status}`);
    const d = await playerRes.json();
    const a = d.athlete || {};
    const stats = (a.statsSummary || {}).statistics || [];

    const newsJson = newsRes && newsRes.ok ? await newsRes.json().catch(() => null) : null;
    const articles = ((newsJson && newsJson.articles) || []).slice(0, 4).map(art => ({
      headline: art.headline || art.title || '',
      description: (art.description || art.caption || '').slice(0, 180),
      link: ((art.links || {}).web || {}).href || null,
      image: (art.images && art.images[0] && art.images[0].url) || null,
      source: 'ESPN',
    })).filter(art => art.headline);

    // Main NFL news list (populated year-round), normalized for name matching below
    let espnList = [];
    try {
      const lj = listRes && listRes.ok ? await listRes.json() : null;
      espnList = ((lj && lj.articles) || []).map(art => ({
        headline: art.headline || art.title || '',
        description: (art.description || '').slice(0, 180),
        link: ((art.links || {}).web || {}).href || null,
        image: (art.images && art.images[0] && art.images[0].url) || null,
        source: 'ESPN',
      })).filter(a => a.headline && a.link);
    } catch (_) {}

    const result = {
      headshot: (a.headshot || {}).href || null,
      statsLabel: (a.statsSummary || {}).displayName || null,
      stats: stats.map(s => ({ abbr: s.abbreviation, name: s.displayName, val: s.displayValue })),
      draft: a.displayDraft || null,
      birthPlace: a.displayBirthPlace || null,
      height: a.displayHeight || null,
      weight: a.displayWeight || null,
      experience: a.displayExperience || null,
      articles,
    };

    // Pull this player's news from EVERY source we have: the ESPN player wire
    // (above), RotoWire player notes, and any story in the general feed (Yahoo,
    // Reddit, ESPN) that names him - so the card shows all the news on a guy.
    if (rwName) {
      const norm = s => String(s).toLowerCase().replace(/[^a-z ]/g, '')
        .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();
      const want = norm(rwName);
      const lastName = want.split(' ').slice(-1)[0] || '';
      // RotoWire player notes (titles are "Player Name: note")
      try {
        const rw = await fetchRotoNews();
        const mine = rw.filter(i => i.title.indexOf(':') > 0 && norm(i.title.slice(0, i.title.indexOf(':'))) === want)
          .slice(0, 3).map(i => ({
            headline: i.title.slice(i.title.indexOf(':') + 1).trim(),
            description: i.description, link: i.link, image: null, source: 'RotoWire',
          }));
        result.articles = mine.concat(result.articles);
      } catch (_) {}
      // ESPN main-list stories that name this player (reliable year-round source)
      try {
        const re = lastName.length > 3 ? new RegExp('\\b' + lastName + '\\b', 'i') : null;
        const hits = espnList.filter(a => {
          const t = ((a.headline || '') + ' ' + (a.description || '')).toLowerCase();
          return t.indexOf(want) >= 0 || (re && re.test(t));
        });
        result.articles = result.articles.concat(hits);
      } catch (_) {}
      // Any story in the general feed that mentions this player (full name, or his
      // last name as a whole word when it's distinctive enough to avoid false hits)
      try {
        const feed = artCache.get('articles');
        if (feed && Array.isArray(feed.articles)) {
          const re = lastName.length > 3 ? new RegExp('\\b' + lastName + '\\b', 'i') : null;
          const extra = feed.articles.filter(a => {
            const t = ((a.headline || '') + ' ' + (a.description || '')).toLowerCase();
            return t.indexOf(want) >= 0 || (re && re.test(t));
          }).map(a => ({ headline: a.headline, description: a.description, link: a.link, image: a.image, source: a.source }));
          result.articles = result.articles.concat(extra);
        }
      } catch (_) {}
      // Google News: recent stories on this player from every outlet (title is
      // "Headline - Outlet"; the <source> tag is the outlet, which becomes the badge)
      try {
        if (gnewsRes && gnewsRes.ok) {
          const xml = await gnewsRes.text();
          const gn = xml.split('<item>').slice(1, 8).map(it => {
            const pick = t => { const m = it.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim() : ''; };
            let title = pick('title'); const link = pick('link'); const src = pick('source');
            if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3)).trim();
            return { headline: title, description: '', link, image: null, source: src || 'Google News' };
          }).filter(a => a.headline && a.link);
          result.articles = result.articles.concat(gn);
        }
      } catch (_) {}
      // Dedupe by headline; when the same story appears twice keep the pictured copy
      const seen = [], deduped = [];
      for (const a of result.articles) {
        const key = norm(a.headline).slice(0, 42);
        const idx = seen.indexOf(key);
        if (idx === -1) { seen.push(key); deduped.push(a); }
        else if (!deduped[idx].image && a.image) deduped[idx].image = a.image;
      }
      result.articles = deduped.slice(0, 6);
      // Backfill pictures for text-only stories that have a resolvable link. Skip
      // Google News redirect URLs - they never expose an og:image and only burn a
      // timeout. (Cached per-URL, so any real fetch is paid once per story.)
      const noImg = result.articles.filter(a => !a.image && a.link && !/news\.google\.com/.test(a.link)).slice(0, 5);
      await Promise.all(noImg.map(async a => { const img = await ogImage(a.link); if (img) a.image = img; }));
    }
    playerCache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/news/nfl — ESPN NFL RSS headlines + Sleeper trending players
router.get('/nfl', async (req, res) => {
  try {
    const [espnRaw, trendAdd, trendDrop, rw] = await Promise.all([
      fetch('https://www.espn.com/espn/rss/nfl/news', {
        headers: { 'User-Agent': 'TradeMind/1.0' }
      }).then(r => r.text()).catch(() => ''),
      fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=10')
        .then(r => r.json()).catch(() => []),
      fetch('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=24&limit=10')
        .then(r => r.json()).catch(() => []),
      fetchRotoNews()
    ]);

    // Parse ESPN RSS titles
    const headlines = [];
    const titleRe = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g;
    let m;
    while ((m = titleRe.exec(espnRaw)) !== null) {
      const t = (m[1] || m[2] || '').trim();
      if (t && !/espn/i.test(t) && t.length > 10) headlines.push(t);
    }

    res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=3600');
    res.json({
      headlines: rw.map(i => i.title).slice(0, 8).concat(headlines).slice(0, 15),
      trending_add: trendAdd,
      trending_drop: trendDrop
    });
  } catch (e) {
    res.status(500).json({ error: e.message, headlines: [], trending_add: [], trending_drop: [] });
  }
});


// GET /api/news/articles — rich NFL news: headline, description, link, image
const NodeCache2 = require('node-cache');
const artCache = new NodeCache2({ stdTTL: 120 }); // 2-min so new drops surface fast
// og:image lookups are the same for a given article URL for hours - cache long so
// we only ever fetch a page's picture once, not on every /articles rebuild.
const ogCache = new NodeCache2({ stdTTL: 6 * 3600 });
// Pull the social-share picture from a story's page (og:image / twitter:image).
// Skips obvious logos/placeholders so we don't fill the grid with wire-service marks.
async function ogImage(url) {
  const hit = ogCache.get(url);
  if (hit !== undefined) return hit;
  let img = null;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (TradeMind)' }, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(to);
    if (r.ok) {
      const html = (await r.text()).slice(0, 60000);
      const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
             || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
      if (m && m[1] && !/logo|sprite|default[-_]|placeholder|blank|favicon|1x1|spacer/i.test(m[1])) img = m[1];
    }
  } catch (_) {}
  ogCache.set(url, img);
  return img;
}
router.get('/articles', async (req, res) => {
  try {
    const cached = artCache.get('articles');
    if (cached) return res.json(cached);
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=12', {
      headers: { 'User-Agent': 'TradeMind/1.0', 'Accept': 'application/json' }
    });
    if (!r.ok) throw new Error('ESPN ' + r.status);
    const d = await r.json();
    const articles = (d.articles || []).map(a => ({
      headline: a.headline || '',
      description: (a.description || '').slice(0, 180),
      link: ((a.links || {}).web || {}).href || null,
      image: (a.images && a.images[0] && a.images[0].url) || null,
      published: a.published || null,
      source: 'ESPN',
    })).filter(a => a.headline && a.link);
    // Merge in hot fantasy football threads from Reddit (activates automatically
    // once REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set in Vercel env vars)
    try {
      if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
        let tok = artCache.get('reddit_token');
        if (!tok) {
          const auth = Buffer.from(process.env.REDDIT_CLIENT_ID + ':' + process.env.REDDIT_CLIENT_SECRET).toString('base64');
          const tr = await fetch('https://www.reddit.com/api/v1/access_token', {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + auth,
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'web:trademind:1.0 (by /u/No-Cold8838)',
            },
            body: 'grant_type=client_credentials',
          });
          if (tr.ok) {
            const td = await tr.json();
            tok = td.access_token;
            if (tok) artCache.set('reddit_token', tok, 3000); // ~50 min (tokens last 1h)
          }
        }
        if (tok) {
          const subs = ['fantasyfootball', 'DynastyFF'];
          for (const sub of subs) {
            const rr = await fetch('https://oauth.reddit.com/r/' + sub + '/hot?limit=5', {
              headers: { 'Authorization': 'Bearer ' + tok, 'User-Agent': 'web:trademind:1.0 (by /u/No-Cold8838)' },
            });
            if (!rr.ok) continue;
            const rd = await rr.json();
            (rd.data.children || []).forEach(c => {
              const p = c.data;
              if (!p || p.stickied || !p.title) return;
              let img = null;
              try { img = p.preview.images[0].source.url.replace(/&amp;/g, '&'); } catch (_) {}
              articles.push({
                headline: p.title.slice(0, 140),
                description: (p.selftext || '').replace(/\n/g, ' ').slice(0, 160) || (p.ups + ' upvotes · ' + p.num_comments + ' comments'),
                link: 'https://www.reddit.com' + p.permalink,
                image: img,
                published: null,
                source: 'r/' + sub,
              });
            });
          }
        }
      }
    } catch (e) { console.error('[news] reddit:', e.message); }

    // Merge in Yahoo Sports NFL stories for source variety
    try {
      const yr = await fetch('https://sports.yahoo.com/nfl/rss/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (TradeMind)' }, redirect: 'follow'
      });
      if (yr.ok) {
        const xml = await yr.text();
        const items = xml.split('<item>').slice(1, 7);
        items.forEach(it => {
          const pick = (tag) => {
            const m = it.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'));
            return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
          };
          const title = pick('title');
          const link = pick('link');
          const desc = pick('description').replace(/<[^>]+>/g, '').slice(0, 160);
          const imgM = it.match(/<media:content[^>]*url="([^"]+)"/);
          if (title && link) articles.push({
            headline: title.slice(0, 140), description: desc,
            link, image: imgM ? imgM[1] : null, published: null, source: 'Yahoo Sports',
          });
        });
      }
    } catch (_) {}
    // RotoWire: the most fantasy-focused wire on the grid - player-level
    // notes with a link back to the full story on rotowire.com
    try {
      const rw = await fetchRotoNews();
      rw.slice(0, 8).forEach(i => articles.push({
        headline: i.title.slice(0, 140), description: i.description,
        link: i.link, image: null, published: null, source: 'RotoWire',
      }));
    } catch (e) { console.error('[news] rotowire:', e.message); }
    // Fantasy-relevant only: player/roster/coaching news stays, business and
    // human-interest stories (obituaries, owners, stadiums, broadcast deals) go.
    const KEEP_RE = /fantasy|waiver|start.?sit|sleeper|dynasty|ranking|injur|trade|depth chart|breakout|rookie|draft|sign|contract|extension|release|cut|suspend|activate|quarterback|running back|wide receiver|tight end|\bQB\b|\bRB\b|\bWR\b|\bTE\b|coach|coordinator|offense|defense|starter|snap|practice|camp|holdout|return|debut|benched|IR\b/i;
    const DROP_RE = /dies|dead at|obituar|funeral|memorial|passes away|owner(ship)?|stadium|arena|broadcast|tv deal|halftime|concert|charity|lawsuit against the league|hall of fame ceremony/i;
    const filtered = articles.filter(a => {
      const t = (a.headline || '') + ' ' + (a.description || '');
      return a.source === 'RotoWire' || (KEEP_RE.test(t) && !DROP_RE.test(t));
    });
    // ── Dedupe cross-source repeats: the same storyline often lands on ESPN,
    // Yahoo, AND RotoWire. Keep ONE copy per story (Jaccard >= 0.5 on the
    // significant headline words = same story), and prefer the copy with a picture.
    const _stop = new Set('the a an of to in on for and or with his her its at is are was be by from as this that after over into out off up down not new nfl his has had will who what'.split(' '));
    const _sig = (a) => new Set(((a.headline || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 2 && !_stop.has(w)));
    const _same = (s1, s2) => {
      if (!s1.size || !s2.size) return false;
      let inter = 0; s1.forEach(w => { if (s2.has(w)) inter++; });
      const union = s1.size + s2.size - inter;
      return union > 0 && inter / union >= 0.5;
    };
    const deduped = [], sigs = [];
    for (const a of filtered) {
      const sa = _sig(a);
      let dup = -1;
      for (let i = 0; i < sigs.length; i++) { if (_same(sigs[i], sa)) { dup = i; break; } }
      if (dup === -1) { deduped.push(a); sigs.push(sa); }
      else if (!deduped[dup].image && a.image) { deduped[dup].image = a.image; } // upgrade to the pictured copy
    }
    // ── Picture backfill: for stories that arrived text-only (RotoWire, Yahoo),
    // pull the page's og:image so the grid is visual instead of walls of text.
    const need = deduped.filter(a => !a.image && a.link).slice(0, 10);
    await Promise.all(need.map(async a => { const img = await ogImage(a.link); if (img) a.image = img; }));
    const out = { articles: deduped.length >= 3 ? deduped : articles.slice(0, 6) };
    artCache.set('articles', out);
    res.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message, articles: [] }); }
});

// ── Tweet resolver: pull a post's data (incl. native video MP4) from X's own
// syndication CDN so videos play in a native player ON OUR SITE instead of
// bouncing users to x.com. Same public endpoint X's embed widget uses.
const tweetCache = new NodeCache2({ stdTTL: 3600 });
function tweetToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}
router.get('/tweet/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').replace(/\D/g, '');
    if (!id) return res.status(400).json({ error: 'bad id' });
    const hit = tweetCache.get(id);
    if (hit) { res.set('Cache-Control', 'public, max-age=1800, s-maxage=3600'); return res.json(hit); }
    const r = await fetch('https://cdn.syndication.twimg.com/tweet-result?id=' + id + '&token=' + tweetToken(id), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TradeMind/1.0)' }
    });
    if (!r.ok) throw new Error('syndication ' + r.status);
    const d = await r.json();
    let video = null;
    const media = d.mediaDetails || [];
    for (const m of media) {
      if ((m.type === 'video' || m.type === 'animated_gif') && m.video_info && m.video_info.variants) {
        const mp4s = m.video_info.variants.filter(v => v.content_type === 'video/mp4');
        mp4s.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
        if (mp4s.length) video = { mp4: mp4s[mp4s.length - 1].url, poster: m.media_url_https || null };
        break;
      }
    }
    let youtube = null;
    for (const u of ((d.entities || {}).urls || [])) {
      const m2 = (u.expanded_url || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
      if (m2) { youtube = m2[1]; break; }
    }
    const photo = !video && d.photos && d.photos[0] ? d.photos[0].url : null;
    const out = {
      id,
      name: (d.user || {}).name || '',
      screen_name: (d.user || {}).screen_name || '',
      avatar: (d.user || {}).profile_image_url_https || null,
      text: d.text || '',
      created_at: d.created_at || null,
      likes: d.favorite_count || 0,
      video, youtube, photo
    };
    tweetCache.set(id, out);
    res.set('Cache-Control', 'public, max-age=1800, s-maxage=3600');
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;

