// Refreshes the results files the website reads first (data/*.json).
//
//   node scripts/update-data.mjs            fetch sheets + TAS Exchange events, write data/
//   node scripts/update-data.mjs --sheets   sheets only
//   node scripts/update-data.mjs --selftest parse the built-in samples, write nothing
//
// Run by .github/workflows/update-data.yml (Saturday night + Sunday midday, or by hand).
// A source that fails keeps its previous file, so one bad fetch never blanks the site.
// The parsing below is a port of speedtas-api-worker.js: keep the two in step.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = 'data';
const UA = 'SpeedTAS data updater (github.com/Kristiano55/SpeedTAS-Testing)';

/* ============ SOURCES ============ */
const SHEETS = {
  // Current season. The sheet must be shared as "Anyone with the link can view".
  s3: { kind: 'gviz', id: '1Ylmj87seG1TF7ZRlnx8puwTFt39tAKdPF0JEpfhcTOc', sheet: 'Editions' },
  s2: { kind: 'gviz', id: '1g7M1IWvDlqmUkUWB6oSX-HKf7tCpAmaQK_nvNGBEppw', sheet: 'Editions' },
  s1: { kind: 'csv', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2PVKpC2mV_UWnXg6ouoPooQ6lgJlPLNIen11GniPy0q3m40b9CL_VTyhWP0V2cGEMItY7c75LLjZH/pub?output=csv' },
  tm20: { kind: 'csv', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRDvd1q6-1ze91Uv30Lm4nOjkx9Q-r2ceqkSetJIeILpYzBfRKlwU-wT6GhJ2Xh_b3XLLIYMrsBb1m_/pub?output=csv', mustStartWith: '👥' },
};

/* Which TAS Exchange events belong to which leaderboard: the title must match and contain "#<edition>".
   Same patterns as EVENT_PATTERN in index.html. */
const EVENT_SETS = {
  s2: /SpeedTAS Season2/i,
  s3: /SpeedTAS (Season ?3|S3)\b/i,
  tm20: /SpeedTAS TM20/i,
};
const EVENT_SCAN_FROM = 40;      // lowest event id worth checking
const EVENT_SCAN_KNOWN = 270;    // events up to here already exist (Nov 2026): the first run reads them all, holes included
const EVENT_LOOKAHEAD = 15;      // this many missing ids in a row = past the newest event
const RESULT_RECHECKS = 12;      // most event pages re-read per run for results that were still hidden
const MAX_CHECKS_PER_EVENT = 4;  // an event whose times stay hidden is given up on after this many reads

/* ============ SHEET PARSING (port of the Worker) ============ */
export function buildDatasetFromGrid(grid) {
  if (!grid || grid.length < 1) throw new Error('The sheet data appears to be empty.');
  const header = grid[0].map((v) => String(v == null ? '' : v).trim());
  const players = header.slice(1).filter((n) => n.length);
  const editions = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    const raw = row[0];
    if (raw === '' || raw == null) continue;
    const edition = String(raw).trim();
    if (!edition) continue;
    const results = {};
    for (let c = 1; c < header.length; c++) {
      const name = header[c];
      if (!name) continue;
      const val = row[c];
      if (val === '' || val == null) continue;
      const place = typeof val === 'number' ? val : parseInt(String(val).trim(), 10);
      if (!isNaN(place)) results[name] = place;
    }
    if (Object.keys(results).length) editions.push({ edition, results });
  }
  return { editions, players };
}

export function parseCsvGrid(text) {
  return text.split(/\r?\n/).filter((l) => l.trim().length).map((line) => {
    const cells = []; let field = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else if (c === '"') q = true;
      else if (c === ',') { cells.push(field); field = ''; }
      else field += c;
    }
    cells.push(field);
    return cells;
  });
}

const GVIZ_CALLBACK = 'speedtasAction';
export function parseGvizText(text) {
  const marker = `${GVIZ_CALLBACK}(`, start = text.indexOf(marker), end = text.lastIndexOf(')');
  if (start === -1 || end <= start) throw new Error('Unexpected response from Google Sheets (is the sheet shared as "anyone with the link"?).');
  const response = JSON.parse(text.slice(start + marker.length, end));
  if (response.status === 'error') throw new Error(response.errors?.[0]?.detailed_message || response.errors?.[0]?.message || 'Google Sheets error');
  const table = response.table;
  if (!table) throw new Error('Google Sheets returned no table.');
  const rows = (table.rows || []).map((r) => (r.c || []).map((cell) => (cell && cell.v != null ? cell.v : '')));
  const labels = (table.cols || []).map((c) => (c && c.label != null ? String(c.label) : ''));
  // Google sometimes lifts the header row into the column labels.
  const grid = labels.some((l) => l.length) ? [labels, ...rows] : rows;
  return buildDatasetFromGrid(grid);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return res;
}

async function fetchSheet(src) {
  if (src.kind === 'gviz') {
    const url = `https://docs.google.com/spreadsheets/d/${src.id}/gviz/tq?tqx=responseHandler:${GVIZ_CALLBACK}&headers=1&sheet=${encodeURIComponent(src.sheet)}`;
    const res = await get(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGvizText(await res.text());
  }
  const res = await get(src.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (src.mustStartWith && !text.trim().replace(/^["']/, '').startsWith(src.mustStartWith)) throw new Error('The published link is not pointing at the Editions tab.');
  return buildDatasetFromGrid(parseCsvGrid(text));
}

/* ============ TAS EXCHANGE EVENTS (port of the Worker) ============ */
const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
export function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? stripTags(m[1]).replace(/\s*[|\-–—]\s*TMTAS Exchange\s*$/i, '').trim() : '';
}
/* The results board: <tr> rows whose first cell holds the position. Rows whose time is hidden are ignored. */
export function parseEventResults(html) {
  const results = [];
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    if (cells.length < 3) continue;
    const pos = cells[0].match(/#?(\d+)/);
    if (!pos || !/\d/.test(cells[2]) || /hidden/i.test(cells[2])) continue;
    results.push({ pos: parseInt(pos[1], 10), entrant: cells[1], time: cells[2] });
  }
  return results;
}
const editionOf = (title) => { const m = title.match(/#\s*0*(\d+)/); return m ? m[1] : null; };

async function fetchEventPage(id) {
  try {
    const res = await get(`https://tmtas.exchange/events/${id}`);
    if (res.status === 404 || res.status === 403 || res.status === 410) return { missing: true };
    if (!res.ok) return { error: res.status };
    return { html: await res.text() };
  } catch (err) { return { error: String(err) }; }
}

async function updateEvents(state, events) {
  let requests = 0;
  const ids = Object.keys(state.titles).map(Number);
  let id = ids.length ? Math.max(...ids) + 1 : EVENT_SCAN_FROM;
  // First run: walk every id from EVENT_SCAN_FROM. Later runs: only ids past the newest known event.
  let missRun = 0;
  while (id <= EVENT_SCAN_KNOWN || missRun < EVENT_LOOKAHEAD) {
    const batch = Array.from({ length: 6 }, (_, i) => id + i);
    const pages = await Promise.all(batch.map(fetchEventPage));
    requests += batch.length;
    batch.forEach((bid, i) => {
      const p = pages[i];
      if (p.html) { state.titles[bid] = extractTitle(p.html); missRun = 0; state.pages[bid] = p.html; }
      else missRun++;
    });
    id += batch.length;
  }
  // Match titles to editions; keep the highest id when an edition was posted twice.
  for (const [eid, title] of Object.entries(state.titles)) {
    for (const [set, re] of Object.entries(EVENT_SETS)) {
      if (!re.test(title)) continue;
      const ed = editionOf(title);
      if (!ed) continue;
      events[set] = events[set] || {};
      const prev = events[set][ed];
      if (!prev || Number(eid) > prev.id) events[set][ed] = { id: Number(eid), title, results: [] };
    }
  }
  // Results: read pages we just fetched, then re-check a few events whose times were still hidden.
  let rechecks = 0;
  for (const set of Object.keys(events)) {
    for (const ev of Object.values(events[set])) {
      if (ev.results && ev.results.length) continue;
      if ((ev.checks || 0) >= MAX_CHECKS_PER_EVENT) continue;
      let html = state.pages[ev.id];
      if (!html) {
        if (rechecks >= RESULT_RECHECKS) continue;
        rechecks++; requests++;
        const p = await fetchEventPage(ev.id);
        html = p.html;
      }
      if (html) {ev.results = parseEventResults(html); ev.checks = (ev.checks || 0) + 1;}
    }
  }
  delete state.pages;
  return requests;
}

/* ============ MAIN ============ */
async function readJson(f, d) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } }
const writeJson = (f, data) => writeFile(f, JSON.stringify(data, null, 1) + '\n');

async function main() {
  await mkdir(OUT, { recursive: true });
  const now = new Date().toISOString();
  let failures = 0;
  for (const [key, src] of Object.entries(SHEETS)) {
    try {
      const d = await fetchSheet(src);
      await writeJson(`${OUT}/${key}.json`, { season: key, editions: d.editions, players: d.players, updatedAt: now });
      console.log(`${key}: ${d.editions.length} editions, ${d.players.length} players`);
    } catch (err) {
      failures++;
      console.warn(`${key}: kept the previous file (${err.message})`);
    }
  }
  if (!process.argv.includes('--sheets')) {
    const state = await readJson(`${OUT}/events_state.json`, { titles: {} });
    state.pages = {};
    const events = await readJson(`${OUT}/events.json`, {});
    delete events.updatedAt;
    try {
      const requests = await updateEvents(state, events);
      await writeJson(`${OUT}/events_state.json`, state);
      await writeJson(`${OUT}/events.json`, { ...events, updatedAt: now });
      console.log(`events: ${Object.entries(events).map(([k, v]) => `${k} ${Object.keys(v).length}`).join(', ')} (${requests} TAS Exchange requests)`);
    } catch (err) {
      failures++;
      console.warn(`events: kept the previous files (${err.message})`);
    }
  }
  await writeJson(`${OUT}/updated.json`, { at: now });
  if (failures) console.log(`${failures} source(s) failed; their previous files were kept.`);
}

function selftest() {
  const assert = (c, m) => { if (!c) throw new Error('selftest: ' + m); };
  const gviz = `/*O_o*/\n${GVIZ_CALLBACK}({"version":"0.6","status":"ok","table":{"cols":[{"label":"👥: 2"},{"label":"Sneak"},{"label":"Rio"}],"rows":[{"c":[{"v":1},{"v":1},{"v":2}]},{"c":[{"v":2},null,{"v":1}]},{"c":[{"v":3},null,null]}]}});`;
  const g = parseGvizText(gviz);
  assert(g.players.join() === 'Sneak,Rio' && g.editions.length === 2 && g.editions[1].results.Rio === 1, 'gviz');
  const c = buildDatasetFromGrid(parseCsvGrid('"👥: 2",Sneak,"Ri,o"\n1,1,2\n2,,1\n3,,\n'));
  assert(c.players[1] === 'Ri,o' && c.editions.length === 2, 'csv');
  const html = '<title>SpeedTAS S3 #4 | TMTAS Exchange</title><table><tr><th>Pos</th></tr><tr><td>#1</td><td><a>Sneak</a></td><td>41.23</td></tr><tr><td>2</td><td>Rio</td><td>Hidden</td></tr></table>';
  assert(extractTitle(html) === 'SpeedTAS S3 #4', 'title');
  const r = parseEventResults(html);
  assert(r.length === 1 && r[0].entrant === 'Sneak' && r[0].time === '41.23', 'results');
  assert(EVENT_SETS.s3.test('SpeedTAS S3 #4') && !EVENT_SETS.s3.test('SpeedTAS S30 #4') && EVENT_SETS.s2.test('SpeedTAS Season2 #30') && !EVENT_SETS.s3.test('SpeedTAS Season2 #30'), 'patterns');
  console.log('selftest ok');
}

if (process.argv.includes('--selftest')) selftest();
else main().catch((err) => { console.error(err); process.exit(1); });
