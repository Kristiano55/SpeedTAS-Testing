// Draws the link-preview image (Discord, X, WhatsApp...) with the current top 10 and keeps the
// preview tags in index.html pointing at the newest one.
//   node scripts/og-image.mjs            render data/og/standings.png and update index.html
//   node scripts/og-image.mjs --svg      also write data/og/standings.svg (for checking the layout)
// Needs @resvg/resvg-js (installed by the GitHub Action with --no-save; not used by the website).
// Same scoring as the site: TMNF points 10-7-6-5-4-3-2-1, Season 3 counts each player's best 9 of 12.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = 'data/og';
const SITE = 'https://kristiano55.github.io/SpeedTAS-Testing/';
const SEASONS = {
  s3: { label: 'Season 3', bestOf: 9, editions: 12, accent: '#b388ff' },
  s2: { label: 'Season 2', bestOf: null, editions: null, accent: '#e9fb59' },
};
const POINTS = { 1: 10, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };
const PODIUM = { 1: '#ffcf3f', 2: '#d5dbe3', 3: '#e08a4f' };

const readJson = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };

/* Same ranking as computeAll() in index.html: counted points, highest first; equal points keep the sheet order. */
export function standings(data, bestOf) {
  const players = new Map();
  const get = (name) => { if (!players.has(name)) players.set(name, { name, pts: [], wins: 0, podiums: 0 }); return players.get(name); };
  (data.players || []).forEach(get);
  for (const ed of data.editions || []) {
    for (const [name, place] of Object.entries(ed.results)) {
      const p = get(name);
      p.pts.push(POINTS[place] ?? 0);
      if (place === 1) p.wins++;
      if (place <= 3) p.podiums++;
    }
  }
  return [...players.values()].filter((p) => p.pts.length).map((p) => {
    const counted = bestOf ? [...p.pts].sort((a, b) => b - a).slice(0, bestOf) : p.pts;
    return { name: p.name, points: counted.reduce((a, b) => a + b, 0), wins: p.wins, podiums: p.podiums, played: p.pts.length };
  }).sort((a, b) => b.points - a.points).map((p, i) => ({ ...p, rank: i + 1 }));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function svgFor({ season, info, ranked, editionsRun, final }) {
  const A = info.accent, W = 1200, H = 630;
  const top = ranked.slice(0, 10);
  const kicker = final ? `${info.label} · Final standings` : `${info.label} · ${editionsRun}${info.editions ? ` of ${info.editions}` : ''} editions`;
  const lead = top[0];
  const rows = top.map((p, i) => {
    const y = 56 + i * 52, pod = PODIUM[p.rank];
    const bg = pod ? `<rect x="520" y="${y}" width="616" height="44" rx="6" fill="${pod}" fill-opacity="0.13"/><rect x="520" y="${y}" width="6" height="44" rx="2" fill="${pod}"/>`
      : `<rect x="520" y="${y}" width="616" height="44" rx="6" fill="#14161a"/>`;
    return `${bg}
    <text x="560" y="${y + 33}" font-family="Barlow Condensed" font-style="italic" font-weight="800" font-size="30" text-anchor="middle" fill="${pod || '#7d828d'}">${p.rank}</text>
    <text x="596" y="${y + 31}" font-family="Barlow" font-weight="600" font-size="25" fill="#eef0ea">${esc(clip(p.name, 22))}</text>
    <text x="1000" y="${y + 30}" font-family="JetBrains Mono" font-weight="700" font-size="15" text-anchor="end" fill="#7d828d">${p.wins ? p.wins + 'W ' : ''}${p.podiums ? p.podiums + 'P' : ''}</text>
    <text x="1112" y="${y + 31}" font-family="JetBrains Mono" font-weight="700" font-size="24" text-anchor="end" fill="${pod ? pod : A}">${p.points}</text>`;
  }).join('\n');
  const empty = top.length ? '' : `<text x="828" y="330" font-family="Barlow" font-weight="600" font-size="28" text-anchor="middle" fill="#7d828d">Standings appear after the first edition</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(120 60) scale(760 520)">
      <stop offset="0" stop-color="${A}" stop-opacity="0.22"/><stop offset="1" stop-color="${A}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="lines" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M0 0V44" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/></pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="#0a0b0d"/>
  <rect width="${W}" height="${H}" fill="url(#lines)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="64" y="108" font-family="Barlow Condensed" font-style="italic" font-weight="800" font-size="58" fill="#f4f5f0">SPEED</text>
  <polygon points="236,58 340,58 326,118 222,118" fill="${A}"/>
  <text x="280" y="108" font-family="Barlow Condensed" font-style="italic" font-weight="800" font-size="58" text-anchor="middle" fill="#0a0b0d">TAS</text>
  <text x="64" y="186" font-family="JetBrains Mono" font-weight="700" font-size="19" letter-spacing="2" fill="${A}">${esc(kicker.toUpperCase())}</text>
  <text x="62" y="300" font-family="Barlow Condensed" font-style="italic" font-weight="800" font-size="124" fill="#f4f5f0">TOP 10</text>
  <text x="64" y="372" font-family="Barlow Condensed" font-style="italic" font-weight="800" font-size="66" fill="${A}">STANDINGS</text>
  ${lead ? `<text x="64" y="470" font-family="JetBrains Mono" font-weight="700" font-size="16" letter-spacing="2" fill="#7d828d">${final ? 'CHAMPION' : 'LEADER'}</text>
  <text x="64" y="512" font-family="Barlow" font-weight="600" font-size="36" fill="#ffcf3f">${esc(clip(lead.name, 18))}</text>
  <text x="64" y="546" font-family="JetBrains Mono" font-weight="700" font-size="17" fill="#c9ccd3">${lead.points} pts${ranked[1] ? ` · ${lead.points - ranked[1].points} ahead of ${esc(clip(ranked[1].name, 14))}` : ''}</text>` : ''}
  <text x="64" y="598" font-family="Barlow" font-weight="600" font-size="17" fill="#5f636e">One hour, one map, fastest tool-assisted run wins</text>
  ${rows}
  ${empty}
</svg>`;
}

/* The season the site opens on: the current one once it has results, otherwise the previous one's final table. */
export async function pickSeason() {
  const s3 = await readJson('data/s3.json', { editions: [], players: [] });
  if (s3.editions.length) {
    const info = SEASONS.s3;
    return { season: 's3', info, ranked: standings(s3, info.bestOf), editionsRun: s3.editions.length, final: info.editions && s3.editions.length >= info.editions };
  }
  const s2 = await readJson('data/s2.json', { editions: [], players: [] });
  return { season: 's2', info: SEASONS.s2, ranked: standings(s2, null), editionsRun: s2.editions.length, final: true };
}

function descriptionFor({ info, ranked, editionsRun, final }) {
  const [a, b, c] = ranked;
  if (!a) return `${info.label} standings, results, records and rivalries for SpeedTAS, the one-hour Trackmania TAS competition.`;
  const podium = [a, b, c].filter(Boolean).map((p, i) => `${['🥇', '🥈', '🥉'][i]} ${p.name} ${p.points}`).join('  ');
  return `${info.label} ${final ? 'final standings' : `after ${editionsRun} edition${editionsRun === 1 ? '' : 's'}`}: ${podium}. Full table, results, records and rivalries.`;
}

async function updateIndex(version, description) {
  const file = 'index.html';
  let html = await readFile(file, 'utf8');
  const img = `${SITE}data/og/standings.png?v=${version}`;
  const before = html;
  html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  if (html !== before) await writeFile(file, html);
  return html !== before;
}

async function main() {
  const pick = await pickSeason();
  const svg = svgFor(pick);
  await mkdir(OUT, { recursive: true });
  if (process.argv.includes('--svg')) await writeFile(`${OUT}/standings.svg`, svg);
  const version = createHash('sha1').update(svg).digest('hex').slice(0, 10);
  const { Resvg } = await import('@resvg/resvg-js');
  const fonts = ['BarlowCondensed-ExtraBoldItalic', 'BarlowCondensed-Bold', 'Barlow-SemiBold', 'JetBrainsMono-Bold'].map((f) => `scripts/fonts/${f}.ttf`);
  const png = new Resvg(svg, { font: { fontFiles: fonts, loadSystemFonts: true, defaultFontFamily: 'Barlow' } }).render().asPng();
  const prev = await readFile(`${OUT}/standings.png`).catch(() => null);
  if (!prev || !prev.equals(png)) await writeFile(`${OUT}/standings.png`, png);
  const changed = await updateIndex(version, descriptionFor(pick));
  console.log(`og image: ${pick.info.label}, ${pick.ranked.length} players, version ${version}${changed ? ' (index.html updated)' : ''}`);
}

if (!process.argv.includes('--no-run')) main().catch((err) => { console.error('og image failed (the site keeps the previous one):', err.message); process.exit(0); });
