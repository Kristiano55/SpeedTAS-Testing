// Browser check of the whole site, run by .github/workflows/site-check.yml on every push.
//   npm install --no-save playwright && npx playwright install chromium && node scripts/site-check.mjs
// Serves the repo locally, blocks every outside service (Worker, Discord, TAS Exchange, TMX, YouTube, Google) so a
// check never adds load to them, and opens every page on desktop and phone. Exits 1 on any failure.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { createRequire } from 'node:module';

/* Accessibility audit with axe-core (installed next to playwright). Serious and critical WCAG 2 A/AA problems fail the check. */
let AXE = null;
try { AXE = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'); } catch { console.log('(axe-core not installed: accessibility audit skipped)'); }
async function audit(page, label) {
  if (!AXE) return;
  await page.addScriptTag({ content: AXE });
  const found = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
  check(!found.length, `${label}: no serious accessibility problems${found.length ? ' — ' + found.join(' | ') : ''}`);
}

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/index.html`;

const failures = [];
const fail = (what) => { failures.push(what); console.log('  ✗ ' + what); };
const ok = (what) => console.log('  ✓ ' + what);
const check = (cond, what) => (cond ? ok(what) : fail(what));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }); // CHROME_PATH: use an installed Chrome when running by hand
async function newPage(viewport, { blockCharts = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (blockCharts && u.includes('/assets/vendor/chart')) return route.fulfill({ status: 503, body: '' }); // chart library missing
    if (u.startsWith('http://localhost')) return route.continue();
    return route.fulfill({ status: 503, body: '' }); // outside services: pretend they're down, the site must cope
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e.message || e).slice(0, 200)));
  return page;
}
const h1 = (page) => page.evaluate(() => (document.querySelector('h1') || {}).textContent || '');
const go = async (page, hash, wait = 1500) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(wait); };

try {
  /* ---------- desktop ---------- */
  console.log('Desktop');
  const d = await newPage({ width: 1440, height: 900 });
  await d.goto(BASE); await d.waitForTimeout(3000);
  check(/standings/i.test(await h1(d)), `home renders ("${await h1(d)}")`);
  check(await d.evaluate(() => document.querySelectorAll('#leaderboardTable tbody tr:not(.empty-row)').length > 0 || /Season 3/.test(document.querySelector('h1').textContent)), 'home table has rows');
  check(await d.evaluate(() => !!(window.Chart && Chart.getChart(document.getElementById('progressChart')))), 'title-race chart drawn');
  check(await d.evaluate(() => !document.getElementById('latestMap') || !document.getElementById('latestMap').hidden), 'latest result shows its map');
  check(/ · SpeedTAS Stats$/.test(await d.title()), `tab title follows the page ("${await d.title()}")`);
  const more = await d.$('#boardMore');
  if (more) {
    await more.click(); await d.waitForTimeout(200);
    check(await d.evaluate(() => !document.querySelector('#leaderboardTable .extra-row') && !document.getElementById('boardMore')), '"Show all players" reveals the full table');
  }
  const routes = { '#/players': /player/i, '#/history': /history/i, '#/maps': /maps/i, '#/records': /records/i, '#/rivalries': /rival/i, '#/versus': /head/i, '#/videos': /video/i, '#/tm20': /TM2020/i, '#/': /standings/i };
  for (const [hash, re] of Object.entries(routes)) { await go(d, hash); check(re.test(await h1(d)), `${hash} renders ("${(await h1(d)).trim()}")`); await audit(d, hash); }
  const profile = await d.evaluate(() => (document.querySelector('#leaderboardTable tbody a') || {}).getAttribute?.('href'));
  if (profile) {
    await go(d, profile, 2500);
    check(await d.evaluate(() => document.querySelectorAll('.history-times tbody tr').length > 0), `profile ${profile} has placement history`);
    check(await d.evaluate(() => [...document.querySelectorAll('canvas')].some((c) => window.Chart && Chart.getChart(c))), 'profile charts drawn');
    check(await d.evaluate(() => document.querySelectorAll('.outlook .note').length > 0), 'profile shows its standing');
    check(await d.evaluate(() => !!document.getElementById('copyLink')), 'profile has a Copy link button');
    await audit(d, 'profile');
  } else fail('no profile link on the home table');
  const edition = await d.evaluate(async () => { location.hash = '#/history'; await new Promise((r) => setTimeout(r, 1500)); return (document.querySelector('a[href*="#/edition/"]') || {}).getAttribute?.('href'); });
  if (edition) {
    await go(d, edition, 2500);
    check(await d.evaluate(() => document.querySelectorAll('.results-table tbody tr').length > 0), `edition ${edition} has results`);
    await audit(d, 'edition page');
    await d.click('#resultsPost'); await d.waitForTimeout(400);
    const post = await d.evaluate(() => (document.querySelector('.post-text') || {}).textContent || '');
    check(/Results of/.test(post), 'results post opens');
    const hasShare = await d.evaluate(() => fetch('data/share/index.json').then((r) => r.ok));
    if (hasShare) check(/\/share\/e\//.test(post), 'results post links to the edition\'s share page');
    check(await d.evaluate(() => !!document.getElementById('copyLink')), 'edition has a Copy link button');
    await d.keyboard.press('Escape');
  } else fail('no edition link on the history page');
  /* Link previews: every page in the share index exists, with its own title and picture, and opens the site. */
  const share = await d.evaluate(async () => {
    const idx = await fetch('data/share/index.json').then((r) => (r.ok ? r.json() : null));
    if (!idx) return null;
    const pages = [];
    for (const [game, seasons] of Object.entries(idx)) for (const [key, s] of Object.entries(seasons)) {
      const base = game === 'tm20' ? 'share/tm20' : 'share';
      pages.push(`${base}/s/${key}/`, ...Object.values(s.players).map((slug) => `${base}/p/${key}/${slug}/`), ...s.editions.map((e) => `${base}/e/${key}/${encodeURIComponent(e)}/`));
    }
    const bad = [];
    for (const path of pages) {
      const html = await fetch(path + 'index.html').then((r) => (r.ok ? r.text() : ''));
      const img = await fetch(path + 'card.jpg').then((r) => r.ok);
      if (!/<meta property="og:title" content="[^"]+ · SpeedTAS">/.test(html) || !/og:image" content="[^"]+card\.jpg\?v=/.test(html) || !/location\.replace\("https:[^"]+#\//.test(html) || !img) bad.push(path);
    }
    return { count: pages.length, bad };
  });
  if (share) check(share.count > 0 && !share.bad.length, `${share.count} share pages have their own preview${share.bad.length ? ' — broken: ' + share.bad.slice(0, 5).join(', ') : ''}`);
  /* TM2020 inputs: their own files, in the TM2020 TAS format with the seed (not TMNF scripts). */
  await go(d, '#/tm20/edition/s2/1', 3000);
  const tmInputs = await d.$('[data-inputs]');
  if (tmInputs) {
    await tmInputs.click(); await d.waitForTimeout(800);
    const shown = await d.evaluate(() => ({ note: (document.querySelector('.inputs-note') || {}).textContent || '', text: (document.querySelector('.inputs-text') || {}).textContent || '' }));
    check(/TM2020 TAS format/.test(shown.note) && /^0 seed -?\d+\n/.test(shown.text) && !/ press /.test(shown.text), 'TM2020 inputs are in the TM2020 format with the seed');
    await d.keyboard.press('Escape');
  } else check(!(await d.evaluate(() => fetch('data/inputs/tm20/index.json').then((r) => r.ok ? r.json() : []).then((ids) => ids.length))), 'TM2020 edition shows its saved inputs');
  await go(d, '#/'); await d.keyboard.press('/'); await d.keyboard.type('a'); await d.waitForTimeout(800);
  check(await d.evaluate(() => document.querySelectorAll('#searchResults a').length > 0), 'search finds results');
  await go(d, '#/records', 2500);
  check(await d.evaluate(() => document.querySelectorAll('#raceRecords .record-card').length >= 5), 'race records drawn');
  await go(d, '#/videos', 2500);
  check(await d.evaluate(() => document.querySelectorAll('.video-card').length > 0), 'videos list from the saved file when YouTube is down');
  check(!d.errors.length, `no script errors on desktop${d.errors.length ? ': ' + d.errors.join(' | ') : ''}`);

  /* ---------- phone ---------- */
  console.log('Phone');
  const m = await newPage({ width: 390, height: 844 });
  await m.goto(BASE); await m.waitForTimeout(3000);
  check(await m.isVisible('#menuBtn'), 'menu button visible');
  check(await m.evaluate(() => { const el = document.querySelector('#leaderboardTable .player-sub'); return !!el && getComputedStyle(el).display !== 'none'; }), 'phone table shows races and gap under each name');
  await m.click('#menuBtn'); await m.waitForTimeout(300);
  check(await m.isVisible('#nav a[data-route="/videos"]'), 'menu shows every page');
  await m.click('#nav a[data-route="/records"]'); await m.waitForTimeout(1500);
  check(/records/i.test(await h1(m)) && !(await m.evaluate(() => document.body.classList.contains('menu-open'))), 'menu navigates and closes');
  for (const hash of ['#/', '#/players', '#/history', '#/maps', '#/rivalries', '#/versus']) {
    await go(m, hash);
    check(!(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${hash} fits the phone screen`);
    await audit(m, `${hash} on phone`);
  }
  check(!m.errors.length, `no script errors on phone${m.errors.length ? ': ' + m.errors.join(' | ') : ''}`);

  /* ---------- chart library missing ---------- */
  console.log('Without Chart.js');
  const n = await newPage({ width: 1440, height: 900 }, { blockCharts: true });
  await n.goto(BASE); await n.waitForTimeout(3000);
  check(await n.evaluate(() => document.querySelectorAll('.chart-box .chart-fallback').length > 0), 'empty chart explains itself');
  check(!n.errors.length, `no script errors without Chart.js${n.errors.length ? ': ' + n.errors.join(' | ') : ''}`);
} catch (err) {
  fail('check crashed: ' + err.message);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
