# SpeedTAS — notes for Claude

Trackmania TAS competition stats site (players get one hour to TAS a map). Vanilla HTML/CSS/JS on GitHub Pages,
no build step: https://kristiano55.github.io/SpeedTAS-Testing/ · repo Kristiano55/SpeedTAS-Testing.

## Find things fast
- **Read `docs/project-map.md` first.** It lists every part, file, line range and function (generated from the
  code, always current). Open only the lines you need; don't read or grep whole files to orient yourself.
- Website: `index.html`, `assets/site.css`, `assets/js/01-…12-*.js` (classic scripts, one shared global scope,
  load order matters only for code that runs at load). Data robot: `scripts/update-data.mjs` (run order + CLI)
  with parts in `scripts/lib/`. Link previews: `scripts/share-pages.mjs`, `scripts/og-image.mjs`.

## Commands
- `npm run setup` once per session (playwright + axe-core + chromium; nothing is committed).
- `npm run check` after any change: stamps assets, rebuilds the map, self-test, full site check. CI fails if
  `index.html` stamps or `docs/project-map.md` are stale, so commit both with the change.
- `npm run sim` site check with Season 3 sample data (`data/fixtures/s3-sample.json`).
- `npm test` offline parser self-test. `node scripts/update-data.mjs --probe-tm20 <event> <replay>` / `--probe-maps`.
- Locally set `CHROME_PATH=/usr/bin/google-chrome` if playwright's own browser isn't installed.

## Rules
- Never change results, points, ranking, tie-breaks, name aliases, season boundaries or historical data unless
  Kristiano asks explicitly. Keep TMNF and TM2020 data, selectors and themes separate.
- No frameworks or new site dependencies. Escape every sheet value and player name. No secrets in the repo.
- Keep every route and feature working (home, players, profiles, history, editions, maps, records, rivalries,
  versus, videos, #/tm20, Copy link, results post, inputs, share pages).
- When done and `npm run check` passes: commit and push straight to `main` (Kristiano's standing instruction),
  then say what changed and what was tested. End commit messages with the Co-Authored-By line.
- New function in a new file or section? Add it to `scripts/project-map.json`, or the map check fails.

## Facts that are easy to get wrong
- TAS Exchange numbers TMNF and TM2020 replays separately; its replayData API only knows TMNF. TM2020 inputs come
  from `/events/<event>/replays/<replay>/download` (see `docs/project-map.md` → Inputs).
- Event titles must look like "SpeedTAS S3 #4" / "SpeedTAS Season 3 #4"; S3 maps "SpeedTAS 3 #4" on TMX.
- Season 2 ends with #45 (28 Nov 2026, counts for points). S2 "Edition 100" is a deliberate special. Season 3:
  best 9 of 12, starts 6 Feb 2027 (dates and breaks in `assets/js/01-config.js`).
- Data commits come from `speedtas-bot` (update-data.yml: Saturday every 30 min 17:17–21:47 UTC, Sunday,
  Wednesday). Problems open a GitHub issue labelled `data-update`; the next clean run closes it.

## Working from Claude's workspace
- tmtas.exchange, tmnf.exchange and github.io are usually unreachable from the workspace shell. Test
  network-dependent changes on a branch: push it, `gh workflow run update-data.yml --ref <branch>`, read the log.
  Branch runs commit to the branch and never open issues. Branches can't be deleted from here; tell Kristiano.
- Decisions, postmortems and the improvement log live in the Claude project docs ("SpeedTAS Season 3").
