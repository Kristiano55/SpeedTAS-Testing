    /* ============ TM2020 DATA ============ */
    let tm20Promise = null;
    function tm20CsvUrl() {
      return TM20_CSV_BASE + '?' + (TM20_EDITIONS_GID ? 'gid=' + encodeURIComponent(TM20_EDITIONS_GID) + '&single=true&' : '') + 'output=csv';
    }
    function parseTM20Text(text) {
      // The Editions tab's A1 cell always starts with 👥 — if it doesn't, the link points at another tab.
      if (!/^["']?👥/.test(text.trim())) throw new Error('The TM2020 link is not pointing at the Editions tab. Set TM20_EDITIONS_GID (or move Editions to be the first tab).');
      return parseDelimitedText(text);
    }
    function loadTM20() {
      if (DATA.tm20) return Promise.resolve(DATA.tm20);
      if (!tm20Promise) {
        const proxyUrl = (SPEEDTAS_API_URL || '').replace(/\/+$/, '');
        const viaWorker = () => proxyUrl
          ? fetch(proxyUrl + '/data?season=tm20').then(async r => {
              if (!r.ok) {
                let msg = `Worker responded with ${r.status}`;
                try {const b = await r.json(); if (b && b.error) msg = b.error;} catch (e) {}
                throw new Error(msg);
              }
              const payload = await r.json();
              return {editions: payload.editions, players: payload.players};
            })
          : Promise.reject(new Error('No SPEEDTAS_API_URL configured.'));
        tm20Promise = fetchRepoData('tm20')
          .catch(err => {
            console.warn('TM2020 repo data file unavailable; trying the Worker.', err);
            return viaWorker().catch(err2 => {console.warn('TM2020 via Worker failed; trying the published sheet directly.', err2); return null;});
          })
          .then(d => d || fetch(tm20CsvUrl()).then(r => {if (!r.ok) throw new Error('The TM2020 sheet could not be reached.'); return r.text();}).then(parseTM20Text))
          /* Name merging looks at the TMNF seasons, so wait for the archives (which preload anyway) before canonicalising. */
          .then(d => Promise.all([loadSeason2().catch(() => null), loadSeason1().catch(() => null)]).then(() => d))
          .then(d => DATA.tm20 = canonicalizeDataset(d))
          .finally(() => {tm20Promise = null;});
      }
      return tm20Promise;
    }

    /* ============ TAS EXCHANGE EVENTS ============ */
    /* The Worker's /events-index finds which tmtas.exchange event is "edition N" by reading event titles.
       EVENT_PATTERN is a regular expression matched against the event title (the title must contain "#N").
       If an edition can't be found automatically, pin it by hand: EVENT_ID_OVERRIDES.tm20 = {"5": 260}. */
    /* Keys: 's2' / 's3' = TMNF seasons, 'tm20' = TM2020. Season 1 has no TAS Exchange events. */
    const EVENT_PATTERN = {s2: 'SpeedTAS Season2', s3: 'SpeedTAS (Season ?3|S3)\\b', tm20: 'SpeedTAS TM20'}; // titles look like "SpeedTAS TM20 #4"
    const EVENT_ID_RANGE = {s2: [40, 300], s3: [260, 860], tm20: [200, 600]};
    const EVENT_ID_OVERRIDES = {s2: {}, s3: {}, tm20: {"1": 229, "2": 240, "3": 251, "4": 258}}; // known events always win; later ones are found automatically
    const eventKeyFor = seasonKey => GAME === 'tm20' ? 'tm20' : seasonKey;
    const hasEvents = seasonKey => GAME === 'tm20' || seasonKey === 's2' || seasonKey === 's3';
    /* data/events.json is written by the GitHub Action: {"s3": {"1": {id, title, results: [{pos, entrant, time}]}}, ...} */
    let REPO_EVENTS = null;
    /* null = the file could not be read (then the Worker is the backup); {} or more = the Action's answer. */
    const repoEvents = () => REPO_EVENTS || (REPO_EVENTS = fetch('data/events.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : null).catch(() => null));
    /* Hosts sometimes upload a competitor's run under their own name. Their entry is then handed to the competitor
       who has no time of their own - unless the sheet shows the host competed (then it's the host's own run). */
    const EVENT_HOSTS = {s2: ['Kristiano'], s3: ['Kristiano'], tm20: ['Kristiano']};
    const EVENT_INDEX = {s2: null, s3: null, tm20: null};
    const eventPromises = {};
    const eventUrl = id => 'https://tmtas.exchange/events/' + id;
    function eventFor(game, edition) {
      const pinned = EVENT_ID_OVERRIDES[game] && EVENT_ID_OVERRIDES[game][String(edition)];
      if (pinned) return {id: pinned};
      return (EVENT_INDEX[game] || {})[String(edition).trim()] || null;
    }
    function loadEventIndex(game, onUpdate) {
      const proxyUrl = (SPEEDTAS_API_URL || '').replace(/\/+$/, '');
      if (!proxyUrl) return Promise.resolve({}).then(r => {if (onUpdate) onUpdate(); return r;});
      const cacheKey = 'speedtas_events_' + game;
      if (!eventPromises[game]) {
        let cached = null;
        try {cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');} catch (e) {}
        if (cached && cached.events && Date.now() - cached.t < 3600e3) {
          EVENT_INDEX[game] = cached.events;
          eventPromises[game] = Promise.resolve(cached.events);
        } else {
          eventPromises[game] = (async () => {
            /* The repo's events.json (GitHub Action) answers without touching TAS Exchange; the Worker scan is the backup. */
            const repo = await repoEvents();
            if (repo) {EVENT_INDEX[game] = repo[game] || {}; return EVENT_INDEX[game];} // no TAS Exchange scan when the Action's file is there
            const [from, to] = EVENT_ID_RANGE[game];
            for (let i = 0; i < 12; i++) {
              const r = await fetch(`${proxyUrl}/events-index?pattern=${encodeURIComponent(EVENT_PATTERN[game])}&from=${from}&to=${to}`);
              if (!r.ok) throw new Error('events-index ' + r.status);
              const b = await r.json();
              EVENT_INDEX[game] = b.events || {};
              if (onUpdate) onUpdate();
              if (b.complete) {try {localStorage.setItem(cacheKey, JSON.stringify({t: Date.now(), events: EVENT_INDEX[game]}));} catch (e) {} break;}
            }
            return EVENT_INDEX[game] || {};
          })().catch(err => {console.warn('TAS Exchange event lookup failed', err); delete eventPromises[game]; return EVENT_INDEX[game] || {};});
        }
      }
      return eventPromises[game].then(r => {if (onUpdate) onUpdate(); return r;});
    }
    function fillHistoryEventLinks() {
      document.querySelectorAll('.history-event[data-edition]').forEach(el => {
        const ev = eventFor(el.dataset.eventKey || eventKeyFor(curKey()), el.dataset.edition);
        if (ev && !el.firstChild) el.innerHTML = `<span class="ext-link" data-ext="${eventUrl(ev.id)}" title="Open this event on TAS Exchange">TAS Exchange ↗</span>`;
      });
    }
    document.addEventListener('click', e => {
      const x = e.target.closest && e.target.closest('[data-ext]');
      if (!x) return;
      e.preventDefault(); e.stopPropagation();
      window.open(x.dataset.ext, '_blank', 'noopener');
    }, true);
    function parseTimeSeconds(t) {
      const m = String(t || '').trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
      return m ? (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]) : null;
    }
    function matchEntrantsToPlayers(entrants, names, opts = {}) {
      const byKey = {};
      names.forEach(n => byKey[playerKey(n)] = n);
      const out = {}, leftovers = [];
      entrants.forEach(en => {
        if (en.player && names.includes(en.player)) {if (!out[en.player]) out[en.player] = en; return;} // resolved by the data Action
        const k = playerKey(en.entrant);
        let name = byKey[k];
        if (!name) {const close = Object.keys(byKey).filter(x => oneLetterApart(x, k)); if (close.length === 1) name = byKey[close[0]];}
        if (name) {if (!out[name]) out[name] = en;} else leftovers.push(en);
      });
      /* A host uploading a run for someone else shows up as the HOST's entry. If the sheet says the host did not
         compete, that entry belongs to a competitor with no time yet: the one whose sheet placement equals the
         entry's position, or the only competitor still without a time. */
      const hostKeys = (opts.hosts || []).map(playerKey);
      if (hostKeys.length && !hostKeys.some(h => byKey[h])) {
        leftovers.filter(en => hostKeys.includes(playerKey(en.entrant))).forEach(en => {
          const free = names.filter(n => !out[n]);
          let pick = opts.placements ? free.filter(n => opts.placements[n] === en.pos) : [];
          if (pick.length !== 1 && free.length === 1) pick = free;
          if (pick.length === 1) out[pick[0]] = {...en, viaHost: stripNote(en.entrant)};
        });
      }
      return out;
    }
    /* Times from the results posts in the SpeedTAS Discord (#results-tmnf), collected into data/times.json:
       {"s1": {"5": {"Mufat": "20.18", ...}}, "s2": {...}}, keyed by the sheet's player names. TMNF only.
       Each was checked against the sheet's placements. When TAS Exchange also has a time, TAS Exchange wins. */
    let POSTED_TIMES = null;
    const postedTimes = () => POSTED_TIMES || (POSTED_TIMES = fetch('data/times.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : {}).catch(() => ({})));
    /* times = {player: {time, viaHost?}}: fills the Time column with each time and its gap to the fastest. */
    function paintTimes(times) {
      const secs = Object.values(times).map(en => parseTimeSeconds(en.time)).filter(x => x != null);
      const best = secs.length ? Math.min(...secs) : null;
      let filled = 0;
      document.querySelectorAll('.time-cell[data-player]').forEach(cell => {
        const en = times[cell.dataset.player];
        if (!en) return;
        const t = parseTimeSeconds(en.time), gap = (t != null && best != null && t - best > 0.0001) ? `<small>+${(t - best).toFixed(2)}</small>` : '';
        const via = en.viaHost ? `<small title="Uploaded by ${escapeHtml(en.viaHost)} on this player's behalf" style="cursor:help">ⓘ</small>` : '';
        cell.innerHTML = escapeHtml(en.time) + gap + via; filled++;
      });
      if (filled) document.querySelector('.results-table').classList.remove('no-times');
      EDITION_TIMES = times;
      const t = document.querySelector('.results-table');
      if (t && best != null) fillMapCard(t.dataset.season, t.dataset.edition, best);
    }
    /* Replay download + inputs for each player whose TAS Exchange run has downloads enabled.
       Inputs are saved by the data Action: TMNF in data/inputs/<replayId>.txt (TMInterface script), TM2020 in
       data/inputs/tm20/<replayId>.txt (TM2020 TAS format with the seed). The two games number replays separately. */
    const inputsDir = () => GAME === 'tm20' ? 'data/inputs/tm20' : 'data/inputs';
    const INPUTS_INDEX = {};
    const inputsIndex = () => INPUTS_INDEX[GAME] || (INPUTS_INDEX[GAME] = fetch(`${inputsDir()}/index.json`, {cache: 'no-cache'}).then(r => r.ok ? r.json() : []).then(ids => new Set(ids)).catch(() => new Set()));
    function paintRuns(times, eventId, label) {
      inputsIndex().then(saved => {
        let filled = 0;
        document.querySelectorAll('.run-cell[data-player]').forEach(cell => {
          const en = times[cell.dataset.player];
          if (!en || !en.replay) return;
          const file = `${label} - ${cell.dataset.player}`;
          const inputs = saved.has(en.replay) ? `<button type="button" class="run-btn" data-inputs="${en.replay}" data-file="${escapeHtml(file)}" title="Show the inputs">Inputs</button>` : '';
          cell.innerHTML = `<span class="run-actions"><a class="run-btn" href="https://tmtas.exchange/events/${eventId}/replays/${en.replay}/download" target="_blank" rel="noopener" title="Download the replay (.Replay.Gbx) from TAS Exchange">Replay</a>${inputs}</span>`;
          filled++;
        });
        const table = document.querySelector('.results-table');
        if (filled && table) table.classList.remove('no-runs');
      });
    }
    /* Every known time of a season, per edition and sheet name: {edition: {name: {time, secs, replay?, eventId?}}}.
       Posted Discord times first; TAS Exchange times (with replays) win, as on the edition page. */
    const SEASON_TIMES = {};
    function seasonTimes(seasonKey) {
      const key = (GAME === 'tm20' ? 'tm20:' : '') + seasonKey;
      if (SEASON_TIMES[key]) return SEASON_TIMES[key];
      return SEASON_TIMES[key] = Promise.all([GAME === 'tmnf' ? postedTimes() : {}, hasEvents(seasonKey) ? repoEvents() : null]).then(([posted, events]) => {
        const out = {}, put = (ed, name, en) => {const secs = parseTimeSeconds(en.time); if (secs == null || !name) return; (out[ed] = out[ed] || {})[name] = {...en, secs};};
        Object.entries((posted || {})[seasonKey] || {}).forEach(([ed, byName]) => Object.entries(byName).forEach(([name, time]) => put(ed, name, {time})));
        Object.entries(((events || {})[eventKeyFor(seasonKey)]) || {}).forEach(([ed, ev]) => (ev.results || []).forEach(r => {if (r.player) put(ed, r.player, {time: r.time, replay: r.replay, eventId: ev.id});}));
        return out;
      }).catch(() => ({}));
    }
    /* Profile placement history: time, gap to the edition winner and the replay, filled in once the times are loaded. */
    function fillHistoryTimes() {
      const rows = [...document.querySelectorAll('.history-times tr[data-tseason]')];
      [...new Set(rows.map(r => r.dataset.tseason))].forEach(season => seasonTimes(season).then(all => {
        rows.filter(r => r.dataset.tseason === season && document.body.contains(r)).forEach(row => {
          const ed = all[row.dataset.ted] || {}, mine = ed[row.dataset.twho];
          if (!mine) return;
          const best = Math.min(...Object.values(ed).map(x => x.secs)), gap = mine.secs - best;
          row.querySelector('.t-time').textContent = mine.time;
          row.querySelector('.t-gap').innerHTML = gap < 0.0005 ? '<span class="t-win">Winner</span>' : `<span class="t-plus">+${gap.toFixed(2)}</span>`;
          if (mine.replay && mine.eventId) row.querySelector('.t-run').innerHTML = `<a class="run-btn" href="https://tmtas.exchange/events/${mine.eventId}/replays/${mine.replay}/download" target="_blank" rel="noopener" title="Download the replay (.Replay.Gbx) from TAS Exchange">Replay</a>`;
        });
      }));
    }
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-inputs]');
      if (btn) openInputs(btn.dataset.inputs, btn.dataset.file);
      if (e.target.closest('[data-close-inputs]') || e.target.classList.contains('inputs-overlay')) closeInputs();
    });
    document.addEventListener('keydown', e => {if (e.key === 'Escape') closeInputs();});
    function closeInputs() {const o = document.querySelector('.inputs-overlay'); if (o) o.remove();}
    function openInputs(replayId, fileLabel) {
      closeInputs();
      const E = escapeHtml, o = document.createElement('div');
      o.className = 'inputs-overlay';
      o.innerHTML = `<div class="inputs-panel" role="dialog" aria-modal="true" aria-label="Inputs for ${E(fileLabel)}">
        <div class="inputs-head"><div><div class="panel-label">Inputs</div><b>${E(fileLabel)}</b></div><button type="button" class="run-btn" data-close-inputs aria-label="Close">✕</button></div>
        <div class="inputs-body"><div class="loader"><div class="spinner"></div> Loading inputs…</div></div></div>`;
      document.body.appendChild(o);
      o.querySelector('[data-close-inputs]').focus();
      const tm20 = GAME === 'tm20';
      fetch(`${inputsDir()}/${encodeURIComponent(replayId)}.txt`, {cache: 'no-cache'}).then(r => {if (!r.ok) throw new Error('not saved yet'); return r.text();}).then(text => {
        const body = o.querySelector('.inputs-body');
        if (!body) return;
        const lines = text.trim().split('\n').length - (tm20 ? 1 : 0), seed = tm20 && (text.match(/^0 seed (-?\d+)/) || [])[1];
        const format = tm20
          ? `TM2020 TAS format: <code>&lt;milliseconds&gt; &lt;action&gt; &lt;value&gt;</code>${seed ? ` · seed <code>${E(seed)}</code>` : ''}`
          : 'TMInterface script format: <code>&lt;seconds&gt; &lt;action&gt; &lt;value&gt;</code>';
        body.innerHTML = `<p class="inputs-note">${lines} input changes · ${format}</p>
          <div class="inputs-tools"><button type="button" class="btn" data-copy>Copy</button><a class="btn" download="${E(fileLabel)}.txt" href="${URL.createObjectURL(new Blob([text], {type: 'text/plain'}))}">Download .txt</a></div>
          <pre class="inputs-text">${E(text)}</pre>`;
        body.querySelector('[data-copy]').addEventListener('click', ev => {navigator.clipboard.writeText(text).then(() => {ev.target.textContent = 'Copied';}, () => {ev.target.textContent = 'Copy failed';});});
      }).catch(() => {
        const body = o.querySelector('.inputs-body');
        if (body) body.innerHTML = `<p class="inputs-note">These inputs haven't been saved yet. They're added by the next data update; the replay download works already.</p>`;
      });
    }
    function attachEditionEvent(ed, seasonKey) {
      const edition = ed.edition, times = {};
      const stillHere = () => {const t = document.querySelector('.results-table'); return !!t && t.dataset.edition === String(edition) && t.dataset.season === seasonKey;};
      const usable = en => en && en.time && parseTimeSeconds(en.time) != null; // skips "Hidden" and other non-times
      if (GAME === 'tmnf') postedTimes().then(all => {
        const posted = (all[seasonKey] || {})[String(edition)] || {};
        Object.entries(posted).forEach(([name, time]) => {if (name in ed.results && !times[name] && usable({time})) times[name] = {time};});
        if (stillHere()) paintTimes(times);
      });
      if (!hasEvents(seasonKey)) return;
      const game = eventKeyFor(seasonKey);
      loadEventIndex(game).then(() => {
        const ev = eventFor(game, edition);
        if (!ev || !stillHere()) return;
        const link = document.getElementById('eventLink');
        if (link) {link.href = eventUrl(ev.id); link.style.display = '';}
        const proxyUrl = (SPEEDTAS_API_URL || '').replace(/\/+$/, '');
        return repoEvents().then(repo => {
          const saved = repo && repo[game] && repo[game][String(edition)];
          if (saved && saved.id === ev.id && Array.isArray(saved.results) && saved.results.length) return saved;
          /* Not saved by the Action (e.g. times still hidden): ask the Worker, but at most once a day per event. */
          const missKey = 'speedtas_evmiss_' + ev.id;
          try {const t = +localStorage.getItem(missKey); if (t && Date.now() - t < 864e5) return null;} catch (e) {}
          return fetch(`${proxyUrl}/event-results?id=${ev.id}`).then(r => r.ok ? r.json() : null).then(d => {
            if (!d || !d.results || !d.results.length) {try {localStorage.setItem(missKey, String(Date.now()));} catch (e) {}}
            return d;
          });
        }).then(data => {
          if (!data || !data.results || !stillHere()) return;
          const matched = matchEntrantsToPlayers(data.results, Object.keys(ed.results), {placements: ed.results, hosts: EVENT_HOSTS[game]});
          Object.entries(matched).forEach(([name, en]) => {if (usable(en)) times[name] = en;}); // replay-backed times win
          paintTimes(times);
          paintRuns(matched, ev.id, ev.title || `SpeedTAS ${labelFor(seasonKey)} #${edition}`);
        });
      }).catch(err => console.warn('Event times unavailable', err));
    }


    /* ============ MAPS ============
       data/maps.json (written by the data Action) has, per season and edition: the TMX map (name, authors,
       author time, TMX record, thumbnail) and the all-time TAS record for that map on TAS Exchange. */
    let MAPS_PROMISE = null;
    const repoMaps = () => MAPS_PROMISE || (MAPS_PROMISE = fetch('data/maps.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : {}).catch(() => ({})));
    const mapKeyFor = seasonKey => GAME === 'tm20' ? 'tm20' : seasonKey;
    const fmtMs = ms => {if (ms == null) return '—'; const s = ms / 1000, m = Math.floor(s / 60); return m ? `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}` : s.toFixed(2);};
    const mapThumb = map => map.thumbFile || map.thumbUrl || (map.tmx && map.thumb ? `https://tmnf.exchange/trackshow/${map.tmx}/image/1` : ''); // thumbFile = copy saved in the repo by the Action
    const mapLink = map => map.tmx ? `https://tmnf.exchange/trackshow/${map.tmx}` : (map.tas ? `https://tmtas.exchange/trackshow/${map.tas.track}?exchange=tm2020` : '');
    /* How far one hour got: 0% = author time, 100% = the all-time TAS record. */
    function recordProgress(map, winnerSecs) {
      if (!map || !map.tas || !map.authorTime || winnerSecs == null) return null;
      const at = map.authorTime / 1000, rec = map.tas.time / 1000;
      if (winnerSecs <= rec + 0.0005) return {pct: 100, beat: winnerSecs < rec - 0.0005, equal: Math.abs(winnerSecs - rec) <= 0.0005};
      if (at - rec <= 0.0005) return null;
      return {pct: Math.max(0, Math.min(100, (at - winnerSecs) / (at - rec) * 100))};
    }
    function progressHTML(prog) {
      if (!prog) return '';
      const label = prog.equal ? 'Equal to the all-time TAS record' : prog.beat ? 'Faster than the all-time TAS record' : `${prog.pct.toFixed(0)}% of the way from author time to the TAS record`;
      return `<div class="rec-progress" title="0% = author time, 100% = the all-time TAS record on TAS Exchange"><div class="rec-bar"><span style="width:${prog.pct.toFixed(1)}%"></span></div><small>${label}</small></div>`;
    }
    /* ============ EDITION VIDEO ============
       data/videos.json (GitHub Action) links each edition to its YouTube upload. The player only loads when
       someone presses play, so an edition page doesn't pull in YouTube for nothing. */
    let VIDEOS_PROMISE = null;
    const repoVideos = () => VIDEOS_PROMISE || (VIDEOS_PROMISE = fetch('data/videos.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : {}).catch(() => ({})));
    function fillEditionVideo(seasonKey, edition) {
      repoVideos().then(all => {
        const el = document.getElementById('editionVideo');
        const id = ((all.editions || {})[GAME === 'tm20' ? 'tm20' : seasonKey] || {})[String(edition)];
        if (!el || !id || !/^[\w-]{6,20}$/.test(id)) return;
        const title = ((all.videos || {})[id] || {}).title || `Edition ${edition} on YouTube`;
        el.innerHTML = `<button type="button" class="video-poster" aria-label="Play the video: ${escapeHtml(title)}">
          <img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy"><span class="video-play" aria-hidden="true"></span>
          <span class="video-title">${escapeHtml(title)}</span></button>`;
        el.hidden = false;
        el.querySelector('.video-poster').addEventListener('click', () => {
          el.innerHTML = `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="${escapeHtml(title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
        });
      });
    }
    function fillMapCard(seasonKey, edition, winnerSecs) {
      const card = document.getElementById('mapCard');
      if (!card) return;
      repoMaps().then(all => {
        const map = ((all[mapKeyFor(seasonKey)] || {})[String(edition)]);
        if (!map || !document.getElementById('mapCard')) return;
        const E = escapeHtml, thumb = mapThumb(map), link = mapLink(map);
        const row = (k, v) => v ? `<div class="map-stat"><span>${k}</span><b>${v}</b></div>` : '';
        card.innerHTML = `
          ${thumb ? `<a class="map-thumb" href="${E(link)}" target="_blank" rel="noopener" aria-label="${E(map.name)} on ${map.tmx ? 'TMX' : 'TAS Exchange'} (opens in a new tab)"><img src="${E(thumb)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
          <div class="map-info">
            <div class="panel-label">Map</div>
            <h2 class="map-name">${link ? `<a href="${E(link)}" target="_blank" rel="noopener">${E(map.name)} ↗</a>` : E(map.name)}</h2>
            ${map.authors && map.authors.length ? `<div class="map-by">by ${map.authors.map(E).join(', ')}</div>` : ''}
            <div class="map-stats">
              ${row('Author time', map.authorTime ? fmtMs(map.authorTime) : '')}
              ${row(GAME === 'tm20' ? '' : 'TMX record', map.wr && map.wr.time ? `${fmtMs(map.wr.time)}${map.wr.by ? ` <small>${E(map.wr.by)}</small>` : ''}` : '')}
              ${row('All-time TAS record', map.tas ? `<a href="https://tmtas.exchange/trackshow/${map.tas.track}?exchange=${GAME === 'tm20' ? 'tm2020' : 'tmnf'}" target="_blank" rel="noopener">${fmtMs(map.tas.time)}</a>${map.tas.by ? ` <small>${E(map.tas.by)}</small>` : ''}` : '')}
              ${row('One-hour winner', winnerSecs != null ? fmtMs(Math.round(winnerSecs * 1000)) : '')}
            </div>
            ${progressHTML(recordProgress(map, winnerSecs))}
          </div>`;
        card.hidden = false;
        const prog = recordProgress(map, winnerSecs);
        window.__editionMap = `🗺️ Map: ${map.name}${map.authors && map.authors.length ? ' by ' + map.authors.join(', ') : ''}` + (map.tas ? ` · all-time TAS record ${fmtMs(map.tas.time)}` + (prog ? (prog.beat || prog.equal ? ' (matched by the winner!)' : ` · the winner got ${prog.pct.toFixed(0)}% of the way there from author time`) : '') : '');
      });
    }

    /* Winning time of every edition of a season: replay-backed times first, then the Discord posts. */
    function winnerTimes(seasonKey, data) {
      return Promise.all([repoEvents(), GAME === 'tmnf' ? postedTimes() : Promise.resolve({})]).then(([events, posted]) => {
        const evs = events[eventKeyFor(seasonKey)] || {}, out = {};
        data.editions.forEach(ed => {
          const winner = Object.entries(ed.results).sort((a, b) => a[1] - b[1])[0];
          const ev = evs[String(ed.edition)], fromEvent = ev && (ev.results || []).map(r => parseTimeSeconds(r.time)).filter(x => x != null);
          const fromPost = ((posted[seasonKey] || {})[String(ed.edition)] || {});
          const secs = fromEvent && fromEvent.length ? Math.min(...fromEvent) : (winner && fromPost[winner[0]] ? parseTimeSeconds(fromPost[winner[0]]) : null);
          out[ed.edition] = {winner: winner && winner[0], secs};
        });
        return out;
      });
    }
    function renderMaps(seasonKey = viewKey()) {
      setSeasonTheme(seasonKey);
      main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading maps…</div>`;
      loadSeasonData(seasonKey).then(data => Promise.all([repoMaps(), winnerTimes(seasonKey, data)]).then(([all, wins]) => {
        const E = escapeHtml, maps = all[mapKeyFor(seasonKey)] || {}, base = GAME === 'tm20' ? '#/tm20' : '#';
        const eds = [...data.editions].reverse();
        const known = eds.filter(ed => maps[ed.edition]).length, withTas = eds.filter(ed => maps[ed.edition] && maps[ed.edition].tas).length;
        const intro = !known ? 'Every SpeedTAS map, with its author time and how the one-hour winner did.'
          : withTas === known ? 'Every SpeedTAS map, with its author time, the all-time TAS record on TAS Exchange and how close the one-hour winner got to it.'
          : `Every SpeedTAS map, with its author time and the one-hour winner. ${withTas ? `${withTas} of ${plural(known, 'map')} also have an all-time TAS record on TAS Exchange, with how close the winner got to it` : 'None has an all-time TAS record on TAS Exchange yet'}.`;
        main.innerHTML = `
    <header class="page-head"><div class="kicker">${E(labelFor(seasonKey))} · ${plural(known, 'map')}</div><h1>The <em>maps</em></h1>
      <p>${E(intro)}</p></header>
    <div class="versus-controls">${seasonSeg(seasonKey, 'maps-season', seasonOptions())}</div>
    ${eds.length ? '' : `<div class="empty-state"><b>No maps yet</b>Maps show up here once ${E(labelFor(seasonKey))} has editions.</div>`}
    ${eds.length && !known ? `<p class="maps-note">Map names, pictures and records for ${E(labelFor(seasonKey))} appear after the next data update.</p>` : ''}
    <div class="maps-grid">${eds.map(ed => {
      const map = maps[ed.edition], w = wins[ed.edition] || {}, thumb = map ? mapThumb(map) : '';
      return `<a class="map-tile" href="${base}/edition/${seasonKey}/${enc(ed.edition)}">
        <div class="map-tile-img">${thumb ? `<img src="${E(thumb)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="map-tile-num">#${E(ed.edition)}</span></div>
        <div class="map-tile-body"><b>${E(map ? map.name : 'Edition ' + ed.edition)}</b>
          <small>${w.winner ? `🏆 ${E(w.winner)}${w.secs != null ? ' · ' + fmtMs(Math.round(w.secs * 1000)) : ''}` : ''}</small>
          ${map && map.authorTime ? `<small>Author time ${fmtMs(map.authorTime)}</small>` : ''}
          ${map && map.tas ? `<small>TAS record ${fmtMs(map.tas.time)}${map.tas.by ? ' · ' + E(map.tas.by) : ''}</small>` : ''}
          ${progressHTML(recordProgress(map, w.secs))}</div></a>`;
    }).join('')}</div>`;
        main.querySelectorAll('[data-maps-season]').forEach(btn => btn.addEventListener('click', () => goSeason('/maps/' + btn.dataset.mapsSeason)));
      })).catch(seasonError);
    }

    /* ============ RESULTS POST (copy into Discord) ============ */
    let EDITION_TIMES = {};
    function resultsPostText(ed, seasonKey, data, clip = '', ping = false) {
      const entries = Object.entries(ed.results).sort((a, b) => a[1] - b[1]);
      const secs = Object.fromEntries(Object.entries(EDITION_TIMES).map(([n, en]) => [n, parseTimeSeconds(en.time)]));
      const best = Math.min(...Object.values(secs).filter(x => x != null));
      const medal = {1: '🥇', 2: '🥈', 3: '🥉'};
      const title = GAME === 'tm20' ? `SpeedTAS TM20 #${ed.edition}` : `SpeedTAS ${SEASON_INFO[seasonKey] ? SEASON_INFO[seasonKey].short : ''} #${ed.edition}`;
      const lines = [`## 🏁 Results of ${title}`];
      entries.forEach(([name, place]) => {
        const t = EDITION_TIMES[name], gap = t && secs[name] != null && secs[name] - best > 0.0001 ? ` (+${(secs[name] - best).toFixed(2)})` : '';
        const pts = pointsFor(place) ? ` · ${pointsFor(place)} pts` : '';
        lines.push(`${medal[place] || `\`${String(place).padStart(2)}.\``} ${place <= 3 ? `**${name}**` : name}${t ? ` — ${t.time}${gap}` : ''}${pts}`);
      });
      if (clip) lines.push('', `🎬 ${entries[0][0]}'s winning run: ${clip}`);
      // Standings straight after this edition, with movement since the edition before.
      const upTo = data.editions.slice(0, data.editions.indexOf(ed) + 1);
      const after = computeAll({editions: upTo, players: data.players, bestOf: data.bestOf}).ranked;
      const before = upTo.length > 1 ? computeAll({editions: upTo.slice(0, -1), players: data.players, bestOf: data.bestOf}).ranked : [];
      const prevRank = Object.fromEntries(before.map((p, i) => [p.name, i + 1]));
      lines.push('', `📊 **Standings after #${ed.edition}**`);
      after.slice(0, 5).forEach((p, i) => {
        const move = prevRank[p.name] ? prevRank[p.name] - (i + 1) : null;
        lines.push(`${i + 1}. ${p.name} — ${p.points} pts${move > 0 ? ` ▲${move}` : move < 0 ? ` ▼${-move}` : ''}`);
      });
      const firsts = entries.map(([n]) => n).filter(n => !upTo.slice(0, -1).some(e => n in e.results));
      if (firsts.length && upTo.length > 1) lines.push('', `👋 First race this season: ${firsts.join(', ')}`);
      const mapLine = window.__editionMap;
      if (mapLine) lines.push('', mapLine);
      lines.push('', `🔗 Full results: ${location.origin}${location.pathname}${GAME === 'tm20' ? '#/tm20' : '#'}/edition/${seasonKey}/${encodeURIComponent(ed.edition)}`);
      /* Discord mentions (<@id>) notify every racer with a known Discord ID; pasted by a person, they ping. */
      if (ping) {
        const ids = [...new Set(entries.map(([n]) => discordIdFor(n)).filter(Boolean))];
        if (ids.length) lines.push('', `🔔 ${ids.map(id => `<@${id}>`).join(' ')}`);
      }
      return lines.join('\n');
    }
    function openTextModal(title, text, hint) {
      closeInputs();
      const E = escapeHtml, o = document.createElement('div');
      o.className = 'inputs-overlay';
      o.innerHTML = `<div class="inputs-panel" role="dialog" aria-modal="true" aria-label="${E(title)}">
        <div class="inputs-head"><div><div class="panel-label">${E(hint)}</div><b>${E(title)}</b></div><button type="button" class="run-btn" data-close-inputs aria-label="Close">✕</button></div>
        <div class="inputs-body"><div class="inputs-tools"><button type="button" class="btn" data-copy>Copy</button></div><pre class="inputs-text post-text">${E(text)}</pre></div></div>`;
      document.body.appendChild(o);
      o.querySelector('[data-copy]').addEventListener('click', ev => {navigator.clipboard.writeText(text).then(() => {ev.target.textContent = 'Copied';}, () => {ev.target.textContent = 'Copy failed';});});
      o.querySelector('[data-close-inputs]').focus();
    }

    /* Results post with an optional link to the winner's clip (Streamable, YouTube…), remembered per edition. */
    function openResultsPost(ed, seasonKey, data) {
      const key = `speedtas_clip_${GAME}_${seasonKey}_${ed.edition}`;
      let clip = '', ping = true;
      try {clip = localStorage.getItem(key) || ''; ping = localStorage.getItem('speedtas_post_ping') !== '0';} catch (e) {}
      openTextModal(`Edition #${ed.edition}`, resultsPostText(ed, seasonKey, data, clip, ping), 'Results post for Discord');
      const panel = document.querySelector('.inputs-overlay .inputs-body');
      if (!panel) return;
      const field = document.createElement('label');
      field.className = 'clip-field';
      field.innerHTML = `<span>Winner's clip</span><input type="url" inputmode="url" placeholder="https://streamable.com/…" value="${escapeHtml(clip)}">`;
      panel.insertBefore(field, panel.firstChild);
      const pingBox = document.createElement('label');
      pingBox.className = 'ping-field';
      pingBox.innerHTML = `<input type="checkbox" ${ping ? 'checked' : ''}> <span>Ping racers <small>(adds a Discord mention for everyone in this edition)</small></span>`;
      field.after(pingBox);
      const input = field.querySelector('input'), pingInput = pingBox.querySelector('input'), pre = panel.querySelector('.post-text'), copy = panel.querySelector('[data-copy]');
      let text = pre.textContent, url = clip;
      const refresh = () => {text = resultsPostText(ed, seasonKey, data, url, pingInput.checked); pre.textContent = text; copy.textContent = 'Copy';};
      input.addEventListener('input', () => {
        const v = input.value.trim(), ok = !v || /^https?:\/\/\S+$/i.test(v);
        input.classList.toggle('bad', !ok);
        if (!ok) return;
        url = v;
        try {v ? localStorage.setItem(key, v) : localStorage.removeItem(key);} catch (e) {}
        refresh();
      });
      pingInput.addEventListener('change', () => {try {localStorage.setItem('speedtas_post_ping', pingInput.checked ? '1' : '0');} catch (e) {} refresh();});
      // Copy always takes the latest text, clip included.
      const fresh = copy.cloneNode(true); copy.replaceWith(fresh);
      fresh.addEventListener('click', () => navigator.clipboard.writeText(text).then(() => {fresh.textContent = 'Copied';}, () => {fresh.textContent = 'Copy failed';}));
    }

