    /* ============ CHAMPIONS ============
       Champion = the leader once nobody can catch them any more; runner-up = second place once that is safe too.
       A finished season is decided by its final table. For the current season every other player (and anyone
       who hasn't raced yet) gets their best possible finish: a win in every edition that's left, counted with
       the same best-of rule. Points never go down under best-of, so the leader's current total is safe. */
    function seasonOutcome(seasonKey, data) {
      if (GAME === 'tm20' || !SEASON_INFO[seasonKey] || !data) return null;
      const {ranked} = computeAll(data);
      if (ranked.length < 2) return null;
      const info = SEASON_INFO[seasonKey];
      const left = seasonKey === CURRENT_TMNF_SEASON && info.editions ? Math.max(0, info.editions - data.editions.length) : 0;
      if (!left) return {champion: ranked[0].name, runnerUp: ranked[1].name, final: true};
      const n = info.bestOf || info.editions, top = pointsFor(1);
      const best = pts => [...pts].sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
      const ceiling = pl => best([...pl.history.map(h => h.points), ...Array(left).fill(top)]);
      const newcomer = best(Array(left).fill(top));
      const [a, b, ...rest] = ranked;
      if (!(a.points > Math.max(ceiling(b), newcomer, ...rest.map(ceiling)))) return null;
      const runnerSafe = b.points > Math.max(newcomer, ...rest.map(ceiling));
      return {champion: a.name, runnerUp: runnerSafe ? b.name : null, final: false};
    }
    const honorOf = (outcome, name) => !outcome ? null : outcome.champion === name ? 'champion' : outcome.runnerUp === name ? 'runner' : null;
    function honorCard(seasonKey, data, name) {
      const pl = computeAll(data).players[name];
      if (!pl) return;
      const honor = honorOf(seasonOutcome(seasonKey, data), name);
      openSeasonCard(pl, labelFor(seasonKey), honor === 'champion' ? 'P1' : 'P2', seasonKey, honor);
    }
    function honorsHTML(seasonKey, outcome) {
      if (!outcome) return '';
      const E = escapeHtml, label = E(labelFor(seasonKey));
      const one = (kind, name) => name ? `<div class="honor honor-${kind}"><span class="honor-icon" aria-hidden="true">${kind === 'champion' ? '🏆' : '🥈'}</span>
        <div><div class="panel-label">${label} ${kind === 'champion' ? 'champion' : 'runner-up'}${outcome.final ? '' : ' · decided'}</div><a href="#/player/${seasonKey}/${enc(name)}"><b>${E(name)}</b></a></div>
        <button type="button" class="btn" data-honor-card="${E(name)}">${kind === 'champion' ? 'Champion' : 'Runner-up'} card</button></div>` : '';
      return `<div class="honors">${one('champion', outcome.champion)}${one('runner', outcome.runnerUp)}</div>`;
    }
    function bindHonors(seasonKey, data) {
      main.querySelectorAll('[data-honor-card]').forEach(btn => btn.addEventListener('click', () => honorCard(seasonKey, data, btn.dataset.honorCard)));
    }

    /* ============ SEASON CARD (shareable image) ============ */
    function loadImage(src) {
      return new Promise((resolve, reject) => {const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = reject; img.src = src;});
    }
    /* Each season keeps its own colour on the card: Seasons 1-2 lime, Season 3 purple, TM2020 cyan. */
    const SEASON_COLORS = {s1: '#e9fb59', s2: '#e9fb59', s3: '#b388ff', tm20: '#59d6fb'};
    const cardColor = key => GAME === 'tm20' ? SEASON_COLORS.tm20 : (SEASON_COLORS[key] || accentHex());
    function roundRect(g, x, y, w, h, r) {g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();}
    async function drawSeasonCard(p, seasonText, rankText, color, allowPhoto = true, honor = null) {
      const honorColor = honor === 'champion' ? '#ffcf3f' : honor === 'runner' ? '#c9ccd6' : color;
      await (document.fonts ? document.fonts.ready : Promise.resolve());
      const W = 1200, H = 630, c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d'), css = getComputedStyle(document.body);
      const display = (css.getPropertyValue('--font-display') || 'sans-serif').trim(), body = (css.getPropertyValue('--font-body') || 'sans-serif').trim(), mono = (css.getPropertyValue('--font-mono') || 'monospace').trim();
      const ink = '#0a0b0d', text = '#eef0ea', muted = '#9aa09a';
      // background: dark, a soft glow in the season colour, faint speed lines
      g.fillStyle = ink; g.fillRect(0, 0, W, H);
      const glow = g.createRadialGradient(W * 0.85, -40, 20, W * 0.85, -40, 760);
      glow.addColorStop(0, honorColor + '55'); glow.addColorStop(1, honorColor + '00');
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      g.save(); g.globalAlpha = 0.06; g.strokeStyle = color; g.lineWidth = 2;
      for (let x = -H; x < W; x += 46) {g.beginPath(); g.moveTo(x, H); g.lineTo(x + H * 0.55, 0); g.stroke();}
      g.restore();
      g.fillStyle = color; g.fillRect(0, 0, W, 8);
      if (honor) { // big faint trophy / medal behind the name
        g.save(); g.globalAlpha = 0.13; g.font = `330px ${body}`; g.textAlign = 'right'; g.fillText(honor === 'champion' ? '🏆' : '🥈', W - 30, 420); g.restore();
      }
      // logo: big "SPEED" + "TAS" in a slanted season-coloured block, like the site header
      g.font = `italic 900 64px ${display}`; g.textBaseline = 'alphabetic';
      g.fillStyle = text; g.fillText('SPEED', 64, 110);
      const sw = g.measureText('SPEED').width, tw = g.measureText('TAS').width, bx = 64 + sw + 12;
      g.save(); g.fillStyle = color; g.beginPath(); g.moveTo(bx + 14, 52); g.lineTo(bx + tw + 30, 52); g.lineTo(bx + tw + 16, 124); g.lineTo(bx, 124); g.closePath(); g.fill(); g.restore();
      g.fillStyle = ink; g.fillText('TAS', bx + 12, 110);
      // season pill, top right
      g.font = `700 22px ${mono}`;
      const pill = seasonText.toUpperCase(), pw = g.measureText(pill).width + 40;
      roundRect(g, W - 64 - pw, 66, pw, 46, 23); g.strokeStyle = color; g.lineWidth = 2; g.stroke();
      g.fillStyle = color; g.textAlign = 'center'; g.fillText(pill, W - 64 - pw / 2, 97); g.textAlign = 'left';
      // avatar with a season-coloured ring
      const ax = 64, ay = 178, ar = 96;
      g.beginPath(); g.arc(ax + ar, ay + ar, ar + 7, 0, Math.PI * 2); g.fillStyle = honorColor; g.fill();
      g.save(); g.beginPath(); g.arc(ax + ar, ay + ar, ar, 0, Math.PI * 2); g.clip();
      let drewPhoto = false;
      const photo = getAvatarOverride(p.name);
      if (photo && allowPhoto) {try {const img = await loadImage(photo); g.drawImage(img, ax, ay, ar * 2, ar * 2); drewPhoto = true;} catch (e) {}}
      if (!drewPhoto) {g.fillStyle = colorForName(p.name); g.fillRect(ax, ay, ar * 2, ar * 2); g.fillStyle = ink; g.font = `900 72px ${display}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(initials(p.name), ax + ar, ay + ar + 4); g.textAlign = 'left'; g.textBaseline = 'alphabetic';}
      g.restore();
      // name + rank
      g.fillStyle = text; g.font = `italic 900 88px ${display}`;
      let name = p.name; while (g.measureText(name).width > 820 && name.length > 3) name = name.slice(0, -2) + '…';
      g.fillText(name, 290, 268);
      if (honor) {g.fillStyle = honorColor; g.font = `italic 900 40px ${display}`; g.fillText(`${honor === 'champion' ? '🏆' : '🥈'} ${seasonText} ${honor === 'champion' ? 'Champion' : 'Runner-up'}`.toUpperCase(), 292, 324);}
      else if (rankText) {g.fillStyle = color; g.font = `800 34px ${display}`; g.fillText(rankText, 292, 320);}
      // stat tiles
      const stats = [['Points', p.points], ['Wins', p.wins], ['Podiums', p.podiums], ['Editions', p.played], ['Best', 'P' + p.best], ['Avg place', p.avgPlacement.toFixed(1)]];
      const tileW = (W - 128 - 5 * 16) / 6, ty = 420, th = 120;
      stats.forEach(([k, v], i) => {
        const x = 64 + i * (tileW + 16);
        roundRect(g, x, ty, tileW, th, 14); g.fillStyle = 'rgba(255,255,255,0.045)'; g.fill();
        g.strokeStyle = i === 0 ? honorColor : 'rgba(255,255,255,0.08)'; g.lineWidth = i === 0 ? 2 : 1; g.stroke();
        g.fillStyle = i === 0 ? honorColor : text; g.font = `900 50px ${display}`; g.fillText(String(v), x + 20, ty + 66);
        g.fillStyle = muted; g.font = `700 16px ${mono}`; g.fillText(k.toUpperCase(), x + 20, ty + 98);
      });
      // footer
      g.fillStyle = '#6b706b'; g.font = `500 19px ${body}`;
      g.fillText(location.host + location.pathname.replace(/index\.html$/, ''), 64, H - 36);
      g.textAlign = 'right'; g.fillText('One hour · one map · fastest TAS wins', W - 64, H - 36); g.textAlign = 'left';
      return c;
    }
    async function openSeasonCard(p, seasonText, rankText, seasonKey, honor = null) {
      const color = cardColor(seasonKey);
      closeInputs();
      const E = escapeHtml, o = document.createElement('div');
      o.className = 'inputs-overlay';
      o.innerHTML = `<div class="inputs-panel card-panel" role="dialog" aria-modal="true" aria-label="Season card">
        <div class="inputs-head"><div><div class="panel-label">Share</div><b>${E(p.name)} · ${E(seasonText)}</b></div><button type="button" class="run-btn" data-close-inputs aria-label="Close">✕</button></div>
        <div class="inputs-body"><div class="loader"><div class="spinner"></div> Drawing the card…</div></div></div>`;
      document.body.appendChild(o);
      let canvas = await drawSeasonCard(p, seasonText, rankText, color, true, honor);
      const body = o.querySelector('.inputs-body');
      if (!body) return;
      let url;
      try {url = canvas.toDataURL('image/png');} catch (e) { // the picture's host doesn't allow reuse: draw initials instead
        canvas = await drawSeasonCard(p, seasonText, rankText, color, false, honor);
        try {url = canvas.toDataURL('image/png');} catch (e2) {url = null;}
      }
      if (!url) {body.innerHTML = '<p class="inputs-note">This browser could not create the image.</p>'; return;}
      const file = `SpeedTAS ${seasonText}${honor === 'champion' ? ' Champion' : honor === 'runner' ? ' Runner-up' : ''} - ${p.name}.png`;
      body.innerHTML = `<img class="card-preview" src="${url}" alt="Season card for ${E(p.name)}">
        <div class="inputs-tools"><a class="btn" download="${E(file)}" href="${url}">Download PNG</a>${window.ClipboardItem ? '<button type="button" class="btn" data-copy-img>Copy image</button>' : ''}</div>`;
      const copyBtn = body.querySelector('[data-copy-img]');
      if (copyBtn) copyBtn.addEventListener('click', () => canvas.toBlob(blob => navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(() => {copyBtn.textContent = 'Copied';}, () => {copyBtn.textContent = 'Copy failed';})));
    }

    /* ============ LOCAL TIME ============ */
    /* " · 21:00 your time" when the visitor's clock differs from Lisbon; adds the day when that differs too. */
    function yourTime(date) {
      const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!here || here === 'Europe/Lisbon') return '';
      const fmt = (tz, opts) => new Intl.DateTimeFormat('en-GB', {timeZone: tz, ...opts}).format(date);
      const hm = {hour: '2-digit', minute: '2-digit', hour12: false};
      if (fmt(here, hm) === fmt('Europe/Lisbon', hm)) return '';
      const sameDay = fmt(here, {weekday: 'short'}) === fmt('Europe/Lisbon', {weekday: 'short'});
      return ` · ${sameDay ? '' : fmt(here, {weekday: 'short'}) + ' '}${fmt(here, hm)} your time`;
    }

    /* ============ SEASON THEME ============
       TMNF pages take the colour of the season being viewed (S1/S2 lime, S3 purple). All-time and
       comparison views keep the current season's colour. */
    function setSeasonTheme(key) {
      document.body.classList.toggle('season-legacy', GAME === 'tmnf' && (key === 's1' || key === 's2'));
    }

    /* ============ GAME CONTEXT ============ */
    function applyTheme(g) {
      document.body.classList.toggle('game-tm20', g === 'tm20');
      document.title = g === 'tm20' ? 'SpeedTAS Stats · TM2020' : 'SpeedTAS Stats';
      document.querySelectorAll('#gameSwitch a').forEach(a => a.classList.toggle('active', a.dataset.game === g));
      document.querySelectorAll('#nav a[data-route]').forEach(a => {
        const r = a.dataset.route;
        a.setAttribute('href', g === 'tm20' ? '#/tm20' + (r === '/' ? '' : r) : '#' + r);
      });
    }
    function setGame(g) {
      if (g !== GAME) {
        if (GAME === 'tmnf') DATA.tmnf = RAW; // RAW always holds the active game's data
        GAME = g;
        RAW = g === 'tm20' ? DATA.tm20 : DATA.tmnf;
      }
      POINTS = g === 'tm20' ? TM20_POINTS : TMNF_POINTS;
      applyTheme(g);
    }
    /* In TM2020 mode every in-app link gets the #/tm20 prefix (also for content that renders later). */
    function prefixLinks(root) {
      if (GAME !== 'tm20') return;
      root.querySelectorAll('a[href^="#/"]').forEach(a => {
        const h = a.getAttribute('href');
        if (h === '#/tm20' || h.startsWith('#/tm20/')) return;
        a.setAttribute('href', '#/tm20' + (h === '#/' ? '' : h.slice(1)));
      });
    }

    /* ============ JSONP LOADER (avoids CORS entirely) ============
       fetch() to Google's gviz endpoint gets blocked by browsers because
       Google doesn't reliably send Access-Control-Allow-Origin headers.
       The Visualization API has a built-in JSONP callback mode
       (tqx=responseHandler:NAME) designed exactly for this: it's loaded
       via a <script> tag, which is never subject to CORS restrictions. */
    let jsonpCounter = 0;
    function fetchViaJSONP(sheetName, timeoutMs = 12000) {
      return new Promise((resolve, reject) => {
        const callbackName = `__gsheetCb_${Date.now()}_${jsonpCounter++}`;
        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?` +
          `tqx=responseHandler:${callbackName}&headers=1&sheet=${encodeURIComponent(sheetName)}`;

        let settled = false;
        const script = document.createElement('script');

        function cleanup() {
          delete window[callbackName];
          script.remove();
          clearTimeout(timer);
        }

        window[callbackName] = function (response) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(response);
        };

        script.onerror = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('Could not reach Google Sheets (network/script load error).'));
        };

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('Timed out waiting for Google Sheets response.'));
        }, timeoutMs);

        script.src = url;
        document.body.appendChild(script);
      });
    }

    function buildDatasetFromGrid(grid) {
      if (!grid || grid.length < 2) throw new Error('The sheet data appears to be empty.');
      const header = grid[0].map(v => String(v == null ? '' : v).trim());
      const playerNames = header.slice(1).filter(n => n.length);

      const editions = [];
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        const editionRaw = row[0];
        if (editionRaw === '' || editionRaw === undefined || editionRaw === null) continue;
        const editionNum = String(editionRaw).trim();
        if (!editionNum) continue;
        const results = {};
        for (let c = 1; c < header.length; c++) {
          const name = header[c];
          if (!name) continue;
          const val = row[c];
          if (val === '' || val === undefined || val === null) continue;
          const place = typeof val === 'number' ? val : parseInt(String(val).trim(), 10);
          if (!isNaN(place)) results[name] = place;
        }
        if (Object.keys(results).length === 0) continue;
        editions.push({edition: editionNum, results});
      }
      return {editions, players: playerNames};
    }

    function parseGvizResponse(response) {
      if (!response || !response.table) throw new Error('Unexpected response format from Google Sheets.');
      if (response.status === 'error') {
        const msg = (response.errors && response.errors[0] && (response.errors[0].detailed_message || response.errors[0].message)) || 'Unknown error from Google Sheets.';
        throw new Error(msg);
      }
      const table = response.table;
      const rawRows = (table.rows || []).map(r => (r.c || []).map(cell => (cell && cell.v !== undefined && cell.v !== null) ? cell.v : ''));

      // Google's API sometimes auto-detects the first row as a header and pulls
      // it OUT of table.rows into table.cols[].label — even when we ask it not
      // to. If it did that, table.rows starts at the real data (edition 1), and
      // we must reconstruct the header from cols[].label instead of rows[0],
      // or every row shifts by one (edition 1 gets read as headers, and its
      // placements get misread as player names).
      const colLabels = (table.cols || []).map(c => (c && c.label != null && c.label !== '') ? String(c.label) : '');
      const headerWasExtracted = colLabels.some(l => l.length > 0);

      let grid;
      if (headerWasExtracted) {
        grid = [colLabels, ...rawRows];
      } else {
        grid = rawRows; // no auto-detection happened; first row of rawRows IS the header
      }

      if (grid.length < 2) throw new Error('The "Editions" sheet appears to be empty.');
      return buildDatasetFromGrid(grid);
    }

    /* Parses manually pasted or uploaded delimited text (CSV or TSV — Google
       Sheets copy/paste produces tab-separated values, downloaded files are
       usually comma-separated, so we auto-detect). Used as a fallback when
       the live connection to Google Sheets can't be established. */
    function parseDelimitedText(text) {
      const firstLine = text.split(/\r?\n/)[0] || '';
      const commaCount = (firstLine.match(/,/g) || []).length;
      const tabCount = (firstLine.match(/\t/g) || []).length;
      const delimiter = tabCount > commaCount ? '\t' : ',';
      const lines = text.split(/\r?\n/).filter(l => l.trim().length);
      const grid = lines.map(line => {
        if (delimiter === ',') {
          // simple CSV parse with quote support
          const cells = []; let field = '', inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQuotes) {
              if (c === '"') {if (line[i + 1] === '"') {field += '"'; i++;} else inQuotes = false;}
              else field += c;
            } else {
              if (c === '"') inQuotes = true;
              else if (c === ',') {cells.push(field); field = '';}
              else field += c;
            }
          }
          cells.push(field);
          return cells;
        }
        return line.split('\t');
      });
      return buildDatasetFromGrid(grid);
    }

    /* Results files committed to this repo by the GitHub Action (.github/workflows/update-data.yml).
       Same shape as the Worker's /data: {season, editions, players, updatedAt}. */
    async function fetchRepoData(key) {
      const res = await fetch(`data/${key}.json`, {cache: 'no-cache'});
      if (!res.ok) throw new Error(`data/${key}.json: HTTP ${res.status}`);
      const payload = await res.json();
      if (!payload || !Array.isArray(payload.editions) || !Array.isArray(payload.players)) throw new Error(`data/${key}.json has an unexpected shape`);
      return {editions: payload.editions, players: payload.players};
    }
    async function fetchWorkerData(key) {
      const proxyUrl = (SPEEDTAS_API_URL || '').replace(/\/+$/, '');
      if (!proxyUrl) throw new Error('No SPEEDTAS_API_URL configured.');
      const res = await fetch(proxyUrl + '/data?season=' + key);
      if (!res.ok) {
        let msg = `Worker responded with ${res.status}`;
        try {const errBody = await res.json(); if (errBody && errBody.error) msg = errBody.error;} catch (e) {}
        throw new Error(msg);
      }
      const payload = await res.json();
      return {editions: payload.editions, players: payload.players};
    }

    /* Season 2 (archive): repo file -> Worker -> direct Google Sheets -> built-in snapshot. */
    async function loadSeason2Live() {
      try {return await fetchRepoData('s2');}
      catch (err) {console.warn('Season 2 repo data file unavailable; trying the Worker.', err);}
      try {return await fetchWorkerData('s2');}
      catch (err) {console.warn('Season 2 via Worker failed; trying direct Google Sheets connection.', err);}
      const response = await fetchViaJSONP(SHEET_NAME);
      return parseGvizResponse(response);
    }
    let SEASON_2 = null, season2Promise = null;
    function loadSeason2() {
      if (SEASON_2) return Promise.resolve(SEASON_2);
      if (!season2Promise) {
        season2Promise = loadSeason2Live()
          .then(data => SEASON_2 = data)
          .catch(err => {console.warn('Season 2 live fetch failed; using saved snapshot.', err); return SEASON_2 = parseDelimitedText(FALLBACK_CSV_TEXT);});
      }
      return season2Promise;
    }

    /* Current TMNF season (Season 3): repo file (written by the GitHub Action) -> Worker.
       Before the first edition there is nothing to show yet, which is a normal state, not an error. */
    async function loadData() {
      try {return await fetchRepoData(CURRENT_TMNF_SEASON);}
      catch (err) {console.warn(`${SEASON_INFO[CURRENT_TMNF_SEASON].label} repo data file unavailable; trying the Worker.`, err);}
      return fetchWorkerData(CURRENT_TMNF_SEASON);
    }
    function withBestOf(data, key) {
      if (data) data.bestOf = (SEASON_INFO[key] && SEASON_INFO[key].bestOf) || null;
      return data;
    }

    /* Data for a season key: current season, an archive, or every TMNF season combined. */
    function loadSeasonData(key) {
      if (key === curKey()) return Promise.resolve(RAW);
      if (key === 's1') return loadSeason1();
      if (key === 's2') return loadSeason2();
      if (key === 'both' || key === 'all') return loadAllTmnfSeasons().then(combinedSeasonData);
      return Promise.resolve(RAW);
    }
    /* [[key, data], ...] oldest first, for every TMNF season. */
    function loadAllTmnfSeasons() {
      return Promise.all([loadSeason1(), loadSeason2()]).then(([s1, s2]) => [['s1', s1], ['s2', s2], ['s3', GAME === 'tmnf' ? RAW : DATA.tmnf]]);
    }

    /* Retries a flaky async call a few times with a short, growing pause
       between attempts, instead of giving up after one failure. This is
       what a manual page refresh was effectively doing by hand. */
    async function retryAsync(fn, attempts = 3, delayMs = 1200) {
      let lastErr;
      for (let i = 0; i < attempts; i++) {
        try { return await fn(); }
        catch (err) { lastErr = err; if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1))); }
      }
      throw lastErr;
    }

    /* Cloudflare Workers on the free plan cap each invocation at 50 outgoing
       fetch() calls, so one Discord lookup per ID means the roster can't be
       sent in a single request forever. Splitting into batches keeps each
       request to the Worker safely under that limit, however large the
       roster grows — it just becomes a few more sequential requests. */
    const AVATAR_STORE_KEY = 'speedtas_discord_avatars_v1';
    let AVATAR_RETRY_IDS = [];
    function readAvatarStore() {
      try {const v = JSON.parse(localStorage.getItem(AVATAR_STORE_KEY) || 'null'); if (v && v.avatars) return v;} catch (e) {}
      return {ids: {}, avatars: {}};
    }
    function saveAvatarStore() {
      try {localStorage.setItem(AVATAR_STORE_KEY, JSON.stringify({t: Date.now(), ids: DISCORD_IDS, avatars: DISCORD_AVATARS}));} catch (e) {}
    }
    /* Pictures from the last visit appear instantly and stay if Discord/the Worker is having a bad moment. */
    function prefillAvatarsFromStore() {
      const v = readAvatarStore();
      DISCORD_IDS = {...v.ids}; DISCORD_AVATARS = {...v.avatars};
    }
    async function fetchAvatarsInBatches(proxyUrl, ids, batchSize = 20) {
      const avatars = {}, transient = new Set(), queue = [...ids];
      let calls = 0;
      while (queue.length && calls < 60) {
        const batch = queue.splice(0, batchSize); calls++;
        try {
          const data = await retryAsync(async () => {
            const res = await fetch(proxyUrl + '/avatars?ids=' + encodeURIComponent(batch.join(',')));
            if (!res.ok) throw new Error('Worker responded with ' + res.status);
            return res.json();
          });
          Object.assign(avatars, data.avatars || {});
          (data.pending || []).forEach(id => queue.push(id));            // Worker ran out of its per-request budget: ask again
          Object.keys(data.failed || {}).forEach(id => transient.add(id)); // Discord had a temporary problem: retry later
        } catch (err) {
          batch.forEach(id => transient.add(id));
          console.warn('Avatar batch failed after retries, will try again later:', err);
        }
      }
      AVATAR_RETRY_IDS = [...transient].filter(id => !avatars[id]);
      return avatars;
    }
    function scheduleAvatarRetry(proxyUrl) {
      [4000, 12000, 30000].forEach(delay => setTimeout(async () => {
        if (!AVATAR_RETRY_IDS.length) return;
        const got = await fetchAvatarsInBatches(proxyUrl, [...AVATAR_RETRY_IDS]);
        if (Object.keys(got).length) {
          Object.assign(DISCORD_AVATARS, got); saveAvatarStore();
          swapInAvatars();
        }
      }, delay));
    }

    /* data/avatars.json is written by the GitHub Action ({players: {name: discordId}, avatars: {discordId: url}}),
       so a visit normally needs no Worker or Discord lookups at all. The Worker is only asked about players the
       file has no picture for, at most once a day per browser. */
    const AVATAR_CHECK_KEY = 'speedtas_avatar_check_t';
    async function loadAvatarsFromRepo(proxyUrl) {
      let file = null;
      try {const r = await fetch('data/avatars.json', {cache: 'no-cache'}); if (r.ok) file = await r.json();} catch (e) {}
      if (!file || !file.players || !Object.keys(file.players).length) return false;
      Object.entries(file.players).forEach(([name, id]) => {if (/^\d{15,25}$/.test(String(id))) DISCORD_IDS[playerKey(name)] = String(id);});
      Object.entries(file.avatars || {}).forEach(([id, url]) => {if (url) DISCORD_AVATARS[id] = url;});
      saveAvatarStore();
      const missing = [...new Set(Object.values(DISCORD_IDS))].filter(id => !DISCORD_AVATARS[id] && !(file.avatars && id in file.avatars && file.avatars[id] === null));
      let last = 0; try {last = +localStorage.getItem(AVATAR_CHECK_KEY) || 0;} catch (e) {}
      if (proxyUrl && missing.length && Date.now() - last > 864e5) {
        try {localStorage.setItem(AVATAR_CHECK_KEY, String(Date.now()));} catch (e) {}
        const fresh = await fetchAvatarsInBatches(proxyUrl, missing);
        Object.assign(DISCORD_AVATARS, fresh); saveAvatarStore();
      }
      return true;
    }
    /* A saved picture that no longer loads (the player changed it): ask the Worker for that one, once a day at most. */
    let avatarFixQueue = new Set(), avatarFixTimer = null;
    function queueAvatarRefresh(id) {
      const proxyUrl = (SPEEDTAS_API_URL || getAvatarProxyUrl() || '').replace(/\/+$/, '');
      if (!proxyUrl || !id) return;
      const key = 'speedtas_avfix_' + id;
      try {const t = +localStorage.getItem(key); if (t && Date.now() - t < 864e5) return; localStorage.setItem(key, String(Date.now()));} catch (e) {}
      avatarFixQueue.add(id);
      clearTimeout(avatarFixTimer);
      avatarFixTimer = setTimeout(async () => {
        const ids = [...avatarFixQueue]; avatarFixQueue = new Set();
        const fresh = await fetchAvatarsInBatches(proxyUrl, ids);
        const changed = ids.filter(id => fresh[id] && fresh[id] !== DISCORD_AVATARS[id]);
        if (changed.length) {Object.assign(DISCORD_AVATARS, fresh); saveAvatarStore(); swapInAvatars();}
      }, 1500);
    }
    async function loadDiscordProfiles() {
      try {
        const proxyUrl = (SPEEDTAS_API_URL || getAvatarProxyUrl() || '').replace(/\/+$/, '');
        if (await loadAvatarsFromRepo(proxyUrl)) return;
        DISCORD_IDS = {...DISCORD_IDS}; let freshRoster = 0; // keep last visit's IDs until the new roster arrives
        // The Worker fetches the Players tab so public browsers never have
        // to execute a Google JSONP script to build the avatar roster.
        let rosterLoaded = false;
        if (proxyUrl) {
          try {
            const response = await retryAsync(async () => {
              const res = await fetch(proxyUrl + '/players');
              if (!res.ok) throw new Error('Worker responded with ' + res.status);
              return res.json();
            });
            Object.entries(response.players || {}).forEach(([name, id]) => {
              if (/^\d{15,25}$/.test(String(id))) {DISCORD_IDS[playerKey(name)] = String(id); freshRoster++;}
            });
            rosterLoaded = freshRoster > 0;
          } catch (err) {console.warn('Worker Players endpoint unavailable; falling back to Google Sheets.', err);}
        }
        if (!rosterLoaded) {
          // Compatibility fallback while the Worker update is being deployed.
          const response = await retryAsync(() => fetchViaJSONP(PLAYER_SHEET_NAME));
          const table = response?.table;
          const labels = (table?.cols || []).map(c => String(c?.label || '').trim().toLowerCase());
          const nameCol = labels.findIndex(x => ['players', 'player', 'player name', 'name'].includes(x));
          const idCol = labels.findIndex(x => ['id', 'discord id', 'discordid', 'discord'].includes(x));
          if (nameCol < 0 || idCol < 0) throw new Error('Players tab needs Player and Discord ID headers.');
          (table.rows || []).forEach(row => {const cells = row.c || []; const name = String(cells[nameCol]?.v ?? '').trim(); const id = String(cells[idCol]?.f ?? cells[idCol]?.v ?? '').replace(/\s/g, ''); if (name && /^\d{15,25}$/.test(id)) DISCORD_IDS[playerKey(name)] = id;});
        }
        if (proxyUrl && Object.keys(DISCORD_IDS).length) {
          const ids = [...new Set(Object.values(DISCORD_IDS))];
          const fresh = await fetchAvatarsInBatches(proxyUrl, ids);
          DISCORD_AVATARS = {...DISCORD_AVATARS, ...fresh}; // new answers win, older known-good pictures are kept
          saveAvatarStore();
          scheduleAvatarRetry(proxyUrl);
        }
      } catch (err) {console.warn('Discord player directory unavailable:', err);}
    }

