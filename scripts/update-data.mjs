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

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

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
/* TrackMania Exchange map packs, one per TMNF season. Add the Season 3 pack id here once it exists. */
const MAP_PACKS = { s1: 11621132, s2: 13122890 };
const MAP_FIELDS = 'TrackId,TrackName,Authors[],AuthorTime,WRReplay.ReplayTime,WRReplay.User.Name,HasThumbnail';
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
/* Inputs for every replay with downloads enabled, from TAS Exchange's replayData API (the same data its own
   input viewer uses). Older event replays aren't known to that API (HTTP 404); those keep just the replay
   download, and are asked about again at most once a month (data/inputs_missing.json).
   data/inputs/index.json lists what's available, for the site. */
async function saveInputs(events) {
  await mkdir(`${OUT}/inputs`, { recursive: true });
  const missing = await readJson(`${OUT}/inputs_missing.json`, {});
  const monthAgo = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  let fetched = 0, failed = 0, pending = 0, unavailable = 0;
  const ids = [...new Set(Object.values(events).flatMap((evs) => Object.values(evs).flatMap((ev) => (ev.results || []).map((r) => r.replay).filter(Boolean))))];
  for (const id of ids.sort((a, b) => b - a)) { // newest first
    const file = `${OUT}/inputs/${id}.txt`;
    if (await readFile(file).then(() => true, () => false)) continue;
    if (missing[id] && missing[id] > monthAgo) { unavailable++; continue; }
    if (fetched + failed >= INPUT_FETCHES) { pending++; continue; }
    try {
      const res = await get(`https://tmtas.exchange/api/replayData?id=${id}&inputs=true`);
      if (res.status === 404) { missing[id] = new Date().toISOString().slice(0, 10); unavailable++; continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) throw new Error('no inputs');
      await writeFile(file, inputsToScript(list));
      delete missing[id];
      fetched++;
    } catch (err) { failed++; console.warn(`inputs ${id}: ${err.message}`); }
  }
  await writeJson(`${OUT}/inputs_missing.json`, missing);
  return { fetched, failed, pending, unavailable };
}
export async function writeInputsIndex() {
  const { readdir } = await import('node:fs/promises');
  const ids = (await readdir(`${OUT}/inputs`).catch(() => [])).filter((f) => /^\d+\.txt$/.test(f)).map((f) => Number(f.slice(0, -4))).sort((a, b) => a - b);
  await writeJson(`${OUT}/inputs/index.json`, ids);
  return ids.length;
}

/* ============ MAPS ============ */
/* Edition number from a map name: "SpeedTAS 2 #7", "SpeedTAS nº12", "SpeedTAS n43". */
export function editionFromMapName(name) {
  const m = String(name).match(/(?:#|n[º°o]?)\s*0*(\d+)\s*(?:\D*)$/i) || String(name).match(/#\s*0*(\d+)/);
  return m ? m[1] : null;
}
async function fetchPack(packId) {
  const tracks = [];
  let after = null;
  for (let i = 0; i < 10; i++) {
    const res = await get(`https://tmnf.exchange/api/tracks?packid=${packId}&count=100&fields=${encodeURIComponent(MAP_FIELDS)}${after ? `&after=${after}` : ''}`);
    if (!res.ok) throw new Error(`TMX HTTP ${res.status}`);
    const j = await res.json();
    tracks.push(...j.Results);
    if (!j.More || !j.Results.length) break;
    after = j.Results[j.Results.length - 1].TrackId;
  }
  return tracks;
}
async function fetchTasTracks() {
  const all = [];
  for (let from = 1; from < 1000; from += 50) {
    const res = await get(`https://tmtas.exchange/api/tracks?name=SpeedTAS&amount=50&fromResultIndex=${from}`);
    if (!res.ok) throw new Error(`TAS Exchange HTTP ${res.status}`);
    const j = await res.json();
    all.push(...(j.results || []));
    if (all.length >= (j.total || 0) || !(j.results || []).length) break;
  }
  return all;
}
/* data/maps.json: {s1: {"5": {tmx, name, authors, authorTime, wr: {time, by}, thumb, tas: {track, time, by}}}, s2: …, tm20: …}
   tas = the all-time TAS record on TAS Exchange for the same map (any run, not just the one-hour SpeedTAS one). */
async function updateMaps(previous) {
  const maps = { ...previous };
  delete maps.updatedAt;
  let tas = [];
  try { tas = await fetchTasTracks(); } catch (err) { console.warn(`maps: TAS Exchange records unavailable (${err.message})`); }
  const tasByTmx = Object.fromEntries(tas.filter((t) => t.tmx_id).map((t) => [String(t.tmx_id), t]));
  const tasRecord = (t) => (t && t.tas_time ? { track: t.track_id, time: t.tas_time, by: t.author || null } : null);
  for (const [season, pack] of Object.entries(MAP_PACKS)) {
    try {
      const tracks = await fetchPack(pack);
      const used = new Set(tracks.map((t) => editionFromMapName(t.TrackName)).filter(Boolean));
      const out = {};
      tracks.forEach((t, i) => {
        let ed = editionFromMapName(t.TrackName);
        if (!ed && !used.has(String(i + 1))) ed = String(i + 1); // e.g. "SpeedTAS GS Edition": its place in the pack
        if (!ed) return;
        out[ed] = {
          tmx: t.TrackId, name: t.TrackName.trim(), authors: (t.Authors || []).map((a) => a.User && a.User.Name).filter(Boolean),
          authorTime: t.AuthorTime || null, wr: t.WRReplay ? { time: t.WRReplay.ReplayTime, by: t.WRReplay.User ? t.WRReplay.User.Name : null } : null,
          thumb: !!t.HasThumbnail, tas: tasRecord(tasByTmx[String(t.TrackId)]),
        };
      });
      maps[season] = out;
    } catch (err) { console.warn(`maps ${season}: kept the previous data (${err.message})`); }
  }
  // TM2020 maps aren't in a TMX pack; TAS Exchange knows them by name ("SpeedTAS #4") with a Nadeo thumbnail.
  const tm20 = {};
  tas.filter((t) => t.tmx_exchange === 'tm2020').forEach((t) => {
    const name = String(t.track_name).replace(/\$[0-9a-f]{3}|\$[a-z]/gi, '').trim();
    const ed = editionFromMapName(name);
    if (ed) tm20[ed] = { name, authors: [t.track_author].filter(Boolean), authorTime: t.author_time || null, thumbUrl: t.thumbnail_url || null, tas: tasRecord(t) };
  });
  if (Object.keys(tm20).length) maps.tm20 = tm20;
  return maps;
}

/* ============ MAP THUMBNAILS ============ */
/* Each TMX map picture is downloaded once into data/thumbs/, so visitors never load it from tmnf.exchange.
   Map pictures don't change, so a saved file is never fetched again. */
const THUMB_FETCHES = 150; // most new pictures downloaded per run
const exists = (f) => access(f).then(() => true, () => false);
async function saveThumbs(maps) {
  await mkdir(`${OUT}/thumbs`, { recursive: true });
  let fetched = 0, failed = 0;
  for (const season of Object.keys(MAP_PACKS)) {
    for (const map of Object.values(maps[season] || {})) {
      if (!map.tmx || !map.thumb) continue;
      const base = `thumbs/tmx-${map.tmx}`;
      const known = ['jpg', 'png', 'webp'].map((x) => `${base}.${x}`);
      let file = null;
      for (const f of known) if (await exists(`${OUT}/${f}`)) { file = f; break; }
      if (!file && fetched < THUMB_FETCHES) {
        try {
          const res = await get(`https://tmnf.exchange/trackshow/${map.tmx}/image/1`);
          const type = res.headers.get('content-type') || '';
          if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`);
          const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
          file = `${base}.${ext}`;
          await writeFile(`${OUT}/${file}`, Buffer.from(await res.arrayBuffer()));
          fetched++;
        } catch (err) { failed++; console.warn(`thumb ${map.tmx}: ${err.message}`); }
      }
      if (file) map.thumbFile = `${OUT}/${file}`; else delete map.thumbFile;
    }
  }
  return { fetched, failed };
}

/* ============ DISCORD AVATARS ============ */
/* data/avatars.json: {players: {name: discordId}, avatars: {discordId: url}}. Read from the SpeedTAS Worker once per
   run, so visitors load one small file instead of asking the Worker (and Discord) on every visit. */
const WORKER = 'https://speedtas-api.kristianogeorgiev652.workers.dev';
async function updateAvatars(previous) {
  const prev = { players: {}, avatars: {}, ...previous };
  const res = await get(`${WORKER}/players`);
  if (!res.ok) throw new Error(`Worker /players HTTP ${res.status}`);
  const players = {};
  Object.entries((await res.json()).players || {}).forEach(([name, id]) => { if (/^\d{15,25}$/.test(String(id))) players[name] = String(id); });
  if (!Object.keys(players).length) throw new Error('Worker returned no players');
  const avatars = {}, queue = [...new Set(Object.values(players))];
  let calls = 0;
  while (queue.length && calls < 60) {
    const batch = queue.splice(0, 20); calls++;
    try {
      const r = await get(`${WORKER}/avatars?ids=${encodeURIComponent(batch.join(','))}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      Object.entries(j.avatars || {}).forEach(([id, url]) => { avatars[id] = url || null; });
      (j.pending || []).forEach((id) => queue.push(id));
    } catch (err) { console.warn(`avatars batch: ${err.message}`); }
  }
  // A lookup that failed this time keeps last run's picture.
  Object.values(players).forEach((id) => { if (!(id in avatars) && prev.avatars[id]) avatars[id] = prev.avatars[id]; });
  return { players, avatars, calls };
}

/* ============ YOUTUBE VIDEOS ============ */
/* data/videos.json: {videos: {videoId: {title, published}}, editions: {s2: {"26": videoId}, tm20: {...}}, manual: {...}}
   Every run reads the channel's feed (newest 15) and, best effort, the channel's video list (older uploads), and keeps
   everything it has ever seen. "manual" is for pinning a video by hand when a title can't be read: it always wins. */
const YT_CHANNEL = 'UCSLm9iD-GUV_HhMEc1ee3tA';
const SEASON3_START = '2027-02-06';
export function videoEdition(title, published) {
  const t = String(title);
  // Channel titles look like "🏆 SpeedTAS 26", "🏆 SpeedTAS 17 | Triple Crown", "The First TM20 SpeedTAS".
  if (/\bTM\s*20(?:20)?\b/i.test(t)) {
    const n = (t.match(/#\s*0*(\d+)/) || t.match(/speed\s*tas\s*(?:TM\s*20(?:20)?\s*)?0*(\d+)/i) || [])[1] || (/\bfirst\b/i.test(t) ? '1' : null);
    return n ? { set: 'tm20', ed: n } : null;
  }
  const explicit = t.match(/\b(?:season\s*|S)(\d)\b[^#\d]*#\s*0*(\d+)/i) || t.match(/speed\s*tas\s*(\d)\s*#\s*0*(\d+)/i);
  if (explicit) return { set: 's' + explicit[1], ed: explicit[2] };
  // No season in the title: the edition number belongs to the season running when it was published
  // (Season 2 until Season 3 starts; uploads without a date are older ones, so Season 2).
  const n = (t.match(/speed\s*tas\s*#?\s*0*(\d+)\b/i) || [])[1];
  if (!n) return null;
  return { set: published && published >= SEASON3_START ? 's3' : 's2', ed: n };
}
function collectVideos(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectVideos(n, out)); return; }
  const id = node.videoId || (node.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && node.contentId);
  const title = node.title && (node.title.simpleText || (node.title.runs || []).map((r) => r.text).join('') || node.title.content)
    || (node.metadata && node.metadata.lockupMetadataViewModel && node.metadata.lockupMetadataViewModel.title && node.metadata.lockupMetadataViewModel.title.content);
  if (id && title && !out[id]) out[id] = { title };
  Object.values(node).forEach((v) => collectVideos(v, out));
}
async function fetchChannelList() {
  const found = {};
  const page = await (await get(`https://www.youtube.com/channel/${YT_CHANNEL}/videos`)).text();
  const data = page.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!data) throw new Error('no ytInitialData');
  const initial = JSON.parse(data[1]);
  collectVideos(initial, found);
  const key = (page.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1], version = (page.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
  let token = (JSON.stringify(initial).match(/"continuationCommand":\{"token":"([^"]+)"/) || [])[1];
  for (let i = 0; token && key && i < 10; i++) {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: version } }, continuation: token }) });
    if (!res.ok) break;
    const j = await res.json();
    collectVideos(j, found);
    token = (JSON.stringify(j).match(/"continuationCommand":\{"token":"([^"]+)"/) || [])[1];
  }
  return found;
}
/* Re-match the saved videos to editions without going online (after changing videoEdition). */
async function relinkVideos() {
  const v = await readJson(`${OUT}/videos.json`, null);
  if (!v) return console.log('no data/videos.json yet');
  v.editions = {};
  Object.entries(v.videos).sort((a, b) => String(a[1].published || '').localeCompare(String(b[1].published || ''))).forEach(([id, x]) => {
    const m = videoEdition(x.title, x.published);
    if (m) (v.editions[m.set] = v.editions[m.set] || {})[m.ed] = id;
  });
  Object.entries(v.manual || {}).forEach(([set, eds]) => Object.entries(eds || {}).forEach(([ed, id]) => { (v.editions[set] = v.editions[set] || {})[ed] = id; }));
  await writeJson(`${OUT}/videos.json`, v);
  console.log(`videos relinked: ${Object.entries(v.editions).map(([k, e]) => `${k} ${Object.keys(e).length}`).join(', ')}`);
}
async function updateVideos(previous) {
  const out = { videos: { ...(previous.videos || {}) }, manual: previous.manual || {}, editions: {} };
  const feed = await (await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`)).text();
  for (const entry of feed.split('<entry>').slice(1)) {
    const id = (entry.match(/<yt:videoId>([^<]+)</) || [])[1], title = stripTags((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const published = ((entry.match(/<published>([^<]+)</) || [])[1] || '').slice(0, 10);
    if (id) out.videos[id] = { title, published };
  }
  try {
    const list = await fetchChannelList();
    Object.entries(list).forEach(([id, v]) => { if (!out.videos[id]) out.videos[id] = { title: v.title, published: null }; });
  } catch (err) { console.warn(`videos: channel list unavailable, feed only (${err.message})`); }
  // Oldest first, so if one edition has several uploads the newest wins.
  Object.entries(out.videos).sort((a, b) => String(a[1].published || '').localeCompare(String(b[1].published || ''))).forEach(([id, v]) => {
    const m = videoEdition(v.title, v.published);
    if (m) (out.editions[m.set] = out.editions[m.set] || {})[m.ed] = id;
  });
  Object.entries(out.manual).forEach(([set, eds]) => Object.entries(eds || {}).forEach(([ed, id]) => { (out.editions[set] = out.editions[set] || {})[ed] = id; }));
  return out;
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
  // Maps: TMX packs + TAS Exchange records (a handful of requests).
  if (!process.argv.includes('--sheets')) {
    const maps = await updateMaps(await readJson(`${OUT}/maps.json`, {}));
    const thumbs = await saveThumbs(maps);
    await writeJson(`${OUT}/maps.json`, { ...maps, updatedAt: now });
    console.log(`maps: ${Object.entries(maps).map(([k, v]) => `${k} ${Object.keys(v).length}`).join(', ')} (thumbnails: ${thumbs.fetched} new, ${thumbs.failed} failed)`);
  }
  // 4. Inputs for every replay with downloads enabled.
  if (!process.argv.includes('--sheets')) {
    const r = await saveInputs(events);
    console.log(`inputs: ${r.fetched} saved, ${r.unavailable} not available from TAS Exchange (replay download only), ${r.failed} failed, ${r.pending} left for the next run`);
    await writeInputsIndex();
  }
  // 5. YouTube videos per edition.
  if (!process.argv.includes('--sheets')) {
    try {
      const prevVideos = await readJson(`${OUT}/videos.json`, {});
      const v = await updateVideos(prevVideos);
      const { updatedAt, ...prevComparable } = prevVideos;
      if (JSON.stringify(prevComparable) !== JSON.stringify(v)) await writeJson(`${OUT}/videos.json`, { ...v, updatedAt: now });
      const unmatched = Object.entries(v.videos).filter(([, x]) => !videoEdition(x.title, x.published)).map(([, x]) => x.title);
      console.log(`videos: ${Object.keys(v.videos).length} known, matched ${Object.entries(v.editions).map(([k, e]) => `${k} ${Object.keys(e).length}`).join(', ') || 'none'}` + (unmatched.length ? `; not matched: ${unmatched.slice(0, 8).join(' | ')}` : ''));
    } catch (err) {
      failures++;
      console.warn(`videos: kept the previous file (${err.message})`);
    }
  }
  // 6. Discord avatars (one Worker pass per run instead of one per visitor).
  try {
    const prevAvatars = await readJson(`${OUT}/avatars.json`, {});
    const av = await updateAvatars(prevAvatars);
    const { updatedAt, ...prevComparable } = prevAvatars;
    const next = { players: av.players, avatars: av.avatars };
    // only rewrite the file when something changed, so a run without changes makes no commit
    if (JSON.stringify(prevComparable) !== JSON.stringify(next)) await writeJson(`${OUT}/avatars.json`, { ...next, updatedAt: now });
    console.log(`avatars: ${Object.keys(av.players).length} players, ${Object.values(av.avatars).filter(Boolean).length} pictures (${av.calls} Worker calls)`);
  } catch (err) {
    failures++;
    console.warn(`avatars: kept the previous file (${err.message})`);
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
  assert(editionFromMapName('SpeedTAS 2 #7') === '7' && editionFromMapName('SpeedTAS nº12') === '12' && editionFromMapName('SpeedTAS n43') === '43' && editionFromMapName('SpeedTAS nº4 Mini_Trial') === '4' && editionFromMapName(' SpeedTAS GS Edition') === null && editionFromMapName('SpeedTAS #100') === '100', 'map names');
  assert(JSON.stringify(videoEdition('SpeedTAS 2 #26', '2026-11-01')) === '{"set":"s2","ed":"26"}', 'video title s2');
  assert(JSON.stringify(videoEdition('SpeedTAS Season 3 #4 | Results')) === '{"set":"s3","ed":"4"}', 'video title season 3');
  assert(JSON.stringify(videoEdition('SpeedTAS TM20 #2')) === '{"set":"tm20","ed":"2"}', 'video title tm20');
  assert(JSON.stringify(videoEdition('SpeedTAS #5', '2027-03-01')) === '{"set":"s3","ed":"5"}', 'video title no season after S3 start');
  assert(JSON.stringify(videoEdition('🏆 SpeedTAS 26', '2026-11-13')) === '{"set":"s2","ed":"26"}', 'channel title s2');
  assert(JSON.stringify(videoEdition('🏆 SpeedTAS 17 | Triple Crown', null)) === '{"set":"s2","ed":"17"}', 'channel title with subtitle');
  assert(JSON.stringify(videoEdition('🏆 The First TM20 SpeedTAS', '2026-09-25')) === '{"set":"tm20","ed":"1"}', 'channel title tm20 first');
  assert(JSON.stringify(videoEdition('🏆 SpeedTAS 3', '2027-02-08')) === '{"set":"s3","ed":"3"}', 'channel title after S3 start');
  assert(videoEdition('Trackmania vlog', '2026-01-01') === null, 'unrelated video');
  console.log('selftest ok');
}

if (process.argv.includes('--selftest')) selftest();
else if (process.argv.includes('--relink-videos')) relinkVideos();
else if (process.argv.includes('--index-inputs')) writeInputsIndex().then((n) => console.log(`inputs index: ${n} replays`));
else if (!process.argv.includes('--index-inputs') && !process.argv.includes('--relink-videos')) main().catch((err) => { console.error(err); process.exit(1); });
