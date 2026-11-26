    /* ============ MAIN RENDER ROUTER ============ */
    const main = document.getElementById('app');
    /* ============ VIDEOS TAB (public YouTube RSS feed — no key involved) ============
       A YouTube Data API key would have to ship inside this file's source to
       work for site visitors, and anyone can open dev tools or view-source on
       a published page and lift it straight out — so instead of asking for one,
       this reads the channel's public RSS feed (no credentials at all) through
       the free rss2json proxy, which turns the XML into plain JSON a browser
       can fetch directly. Nothing secret ever touches this file.
       Trade-off: the RSS feed only exposes the ~15 most recent uploads (a limit
       of the feed itself) rather than the full back-catalog an API key would
       allow — plenty for "this week's race," but older videos won't list here. */
    const YT_CHANNEL_ID = 'UCSLm9iD-GUV_HhMEc1ee3tA';
    const YT_RSS_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + YT_CHANNEL_ID;
    const YT_RSS2JSON_URL = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(YT_RSS_URL);
    const YT_CACHE_KEY = 'speedtas_v1_youtube_cache';
    const YT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — avoids re-fetching on every tab visit

    function getCachedVideos() {
      try {
        const raw = localStorage.getItem(YT_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed.fetchedAt || (Date.now() - parsed.fetchedAt) > YT_CACHE_TTL_MS) return null;
        return parsed.videos;
      } catch (e) {return null;}
    }
    function setCachedVideos(videos) {
      try {localStorage.setItem(YT_CACHE_KEY, JSON.stringify({fetchedAt: Date.now(), videos}));} catch (e) { }
    }

    async function fetchChannelVideos() {
      if (SPEEDTAS_API_URL) {
        try {
          const proxyUrl = SPEEDTAS_API_URL.replace(/\/+$/, '') + '/videos?channelId=' + encodeURIComponent(YT_CHANNEL_ID);
          const res = await fetch(proxyUrl);
          const data = await res.json();
          if (res.ok && Array.isArray(data.videos)) return data.videos;
          console.warn('Worker video proxy returned an error, falling back to the RSS feed:', data.error);
        } catch (err) {
          console.warn('Worker video proxy unreachable, falling back to the RSS feed:', err);
        }
      }
      const res = await fetch(YT_RSS2JSON_URL);
      const data = await res.json();
      if (data.status !== 'ok' || !Array.isArray(data.items)) {
        throw new Error(data.message || 'Could not read the channel feed.');
      }
      return data.items.map(item => {
        const idMatch = /video:([\w-]{6,})/.exec(item.guid || '') || /[?&]v=([\w-]{6,})/.exec(item.link || '');
        const id = idMatch ? idMatch[1] : '';
        return {
          id,
          title: item.title || 'Untitled',
          thumbnail: item.thumbnail || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''),
          publishedAt: item.pubDate,
        };
      }).filter(v => v.id);
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    }

    let videosCache = null;

    function renderVideos() {
      main.innerHTML = `
    <header class="page-head"><div class="kicker">Race results on video</div><h1>Video <em>archive</em></h1><p>The latest SpeedTAS uploads from <a href="https://www.youtube.com/@Kristiano55-tas" target="_blank" rel="noopener" style="color:var(--accent)">Kristiano's YouTube channel ↗</a>. Pick one to play it here.</p></header>
    <div class="toolbar"><button type="button" class="btn" id="ytRefreshBtn">Refresh videos</button></div>
    <div id="videosContent"></div>
  `;

      document.getElementById('ytRefreshBtn').addEventListener('click', () => {
        videosCache = null;
        try {localStorage.removeItem(YT_CACHE_KEY);} catch (e) { }
        renderVideos();
      });

      const contentEl = document.getElementById('videosContent');
      if (videosCache) {renderVideoGrid(videosCache); return;}
      const cached = getCachedVideos();
      if (cached) {videosCache = cached; renderVideoGrid(cached); return;}

      contentEl.innerHTML = `<div class="loader"><div class="spinner"></div> Loading videos…</div>`;
      fetchChannelVideos().then(videos => {
        videosCache = videos;
        setCachedVideos(videos);
        renderVideoGrid(videos);
      }).catch(err => {
        if (!document.getElementById('videosContent')) return;
        contentEl.innerHTML = `
      <div class="empty-state">
        <b>Couldn't load the video feed</b>${escapeHtml(err.message)}<br><br>
        <button class="btn" id="ytRetryBtn" type="button">Try again</button>
      </div>`;
        const retryBtn = document.getElementById('ytRetryBtn');
        if (retryBtn) retryBtn.addEventListener('click', () => {videosCache = null; renderVideos();});
      });
    }

    function renderVideoGrid(videos) {
      const contentEl = document.getElementById('videosContent');
      if (!contentEl) return;
      if (!videos.length) {
        contentEl.innerHTML = `<div class="empty-state"><b>No videos yet</b>Nothing has been uploaded to the channel so far.</div>`;
        return;
      }
      contentEl.innerHTML = `<div class="video-grid" id="videoGrid">${videos.map(videoCardHTML).join('')}</div>`;
      document.querySelectorAll('.video-card').forEach(card => {
        /* A collapsed card is one big play button; an expanded one only closes from its Close button. */
        card.addEventListener('click', e => {
          if (!card.classList.contains('expanded')) toggleVideoCard(card);
          else if (e.target.closest('[data-video-close]')) {toggleVideoCard(card); card.focus();}
        });
        card.addEventListener('keydown', e => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === card && !card.classList.contains('expanded')) {e.preventDefault(); toggleVideoCard(card);}
        });
      });
    }

    function videoCardCollapsedInner(v) {
      const date = v.publishedAt ? new Date(v.publishedAt) : null;
      const dateText = date && !isNaN(date) ? date.toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : '';
      return `
    <div class="video-thumb-wrap">
      <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy">
      <div class="video-play" aria-hidden="true"><svg viewBox="0 0 12 12" fill="currentColor"><path d="M2 1l9 5-9 5z"/></svg></div>
    </div>
    <div class="video-card-title">${escapeHtml(v.title)}${dateText ? `<span class="video-card-date">${dateText}</span>` : ''}</div>
  `;
    }
    function videoCardHTML(v) {
      return `<div class="video-card" role="button" tabindex="0" data-video-id="${escapeHtml(v.id)}">${videoCardCollapsedInner(v)}</div>`;
    }

    function toggleVideoCard(card) {
      const grid = document.getElementById('videoGrid');
      const wasExpanded = card.classList.contains('expanded');
      grid.querySelectorAll('.video-card.expanded').forEach(c => {if (c !== card) collapseCard(c);});
      if (wasExpanded) collapseCard(card); else expandCard(card);
    }

    function expandCard(card) {
      const videoId = card.dataset.videoId;
      const v = (videosCache || []).find(x => x.id === videoId);
      const title = v ? v.title : '';
      card.classList.add('expanded');
      card.removeAttribute('role');
      card.innerHTML = `
    <div class="video-expanded-head">
      <b>${escapeHtml(title)}</b>
      <button type="button" class="btn" data-video-close>Close</button>
    </div>
    <div class="video-frame">
      <iframe
        src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1"
        title="${escapeHtml(title)}"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    </div>
    <a href="https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}" target="_blank" rel="noopener" class="video-watch-link">Watch on YouTube ↗</a>
  `;
      card.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }

    function collapseCard(card) {
      const videoId = card.dataset.videoId;
      const v = (videosCache || []).find(x => x.id === videoId);
      card.classList.remove('expanded');
      card.setAttribute('role', 'button');
      if (v) card.innerHTML = videoCardCollapsedInner(v);
    }

    /* ============ SEASON COMPARISON ============ */
    /* Different spellings of the same person -> one identity key. Left side = the spelling with
       everything except letters/digits removed and lowercased. Add new ones here. */
    const PLAYER_ALIASES = {
      lildemo: 'demo', caster: 'c4ster', elliot: 'eliot',
      elliott: 'eliot', qqkewkew: 'qq', midnighteuphoria: 'midnight'
    };
    /* A trailing "(late upload)" etc. from TAS Exchange entrant names is not part of the name. */
    const stripNote = name => String(name == null ? '' : name).replace(/\s*\([^)]*\)\s*$/, '').trim();
    const playerKey = name => {
      const base = stripNote(name).toLowerCase().replace(/[^a-z0-9]/g, '');
      return PLAYER_ALIASES[base] || base;
    };
    /* Preferred spelling shown for a merged player in TM2020 when the TMNF data doesn't already settle it. */
    const TM20_DISPLAY_NAMES = {eliot: 'Elliot', qq: 'QQ', vogtek: 'Vogtek', midnight: 'Midnight'};
    function canonicalizeDataset(d) {
      const known = {};
      const addKnown = list => (list || []).forEach(n => {const k = playerKey(n); if (!known[k]) known[k] = n;});
      const tmnf = GAME === 'tmnf' ? RAW : DATA.tmnf;
      if (tmnf) addKnown(tmnf.players);
      if (typeof SEASON_2 !== 'undefined' && SEASON_2) addKnown(SEASON_2.players);
      if (typeof SEASON_1 !== 'undefined' && SEASON_1) addKnown(SEASON_1.players);
      const display = {};
      const nameFor = n => {
        const k = playerKey(n);
        if (!display[k]) display[k] = TM20_DISPLAY_NAMES[k] || known[k] || stripNote(n);
        return display[k];
      };
      const players = [];
      (d.players || []).forEach(n => {const c = nameFor(n); if (!players.includes(c)) players.push(c);});
      const editions = (d.editions || []).map(e => {
        const results = {};
        Object.entries(e.results).forEach(([n, place]) => {const c = nameFor(n); if (results[c] == null || place < results[c]) results[c] = place;});
        return {...e, results};
      });
      return {editions, players};
    }
    function discordIdFor(name) {
      const key = playerKey(name);
      if (DISCORD_IDS[key]) return DISCORD_IDS[key];
      // Keep avatar matching consistent with the S1↔S2 identity rule for a
      // one-character rename, while avoiding a match when it is ambiguous.
      const close = Object.keys(DISCORD_IDS).filter(candidate => oneLetterApart(candidate, key));
      return close.length === 1 ? DISCORD_IDS[close[0]] : null;
    }
    function oneLetterApart(a, b) {
      if (a === b) return true;
      if (Math.abs(a.length - b.length) > 1) return false;
      let i = 0, j = 0, edits = 0;
      while (i < a.length && j < b.length) {if (a[i] === b[j]) {i++; j++;} else if (++edits > 1) return false; else if (a.length > b.length) i++; else if (b.length > a.length) j++; else {i++; j++;} }
      return true;
    }
    function seasonStats(data) {return computeAll(data).ranked;}
    function rankMap(ranked, knownKeys = []) {const map = {}; ranked.forEach((p, i) => {let key = playerKey(p.name); if (!knownKeys.includes(key)) {const close = knownKeys.find(k => oneLetterApart(k, key)); if (close) key = close;} map[key] = {...p, rank: i + 1};}); return map;}
    /* One row per player across several seasons' standings (oldest first). A one-letter rename in a later
       season is matched to the earlier spelling; the newest spelling is shown. */
    function comparisonRows(...rankedLists) {
      const maps = []; let known = [];
      rankedLists.forEach(ranked => {const m = rankMap(ranked, known); maps.push(m); known = [...new Set([...known, ...Object.keys(m)])];});
      const sum = (xs, f) => xs.reduce((a, x) => a + (x ? x[f] : 0), 0);
      return known.map(k => {
        const xs = maps.map(m => m[k]), latest = [...xs].reverse().find(Boolean);
        return {
          key: k, name: latest.name, seasons: xs, s1: xs[0], s2: xs[1], delta: xs[0] && xs[1] ? xs[0].rank - xs[1].rank : null,
          total: sum(xs, 'points'), played: sum(xs, 'played'), wins: sum(xs, 'wins'), podiums: sum(xs, 'podiums')
        };
      }).sort((x, y) => y.total - x.total || y.played - x.played);
    }
    /* Wrapper keeps the nav's aria-current in step with its .active class after every route render */
    /* Phone menu: opens search + every page; closes on navigation, Escape or a tap outside. */
    const menuBtn = document.getElementById('menuBtn');
    function setMenu(open) {
      document.body.classList.toggle('menu-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    menuBtn.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
    document.querySelectorAll('#nav a, #gameSwitch a').forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', e => {if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {setMenu(false); menuBtn.focus();}});
    document.addEventListener('click', e => {if (document.body.classList.contains('menu-open') && !e.target.closest('.site-header')) setMenu(false);});
    function render() {
      setMenu(false);
      renderRoute();
      document.querySelectorAll('#nav a').forEach(a => {
        if (a.classList.contains('active')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
    }
    function renderRoute() {
      document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
      setSeasonTheme(null);
      const route = currentRoute();
      if (ROUTE_GAME === 'tm20' && !DATA.tm20) {
        applyTheme('tm20');
        main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading TM2020 data...</div>`;
        loadTM20().then(() => render()).catch(err => {
          main.innerHTML = `<div class="empty-state"><b>TM2020 data unavailable</b>${escapeHtml(err.message)}<br><br><button class="btn" id="tm20Retry" type="button">Try again</button></div>`;
          document.getElementById('tm20Retry').addEventListener('click', () => render());
        });
        return;
      }
      setGame(ROUTE_GAME);
      if (GAME === 'tm20') {
        if (route[0] === 'videos') {location.hash = '#/tm20'; return;}
        if (!RAW.editions.length) {
          const active = document.querySelector(`nav a[data-route="/${route[0] || ''}"]`); if (active) active.classList.add('active');
          main.innerHTML = `<div class="empty-state"><b>No TM2020 results yet</b>The first edition will appear here as soon as results are added to the TM2020 sheet.</div>`;
          return;
        }
      }
      if (route.length === 0) {
        document.querySelector('nav a[data-route="/"]').classList.add('active');
        renderHome();
      } else if (route[0] === 'players') {
        document.querySelector('nav a[data-route="/players"]').classList.add('active');
        renderPlayers();
      } else if (route[0] === 'player' && route[1]) {
        if ((isSeasonKey(route[1]) || route[1] === 'all') && route[2]) renderPlayerProfileEnhanced(route[2], route[1]);
        else renderPlayerProfileEnhanced(route[1]);
      } else if (route[0] === 'history') {
        document.querySelector('nav a[data-route="/history"]').classList.add('active');
        renderHistory();
      } else if (route[0] === 'maps') {
        document.querySelector('nav a[data-route="/maps"]').classList.add('active');
        renderMaps();
      } else if (route[0] === 'records') {
        document.querySelector('nav a[data-route="/records"]').classList.add('active');
        renderRecords();
      } else if (route[0] === 'rivalries') {
        document.querySelector('nav a[data-route="/rivalries"]').classList.add('active');
        renderRivalries();
      } else if (route[0] === 'edition' && route[1]) {
        if (isSeasonKey(route[1]) && route[2]) renderEditionDetail(route[2], route[1]);
        else renderEditionDetail(route[1]);
      } else if (route[0] === 'versus') {
        document.querySelector('nav a[data-route="/versus"]').classList.add('active');
        if ((isSeasonKey(route[1]) || route[1] === 'both') && route[2] && route[3]) renderVersus(route[2], route[3], route[1]);
        else renderVersus(route[1], route[2]);
      } else if (route[0] === 'videos') {
        document.querySelector('nav a[data-route="/videos"]').classList.add('active');
        renderVideos();
      } else {
        renderHome();
      }
    }

