// Refreshes the results files the website reads first (data/*.json).
//
//   node scripts/update-data.mjs            fetch sheets + TAS Exchange events, write data/
//   node scripts/update-data.mjs --sheets   sheets only
//   node scripts/update-data.mjs --selftest parse the built-in samples, write nothing
//
// What it does:
//  1. Reads the Google Sheets into data/s1.json, s2.json, s3.json, tm20.json.
//  2. Reads SpeedTAS events on TAS Exchange into data/events.json (results, times, replay ids).
//  3. Auto-import: a finished Season 3 / TM2020 event whose times are public but whose edition has no row
//     in the sheet yet is added to data/s3.json / tm20.json straight away (placements from the times,
//     marked "auto"). As soon as the sheet has that edition, the sheet's version wins.
//  4. Saves each replay's inputs as a TMInterface-style script in data/inputs/<replayId>.txt.
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
const REPLAY_BACKFILL = 50;      // most older events re-read per run to pick up their replay ids
const INPUT_FETCHES = 120;       // most input files downloaded per run (the backlog spreads over a few runs)
const AUTO_IMPORT = { s3: 's3', tm20: 'tm20' }; // event set -> results file that receives auto-imported editions
/* TAS Exchange name -> sheet name, for names the history can't work out on its own. Keys are lower-case, letters/digits only. */
const MANUAL_ALIASES = {};

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
    const replay = row.match(/\/events\/\d+\/replays\/(\d+)\/download/); // present only when downloads are enabled
    results.push({ pos: parseInt(pos[1], 10), entrant: cells[1], time: cells[2], ...(replay ? { replay: Number(replay[1]) } : {}) });
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
  // Events read before replay ids were collected: re-read them once, a few per run.
  let backfill = 0;
  for (const set of Object.keys(events)) {
    for (const ev of Object.values(events[set])) {
      if (!ev.results || !ev.results.length || ev.replaysChecked || backfill >= REPLAY_BACKFILL) continue;
      const html = state.pages[ev.id] || (backfill++, requests++, (await fetchEventPage(ev.id)).html);
      if (!html) continue;
      const fresh = parseEventResults(html);
      if (fresh.length) ev.results = fresh;
      ev.replaysChecked = true;
    }
  }
  delete state.pages;
  return requests;
}

/* ============ NAMES: TAS Exchange entrant -> sheet player ============ */
const nameKey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function oneLetterApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
/* Learns aliases from past editions that exist both on TAS Exchange and in a sheet: an entrant whose name
   doesn't match any sheet player is paired with the sheet player who finished in the same place. */
export function learnAliases(events, datasets) {
  const votes = {};
  for (const [set, evs] of Object.entries(events)) {
    const data = datasets[set];
    if (!data) continue;
    for (const [ed, ev] of Object.entries(evs)) {
      const row = data.editions.find((e) => e.edition === ed && !e.auto);
      if (!row || !ev.results || !ev.results.length) continue;
      const sheetKeys = Object.keys(row.results).map(nameKey);
      for (const r of ev.results) {
        const k = nameKey(r.entrant);
        if (sheetKeys.includes(k)) continue;
        const same = Object.entries(row.results).filter(([, p]) => p === r.pos).map(([n]) => n);
        if (same.length !== 1 || ev.results.some((o) => nameKey(o.entrant) === nameKey(same[0]))) continue;
        ((votes[k] = votes[k] || {})[same[0]] = (votes[k][same[0]] || 0) + 1);
      }
    }
  }
  const aliases = {};
  for (const [k, v] of Object.entries(votes)) {
    const ranked = Object.entries(v).sort((a, b) => b[1] - a[1]);
    if (!ranked[1] || ranked[0][1] > ranked[1][1]) aliases[k] = ranked[0][0];
  }
  return { ...aliases, ...MANUAL_ALIASES };
}
/* Sheet name for an entrant: exact (ignoring case and symbols), a learned alias, or one letter off. Else null. */
export function resolveName(entrant, sheetNames, aliases) {
  const k = nameKey(entrant), byKey = Object.fromEntries(sheetNames.map((n) => [nameKey(n), n]));
  if (byKey[k]) return byKey[k];
  if (aliases[k]) return aliases[k];
  const close = Object.keys(byKey).filter((x) => oneLetterApart(x, k));
  return close.length === 1 ? byKey[close[0]] : null;
}
const toSeconds = (t) => { const m = String(t).match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/); return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]) : null; };

/* Adds every finished event that the sheet doesn't have yet. Placements come from the times (ties share a place). */
export function autoImport(data, evs, aliases, allNames) {
  const have = new Set(data.editions.filter((e) => !e.auto).map((e) => e.edition));
  const added = [], unknown = new Set();
  for (const [ed, ev] of Object.entries(evs || {})) {
    if (have.has(ed) || !ev.results || ev.results.length < 2) continue;
    const timed = ev.results.map((r) => ({ ...r, secs: toSeconds(r.time) })).filter((r) => r.secs != null).sort((a, b) => a.secs - b.secs);
    if (timed.length < 2) continue;
    const results = {};
    timed.forEach((r, i) => {
      const place = i && r.secs === timed[i - 1].secs ? results[timed[i - 1].name] : i + 1;
      let name = resolveName(r.entrant, allNames, aliases);
      if (!name) { name = r.entrant; unknown.add(r.entrant); }
      r.name = name;
      if (!(name in results)) results[name] = place;
    });
    added.push({ edition: ed, results, auto: true, event: ev.id });
  }
  const editions = [...data.editions.filter((e) => !e.auto), ...added].sort((a, b) => (parseFloat(a.edition) || 0) - (parseFloat(b.edition) || 0));
  const players = [...data.players];
  added.forEach((e) => Object.keys(e.results).forEach((n) => { if (!players.includes(n)) players.push(n); }));
  return { data: { ...data, editions, players }, added: added.map((e) => e.edition), unknown: [...unknown] };
}

/* ============ INPUTS ============ */
/* TAS Exchange's input list -> one line per input change: "<seconds> <action> <value>", e.g. "0.75 steer 963".
   For TMNF this is a TMInterface script that can be loaded as-is. */
export function inputsToScript(list) {
  return list.map((x) => `${(Number(x.time) / 1000).toFixed(2).replace(/\.00$/, '')} ${x.action} ${x.value}`).join('\n') + '\n';
}
/* Inputs for every replay with downloads enabled. The API covers newer replays; for the ones it doesn't
   know (HTTP 404) the replay file is queued in data/inputs_todo.json for the GBX.NET extractor
   (tools/extract), which the workflow runs next. Replays neither can read go into data/inputs_missing.json
   and are not tried again. data/inputs/index.json lists what's available, for the site. */
async function saveInputs(events) {
  await mkdir(`${OUT}/inputs`, { recursive: true });
  const missing = await readJson(`${OUT}/inputs_missing.json`, {});
  let fetched = 0, failed = 0, pending = 0;
  const todo = [];
  const runs = Object.values(events).flatMap((evs) => Object.values(evs).flatMap((ev) => (ev.results || []).filter((r) => r.replay).map((r) => ({ event: ev.id, replay: r.replay, game: ev.title && /TM20/i.test(ev.title) ? 'tm20' : 'tmnf' }))));
  const seen = new Set();
  for (const run of runs.sort((a, b) => b.replay - a.replay)) { // newest first
    if (seen.has(run.replay)) continue; seen.add(run.replay);
    const file = `${OUT}/inputs/${run.replay}.txt`;
    if (missing[run.replay] || await readFile(file).then(() => true, () => false)) continue;
    if (fetched + failed >= INPUT_FETCHES) { pending++; continue; }
    try {
      const res = await get(`https://tmtas.exchange/api/replayData?id=${run.replay}&inputs=true`);
      if (res.status === 404) { todo.push(run); failed++; continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) { todo.push(run); failed++; continue; }
      await writeFile(file, inputsToScript(list));
      fetched++;
    } catch (err) { failed++; console.warn(`inputs ${run.replay}: ${err.message}`); }
  }
  await writeJson(`${OUT}/inputs_todo.json`, todo);
  return { fetched, failed, pending, todo: todo.length };
}
export async function writeInputsIndex() {
  const { readdir } = await import('node:fs/promises');
  const ids = (await readdir(`${OUT}/inputs`).catch(() => [])).filter((f) => /^\d+\.txt$/.test(f)).map((f) => Number(f.slice(0, -4))).sort((a, b) => a - b);
  await writeJson(`${OUT}/inputs/index.json`, ids);
  return ids.length;
}

/* ============ MAIN ============ */
async function readJson(f, d) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } }
const writeJson = (f, data) => writeFile(f, JSON.stringify(data, null, 1) + '\n');

async function main() {
  await mkdir(OUT, { recursive: true });
  const now = new Date().toISOString();
  let failures = 0;
  // 1. Sheets. A sheet that can't be read keeps its previous file (minus earlier auto-imports, which are redone below).
  const datasets = {};
  for (const [key, src] of Object.entries(SHEETS)) {
    try {
      const d = await fetchSheet(src);
      datasets[key] = { season: key, editions: d.editions, players: d.players };
      console.log(`${key}: ${d.editions.length} editions, ${d.players.length} players`);
    } catch (err) {
      failures++;
      const prev = await readJson(`${OUT}/${key}.json`, null);
      if (prev) datasets[key] = { season: key, editions: prev.editions.filter((e) => !e.auto), players: prev.players };
      console.warn(`${key}: kept the previous data (${err.message})`);
    }
  }
  // 2. TAS Exchange events.
  const events = await readJson(`${OUT}/events.json`, {});
  delete events.updatedAt;
  if (!process.argv.includes('--sheets')) {
    const state = await readJson(`${OUT}/events_state.json`, { titles: {} });
    state.pages = {};
    try {
      const requests = await updateEvents(state, events);
      await writeJson(`${OUT}/events_state.json`, state);
      console.log(`events: ${Object.entries(events).map(([k, v]) => `${k} ${Object.keys(v).length}`).join(', ')} (${requests} TAS Exchange requests)`);
    } catch (err) {
      failures++;
      console.warn(`events: kept the previous files (${err.message})`);
    }
  }
  // 3. Names + auto-import. Names are looked up in the same game only, newest season first, so a TMNF
  //    edition never picks up a TM2020 spelling (and the other way round).
  const aliases = learnAliases(events, datasets);
  const namesFor = (key) => [...new Set((key === 'tm20' ? ['tm20'] : [key, 's3', 's2', 's1']).flatMap((k) => (datasets[k] ? datasets[k].players : [])))];
  for (const [set, key] of Object.entries(AUTO_IMPORT)) {
    if (!datasets[key]) continue;
    const { data, added, unknown } = autoImport(datasets[key], events[set], aliases, namesFor(key));
    datasets[key] = data;
    if (added.length) console.log(`${key}: auto-imported edition(s) ${added.join(', ')} from TAS Exchange` + (unknown.length ? ` (new or unrecognised names: ${unknown.join(', ')})` : ''));
  }
  // Each event result gets the sheet name it belongs to ("player"), so the site can match times, replays and inputs.
  for (const [set, evs] of Object.entries(events)) {
    if (!datasets[set]) continue;
    const names = namesFor(set);
    for (const ev of Object.values(evs)) for (const r of ev.results || []) {
      const n = resolveName(r.entrant, names, aliases);
      if (n) r.player = n; else delete r.player;
    }
  }
  for (const [key, d] of Object.entries(datasets)) await writeJson(`${OUT}/${key}.json`, { ...d, updatedAt: now });
  await writeJson(`${OUT}/aliases.json`, aliases);
  await writeJson(`${OUT}/events.json`, { ...events, updatedAt: now });
  // 4. Inputs for every replay with downloads enabled.
  if (!process.argv.includes('--sheets')) {
    const r = await saveInputs(events);
    console.log(`inputs: ${r.fetched} saved from the API, ${r.todo} queued for the replay-file extractor, ${r.pending} left for the next run`);
    await writeInputsIndex();
  }
  await writeJson(`${OUT}/updated.json`, { at: now });
  if (failures) console.log(`${failures} source(s) failed; their previous data was kept.`);
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
  const row = '<tr><td>#1</td><td><a href="/profile/Rio">Rio</a></td><td>20.43</td><td>-</td><td>21 Nov</td><td><a href="/events/263/replays/2004/download" download>x</a></td></tr>';
  assert(parseEventResults(row)[0].replay === 2004, 'replay id');
  assert(inputsToScript([{ time: 0, action: 'press', value: 'up' }, { time: 750, action: 'steer', value: '963' }]) === '0 press up\n0.75 steer 963\n', 'inputs');
  const evs = { s2: { '1': { results: [{ pos: 1, entrant: 'MidnightEuphoria', time: '10.00' }, { pos: 2, entrant: 'Rio', time: '10.50' }] } },
                s3: { '1': { results: [{ pos: 1, entrant: 'Rio', time: '9.10' }, { pos: 2, entrant: 'MidnightEuphoria', time: '9.10' }, { pos: 3, entrant: 'NewGuy', time: '9.90' }] } } };
  const ds = { s2: { editions: [{ edition: '1', results: { Midnight: 1, Rio: 2 } }], players: ['Midnight', 'Rio'] }, s3: { editions: [], players: [] } };
  const al = learnAliases(evs, ds);
  assert(al.midnighteuphoria === 'Midnight', 'alias learning');
  const imp = autoImport(ds.s3, evs.s3, al, ['Midnight', 'Rio']);
  assert(imp.added[0] === '1' && imp.data.editions[0].results.Rio === 1 && imp.data.editions[0].results.Midnight === 1 && imp.data.editions[0].results.NewGuy === 3 && imp.data.editions[0].auto, 'auto import (ties share a place)');
  assert(autoImport({ editions: [{ edition: '1', results: { X: 1 } }], players: ['X'] }, evs.s3, al, ['X']).added.length === 0, 'sheet wins');
  console.log('selftest ok');
}

if (process.argv.includes('--selftest')) selftest();
else if (process.argv.includes('--index-inputs')) writeInputsIndex().then((n) => console.log(`inputs index: ${n} replays`));
else if (!process.argv.includes('--index-inputs')) main().catch((err) => { console.error(err); process.exit(1); });
