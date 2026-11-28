// scripts/lib/names.mjs — TAS Exchange entrant names -> sheet players, and the auto-import of results before the sheet has them.
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { MANUAL_ALIASES } from './config.mjs';

export const nameKey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function oneLetterApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

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

export const toSeconds = (t) => { const m = String(t).match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/); return m ? (m[1] ? +m[1] * 60 : 0) + parseFloat(m[2]) : null; };

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
