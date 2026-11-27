# SpeedTAS stats site

Standings, results, records and rivalries for SpeedTAS, the one-hour Trackmania TAS competition.
Two copies: **SpeedTAS** is the live site, **SpeedTAS-Testing** (https://kristiano55.github.io/SpeedTAS-Testing/) is the test copy
where changes are tried first. GitHub Pages, plain HTML/CSS/JS, no build step. Nothing in the code is tied to one of them.

## Files

| Path | What it is |
|---|---|
| `index.html` | The page shell: header, link-preview tags, and the list of styles/scripts |
| `assets/site.css` | All styles, starting with the self-hosted fonts |
| `assets/fonts/` | Barlow, Barlow Condensed, JetBrains Mono (OFL, latin + latin-ext); never renamed, so not version-stamped |
| `assets/vendor/` | Chart.js 4.4.0 (MIT), served from this site so the charts don't depend on a CDN |
| `assets/js/` | The app, split by section and loaded in this order (they share one global scope): |
| &nbsp;&nbsp;`01-config.js` | Sheet IDs, points, seasons and schedule, shared state, the `main` element |
| &nbsp;&nbsp;`02-names.js` | `escapeHtml` and player identity (aliases, spelling matches, Discord IDs, cross-season rows) |
| &nbsp;&nbsp;`03-sources.js` | TM2020 data, TAS Exchange events and times, maps, edition videos, the Discord results post |
| &nbsp;&nbsp;`04-season-data.js` | Champions, the shareable season card, game/season themes, sheet loading, avatars |
| &nbsp;&nbsp;`05-stats.js` | Standings and player stats (`computeAll`, best-of scoring), custom profile pictures |
| &nbsp;&nbsp;`06-view-helpers.js` | Small shared bits of HTML (form chips, avatars, season pickers), avatar modal, colours |
| &nbsp;&nbsp;`07-home.js` | Standings page, countdown, who-can-still-win, live Saturday banner |
| &nbsp;&nbsp;`08-charts-pages.js` | Charts, players, profiles, history, edition pages, Head2Head |
| &nbsp;&nbsp;`09-records.js` | Records and rivalries |
| &nbsp;&nbsp;`10-videos.js` | Videos page (Worker → YouTube feed → saved `data/videos.json`) |
| &nbsp;&nbsp;`11-router.js` | Reading the address, the phone menu, picking the page to draw |
| &nbsp;&nbsp;`12-boot.js` | Search, refresh, status banner, manual import, start-up, tab titles |
| `data/` | Results, events, maps, videos, avatars, map thumbnails and the preview image, written by the data Action |
| `scripts/update-data.mjs` | The data Action: Google Sheets, TAS Exchange, TMX, YouTube, Discord avatars |
| `scripts/og-image.mjs` | Draws `data/og/standings.png` (top 10) for Discord/X link previews |
| `scripts/stamp-assets.mjs` | Adds `?v=<hash>` to every asset link in `index.html` |
| `scripts/site-check.mjs` | Opens every page on desktop and phone and fails on errors (run on every push by `site-check.yml`) |

## Editing

- After changing anything in `assets/`, run `node scripts/stamp-assets.mjs` so browsers fetch the new files
  (the data Action also runs it).
- The script files run in order. Code that runs immediately at load must only use things from the same or an
  earlier file; inside functions and event handlers anything can be used. Adding a file: add it to `index.html`
  in the right place and to the table above.
- Colours live in the CSS variables at the top of `assets/site.css`; the charts read them from there too.
- Every outside service is optional: the site must still work (with a note) when the Worker, Google Sheets,
  YouTube, Discord or TAS Exchange is down. The site check blocks all of them to make sure.
- Every push runs the Site check workflow; a red ✗ on the commit means something broke (GitHub emails you).
  Run it by hand: `npm install --no-save playwright && npx playwright install chromium && node scripts/site-check.mjs`
- The data Action (`.github/workflows/update-data.yml`) runs on Saturday and Sunday after each edition, or by hand
  from the Actions tab ("Run workflow").
