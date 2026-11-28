// scripts/lib/maps.mjs — Map details (TMX packs or name search), TAS records, map pictures.
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { writeFile, mkdir, access } from 'node:fs/promises';
import { OUT, REPORT, get } from './common.mjs';
import { MAP_FIELDS, MAP_PACKS, MAP_SEARCH, MAP_SEASONS } from './config.mjs';

/* Edition number from a map name: "SpeedTAS 2 #7", "SpeedTAS nº12", "SpeedTAS n43". */
export function editionFromMapName(name) {
  const m = String(name).match(/(?:#|n[º°o]?)\s*0*(\d+)\s*(?:\D*)$/i) || String(name).match(/#\s*0*(\d+)/);
  return m ? m[1] : null;
}

export async function fetchPack(packId) {
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

/* Maps whose name matches a season's pattern ("SpeedTAS 3 #4"), from TMX's name search. */
export async function searchTracks({ query, name }) {
  const tracks = [];
  let after = null;
  for (let i = 0; i < 5; i++) {
    const res = await get(`https://tmnf.exchange/api/tracks?name=${encodeURIComponent(query)}&count=100&fields=${encodeURIComponent(MAP_FIELDS)}${after ? `&after=${after}` : ''}`);
    if (!res.ok) throw new Error(`TMX search HTTP ${res.status}`);
    const j = await res.json();
    tracks.push(...(j.Results || []).filter((t) => name.test(t.TrackName || '')));
    if (!j.More || !(j.Results || []).length) break;
    after = j.Results[j.Results.length - 1].TrackId;
  }
  // The same edition uploaded twice: keep the first upload (lowest id), which is the one used on the day.
  const byEd = {};
  tracks.sort((a, b) => a.TrackId - b.TrackId).forEach((t) => { const ed = t.TrackName.match(name)[1]; if (!byEd[ed]) byEd[ed] = t; });
  return byEd;
}

export async function fetchTasTracks() {
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

export async function updateMaps(previous) {
  const maps = { ...previous };
  delete maps.updatedAt;
  let tas = [];
  try { tas = await fetchTasTracks(); } catch (err) { console.warn(`maps: TAS Exchange records unavailable (${err.message})`); REPORT.warnings.push(`TAS records for maps unavailable this run (${err.message}).`); }
  const tasByTmx = Object.fromEntries(tas.filter((t) => t.tmx_id).map((t) => [String(t.tmx_id), t]));
  const tasRecord = (t) => (t && t.tas_time ? { track: t.track_id, time: t.tas_time, by: t.author || null } : null);
  const mapEntry = (t) => ({
    tmx: t.TrackId, name: t.TrackName.trim(), authors: (t.Authors || []).map((a) => a.User && a.User.Name).filter(Boolean),
    authorTime: t.AuthorTime || null, wr: t.WRReplay ? { time: t.WRReplay.ReplayTime, by: t.WRReplay.User ? t.WRReplay.User.Name : null } : null,
    thumb: !!t.HasThumbnail, tas: tasRecord(tasByTmx[String(t.TrackId)]),
  });
  for (const [season, search] of Object.entries(MAP_SEARCH)) {
    if (MAP_PACKS[season]) continue;
    try {
      const found = await searchTracks(search);
      if (!Object.keys(found).length) { console.log(`maps ${season}: no maps on TMX yet`); continue; }
      maps[season] = Object.fromEntries(Object.entries(found).map(([ed, t]) => [ed, mapEntry(t)]));
    } catch (err) { console.warn(`maps ${season}: kept the previous data (${err.message})`); REPORT.warnings.push(`${season} maps: kept the previous data (${err.message}).`); }
  }
  for (const [season, pack] of Object.entries(MAP_PACKS)) {
    try {
      const tracks = await fetchPack(pack);
      const used = new Set(tracks.map((t) => editionFromMapName(t.TrackName)).filter(Boolean));
      const out = {};
      tracks.forEach((t, i) => {
        let ed = editionFromMapName(t.TrackName);
        if (!ed && !used.has(String(i + 1))) ed = String(i + 1); // e.g. "SpeedTAS GS Edition": its place in the pack
        if (!ed) return;
        out[ed] = mapEntry(t);
      });
      maps[season] = out;
    } catch (err) { console.warn(`maps ${season}: kept the previous data (${err.message})`); REPORT.warnings.push(`${season} maps: kept the previous data (${err.message}).`); }
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

export const THUMB_FETCHES = 150;

 // most new pictures downloaded per run
export const exists = (f) => access(f).then(() => true, () => false);

export async function saveThumbs(maps) {
  await mkdir(`${OUT}/thumbs`, { recursive: true });
  let fetched = 0, failed = 0;
  for (const season of MAP_SEASONS) {
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
