    /* ============ GLOBAL SEARCH ============ */
    const searchInput = document.getElementById('globalSearch');
    const searchResults = document.getElementById('searchResults');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      if (!q || !RAW) {searchResults.style.display = 'none'; return;}

      // Archived seasons may not have finished their background preload yet - search
      // covers whatever is loaded and quietly widens once the rest arrives. Newest season first.
      const sources = GAME === 'tm20' ? [[curKey(), RAW]] : [[CURRENT_TMNF_SEASON, RAW], ['s2', SEASON_2], ['s1', SEASON_1]].filter(([, d]) => d);
      const keySets = sources.map(([key, d]) => [key, new Set(d.players.map(playerKey))]);
      const nameByKey = {};
      sources.forEach(([, d]) => d.players.forEach(n => {if (!(playerKey(n) in nameByKey)) nameByKey[playerKey(n)] = n;}));

      const playerMatches = [...new Set(keySets.flatMap(([, set]) => [...set]))]
        .map(k => nameByKey[k])
        .filter(n => n.toLowerCase().includes(q))
        .slice(0, 6);

      const editionMatches = sources.flatMap(([key, d]) => d.editions.filter(e => String(e.edition).toLowerCase().includes(q)).map(e => ({edition: e.edition, season: key}))).slice(0, 4);

      const items = [
        ...playerMatches.map(n => {
          const key = playerKey(n), inSeasons = keySets.filter(([, set]) => set.has(key)).map(([k]) => k);
          const season = inSeasons.length > 1 ? 'all' : (inSeasons[0] || curKey());
          return {label: `Player · ${n}`, href: `${GAME === 'tm20' ? '#/tm20' : '#'}/player/${season}/${encodeURIComponent(n)}`};
        }),
        ...editionMatches.map(e => ({label: `Edition ${e.edition} (${GAME === 'tm20' ? 'TM20' : SEASON_INFO[e.season].short})`, href: `${GAME === 'tm20' ? '#/tm20' : '#'}/edition/${e.season}/${encodeURIComponent(e.edition)}`}))
      ];
      if (!items.length) {searchResults.style.display = 'none'; return;}
      // Real links: keyboard reachable (Tab / Enter), open with the normal hash navigation
      searchResults.innerHTML = items.map(it => `<a href="${it.href}">${escapeHtml(it.label)}</a>`).join('');
      searchResults.style.display = 'block';
      searchResults.querySelectorAll('a').forEach(a => {
        a.addEventListener('click', () => {searchResults.style.display = 'none'; searchInput.value = '';});
      });
    });
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {searchResults.style.display = 'none';}
      else if (e.key === 'ArrowDown') {const first = searchResults.querySelector('a'); if (first && searchResults.style.display !== 'none') {e.preventDefault(); first.focus();}}
    });
    searchResults.addEventListener('keydown', e => {
      const links = [...searchResults.querySelectorAll('a')], i = links.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i < links.length - 1) {e.preventDefault(); links[i + 1].focus();}
      else if (e.key === 'ArrowUp') {e.preventDefault(); (i > 0 ? links[i - 1] : searchInput).focus();}
      else if (e.key === 'Escape') {searchResults.style.display = 'none'; searchInput.focus();}
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.search-wrap')) searchResults.style.display = 'none';
    });

    /* "/" jumps to search from anywhere outside a text field */
    document.addEventListener('keydown', e => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      e.preventDefault(); searchInput.focus();
    });

    /* ============ REFRESH ============ */
    document.getElementById('refreshBtn').addEventListener('click', init);

    /* ============ DATA SOURCE STATUS BANNER ============ */
    let dataSourceStatus = 'live'; // 'live' | 'fallback' | 'manual'

    function renderStatusBanner() {
      const existing = document.getElementById('statusBanner');
      if (existing) existing.remove();
      if (dataSourceStatus === 'live') return;

      const banner = document.createElement('div');
      banner.id = 'statusBanner';
      banner.setAttribute('role', 'status');
      const label = dataSourceStatus === 'fallback'
        ? `Couldn't load the ${SEASON_INFO[CURRENT_TMNF_SEASON].label} results. The table stays empty until the connection is back.`
        : "Showing manually loaded data.";
      banner.innerHTML = `
    <span>${label}</span>
    <button class="btn" id="bannerRetry" type="button">Retry live</button>
    <button class="btn" id="bannerManual" type="button">Load newer data</button>
    <span class="spacer"></span>
    <a href="https://docs.google.com/spreadsheets/d/${SEASON_3_SHEET_ID}/gviz/tq?tqx=out:html&sheet=${encodeURIComponent(SHEET_NAME)}" target="_blank" rel="noopener">Check raw sheet ↗</a>
  `;
      main.parentNode.insertBefore(banner, main);
      document.getElementById('bannerRetry').addEventListener('click', init);
      document.getElementById('bannerManual').addEventListener('click', () => renderManualPanel());
    }

    function renderManualPanel() {
      main.innerHTML = `
    <div class="panel form-panel">
      <h2 class="section-title">Load data manually</h2>
      <p>Select everything in the "Editions" tab and copy it (Ctrl/Cmd+C), then paste it below. Or download the tab as .csv and upload it.</p>
      <textarea id="manualPaste" class="field mono" aria-label="Sheet data" placeholder="Paste sheet data here" style="width:100%;min-height:120px;font-size:12px;margin-bottom:12px"></textarea>
      <div class="form-row">
        <button class="btn primary" id="usePasteBtn" type="button">Use pasted data</button>
        <label class="btn">
          Upload CSV file
          <input type="file" id="csvUpload" accept=".csv,.tsv,text/csv,text/tab-separated-values" class="sr-only">
        </label>
        <button class="btn" id="cancelManual" type="button">Cancel</button>
      </div>
      <div class="form-error" id="manualError" role="alert"></div>
    </div>
  `;
      document.getElementById('cancelManual').addEventListener('click', () => {if (RAW) {render(); renderStatusBanner();} else init();});
      document.getElementById('usePasteBtn').addEventListener('click', () => {
        const text = document.getElementById('manualPaste').value;
        const errEl = document.getElementById('manualError');
        try {
          if (!text.trim()) throw new Error('Paste some data first.');
          RAW = withBestOf(parseDelimitedText(text), CURRENT_TMNF_SEASON);
          dataSourceStatus = 'manual';
          render(); renderStatusBanner();
        } catch (e) {errEl.textContent = e.message;}
      });
      document.getElementById('csvUpload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            RAW = withBestOf(parseDelimitedText(reader.result), CURRENT_TMNF_SEASON);
            dataSourceStatus = 'manual';
            render(); renderStatusBanner();
          } catch (err2) {document.getElementById('manualError').textContent = err2.message;}
        };
        reader.onerror = () => {document.getElementById('manualError').textContent = 'Could not read file.';};
        reader.readAsText(file);
      });
    }

    /* ============ INIT ============ */
    async function init() {
      loadAvatarOverridesCache();
      prefillAvatarsFromStore();
      GAME = 'tmnf'; DATA.tm20 = null; // RAW below is always the TMNF data; TM2020 reloads on demand
      main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading SpeedTAS data...</div>`;
      const existingBanner = document.getElementById('statusBanner');
      if (existingBanner) existingBanner.remove();
      try {
        loadSeason2().catch(() => {}); // starts right away: the off-season home page shows Season 2, and it's needed later anyway
        RAW = withBestOf(await loadData(), CURRENT_TMNF_SEASON);
        dataSourceStatus = 'live';
        render();
        // Progressive enhancement, not blocking: avatarHTML() already has a
        // colored-initials fallback, so there's no reason the leaderboard
        // sits on a loading spinner for the whole (deliberately sequential,
        // see fetchAvatarsInBatches) avatar fetch. Re-render whatever route
        // is current once real avatars are in.
        loadDiscordProfiles().then(swapInAvatars);
        // Also warm the Season 1 cache in the background so it's likely
        // ready by the time someone uses global search or visits a
        // Season-1-aware page - loadSeason1() already caches its own result,
        // so this costs nothing extra later.
        loadSeason1().catch(err => console.warn('Background Season 1 preload failed (will retry when a page needs it):', err));
        loadSeason2().catch(err => console.warn('Background Season 2 preload failed (will retry when a page needs it):', err));
      } catch (err) {
        console.error(`${SEASON_INFO[CURRENT_TMNF_SEASON].label} results unavailable:`, err);
        try {
          // The built-in snapshot is Season 2 data, so it is never shown as the current season: show an empty season instead.
          RAW = withBestOf({editions: [], players: []}, CURRENT_TMNF_SEASON);
          dataSourceStatus = 'fallback';
          loadSeason1().catch(() => {}); loadSeason2().catch(() => {});
          render();
          renderStatusBanner();
          loadDiscordProfiles().then(swapInAvatars); // pictures don't depend on the sheet being live
        } catch (err2) {
          console.error(err2);
          renderManualPanel();
        }
      }
    }
    new MutationObserver(() => prefixLinks(main)).observe(main, {childList: true, subtree: true});
    init();

