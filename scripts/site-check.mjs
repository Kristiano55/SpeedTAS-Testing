// Browser check of the whole site, run by .github/workflows/site-check.yml on every push.
//   npm install --no-save playwright && npx playwright install chromium && node scripts/site-check.mjs
// Serves the repo locally, blocks outside services (Worker, Discord, TAS Exchange, TMX, YouTube, Google) so a
// check never adds load to them, and opens every page on desktop and phone. Exits 1 on any failure.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

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
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('cdnjs.cloudflare.com') && process.env.CHART_FILE) return readFile(process.env.CHART_FILE).then((body) => route.fulfill({ status: 200, body, contentType: 'text/javascript' })); // offline runs
    if (u.startsWith('http://localhost') || u.includes('cdnjs.cloudflare.com') || u.includes('fonts.g')) return route.continue();
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
  const routes = { '#/players': /player/i, '#/history': /history/i, '#/maps': /maps/i, '#/records': /records/i, '#/rivalries': /rival/i, '#/versus': /head/i, '#/videos': /video/i, '#/tm20': /TM2020/i, '#/': /standings/i };
  for (const [hash, re] of Object.entries(routes)) { await go(d, hash); check(re.test(await h1(d)), `${hash} renders ("${(await h1(d)).trim()}")`); }
  const profile = await d.evaluate(() => (document.querySelector('#leaderboardTable tbody a') || {}).getAttribute?.('href'));
  if (profile) {
    await go(d, profile, 2500);
    check(await d.evaluate(() => document.querySelectorAll('.history-times tbody tr').length > 0), `profile ${profile} has placement history`);
    check(await d.evaluate(() => [...document.querySelectorAll('canvas')].some((c) => window.Chart && Chart.getChart(c))), 'profile charts drawn');
  } else fail('no profile link on the home table');
  const edition = await d.evaluate(async () => { location.hash = '#/history'; await new Promise((r) => setTimeout(r, 1500)); return (document.querySelector('a[href*="#/edition/"]') || {}).getAttribute?.('href'); });
  if (edition) {
    await go(d, edition, 2500);
    check(await d.evaluate(() => document.querySelectorAll('.results-table tbody tr').length > 0), `edition ${edition} has results`);
    await d.click('#resultsPost'); await d.waitForTimeout(400);
    check(/Results of/.test(await d.evaluate(() => (document.querySelector('.post-text') || {}).textContent || '')), 'results post opens');
    await d.keyboard.press('Escape');
  } else fail('no edition link on the history page');
  await go(d, '#/'); await d.keyboard.press('/'); await d.keyboard.type('a'); await d.waitForTimeout(800);
  check(await d.evaluate(() => document.querySelectorAll('#searchResults a').length > 0), 'search finds results');
  check(!d.errors.length, `no script errors on desktop${d.errors.length ? ': ' + d.errors.join(' | ') : ''}`);

  /* ---------- phone ---------- */
  console.log('Phone');
  const m = await newPage({ width: 390, height: 844 });
  await m.goto(BASE); await m.waitForTimeout(3000);
  check(await m.isVisible('#menuBtn'), 'menu button visible');
  await m.click('#menuBtn'); await m.waitForTimeout(300);
  check(await m.isVisible('#nav a[data-route="/videos"]'), 'menu shows every page');
  await m.click('#nav a[data-route="/records"]'); await m.waitForTimeout(1500);
  check(/records/i.test(await h1(m)) && !(await m.evaluate(() => document.body.classList.contains('menu-open'))), 'menu navigates and closes');
  for (const hash of ['#/', '#/players', '#/history', '#/maps', '#/rivalries', '#/versus']) {
    await go(m, hash);
    check(!(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${hash} fits the phone screen`);
  }
  check(!m.errors.length, `no script errors on phone${m.errors.length ? ': ' + m.errors.join(' | ') : ''}`);
} catch (err) {
  fail('check crashed: ' + err.message);
} finally {
  await browser.close();
  server.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
