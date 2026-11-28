// scripts/lib/inputs.mjs — Replay inputs: TMNF as TMInterface scripts, TM2020 in the TM2020 TAS format with the seed (decoded sandboxed).
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { OUT, get, readJson, writeJson } from './common.mjs';
import { INPUT_FETCHES } from './config.mjs';

export function inputsToScript(list) {
  return list.map((x) => `${(Number(x.time) / 1000).toFixed(2).replace(/\.00$/, '')} ${x.action} ${x.value}`).join('\n') + '\n';
}

export const TOOLS_PAGE = 'https://tmtas.exchange/tools?module=input-extractor';

export let TM2020_DECODER = null;

/* Finds the decoder module by walking the tools page's scripts (their file names change on every deploy). */
export async function findTm2020Decoder(fetchText = async (u) => { const r = await get(u); if (!r.ok) throw new Error(`HTTP ${r.status} for ${u}`); return r.text(); }) {
  const html = await fetchText(TOOLS_PAGE);
  const queue = [...html.matchAll(/(?:src|href)="([^"]+\.js)"|import\("([^"]+\.js)"\)/g)].map((m) => new URL(m[1] || m[2], TOOLS_PAGE).href);
  const seen = new Set();
  while (queue.length && seen.size < 250) {
    const url = queue.shift();
    if (seen.has(url) || !url.startsWith('https://tmtas.exchange/')) continue;
    seen.add(url);
    const js = await fetchText(url).catch(() => '');
    if (/\bas decodeTm2020Inputs\b/.test(js) && /export\s*\{/.test(js)) return js;
    for (const m of js.matchAll(/["'`]((?:\.{1,2}\/|\/_app\/)[^"'`\s]+?\.js)["'`]/g)) queue.push(new URL(m[1], url).href);
  }
  throw new Error(`TM2020 input decoder not found on TAS Exchange (${seen.size} scripts checked)`);
}

export async function tm2020Decoder() {
  if (TM2020_DECODER) return TM2020_DECODER;
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'speedtas-tm2020-'));
  await writeFile(join(dir, 'decoder.mjs'), await findTm2020Decoder());
  // Reads one replay from stdin, prints {seed, text} (or {error}) as JSON.
  await writeFile(join(dir, 'run.mjs'), `import * as d from './decoder.mjs';
const chunks = []; for await (const c of process.stdin) chunks.push(c);
const buf = Buffer.concat(chunks), bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
try { const r = d.decodeTm2020Inputs(bytes); process.stdout.write(JSON.stringify({ seed: r.seed ?? null, text: r.text || '' })); }
catch (e) { process.stdout.write(JSON.stringify({ error: String(e && e.message || e) })); }
`);
  const major = Number(process.versions.node.split('.')[0]);
  const flags = [major >= 22 ? '--permission' : '--experimental-permission', `--allow-fs-read=${dir}`, `--allow-fs-read=${dir}/*`];
  TM2020_DECODER = (bytes) => new Promise((resolve, reject) => {
    import('node:child_process').then(({ spawn }) => {
      const p = spawn(process.execPath, [...flags, join(dir, 'run.mjs')], { cwd: dir, env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('decoder timed out')); }, 30000);
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { err += c; });
      p.on('close', () => {
        clearTimeout(timer);
        try { const r = JSON.parse(out); r.error ? reject(new Error(r.error)) : resolve(r); }
        catch { reject(new Error(`decoder failed: ${(err || out).trim().split('\n').filter((l) => /Error|denied|ERR_/.test(l)).slice(0, 2).join(' / ') || (err || out).trim().slice(-200)}`)); }
      });
      p.stdin.on('error', () => {}); // the decoder exiting early shows up as its own error in 'close'
      p.stdin.end(Buffer.from(bytes));
    }, reject);
  });
  return TM2020_DECODER;
}

/* A decoded TM2020 script is usable when it starts with the seed and has at least one timed input. */
export const TM2020_LINE = /^-?\d+ (accel|brake|steer|flags|respawn|srespawn)( -?\w+)?$/;

export function validTm2020Script(text) { return !tm2020ScriptProblem(text); }

/* Why a decoded script isn't usable (null when it is). */
export function tm2020ScriptProblem(text) {
  const lines = String(text).trim().split('\n');
  if (!/^0 seed -?\d+$/.test(lines[0])) return `no seed line (starts "${lines[0].slice(0, 40)}")`;
  if (lines.length < 2) return 'no inputs after the seed';
  const bad = lines.slice(1).find((l) => !TM2020_LINE.test(l));
  return bad ? `unexpected line "${bad.slice(0, 60)}"` : null;
}

export async function saveTm2020Inputs(evs, budget) {
  await mkdir(`${OUT}/inputs/tm20`, { recursive: true });
  let fetched = 0, failed = 0, pending = 0, decoder = null;
  const runs = Object.values(evs).flatMap((ev) => (ev.results || []).filter((r) => r.replay).map((r) => ({ event: ev.id, replay: r.replay })));
  for (const { event, replay } of runs.sort((a, b) => b.replay - a.replay)) {
    const file = `${OUT}/inputs/tm20/${replay}.txt`;
    if (await readFile(file).then(() => true, () => false)) continue;
    if (fetched + failed >= budget) { pending++; continue; }
    try {
      decoder = decoder || await tm2020Decoder();
      const res = await get(`https://tmtas.exchange/events/${event}/replays/${replay}/download`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { text } = await decoder(await res.arrayBuffer());
      const problem = tm2020ScriptProblem(text);
      if (problem) throw new Error(`decoded inputs not usable: ${problem}`);
      await writeFile(file, text.trim() + '\n');
      fetched++;
    } catch (err) {
      failed++; console.warn(`tm20 inputs ${replay}: ${err.message}`);
      if (/decoder not found/.test(err.message)) { pending += runs.length; break; }
    }
  }
  return { fetched, failed, pending };
}

export async function saveInputs(events) {
  await mkdir(`${OUT}/inputs`, { recursive: true });
  const missing = await readJson(`${OUT}/inputs_missing.json`, {});
  const monthAgo = new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
  let fetched = 0, failed = 0, pending = 0, unavailable = 0;
  const replaysOf = (sets) => [...new Set(sets.flatMap((evs) => Object.values(evs || {}).flatMap((ev) => (ev.results || []).map((r) => r.replay).filter(Boolean))))];
  const tmnfSets = Object.entries(events).filter(([set]) => set !== 'tm20').map(([, evs]) => evs);
  const ids = replaysOf(tmnfSets);
  // Old runs saved TM2020 ids through the TMNF API, i.e. somebody else's TMNF inputs: those files go.
  const tmnfIds = new Set(ids);
  let removed = 0;
  for (const id of replaysOf([events.tm20])) {
    if (tmnfIds.has(id)) continue;
    const { rm } = await import('node:fs/promises');
    if (await rm(`${OUT}/inputs/${id}.txt`).then(() => true, () => false)) removed++;
    delete missing[id];
  }
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
  const tm20 = events.tm20 ? await saveTm2020Inputs(events.tm20, Math.max(0, INPUT_FETCHES - fetched - failed)) : { fetched: 0, failed: 0, pending: 0 };
  return { fetched, failed, pending, unavailable, removed, tm20 };
}

export async function writeInputsIndex() {
  const { readdir } = await import('node:fs/promises');
  const list = async (dir) => (await readdir(dir).catch(() => [])).filter((f) => /^\d+\.txt$/.test(f)).map((f) => Number(f.slice(0, -4))).sort((a, b) => a - b);
  const ids = await list(`${OUT}/inputs`), tm20 = await list(`${OUT}/inputs/tm20`);
  await writeJson(`${OUT}/inputs/index.json`, ids);
  await mkdir(`${OUT}/inputs/tm20`, { recursive: true });
  await writeJson(`${OUT}/inputs/tm20/index.json`, tm20);
  return ids.length + tm20.length;
}
