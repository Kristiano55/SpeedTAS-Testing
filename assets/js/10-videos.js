    /* ============ VIDEOS TAB (public YouTube RSS feed — no key involved) ============
       A YouTube Data API key would have to ship inside this file's source to
       work for site visitors, and anyone can open dev tools or view-source on
       a published page and lift it straight out — so instead of asking for one,
       this reads the channel's public RSS feed (no credentials at all) through
       the free rss2json proxy, which turns the XML into plain JSON a browser
       can fetch directly. Nothing secret ever touches this file.
       The RSS feed only exposes the ~15 most recent uploads, so older ones come
       from data/videos.json (saved by the data Action), which is also the
       fallback when both live sources are down. */
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

    /* Every upload the data Action has saved (data/videos.json, same site, so it works when the live
       feeds are down). It also goes further back than the ~15 videos the live feeds return. */
    async function savedChannelVideos() {
      const saved = await repoVideos();
      return Object.entries((saved && saved.videos) || {}).map(([id, v]) => ({
        id, title: v.title || 'Untitled', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, publishedAt: v.published || ''
      }));
    }
    /* Live list first (newest uploads), then the saved older ones it doesn't include, newest first. */
    async function fetchChannelVideos() {
      const [live, saved] = await Promise.all([
        fetchLiveChannelVideos().catch(err => {console.warn('Live video feed unavailable, using the saved list:', err); return null;}),
        savedChannelVideos().catch(() => [])
      ]);
      if (!live && !saved.length) throw new Error('Could not read the channel feed.');
      const seen = new Set((live || []).map(v => v.id));
      const merged = [...(live || []), ...saved.filter(v => !seen.has(v.id))];
      const time = v => {const t = Date.parse(v.publishedAt); return isNaN(t) ? 0 : t;};
      return merged.sort((a, b) => time(b) - time(a));
    }
    async function fetchLiveChannelVideos() {
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


    let videosCache = null;

    function renderVideos() {
      main.innerHTML = `
    <header class="page-head"><div class="kicker">Race results on video</div><h1>Video <em>archive</em></h1><p>The latest SpeedTAS uploads from <a href="https://www.youtube.com/@Kristiano55-tas" target="_blank" rel="noopener">Kristiano's YouTube channel ↗</a>. Pick one to play it here.</p></header>
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
