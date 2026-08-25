#!/usr/bin/env node
/**
 * Regenerates public/sitemap.xml and public/robots.txt from the live feeds.
 *
 * Why a script and not a hand-written file: the old sitemap was written by hand
 * for trademindff.com and never updated, so after the rename to macdraft.app it
 * pointed every crawler at the wrong domain and listed three URLs. This reads
 * the same two feeds the app itself uses, so the sitemap cannot drift again.
 *
 *   node scripts/gen-sitemap.mjs                    # reads production, writes public/
 *   node scripts/gen-sitemap.mjs --api http://localhost:3100
 *   node scripts/gen-sitemap.mjs --dry              # prints, writes nothing
 *
 * Run it after a deploy that adds screens, and on a schedule (a weekly Vercel
 * cron or a GitHub Action) so new players reach the index.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://macdraft.app';

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const API = (arg('--api', SITE)).replace(/\/+$/, '');
const DRY = argv.includes('--dry');

// The screens the SPA can restore from a cold URL. Keep in step with
// _VALID_SCREENS in public/app.js and SPA_ROUTES in server/index.js.
const SCREENS = [
  ['/',           '1.0', 'daily'],
  ['/mock',       '0.9', 'weekly'],
  ['/sage',       '0.9', 'weekly'],
  ['/analyze',    '0.8', 'weekly'],
  ['/research',   '0.7', 'daily'],
  ['/league',     '0.6', 'weekly'],
  ['/community',  '0.6', 'daily'],
  ['/privacy',    '0.3', 'monthly'],
  ['/terms',      '0.3', 'monthly'],
];

// Same slug rule as playerSlug() in public/app.js. If one changes, change both.
const slugify = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'MacDraft-sitemap/1.0' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

/**
 * Which players earn a page in the sitemap.
 *
 * Sleeper lists ~4,200 skill players: retired names, camp arms and practice
 * squad bodies with no team. Their /player pages would render a name and
 * nothing else, and a sitemap full of near-empty near-duplicates is worse than
 * no sitemap at all. FantasyCalc's current market is the honest cut: those are
 * exactly the players whose page has a live value, a 30-day trend, a positional
 * rank and trade comps to show. Today that is 399 players (68 QB / 112 RB /
 * 155 WR / 64 TE), which is a real, indexable page for every URL listed.
 * The 76 draft-pick rows in the same feed are dropped: picks are not players
 * and have no /player route.
 */
function pickPlayers(fc, slim) {
  const out = new Map(); // slug -> { slug, rank, name }
  for (const [sleeperId, v] of Object.entries(fc.byIdFull || {})) {
    if (!v || v.position === 'PICK') continue;
    if (!v.value) continue;

    // Name the URL the way the app names it. FantasyCalc and Sleeper disagree
    // on suffixes (FantasyCalc: "Marvin Harrison Jr", Sleeper: "Marvin
    // Harrison"), and the client resolves the slug against the Sleeper list,
    // so the Sleeper spelling is the one that actually opens a card.
    const s = slim[sleeperId];
    const name = s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : (v.name || '');
    const slug = slugify(name);
    if (!slug) continue;

    // Homonyms share a slug (37 pairs across the full Sleeper list). Only the
    // better-ranked one gets the URL, which is also the one the app opens.
    const rank = v.overallRank || 9999;
    const prev = out.get(slug);
    if (!prev || rank < prev.rank) out.set(slug, { slug, rank, name });
  }
  return [...out.values()].sort((a, b) => a.rank - b.rank);
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildSitemap(players, today) {
  const url = (loc, priority, changefreq, lastmod) =>
    `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n` +
    (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
    `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

  const rows = [
    ...SCREENS.map(([p, pri, freq]) => url(SITE + p, pri, freq, today)),
    // Values move every day, so the player pages are the freshest thing here.
    // Priority tracks the market rank: the top 50 are what anyone searches for.
    ...players.map((p) => url(
      `${SITE}/player/${p.slug}`,
      p.rank <= 50 ? '0.8' : p.rank <= 150 ? '0.6' : '0.4',
      'daily',
      today,
    )),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

const ROBOTS = `User-agent: *
Allow: /

# Internal setup helper, not a product page.
Disallow: /whoami

# Private self-scouting profile: one owner, his own trade history. The route
# already fails closed without PERFIL_ACCTS, but it has no business in an index
# either: there is nothing here a visitor could use.
Disallow: /perfil

Sitemap: ${SITE}/sitemap.xml
`;

async function main() {
  console.log(`Reading feeds from ${API}`);
  const [fc, slim] = await Promise.all([
    getJson(`${API}/api/ktc/rankings?numQbs=1&ppr=1`),
    getJson(`${API}/api/sleeper/players/nfl/slim`),
  ]);

  const players = pickPlayers(fc, slim);

  // A feed that answers 200 with an empty body would otherwise quietly publish
  // a sitemap with nine URLs and drop 400 pages out of the index overnight.
  // Refuse to write instead: a stale sitemap beats a gutted one.
  const FLOOR = 200;
  if (players.length < FLOOR) {
    console.error(`ABORT: only ${players.length} players resolved (floor ${FLOOR}). ` +
      `The feed is probably down. Nothing was written.`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const xml = buildSitemap(players, today);

  console.log(`  screens : ${SCREENS.length}`);
  console.log(`  players : ${players.length}  (top: ${players.slice(0, 3).map(p => p.slug).join(', ')})`);
  console.log(`  total   : ${SCREENS.length + players.length} URLs`);

  if (DRY) { console.log('\n--dry: nothing written\n'); console.log(xml.split('\n').slice(0, 14).join('\n')); return; }

  fs.writeFileSync(path.join(ROOT, 'public', 'sitemap.xml'), xml);
  fs.writeFileSync(path.join(ROOT, 'public', 'robots.txt'), ROBOTS);
  console.log(`\nWrote public/sitemap.xml and public/robots.txt`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
