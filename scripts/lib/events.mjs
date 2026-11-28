// scripts/lib/events.mjs — TAS Exchange events: titles, results, times, replay ids (port of the Worker).
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { get } from './common.mjs';
import { EVENT_LOOKAHEAD, EVENT_SCAN_FROM, EVENT_SCAN_KNOWN, EVENT_SETS, MAX_CHECKS_PER_EVENT, REPLAY_BACKFILL, RESULT_RECHECKS } from './config.mjs';

export const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

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

export const editionOf = (title) => { const m = title.match(/#\s*0*(\d+)/); return m ? m[1] : null; };

export async function fetchEventPage(id) {
  try {
    const res = await get(`https://tmtas.exchange/events/${id}`);
    if (res.status === 404 || res.status === 403 || res.status === 410) return { missing: true };
    if (!res.ok) return { error: res.status };
    return { html: await res.text() };
  } catch (err) { return { error: String(err) }; }
}

export async function updateEvents(state, events) {
  let requests = 0;
  const ids = Object.keys(state.titles).map(Number);
  let id = ids.length ? Math.max(...ids) + 1 : EVENT_SCAN_FROM;
  // First run: walk every id from EVENT_SCAN_FROM. Later runs: only ids past the newest known event.
  let missRun = 0, reached = 0, errors = 0;
  while (id <= EVENT_SCAN_KNOWN || missRun < EVENT_LOOKAHEAD) {
    const batch = Array.from({ length: 6 }, (_, i) => id + i);
    const pages = await Promise.all(batch.map(fetchEventPage));
    requests += batch.length;
    batch.forEach((bid, i) => {
      const p = pages[i];
      if (p.html) { state.titles[bid] = extractTitle(p.html); missRun = 0; state.pages[bid] = p.html; }
      else missRun++;
      if (p.error) errors++; else reached++;
    });
    id += batch.length;
  }
  // Every request failed (not "no such event", but no answer at all): the site is down, not out of events.
  if (!reached && errors) throw new Error(`TAS Exchange did not answer (${errors} failed requests)`);
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
