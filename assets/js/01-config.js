    /* ============ CONFIG ============ */
    const SHEET_ID = "1g7M1IWvDlqmUkUWB6oSX-HKf7tCpAmaQK_nvNGBEppw"; // Season 2 (archive)
    const SEASON_3_SHEET_ID = "1Ylmj87seG1TF7ZRlnx8puwTFt39tAKdPF0JEpfhcTOc"; // Season 3 (current)
    const SHEET_NAME = "Editions";
    const PLAYER_SHEET_NAME = "Players"; // columns: Players, Id (the Discord ID)
    /* After deploying outputs/speedtas-api-worker.js, paste its public URL here.
       Both seasons' Editions data (via /data), Discord avatars, and videos are
       all proxied through it; its Discord and YouTube keys stay in Worker
       secrets, never here. */
    const SPEEDTAS_API_URL = "https://speedtas-api.kristianogeorgiev652.workers.dev";
    const TMNF_POINTS = {1: 10, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1};
    const TM20_POINTS = {1: 12, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1}; // top 10 score
    let POINTS = TMNF_POINTS; // swapped by setGame()

    /* ============ TM2020 SECTION ============
       TM2020 results live in their own published spreadsheet (same layout as the
       TMNF "Editions" tab). Discord IDs / avatars still come from the existing
       Players tab, so profile pictures are shared between both games.
       TM20_EDITIONS_GID: open the TM2020 sheet on its Editions tab and copy the number after
       "gid=" in the address bar. Leave '' only if Editions is the FIRST tab of the sheet. */
    const TM20_CSV_BASE = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRDvd1q6-1ze91Uv30Lm4nOjkx9Q-r2ceqkSetJIeILpYzBfRKlwU-wT6GhJ2Xh_b3XLLIYMrsBb1m_/pub";
    const TM20_EDITIONS_GID = "";
    let GAME = 'tmnf', ROUTE_GAME = 'tmnf';
    const DATA = {tmnf: null, tm20: null};
    /* ============ SEASONS ============
       RAW always holds the CURRENT season of the active game: Season 3 for TMNF, the TM2020 data for TM2020.
       Earlier TMNF seasons are archives, loaded on demand (loadSeason1 / loadSeason2).
       bestOf: only that many of a player's best results count towards the championship (null = all count).
       Seasons 1 and 2 count every result, exactly as they always have. */
    const CURRENT_TMNF_SEASON = 's3';
    const SEASON_INFO = {
      s1: {label: 'Season 1', short: 'S1', bestOf: null},
      s2: {label: 'Season 2', short: 'S2', bestOf: null},
      s3: {label: 'Season 3', short: 'S3', bestOf: 9, editions: 12, start: '2027-02-06'}
    };
    const TMNF_SEASON_ORDER = ['s3', 's2', 's1']; // newest first, as shown in the season pickers
    /* Saturdays without a points edition (mid-season and off-season breaks), Lisbon dates. */
    const SCHEDULE_BREAKS = ['2027-03-20', '2027-05-08', '2027-05-15', '2027-05-22', '2027-05-29', '2027-07-17', '2027-09-04', '2027-09-11', '2027-09-18', '2027-11-06', '2027-12-25', '2028-01-01', '2028-01-08', '2028-01-15', '2028-01-22'];
    const EDITION_HOUR_LISBON = 18;
    /* Season pickers change the address (#/history/s1), so a shared link, Back and refresh keep the chosen season. */
    const routeHash = path => (GAME === 'tm20' ? '#/tm20' : '#') + path;
    function goSeason(path) {location.hash = routeHash(path);}
    const seasonArg = (k, extra = []) => (isSeasonKey(k) || extra.includes(k)) ? k : undefined; // undefined = the page's default season
    const curKey = () => GAME === 'tm20' ? 's2' : CURRENT_TMNF_SEASON; // TM2020 keeps its existing #/tm20/.../s2/... links
    const isSeasonKey = k => k === 's1' || k === 's2' || k === 's3';
    /* Off-season: until the current TMNF season has its first result, pages open on the
       previous season (Season 2) instead of an empty one. Switches back automatically. */
    const ARCHIVE_DEFAULT = 's2';
    const isOffSeason = () => GAME === 'tmnf' && !!RAW && !RAW.editions.length;
    const viewKey = () => isOffSeason() ? ARCHIVE_DEFAULT : curKey();
    const S2L = () => GAME === 'tm20' ? 'TM2020' : SEASON_INFO[CURRENT_TMNF_SEASON].label; // label of the "current" data set
    function labelFor(key) {
      if (key === curKey()) return S2L();
      if (key === 'both' || key === 'all') return 'All seasons';
      return SEASON_INFO[key] ? SEASON_INFO[key].label : S2L();
    }
    /* Picker options: current season first, then the archives, then an optional combined view. */
    function seasonOptions(combinedKey, combinedLabel = 'All seasons') {
      if (GAME === 'tm20') return [[curKey(), S2L()]];
      const opts = TMNF_SEASON_ORDER.map(k => [k, SEASON_INFO[k].label]);
      return combinedKey ? opts.concat([[combinedKey, combinedLabel]]) : opts;
    }

    /* Last-resort snapshot of the real sheet — used only if BOTH the Worker's
       cached /data endpoint and a direct browser connection to Google Sheets
       fail. This is NOT kept in sync automatically — use "Retry Live
       Connection" or the manual paste/upload option to pull fresh data. */
    const FALLBACK_CSV_TEXT = `👥: 40,Vogtek,Sneak,Charlie,Magon,Exix,C4ster,Leva,Elliot,Galaxy,Skycrafter,Mufat,Lucy,Fabi,QQ,DeleteC,Crayhax,Thoman,Bedeux,Rio,IgntuL,Frusty,Oogy,NaiCou,Salty,Midnight,oeN,wasgud,Faiby,Caleb,Comfy,Kim,Qwerter,LilDemo,Timefall,Felipe,Meable,Viron,Infra,Adrien,7-n,Magnus,	casterjamar,Telve,Tizzan,Tejas,MigthBeJoe,Kram
1,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
2,4,10,2,9,,8,6,,,3,,,,7,,,1,5,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
3,4,12,8,,11,6,,10,,1,2,13,,9,,,3,,5,7,,,,,,,,,,,,,,,,,,,,,,,,,,,
4,5,,4,6,,,,9,,1,2,,8,7,,,3,10,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
5,3,6,,,5,,,,,1,4,,10,9,,,2,,,,7,8,,,,,,,,,,,,,,,,,,,,,,,,,
6,2,4,3,,,,,,,,1,,6,5,,,,7,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
7,5,3,7,,8,6,,9,,2,,,11,,,4,1,,,,,12,10,,,,,,,,,,,,,,,,,,,,,,,,
8,,4,,,,5,,,,3,,8,,9,,6,1,,2,,,,,,,,,,,,,,,,,,,,,,,,,,,,
9,,1,,,,4,,,,,,,,,,5,3,,6,,,2,7,,,,,,,,,,,,,,,,,,,,,,,,
10,,6,,4,,,,,,,,,,7,,,5,3,2,1,,,,,,,,,,,,,,,,,,,,,,,,,,,
11,,3,,,,,,6,,,,,5,7,,4,,,,1,,2,,,,,,,,,,,,,,,,,,,,,,,,,
12,,2,,,,,,,,,3,,,8,,,4,,1,,,10,,5,6,7,9,,,,,,,,,,,,,,,,,,,,
13,,1,,,,,,,,,,,4,3,,,,,2,,,,,,,,,,,,,,,,,,,,,,,,,,,,
14,,9,,,,,,,,,,,,8,,,3,,10,1,,11,2,,7,,,4,5,6,12,,,,,,,,,,,,,,,,
15,,7,,,,,,,,,,11,15,10,,,,2,1,4,,5,13,,8,,,,,3,11,9,6,14,,,,,,,,,,,,,
16,9,3,,,13,,,,,4,,,,,,5,8,,2,1,,,,,,,,,,,12,6,,,14,10,7,11,,,,,,,,,
17,,4,,,,,,,,,,,5,11,,,3,,1,,,,9,,10,,,,2,,6,,8,,,,,,7,,,,,,,,
18,3,9,,,,,,,,,,,,11,,,2,,8,1,,,10,,4,,,,5,6,13,,7,,,,12,,,14,,,,,,,
19,1,5,,,,,,,,2,,,4,,,,3,,,,,,,,,,,,6,,7,,,,,,,,,8,,,,,,,
20,,6,,,,,,,,,3,,,8,,,1,,7,2,,,,,,,,,11,5,9,,4,,,,,,,10,,,,,,,
21,,4,,,,,,,,1,,,8,,,,,,2,3,,6,,,5,,,,,,,,,,,,,,,7,,,,,,,
22,,9,,,,,,,,3,,,8,7,10,,,,1,2,,4,11,,6,,,,,,,,,,,,,,,12,5,,,,,,
23,,6,,,4,,,,,,,,,7,,,,,,1,,3,,,12,,,,,,5,,2,,,,,,,10,,11,9,8,,,
24,,4,,,,,,,,,,,,,,,1,,,,,6,,,9,,,,3,,2,,,,,,,,,10,,,8,7,5,11,
25,,1,,,,,,,,,,,,,,,,,3,,,4,,,2,,,,5,,6,,,,,,,,,8,,,,,7,,9`;
    const pointsFor = p => POINTS[p] ?? 0;

    /* ============ STATE ============ */
    const main = document.getElementById('app'); // every page renders into this
    let RAW = null;        // { editions: [...], players: [...] }
    let STATE = {players: {}, editions: []};
    let sortState = {key: 'points', dir: 'desc'};
    let leaderboardFilter = 'all'; // all | 10 | 25
    let DISCORD_IDS = {}, DISCORD_AVATARS = {};

    /* Season 1 is embedded so Season 1 / Both views (records, rivalries, head-to-head, profiles) remain usable
       even when the published Google Sheet is unavailable. */
    const SEASON_1_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2PVKpC2mV_UWnXg6ouoPooQ6lgJlPLNIen11GniPy0q3m40b9CL_VTyhWP0V2cGEMItY7c75LLjZH/pub?output=csv';
    /* Full Season 1 snapshot, compressed for a one-file dashboard fallback —
       only used if both the Worker's cached /data endpoint and the direct
       published-CSV fetch above fail. Refresh the snapshot on a major
       correction by replacing this value with a fresh gzip+base64 export. */
    const SEASON_1_SNAPSHOT_GZIP = 'H4sIAAAAAAAACp1XS3LjNhDdowp3yAHewvyAkrKz5c/MOFOpZFzepiAZkliiSQ1IjqVj5ARZ5X45QqoBgqRMUiYHG1sS+/Xr1z/iv3/+/vfXX0SEp132KlN8LTeywK16zZDKeJmVyNUq3uNeyvx7GRf4tj+ttdwUSuNel3lxwnO2LdQeTzJOcmSr1WkVbzcyL/Bbts3KAg8ykccTljupk1jhNtMS34oyLZLsh9L4KrdZioPOXuIYB1Uo/dcmThQedbZNCfjmdi0PyA9qXSZS4yFLXlT6+1uCm0T9wFJ6aoXP6UbpNMO9XMX4vE2LMsEneTicCD4tc9wdJZa7eL1XKb7k8oAbmcr0MU63eNRxXsQyzfCo5SvukjgrcJ0fdjIp8Kw0/ZjgjzelKehnqZJTqnCflJvNCX/GGZZZXqwzPD3ssrzAo9zvlcbdy1a9ZbrAtd6rHPcyXp3wqfyudIG7Y3zEjXpR5RHXryutTuSnUEcstTzt5BFLmRdKc+bDg48AIQQizDDHxMNZAB8IyVIgQAQPMyzgXU1DCemPD8CbygCcCQh4iOhDYFEQTgKIQFEIwIAYCuEkNTibWeekggXwp3DgrPL1MxJwtgAMWdIfiyoIkxYxGqPOmE/GJpTI6CgwGwtRMacCgGfiN8kQBBWMkpMzz5iYM10IL3AMvCoDcwR1YkdihC5z5L9mE4y2rzUPQf1lBZgC0HD1rCmRmFmAcEQknHlNyqpc2p5otP3Afl6JH7qOsl4nlBPVZDtqwnMd8SENzvyrbgDje4ozvy4e808w2b7mGNpewoQckj09arzRZKry2KRxFETYDKNGMjunxgEIF6/paXfGE6CuddOscz6SkjPftKE1px0z7XDmuyoUJnMN75HNzJm/aPWyq4EJDIKr2oBWjGPQZIDWxAcQtZkTgGJqWc1NSiOamcMgjjXp0DMWiVBwQRfOAsfdWfvnlXA5O5wFZsVXAHYeOccNwiUKhEEattwjMvYtLQIDM7woOAuomaq95Jb9hMNZMHNG3lDolZpDAPPWoh7upQFBOQsWznPbeGQgnIVX5lk7G/pGQZ2Bfm6chV6ThqCHwEelEPpjWLfG9jtz871lMD19oa3/qnqnz5SwVYMXrGlg9dvX9XfGfvRMDWctDz2d3HCimdCLQAPDdU0PQosKzf8uCGehmzVnFdyE07YRfUOOM2HLEPAojBkiy7yjg6tQ83rp+fBojizgXhVruLomfQLpZqZ1oTDsFmZKzM46gDPhYohcOIR01iXO8UB+hfneDDLv4gv0QOlyJpq3nPpa8u4EXe8thTkTwuHbG1XnmPFXnfkARtSi2I2iBdq7BTgTtbhGiOFjbh0Nh9orZ8Jx60Gw6avP4rxW6D5WoXIm6MezmRkN5eFsrzbp4yzqXkgdiNcRyGHWNxiD4A3eSPwObtjW1YJzFg2Ouw5udzVwFgWjzZ3Y1e3BZoizaPgKcOmuVQXDWSSm3M2CMzY+BGdR1HoN64NoquTdyLGDbE4kZu6x9v7vn5ZUZF7nfYKzaN7aQDVPctntFGP9DjzE/w/aglbZEgAA';
    let SEASON_1 = null, season1Promise = null;
    async function loadSeason1Snapshot() {
      const bytes = Uint8Array.from(atob(SEASON_1_SNAPSHOT_GZIP), c => c.charCodeAt(0));
      if (!window.DecompressionStream) throw new Error('Season 1 live data could not be reached, and this browser cannot read its saved snapshot.');
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return parseDelimitedText(await new Response(stream).text());
    }
    function loadSeason1() {
      if (SEASON_1) return Promise.resolve(SEASON_1);
      if (!season1Promise) {
        const proxyUrl = (SPEEDTAS_API_URL || '').replace(/\/+$/, '');
        const viaWorker = () => proxyUrl
          ? fetch(proxyUrl + '/data?season=s1').then(async r => {
              if (!r.ok) {
                let msg = `Worker responded with ${r.status}`;
                try {const errBody = await r.json(); if (errBody && errBody.error) msg = errBody.error;} catch (e) {}
                throw new Error(msg);
              }
              const payload = await r.json();
              return {editions: payload.editions, players: payload.players};
            })
          : Promise.reject(new Error('No SPEEDTAS_API_URL configured.'));

        /* Repo file first: same server as the page and kept fresh by the GitHub Action. */
        season1Promise = fetchRepoData('s1')
          .catch(err => {
            console.warn('Season 1 repo data file unavailable; trying the Worker.', err);
            return viaWorker().catch(err2 => {
              console.warn('Season 1 via Worker failed; trying direct sheet fetch.', err2);
              return fetch(SEASON_1_CSV_URL)
                .then(r => {if (!r.ok) throw new Error('Season 1 sheet could not be reached.'); return r.text();})
                .then(text => parseDelimitedText(text));
            });
          })
          .then(data => SEASON_1 = data)
          .catch(async err => {console.warn('Season 1 live fetch failed; using saved snapshot.', err); return SEASON_1 = await loadSeason1Snapshot();});
      }
      return season1Promise;
    }

