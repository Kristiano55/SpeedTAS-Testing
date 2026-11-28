// scripts/lib/common.mjs — Shared by every part of the data update: output folder, user agent, HTTP get, JSON read/write, the run report.
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { readFile, writeFile } from 'node:fs/promises';

export const OUT = 'data';

export const UA = `SpeedTAS data updater (github.com/${process.env.GITHUB_REPOSITORY || 'Kristiano55/SpeedTAS'})`;

export async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return res;
}

export const REPORT = { problems: [], warnings: [], changes: [], notes: [] };

export async function readJson(f, d) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } }

export const writeJson = (f, data) => writeFile(f, JSON.stringify(data, null, 1) + '\n');

/* Rewrites a data file only when its content (ignoring updatedAt) changed, so a run without news makes no commit. */
export async function writeJsonIfChanged(f, data, now) {
  const { updatedAt, ...prev } = await readJson(f, {});
  const { updatedAt: _, ...next } = data;
  if (JSON.stringify(prev) === JSON.stringify(next)) return false;
  await writeJson(f, { ...next, updatedAt: now });
  return true;
}
