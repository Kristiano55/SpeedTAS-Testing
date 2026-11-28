// Link previews for Discord, X, WhatsApp... (Open Graph). The site uses #/ addresses, and the part after # never
// reaches Discord, so every link would show the same preview. This writes one small static page per player (per
// season), edition and season table under share/, each with its own title, text and picture, which opens the
// normal site page. Run by the data Action after new data; also writes sitemap.xml.
//   node scripts/share-pages.mjs            update what changed (needs playwright, like the site check)
//   node scripts/share-pages.mjs --all      redraw every picture
// The numbers come from the site itself: the repo is served locally and opened in headless Chromium, so standings,
// best-of scoring, tie-breaks and name matching are exactly the site's (nothing is re-implemented here).
// A picture is redrawn only when its content changes (hash in data/share/manifest.json); a picture whose Discord
// avatar couldn't load is drawn with initials and redrawn on the next run.
import http from 'node:http';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const [OWNER, REPO] = (process.env.GITHUB_REPOSITORY || 'Kristiano55/SpeedTAS-Testing').split('/');
const SITE = `https://${OWNER.toLowerCase()}.github.io/${REPO}/`;
const DESIGN = 1; // bump to redraw every picture after changing the card design below
const ALL = process.argv.includes('--all');
const ROOT = process.cwd();

/* ---------- local server + browser ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
// The site's own data files only (no live Sheets/Worker, so pictures match the committed data); outside images
// (Discord avatars, map pictures) are allowed so they appear on the cards.
await ctx.route('**/*', (route) => {
  const req = route.request(), u = req.url();
  if (u.startsWith('http://localhost') || req.resourceType() === 'image') return route.continue();
  return route.fulfill({ status: 503, body: '' });
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.warn('page error:', e.message));
// A Discord picture that fails to load becomes initials at the same size (the site's fallback doesn't keep the size).
await page.addInitScript(() => {
  window.__shareAvatarFallback = (img, encoded) => {
    const name = decodeURIComponent(encoded), size = parseInt(img.style.width, 10) || 32;
    const div = document.createElement('div');
    div.className = 'avatar';
    div.style.cssText = `background:${colorForName(name)};width:${size}px;height:${size}px;font-size:${size * 0.35}px;flex-shrink:0`;
    div.textContent = initials(name);
    img.replaceWith(div);
  };
});

const slugify = (name) => String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'player';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- gather everything from the site ---------- */
async function gather(game) {
  await page.goto(BASE + (game === 'tm20' ? '#/tm20' : '#/'));
  await page.waitForFunction((g) => typeof GAME !== 'undefined' && GAME === g && RAW && RAW.editions, game, { timeout: 30000 });
  await page.waitForTimeout(500);
  return page.evaluate(async (game) => {
    const seasons = game === 'tm20' ? [curKey()] : TMNF_SEASON_ORDER;
    const [maps, out] = [await repoMaps(), []];
    for (const key of seasons) {
      const data = await loadSeasonData(key);
      if (!data || !data.editions || !data.editions.length) continue;
      const comp = computeAll(data), times = await seasonTimes(key).catch(() => ({}));
      const label = game === 'tm20' ? 'TM2020' : SEASON_INFO[key].label;
      out.push({
        key, label, editions: data.editions.length,
        players: comp.ranked.map((p) => ({ name: p.name, rank: p.rank, points: p.points, wins: p.wins, podiums: p.podiums, played: p.played, dropped: p.droppedPoints || 0,
          form: p.history.slice(-5).map((h) => ({ place: h.placement, dropped: !!h.dropped, ed: h.edition })) })),
        eds: data.editions.map((e) => {
          const order = Object.entries(e.results).sort((a, b) => a[1] - b[1]);
          const t = times[String(e.edition)] || {}, secs = (n) => (t[n] && t[n].secs != null ? t[n].secs : null);
          const map = (maps[mapKeyFor(key)] || {})[e.edition];
          return { edition: String(e.edition), field: order.length, podium: order.slice(0, 3).map(([name, place]) => ({ name, place, secs: secs(name) })),
            map: map ? { name: map.name, authors: map.authors || [], thumb: mapThumb(map) } : null };
        }),
      });
    }
    return out;
  }, game);
}

/* ---------- cards (drawn in the page, with the site's styles and helpers) ---------- */
async function shoot(html, file) {
  const result = await page.evaluate(async (html) => {
    let stage = document.getElementById('shareStage');
    if (!stage) {
      stage = document.createElement('div'); stage.id = 'shareStage';
      stage.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:630px;z-index:2147483647;overflow:hidden';
      document.body.appendChild(stage);
    }
    stage.innerHTML = html.replace(/onerror="handleAvatarError\(/g, 'onerror="__shareAvatarFallback(');
    const imgs = [...stage.querySelectorAll('img')], wanted = imgs.filter((i) => /discordapp|tmnf\.exchange|ytimg/.test(i.src)).length;
    await Promise.race([Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); })))), new Promise((r) => setTimeout(r, 8000))]);
    await document.fonts.ready;
    const loaded = [...stage.querySelectorAll('img')].filter((i) => /discordapp|tmnf\.exchange|ytimg/.test(i.src) && i.naturalWidth > 0).length;
    return { complete: loaded >= wanted };
  }, html);
  await mkdir(dirname(file), { recursive: true });
  await (await page.$('#shareStage')).screenshot({ path: file, type: 'jpeg', quality: 82 });
  return result.complete;
}
const frame = (inner, { label, accent }) => `
  <div style="position:absolute;inset:0;background:radial-gradient(1200px 500px at 85% -10%, ${accent}22, transparent 60%), var(--bg);color:var(--text);font-family:var(--font-body,inherit);padding:56px 64px;box-sizing:border-box;display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div class="logo" style="font-size:34px;pointer-events:none;order:0"><span>Speed</span><b>TAS</b></div>
      <div style="order:1;font-family:var(--font-mono);font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:${accent};border:2px solid ${accent}66;border-radius:6px;padding:6px 14px">${esc(label)}</div>
    </div>
    <div style="flex:1;display:flex;min-height:0">${inner}</div>
    <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:18px;color:var(--dim)"><span>One hour to TAS a map · fastest run wins</span><span>${esc(SITE.replace(/^https:\/\//, '').replace(/\/$/, ''))}</span></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:6px;background:${accent}"></div>
  </div>`;
const stat = (label, value) => `<div><div style="font-family:var(--font-mono);font-size:16px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)">${label}</div><div style="font-family:var(--font-display);font-size:58px;font-weight:700;line-height:1.05">${value}</div></div>`;
const medal = { 1: 'var(--gold)', 2: 'var(--silver)', 3: 'var(--bronze)' };

function playerCard(p, s, total, theme) {
  return frame(`
    <div style="display:flex;align-items:center;gap:48px;width:100%">
      <div style="flex:none">__AVATAR__</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-display);font-size:${p.name.length > 14 ? 72 : 92}px;font-weight:800;font-style:italic;text-transform:uppercase;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
        <div style="display:flex;gap:44px;margin-top:26px">${stat('Points', p.points)}${stat('Wins', p.wins)}${stat('Podiums', p.podiums)}${stat('Races', p.played)}</div>
        <div class="form" style="margin-top:26px;transform:scale(1.6);transform-origin:left center">__FORM__</div>
      </div>
      <div style="flex:none;text-align:right">
        <div style="font-family:var(--font-mono);font-size:18px;letter-spacing:.12em;color:var(--dim);text-transform:uppercase">of ${total}</div>
        <div style="font-family:var(--font-display);font-size:170px;font-weight:800;font-style:italic;line-height:.9;color:${p.rank <= 3 ? medal[p.rank] : theme.accent}">P${p.rank}</div>
      </div>
    </div>`, theme);
}
function editionCard(e, s, theme) {
  const t1 = e.podium[0] && e.podium[0].secs;
  const row = (r) => `<div style="display:flex;align-items:center;gap:22px;padding:10px 0">
      <div style="width:54px;font-family:var(--font-display);font-size:50px;font-weight:800;font-style:italic;color:${medal[r.place]}">${r.place}</div>
      __AV_${esc(r.name)}__
      <div style="flex:1;font-family:var(--font-display);font-size:46px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</div>
      <div style="font-family:var(--font-mono);font-size:30px;color:${r.place === 1 ? theme.accent : 'var(--muted)'}">${r.secs == null ? '' : r.place === 1 || t1 == null ? r.secs.toFixed(2) : '+' + (r.secs - t1).toFixed(2)}</div>
    </div>`;
  return frame(`
    <div style="display:flex;gap:44px;width:100%;align-items:center">
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--font-display);font-size:84px;font-weight:800;font-style:italic;text-transform:uppercase;line-height:1">Edition <span style="color:${theme.accent}">#${esc(e.edition)}</span></div>
        <div style="font-size:24px;color:var(--muted);margin:10px 0 16px">${e.map ? `${esc(e.map.name)}${e.map.authors.length ? ' · by ' + esc(e.map.authors.join(', ')) : ''} · ` : ''}${e.field} racers</div>
        ${e.podium.map(row).join('')}
      </div>
      ${e.map && e.map.thumb ? `<div style="flex:none;width:360px;height:360px;border-radius:10px;overflow:hidden;border:2px solid var(--border)"><img src="${esc(e.map.thumb)}" alt="" onerror="this.parentNode.remove()" style="width:100%;height:100%;object-fit:cover"></div>` : ''}
    </div>`, theme);
}
function seasonCard(s, theme) {
  const top = s.players.slice(0, 10);
  const row = (p) => `<div style="display:flex;align-items:center;gap:16px;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="width:40px;font-family:var(--font-display);font-size:34px;font-weight:800;font-style:italic;color:${medal[p.rank] || 'var(--muted)'}">${p.rank}</div>
      __AV_${esc(p.name)}__
      <div style="flex:1;font-family:var(--font-display);font-size:32px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
      <div style="font-family:var(--font-mono);font-size:28px;font-weight:700;color:${p.rank === 1 ? theme.accent : 'var(--text)'}">${p.points}</div>
    </div>`;
  return frame(`
    <div style="width:100%;display:flex;flex-direction:column;justify-content:center">
      <div style="font-family:var(--font-display);font-size:60px;font-weight:800;font-style:italic;text-transform:uppercase;line-height:1;margin-bottom:14px">${esc(s.label)} <span style="color:${theme.accent}">standings</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 56px">${top.slice(0, 5).map(row).join('')}${top.slice(5).map(row).join('')}</div>
    </div>`, theme).replace('grid-template-columns:1fr 1fr;gap:0 56px">', 'grid-template-columns:1fr 1fr;grid-auto-flow:column;grid-template-rows:repeat(5,auto);gap:0 56px">');
}
/* Avatars and form chips come from the site's own helpers, so they look exactly like on the site. */
async function fill(html, { avatar = null, avatars = [], form = null }) {
  return page.evaluate(({ html, avatar, avatars, form }) => {
    let out = html;
    if (avatar) out = out.replace('__AVATAR__', avatarHTML(avatar, 220).replace('border-radius:50%;', 'border-radius:50%;border:4px solid var(--border-strong);box-sizing:border-box;'));
    avatars.forEach(([name, size]) => { out = out.split(`__AV_${escapeHtml(name)}__`).join(avatarHTML(name, size)); });
    if (form) out = out.replace('__FORM__', form.map((f) => formChip(f.place, '', null, f.dropped)).join(''));
    return out.replace('__FORM__', '');
  }, { html, avatar, avatars, form });
}

/* ---------- pages ---------- */
function sharePage({ url, target, title, description, image, alt }) {
  const t = esc(title), d = esc(description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t}</title>
  <meta name="description" content="${d}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="SpeedTAS">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${esc(image)}">
  <meta name="theme-color" content="#0b0c0f">
  <meta http-equiv="refresh" content="0; url=${esc(target)}">
  <script>location.replace(${JSON.stringify(target)});</script>
  <style>body{background:#0b0c0f;color:#eef0ea;font:16px/1.5 system-ui,sans-serif;padding:40px}a{color:#e9fb59}</style>
</head>
<body>
  <h1>${t}</h1>
  <p>${d}</p>
  <p><a href="${esc(target)}">Open on SpeedTAS</a></p>
</body>
</html>
`;
}

const manifest = await readFile('data/share/manifest.json', 'utf8').then(JSON.parse).catch(() => ({ design: 0, pages: {} }));
const redrawAll = ALL || manifest.design !== DESIGN;
const nextPages = {}, index = {}, written = new Set();
let drawn = 0, kept = 0, incomplete = 0;

async function emit(path, { target, title, description, alt, html, fillWith }) {
  const url = `${SITE}${path}/`;
  const filled = await fill(html, fillWith);
  const hash = createHash('sha1').update(filled).digest('hex').slice(0, 10);
  const prev = manifest.pages[path];
  const jpg = join(path, 'card.jpg');
  const haveJpg = await readFile(jpg).then(() => true, () => false);
  let complete = prev ? prev.complete !== false : false;
  if (redrawAll || !prev || prev.hash !== hash || !prev.complete || !haveJpg) {
    complete = await shoot(filled, jpg); drawn++;
    if (!complete) incomplete++;
  } else kept++;
  const htmlOut = sharePage({ url, target, title, description, alt, image: `${url}card.jpg?v=${hash}` });
  const file = join(path, 'index.html');
  if ((await readFile(file, 'utf8').catch(() => '')) !== htmlOut) await writeFile(file, htmlOut);
  nextPages[path] = { hash, complete, changed: prev && prev.hash === hash ? prev.changed : new Date().toISOString().slice(0, 10) };
  written.add(path);
}

for (const game of ['tmnf', 'tm20']) {
  const seasons = await gather(game);
  const theme = await page.evaluate(() => ({ accent: getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#e9fb59' }));
  const prefix = game === 'tm20' ? 'share/tm20' : 'share', hashGame = game === 'tm20' ? '#/tm20' : '#';
  index[game] = {};
  for (const s of seasons) {
    if (game === 'tmnf') await page.evaluate((k) => setSeasonTheme(k), s.key);
    const th = game === 'tm20' ? theme : await page.evaluate(() => ({ accent: getComputedStyle(document.body).getPropertyValue('--accent').trim() }));
    const cardTheme = { label: s.label, accent: th.accent || theme.accent };
    const slugs = {}, used = new Set();
    for (const p of s.players) { let slug = slugify(p.name), n = 2; while (used.has(slug)) slug = `${slugify(p.name)}-${n++}`; used.add(slug); slugs[p.name] = slug; }
    index[game][s.key] = { players: slugs, editions: s.eds.map((e) => e.edition) };
    // season table
    const top3 = s.players.slice(0, 3);
    await emit(`${prefix}/s/${s.key}`, {
      target: `${SITE}${game === 'tm20' ? '#/tm20' : s.key === 's3' ? '#/' : `#/players/${s.key}`}`,
      title: `${s.label} standings · SpeedTAS`,
      description: `${['🥇', '🥈', '🥉'].map((m, i) => (top3[i] ? `${m} ${top3[i].name} ${top3[i].points}` : '')).filter(Boolean).join(' · ')} · ${s.editions} editions, ${s.players.length} players. Full table, results, records and rivalries.`,
      alt: `${s.label} top 10 standings`, html: seasonCard(s, cardTheme), fillWith: { avatars: s.players.slice(0, 10).map((p) => [p.name, 44]) },
    });
    for (const p of s.players) {
      await emit(`${prefix}/p/${s.key}/${slugs[p.name]}`, {
        target: `${SITE}${hashGame}/player/${s.key}/${encodeURIComponent(p.name)}`,
        title: `${p.name} · ${s.label} · SpeedTAS`,
        description: `P${p.rank} of ${s.players.length} in ${s.label} · ${p.points} pts${p.dropped ? ` (${p.dropped} dropped)` : ''} · ${p.wins} win${p.wins === 1 ? '' : 's'} · ${p.podiums} podium${p.podiums === 1 ? '' : 's'} · ${p.played} race${p.played === 1 ? '' : 's'}`,
        alt: `${p.name}: P${p.rank} in ${s.label}`, html: playerCard(p, s, s.players.length, cardTheme), fillWith: { avatar: p.name, form: p.form },
      });
    }
    for (const e of s.eds) {
      const w = e.podium[0], t1 = w && w.secs;
      const podium = e.podium.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.name}${r.secs == null ? '' : i === 0 || t1 == null ? ` ${r.secs.toFixed(2)}` : ` +${(r.secs - t1).toFixed(2)}`}`).join(' · ');
      await emit(`${prefix}/e/${s.key}/${encodeURIComponent(e.edition)}`, {
        target: `${SITE}${hashGame}/edition/${s.key}/${encodeURIComponent(e.edition)}`,
        title: `${s.label} · Edition ${e.edition} · SpeedTAS`,
        description: `${podium} · ${e.field} racers${e.map ? ` · ${e.map.name}${e.map.authors.length ? ' by ' + e.map.authors.join(', ') : ''}` : ''}`,
        alt: `${s.label} edition ${e.edition} podium`, html: editionCard(e, s, cardTheme), fillWith: { avatars: e.podium.map((r) => [r.name, 64]) },
      });
    }
  }
}
await browser.close(); server.close();

/* Remove pages that no longer exist (a renamed player, a deleted edition). */
let removed = 0;
async function prune(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = join(dir, e.name);
    const isPage = await readFile(join(sub, 'index.html')).then(() => true, () => false);
    if (isPage && !written.has(sub.split('\\').join('/'))) { await rm(sub, { recursive: true, force: true }); removed++; }
    else if (!isPage) await prune(sub);
  }
}
await prune('share');

await mkdir('data/share', { recursive: true });
await writeFile('data/share/manifest.json', JSON.stringify({ design: DESIGN, pages: nextPages }, null, 1) + '\n');
await writeFile('data/share/index.json', JSON.stringify(index) + '\n');
const urls = [{ loc: SITE, lastmod: null }, ...Object.entries(nextPages).map(([p, v]) => ({ loc: `${SITE}${p}/`, lastmod: v.changed }))];
await writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`);
console.log(`share pages: ${written.size} (${drawn} pictures drawn, ${kept} unchanged, ${incomplete} drawn without some avatars/map pictures, ${removed} removed)`);
