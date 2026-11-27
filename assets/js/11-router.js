    /* ============ ROUTER ============ */
    function currentRoute() {
      const hash = location.hash.replace(/^#/, '') || '/';
      const parts = hash.split('/').filter(Boolean).map(part => {
        try { return decodeURIComponent(part); } catch (e) { return part; }
      });
      ROUTE_GAME = 'tmnf';
      if (parts[0] === 'tm20') {ROUTE_GAME = 'tm20'; parts.shift();}
      return parts;
    }
    window.addEventListener('hashchange', () => render()); // render() is defined below
    /* A page change starts at the top (hash links to non-anchors otherwise keep the old scroll position) */
    window.addEventListener('hashchange', () => window.scrollTo(0, 0));

    /* ============ PAGE RENDER ============ */
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
        renderPlayers(seasonArg(route[1], ['both']));
      } else if (route[0] === 'player' && route[1]) {
        if ((isSeasonKey(route[1]) || route[1] === 'all') && route[2]) renderPlayerProfileEnhanced(route[2], route[1]);
        else renderPlayerProfileEnhanced(route[1]);
      } else if (route[0] === 'history') {
        document.querySelector('nav a[data-route="/history"]').classList.add('active');
        renderHistory(seasonArg(route[1]));
      } else if (route[0] === 'maps') {
        document.querySelector('nav a[data-route="/maps"]').classList.add('active');
        renderMaps(seasonArg(route[1]));
      } else if (route[0] === 'records') {
        document.querySelector('nav a[data-route="/records"]').classList.add('active');
        renderRecords(seasonArg(route[1], ['both']));
      } else if (route[0] === 'rivalries') {
        document.querySelector('nav a[data-route="/rivalries"]').classList.add('active');
        renderRivalries(seasonArg(route[1], ['both']));
      } else if (route[0] === 'edition' && route[1]) {
        if (isSeasonKey(route[1]) && route[2]) renderEditionDetail(route[2], route[1]);
        else renderEditionDetail(route[1]);
      } else if (route[0] === 'versus') {
        document.querySelector('nav a[data-route="/versus"]').classList.add('active');
        if (isSeasonKey(route[1]) || route[1] === 'both') renderVersus(route[2], route[3], route[1]); // #/versus/s2 or #/versus/s2/A/B
        else renderVersus(route[1], route[2]);
      } else if (route[0] === 'videos') {
        document.querySelector('nav a[data-route="/videos"]').classList.add('active');
        renderVideos();
      } else {
        renderHome();
      }
    }

