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
| `assets/js/01-config.js` … `10-boot.js` | The app, split by section and loaded in this order (they share one global scope) |
| `data/` | Results, events, maps, videos, avatars, map thumbnails and the preview image, written by the data Action |
| `scripts/update-data.mjs` | The data Action: Google Sheets, TAS Exchange, TMX, YouTube, Discord avatars |
| `scripts/og-image.mjs` | Draws `data/og/standings.png` (top 10) for Discord/X link previews |
| `scripts/stamp-assets.mjs` | Adds `?v=<hash>` to every asset link in `index.html` |
| `scripts/site-check.mjs` | Opens every page on desktop and phone and fails on errors (run on every push by `site-check.yml`) |

## Editing

- After changing anything in `assets/`, run `node scripts/stamp-assets.mjs` so browsers fetch the new files
  (the data Action also runs it).
- The script files run in order. Code that runs immediately at load must only use things from the same or an
  earlier file; inside functions and event handlers anything can be used.
- Every push runs the Site check workflow; a red ✗ on the commit means something broke (GitHub emails you).
  Run it by hand: `npm install --no-save playwright && npx playwright install chromium && node scripts/site-check.mjs`
- The data Action (`.github/workflows/update-data.yml`) runs on Saturday and Sunday after each edition, or by hand
  from the Actions tab ("Run workflow").
