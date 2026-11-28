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
//  4. Saves each replay's inputs: TMNF as a TMInterface script in data/inputs/<replayId>.txt, TM2020 in the TM2020
//     TAS format (with the seed) in data/inputs/tm20/<replayId>.txt (the two games number replays separately).
//
// Run by .github/workflows/update-data.yml (Saturday evening every 30 min, Sunday, a weekly maintenance run, or by hand).
// A source that fails keeps its previous file, so one bad fetch never blanks the site.
// Guard: sheet data that would lose editions the site already has is not taken (previous file kept, problem
// reported) unless the run is started with --allow-removals. Every run writes run-report.md / run-report.json
// (what changed, what went wrong) and commit-message.txt; the workflow turns problems into a GitHub issue.
// The parts live in scripts/lib/ (config, sheets, events, names, inputs, maps, media, guard, common);
// this file is the run order, the self-test and the command line. Sheet/event parsing ports speedtas-api-worker.js.

import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { OUT, REPORT, get, readJson, writeJson, writeJsonIfChanged } from './lib/common.mjs';
import { AUTO_IMPORT, EVENT_SETS, MAP_PACKS, MAP_SEARCH, SHEETS } from './lib/config.mjs';
import { extractTitle, parseEventResults, updateEvents } from './lib/events.mjs';
import { datasetChanges, expectedEditions, guardDataset, readSchedule, writeReport } from './lib/guard.mjs';
import { inputsToScript, saveInputs, tm2020Decoder, validTm2020Script, writeInputsIndex } from './lib/inputs.mjs';
import { editionFromMapName, fetchPack, saveThumbs, searchTracks, updateMaps } from './lib/maps.mjs';
import { relinkVideos, updateAvatars, updateVideos, videoEdition } from './lib/media.mjs';
import { autoImport, learnAliases, resolveName } from './lib/names.mjs';
import { GVIZ_CALLBACK, buildDatasetFromGrid, fetchSheet, parseCsvGrid, parseGvizText } from './lib/sheets.mjs';

async function main() {
  await mkdir(OUT, { recursive: true });
  const now = new Date().toISOString();
  let failures = 0;
  // 1. Sheets. A sheet that can't be read keeps its previous file (minus earlier auto-imports, which are redone below).
  const datasets = {}, previous = {};
  const allowRemovals = process.argv.includes('--allow-removals');
  for (const [key, src] of Object.entries(SHEETS)) {
    const prev = previous[key] = await readJson(`${OUT}/${key}.json`, null);
    const keepPrev = () => { if (prev) datasets[key] = { season: key, editions: prev.editions.filter((e) => !e.auto), players: prev.players }; };
    try {
      const d = await fetchSheet(src);
      const guard = guardDataset(key, d, prev, allowRemovals);
      REPORT.warnings.push(...guard.warnings);
      if (!guard.take) { failures++; REPORT.problems.push(...guard.problems); keepPrev(); console.warn(guard.problems.join('\n')); continue; }
      datasets[key] = { season: key, editions: d.editions, players: d.players };
      console.log(`${key}: ${d.editions.length} editions, ${d.players.length} players`);
    } catch (err) {
      failures++;
      keepPrev();
      REPORT.problems.push(`${key} sheet could not be read (${err.message}); kept the previous data.`);
      console.warn(`${key}: kept the previous data (${err.message})`);
    }
  }
  // 2. TAS Exchange events.
  const events = await readJson(`${OUT}/events.json`, {});
  delete events.updatedAt;
  const eventsBefore = JSON.parse(JSON.stringify(events));
  if (!process.argv.includes('--sheets')) {
    const state = await readJson(`${OUT}/events_state.json`, { titles: {} });
    state.pages = {};
    try {
      const requests = await updateEvents(state, events);
      await writeJson(`${OUT}/events_state.json`, state);
      console.log(`events: ${Object.entries(events).map(([k, v]) => `${k} ${Object.keys(v).length}`).join(', ')} (${requests} TAS Exchange requests)`);
    } catch (err) {
      failures++;
      REPORT.problems.push(`TAS Exchange events could not be read (${err.message}); kept the previous file.`);
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
    if (unknown.length) REPORT.warnings.push(`${key}: TAS Exchange names not matched to a sheet player (shown as typed until the sheet has them): ${unknown.join(', ')}.`);
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
  for (const [key, d] of Object.entries(datasets)) {
    REPORT.changes.push(...datasetChanges(key, previous[key], d));
    await writeJsonIfChanged(`${OUT}/${key}.json`, d, now);
  }
  for (const [set, evs] of Object.entries(events)) {
    const fresh = Object.entries(evs).filter(([ed, ev]) => (ev.results || []).length && !(((eventsBefore[set] || {})[ed] || {}).results || []).length).map(([ed]) => ed);
    if (fresh.length) REPORT.changes.push(`${set} times for #${fresh.join(', #')}`);
  }
  await writeJson(`${OUT}/aliases.json`, aliases);
  await writeJsonIfChanged(`${OUT}/events.json`, events, now);
  // Maps: TMX packs + TAS Exchange records (a handful of requests).
  if (!process.argv.includes('--sheets')) {
    const maps = await updateMaps(await readJson(`${OUT}/maps.json`, {}));
    const thumbs = await saveThumbs(maps);
    if (await writeJsonIfChanged(`${OUT}/maps.json`, maps, now)) REPORT.changes.push('map details updated');
    const line = `maps: ${Object.entries(maps).map(([k, v]) => `${k} ${Object.keys(v).length}`).join(', ')} (thumbnails: ${thumbs.fetched} new, ${thumbs.failed} failed)`;
    console.log(line); REPORT.notes.push(line);
    if (thumbs.failed) REPORT.warnings.push(`${thumbs.failed} map picture(s) could not be downloaded; retried next run.`);
  }
  // 4. Inputs for every replay with downloads enabled.
  if (!process.argv.includes('--sheets')) {
    const r = await saveInputs(events);
    const line = `inputs: ${r.fetched} saved, ${r.unavailable} not available from TAS Exchange (replay download only), ${r.failed} failed, ${r.pending} left for the next run` +
      ` · TM2020: ${r.tm20.fetched} saved, ${r.tm20.failed} failed, ${r.tm20.pending} left` + (r.removed ? ` · ${r.removed} wrong TM2020 files removed` : '');
    console.log(line); REPORT.notes.push(line);
    if (r.tm20.fetched) REPORT.changes.push(`TM2020 inputs for ${r.tm20.fetched} run${r.tm20.fetched > 1 ? 's' : ''}`);
    if (r.removed) REPORT.changes.push(`${r.removed} wrong TM2020 input files removed`);
    if (r.tm20.failed) REPORT.warnings.push(`${r.tm20.failed} TM2020 replay(s) could not be decoded; tried again next run.`);
    await writeInputsIndex();
  }
  // 5. YouTube videos per edition.
  if (!process.argv.includes('--sheets')) {
    try {
      const prevVideos = await readJson(`${OUT}/videos.json`, {});
      const v = await updateVideos(prevVideos);
      const { updatedAt, ...prevComparable } = prevVideos;
      if (JSON.stringify(prevComparable) !== JSON.stringify(v)) {
      await writeJson(`${OUT}/videos.json`, { ...v, updatedAt: now });
      const fresh = Object.keys(v.videos).filter((id) => !(prevComparable.videos || {})[id]).length;
      REPORT.changes.push(fresh ? `${fresh} new video${fresh > 1 ? 's' : ''}` : 'video links updated');
    }
      const unmatched = Object.entries(v.videos).filter(([, x]) => !videoEdition(x.title, x.published)).map(([, x]) => x.title);
      console.log(`videos: ${Object.keys(v.videos).length} known, matched ${Object.entries(v.editions).map(([k, e]) => `${k} ${Object.keys(e).length}`).join(', ') || 'none'}` + (unmatched.length ? `; not matched: ${unmatched.slice(0, 8).join(' | ')}` : ''));
    } catch (err) {
      failures++;
      REPORT.problems.push(`YouTube videos could not be read (${err.message}); kept the previous file.`);
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
    if (JSON.stringify(prevComparable) !== JSON.stringify(next)) {
      await writeJson(`${OUT}/avatars.json`, { ...next, updatedAt: now });
      REPORT.changes.push('Discord pictures updated');
    }
    console.log(`avatars: ${Object.keys(av.players).length} players, ${Object.values(av.avatars).filter(Boolean).length} pictures (${av.calls} Worker calls)`);
  } catch (err) {
    failures++;
    REPORT.problems.push(`Discord avatars could not be read from the Worker (${err.message}); kept the previous file.`);
    console.warn(`avatars: kept the previous file (${err.message})`);
  }
  // 7. Missing results: a Saturday edition whose results still aren't in by the next day is reported.
  try {
    const schedule = readSchedule(await readFile('assets/js/01-config.js', 'utf8'));
    const want = expectedEditions(schedule, new Date()), have = datasets.s3 ? datasets.s3.editions.length : 0;
    if (want > have) REPORT.problems.push(`Season 3 should have ${want} edition(s) by now but has ${have}. Add the latest results to the Season 3 sheet (or make the TAS Exchange times public).`);
  } catch (err) { REPORT.warnings.push(`Could not check the Season 3 schedule (${err.message}).`); }
  await writeJson(`${OUT}/updated.json`, { at: now });
  if (failures) console.log(`${failures} source(s) failed; their previous data was kept.`);
  await writeReport(now);
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
  const prevS2 = { editions: [{ edition: '1', results: { A: 1 } }, { edition: '2', results: { A: 1 } }], players: ['A'] };
  assert(!guardDataset('s2', { editions: [{ edition: '1', results: { A: 1 } }], players: ['A'] }, prevS2).take, 'guard: lost edition');
  assert(guardDataset('s2', { editions: [{ edition: '1', results: { A: 1 } }], players: ['A'] }, prevS2, true).take, 'guard: allow removals');
  assert(!guardDataset('s3', { editions: [], players: [] }, prevS2).take, 'guard: empty sheet');
  assert(guardDataset('s3', { editions: [{ edition: '1', results: { A: 1 } }], players: ['A'] }, { editions: [{ edition: '1', results: { A: 1 }, auto: true }, { edition: '2', results: { A: 1 }, auto: true }], players: ['A'] }).take, 'guard: auto editions may go');
  assert(guardDataset('s3', { editions: [{ edition: '1', results: { A: 0 } }], players: ['A'] }, null).warnings.length === 2, 'guard: bad placement warnings');
  assert(datasetChanges('s3', prevS2, { editions: [...prevS2.editions, { edition: '3', results: { B: 1 } }], players: ['A', 'B'] }).join('|') === 's3 #3 added|s3 new player: B', 'changes');
  assert(MAP_SEARCH.s3.name.test('SpeedTAS 3 #4') && MAP_SEARCH.s3.name.test('SpeedTAS S3 #12') && !MAP_SEARCH.s3.name.test('SpeedTAS 2 #3') && !MAP_SEARCH.s3.name.test('SpeedTAS 30 #3'), 'S3 map names');
  const sched = readSchedule(`s3: {label: 'Season 3', short: 'S3', bestOf: 9, editions: 12, start: '2027-02-06'}\n const SCHEDULE_BREAKS = ['2027-02-20'];\n const EDITION_HOUR_LISBON = 18;`);
  assert(sched && sched.total === 12 && sched.start === '2027-02-06' && sched.breaks[0] === '2027-02-20' && sched.hour === 18, 'schedule parse');
  assert(expectedEditions(sched, new Date('2027-02-06T20:00:00Z')) === 0, 'expected: edition day itself');
  assert(expectedEditions(sched, new Date('2027-02-07T14:00:00Z')) === 1, 'expected: next day');
  assert(expectedEditions(sched, new Date('2027-02-21T14:00:00Z')) === 2, 'expected: break skipped');
  assert(expectedEditions(sched, new Date('2026-11-27T12:00:00Z')) === 0, 'expected: before the season');
  assert(validTm2020Script('0 seed 31893439\n0 accel 1\n280 steer 1\n290 steer -9\n300 steer left\n500 flags 2\n900 respawn\n'), 'tm2020 script ok');
  assert(!validTm2020Script('0 steer -55685\n0 press up\n0.01 steer 58323\n'), 'tmnf script is not tm2020');
  assert(!validTm2020Script('0 seed 5\n'), 'seed only');
  console.log('selftest ok');
}

/* --probe-maps: checks the TMX name search against Season 2's pack (both should find the same maps). Writes nothing. */
async function probeMaps() {
  const pack = await fetchPack(MAP_PACKS.s2);
  const byName = await searchTracks({ query: 'SpeedTAS 2', name: /^\s*SpeedTAS\s*2\s*#\s*0*(\d+)\b/i });
  const packIds = new Set(pack.map((t) => t.TrackId)), found = Object.values(byName).map((t) => t.TrackId);
  console.log(`probe: pack has ${pack.length} maps, name search found ${found.length}, ${found.filter((id) => packIds.has(id)).length} of them in the pack`);
  const s3 = await searchTracks(MAP_SEARCH.s3);
  console.log(`probe: Season 3 maps on TMX so far: ${Object.keys(s3).length}`);
}

// Only act when run as a script (node scripts/update-data.mjs ...), never when another script imports it.
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (!isCli) { /* imported: functions only */ }
else if (process.argv.includes('--selftest')) selftest();
else if (process.argv.includes('--probe-maps')) probeMaps().catch((err) => { console.error(err); process.exit(1); });
else if (process.argv.includes('--relink-videos')) relinkVideos();
else if (process.argv.includes('--probe-tm20')) (async () => {
  // --probe-tm20 <eventId> <replayId>: decode one TM2020 replay and print the start of its inputs. Writes nothing.
  const [event, replay] = process.argv.slice(process.argv.indexOf('--probe-tm20') + 1);
  const res = await get(`https://tmtas.exchange/events/${event}/replays/${replay}/download`);
  const { text } = await (await tm2020Decoder())(await res.arrayBuffer());
  console.log(`probe tm20 ${replay}: valid=${validTm2020Script(text)} lines=${text.trim().split('\n').length}\n${text.split('\n').slice(0, 6).join('\n')}`);
})().catch((err) => { console.error(err); process.exit(1); });
else if (process.argv.includes('--index-inputs')) writeInputsIndex().then((n) => console.log(`inputs index: ${n} replays`));
else main().catch((err) => { console.error(err); process.exit(1); });
