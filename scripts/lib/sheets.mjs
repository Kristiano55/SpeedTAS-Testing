// scripts/lib/sheets.mjs — Google Sheets -> datasets (port of the Worker: keep the two in step).
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { get } from './common.mjs';

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

export const GVIZ_CALLBACK = 'speedtasAction';

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

export async function fetchSheet(src) {
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
