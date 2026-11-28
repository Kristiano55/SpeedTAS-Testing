// scripts/lib/guard.mjs — Guard against bad sheet data, missing-results check, run report and commit message.
// Part of scripts/update-data.mjs (see the top of that file for what a run does).
import { writeFile } from 'node:fs/promises';
import { REPORT } from './common.mjs';

export const ARCHIVE_SEASONS = ['s1', 's2'];

export function guardDataset(key, fresh, prev, allowRemovals = false) {
  const problems = [], warnings = [];
  const prevSheet = prev ? (prev.editions || []).filter((e) => !e.auto) : [];
  const freshLabels = new Set(fresh.editions.map((e) => e.edition));
  const gone = prevSheet.map((e) => e.edition).filter((ed) => !freshLabels.has(ed));
  if (!allowRemovals) {
    if (prevSheet.length && !fresh.editions.length) problems.push(`${key}: the sheet came back empty; kept the previous data.`);
    else if (gone.length) problems.push(`${key}: the sheet no longer has edition(s) ${gone.join(', ')}; kept the previous data. If that was on purpose, run the workflow with "allow removals".`);
    else if (ARCHIVE_SEASONS.includes(key) && fresh.editions.length < prevSheet.length) problems.push(`${key}: finished season shrank from ${prevSheet.length} to ${fresh.editions.length} editions; kept the previous data.`);
  }
  const seen = new Set();
  fresh.editions.forEach((e) => {
    if (seen.has(e.edition)) warnings.push(`${key}: edition ${e.edition} appears twice in the sheet.`);
    seen.add(e.edition);
    const bad = Object.entries(e.results).filter(([, p]) => !Number.isInteger(p) || p < 1).map(([n]) => n);
    if (bad.length) warnings.push(`${key} edition ${e.edition}: placement that isn't a whole number 1 or more for ${bad.join(', ')}.`);
    if (!Object.values(e.results).includes(1)) warnings.push(`${key} edition ${e.edition}: nobody is in 1st place.`);
  });
  return { take: !problems.length, problems, warnings };
}

/* What a run changed in a results file, for the report and the commit message. */
export function datasetChanges(key, prev, next) {
  const out = [];
  const before = Object.fromEntries(((prev && prev.editions) || []).map((e) => [e.edition, e]));
  const added = next.editions.filter((e) => !before[e.edition]);
  const changed = next.editions.filter((e) => before[e.edition] && JSON.stringify(before[e.edition].results) !== JSON.stringify(e.results));
  if (added.length) out.push(`${key} #${added.map((e) => e.edition + (e.auto ? ' (auto)' : '')).join(', #')} added`);
  if (changed.length) out.push(`${key} #${changed.map((e) => e.edition).join(', #')} updated`);
  const known = new Set((prev && prev.players) || []), fresh = next.players.filter((n) => !known.has(n));
  if (prev && fresh.length) out.push(`${key} new player${fresh.length > 1 ? 's' : ''}: ${fresh.join(', ')}`);
  return out;
}

/* Season 3 schedule, read from the website's own config (assets/js/01-config.js) so it is written down once. */
export function readSchedule(configJs) {
  const info = configJs.match(/s3:\s*\{[^}]*editions:\s*(\d+)[^}]*start:\s*'(\d{4}-\d{2}-\d{2})'/);
  const breaks = (configJs.match(/SCHEDULE_BREAKS\s*=\s*\[([^\]]*)\]/) || [, ''])[1].match(/\d{4}-\d{2}-\d{2}/g) || [];
  const hour = +((configJs.match(/EDITION_HOUR_LISBON\s*=\s*(\d+)/) || [, 18])[1]);
  return info ? { total: +info[1], start: info[2], breaks, hour } : null;
}

export function expectedEditions(schedule, now, graceHours = 18) {
  if (!schedule) return 0;
  let n = 0;
  for (let day = Date.parse(schedule.start + 'T00:00:00Z'); n < schedule.total; day += 7 * 86400e3) {
    const iso = new Date(day).toISOString().slice(0, 10);
    if (day + (schedule.hour + 1 + graceHours) * 3600e3 > now.getTime()) break;
    if (!schedule.breaks.includes(iso)) n++;
  }
  return n;
}

export async function writeReport(startedAt) {
  const list = (title, xs) => (xs.length ? `### ${title}\n${xs.map((x) => `- ${x}`).join('\n')}\n\n` : '');
  const md = `## SpeedTAS data update · ${startedAt.slice(0, 16).replace('T', ' ')} UTC\n\n` +
    (REPORT.problems.length ? `**${REPORT.problems.length} problem(s).** The previous data was kept for these, so the site still works.\n\n` : '**All sources OK.**\n\n') +
    list('Problems', REPORT.problems) + list('Changes', REPORT.changes.length ? REPORT.changes : ['No result changes.']) + list('Warnings', REPORT.warnings) + list('Details', REPORT.notes);
  await writeFile('run-report.md', md);
  await writeFile('run-report.json', JSON.stringify({ at: startedAt, problems: REPORT.problems.length, warnings: REPORT.warnings.length, changes: REPORT.changes }, null, 1) + '\n');
  const headline = REPORT.changes.length ? REPORT.changes.slice(0, 3).join('; ') : 'refresh';
  await writeFile('commit-message.txt', `data: ${headline.length > 100 ? headline.slice(0, 97) + '...' : headline}\n\n${REPORT.changes.map((c) => `- ${c}`).join('\n')}\n`);
}
