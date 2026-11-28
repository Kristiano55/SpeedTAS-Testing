// scripts/lib/media.mjs — Discord avatars via the Worker, YouTube uploads linked to editions.
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { OUT, UA, get, readJson, writeJson } from './common.mjs';
import { stripTags } from './events.mjs';

export const WORKER = 'https://speedtas-api.kristianogeorgiev652.workers.dev';

export async function updateAvatars(previous) {
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
  // Sorted, so the file only changes when a picture does (the Worker answers batches in any order).
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return { players: sorted(players), avatars: sorted(avatars), calls };
}

export const YT_CHANNEL = 'UCSLm9iD-GUV_HhMEc1ee3tA';

export const SEASON3_START = '2027-02-06';

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

export function collectVideos(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectVideos(n, out)); return; }
  const id = node.videoId || (node.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && node.contentId);
  const title = node.title && (node.title.simpleText || (node.title.runs || []).map((r) => r.text).join('') || node.title.content)
    || (node.metadata && node.metadata.lockupMetadataViewModel && node.metadata.lockupMetadataViewModel.title && node.metadata.lockupMetadataViewModel.title.content);
  if (id && title && !out[id]) out[id] = { title };
  Object.values(node).forEach((v) => collectVideos(v, out));
}

export async function fetchChannelList() {
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
export async function relinkVideos() {
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

export async function updateVideos(previous) {
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
