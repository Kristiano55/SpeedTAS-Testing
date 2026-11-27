    /* ============ RENDER: HOME ============ */
    let HOME_ARCHIVE = null, HOME_ARCHIVE_FAILED = false;
    function renderHome() {
      if (isOffSeason() && !HOME_ARCHIVE && !HOME_ARCHIVE_FAILED) {
        main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading ${escapeHtml(SEASON_INFO[ARCHIVE_DEFAULT].label)} final standings…</div>`;
        const done = () => {if (GAME === 'tmnf' && currentRoute().length === 0) renderHome();};
        loadSeasonData(ARCHIVE_DEFAULT).then(d => {HOME_ARCHIVE = d;}).catch(err => {console.warn('Off-season archive unavailable; showing the empty current season.', err); HOME_ARCHIVE_FAILED = true;}).then(done);
        return;
      }
      const archive = isOffSeason() ? HOME_ARCHIVE : null; // Season 2 data while Season 3 has no results
      const D = archive || RAW;
      const homeKey = archive ? ARCHIVE_DEFAULT : curKey();
      const sk = archive ? ARCHIVE_DEFAULT + '/' : ''; // season prefix for player/edition links
      setSeasonTheme(archive ? ARCHIVE_DEFAULT : null);
      const {players, editionOrder, ranked} = computeAll(D);
      const totalEditions = D.editions.length;
      const totalPlayers = ranked.length;
      const totalPodiums = ranked.reduce((a, p) => a + p.podiums, 0);
      const avgParticipants = totalEditions ? (D.editions.reduce((a, e) => a + Object.keys(e.results).length, 0) / totalEditions).toFixed(1) : 0;
      const leader = ranked[0];
      /* Closest battle: only top-15 players on 10+ points qualify, so the bottom of the
         table can't produce meaningless 0 vs 0 "battles". ranked is sorted by points,
         so the closest pair is always two neighbours in the filtered list. */
      const CLOSEST_MIN_POINTS = 10;
      const CLOSEST_TOP = 15; // only battles inside the top 15 are worth a headline
      const battleField = ranked.filter(p => p.points >= CLOSEST_MIN_POINTS && p.rank <= CLOSEST_TOP);
      let closestGap = null, closestPair = null;
      for (let i = 0; i < battleField.length - 1; i++) {
        const gap = battleField[i].points - battleField[i + 1].points;
        if (closestGap === null || gap < closestGap) {closestGap = gap; closestPair = [battleField[i], battleField[i + 1]];}
      }
      const latestEdition = D.editions[D.editions.length - 1];
      const latestEntries = latestEdition ? Object.entries(latestEdition.results).sort((a, b) => a[1] - b[1]) : [];
      const latestWinner = latestEntries.find(([, place]) => place === 1)?.[0] || '—';
      const latestPodium = latestEntries.filter(([, place]) => place <= 3);
      const beforeLatest = new Set(D.editions.slice(0, -1).flatMap(ed => Object.keys(ed.results)));
      /* First-timers = never raced SpeedTAS before, earlier seasons included (TMNF), not just new to this season. */
      const earlierSeasons = GAME === 'tmnf' ? (homeKey === 's3' ? [SEASON_2, SEASON_1] : homeKey === 's2' ? [SEASON_1] : []) : [];
      const earlierKeys = new Set(earlierSeasons.filter(Boolean).flatMap(d => d.editions.flatMap(ed => Object.keys(ed.results))).map(playerKey));
      const debutants = latestEntries.filter(([name]) => !beforeLatest.has(name) && !earlierKeys.has(playerKey(name))).map(([name]) => name);
      const archivesPending = earlierSeasons.some(d => !d); // older seasons still loading: redraw once they're in
      /* Season complete (all editions run): final wording instead of "leader". */
      const infoNow = GAME === 'tmnf' ? SEASON_INFO[CURRENT_TMNF_SEASON] : null;
      const seasonDone = !archive && !!(infoNow && infoNow.editions && D.editions.length >= infoNow.editions);
      /* "Last N" ranges only when the season has more than N editions. */
      const rangeOpts = [5, 10, 25].filter(n => n < D.editions.length);
      const range = rangeOpts.includes(+leaderboardFilter) ? leaderboardFilter : 'all';
      const climber = [...ranked].filter(p => p.movement > 0).sort((a, b) => b.movement - a.movement)[0];

      const filteredEditions = range === 'all' ? D.editions :
        D.editions.slice(-parseInt(range));
      const filteredData = {editions: filteredEditions, players: D.players, bestOf: D.bestOf};
      const filteredComputed = range === 'all' ? {players, ranked} : computeAll(filteredData);
      const board = range === 'all' ? ranked : filteredComputed.ranked;

      const sorted = sortBoard(board, sortState);

      const E = escapeHtml;
      const restPodium = latestPodium.filter(([, place]) => place > 1);
      const boardTop = board.length ? Math.max(...board.map(p => p.points)) : 0;
      const runnerUp = ranked[1];
      const gameName = GAME === 'tm20' ? 'Trackmania 2020' : 'Trackmania Nations Forever';
      const playerLink = n => `<a href="#/player/${sk}${enc(n)}">${E(n)}</a>`;
      const notes = [
        leader ? `<div class="note"><div><div class="panel-label">${archive ? E(SEASON_INFO[ARCHIVE_DEFAULT].label) + ' champion' : seasonDone ? E(infoNow.label) + ' champion' : 'Championship leader'}</div><div class="note-title">${playerLink(leader.name)}</div></div><div class="note-fig">${leader.points} pts</div><div class="note-detail">${runnerUp ? (leader.points - runnerUp.points) + ' pt lead over ' + E(runnerUp.name) : 'No challenger yet'} · ${plural(leader.wins, 'win')}</div></div>` : '',
        `<div class="note"><div><div class="panel-label">Closest battle</div><div class="note-title">${closestPair ? `<a href="#/versus/${homeKey}/${enc(closestPair[0].name)}/${enc(closestPair[1].name)}">${E(closestPair[0].name)} vs ${E(closestPair[1].name)}</a>` : 'Not yet'}</div></div><div class="note-fig">${closestPair ? closestGap + ' pt gap' : ''}</div><div class="note-detail">${closestPair ? 'P' + closestPair[0].rank + ' against P' + closestPair[1].rank + ' in the standings' : 'Needs two players on ' + CLOSEST_MIN_POINTS + '+ points'}</div></div>`,
        `<div class="note"><div><div class="panel-label">Biggest climber</div><div class="note-title">${climber ? playerLink(climber.name) : 'No movement yet'}</div></div><div class="note-fig up">${climber ? '▲ ' + climber.movement : ''}</div><div class="note-detail">${climber ? plural(climber.movement, 'place') + ' gained after Edition ' + E(latestEdition?.edition || '—') : 'Rank shifts appear after another edition'}</div></div>`,
        `<div class="note"><div><div class="panel-label">First-timers</div><div class="note-title">${debutants.length ? debutants.map(E).join(', ') : (latestEdition ? 'No debuts' : 'Not yet')}</div></div><div class="note-avs">${debutants.slice(0, 4).map(name => avatarHTML(name, 26)).join('')}</div><div class="note-detail">${debutants.length ? 'Welcome to the SpeedTAS grid' : (latestEdition ? 'Every racer in the latest edition had competed before' : 'New names show up here after each edition')}</div></div>`
      ].join('');
      const info = GAME === 'tmnf' ? SEASON_INFO[CURRENT_TMNF_SEASON] : null;
      const next = GAME === 'tmnf' ? nextEditionLisbon() : null;
      const preSeason = info && !RAW.editions.length;
      const bestOfNote = !archive && info && info.bestOf ? `Only each player's best ${info.bestOf} of ${info.editions} results count.` : '';
      main.innerHTML = `
    ${GAME === 'tmnf' ? '<div id="liveSlot"></div>' : ''}
    <header class="page-head">
      ${archive ? `<div class="kicker">${gameName} · Off-season · ${E(info.label)} starts ${E(fmtLisbonDay(info.start))}</div>
      <h1>${E(SEASON_INFO[ARCHIVE_DEFAULT].label)} <em>final standings</em></h1>
      <p>One hour to TAS a map, fastest run wins. ${E(info.label)} is coming soon. Until then, here's how ${E(SEASON_INFO[ARCHIVE_DEFAULT].label)} finished after ${plural(totalEditions, 'edition')}.</p>` : `<div class="kicker">${gameName} · ${info && info.editions ? `${totalEditions} of ${info.editions} editions run` : plural(totalEditions, 'edition') + ' run'}</div>
      <h1>${E(S2L())} <em>${seasonDone ? 'final standings' : 'standings'}</em></h1>
      <p>${seasonDone ? `One hour to TAS a map, fastest run wins. ${E(info.label)} is complete: here's how all ${info.editions} editions finished.${bestOfNote ? ' ' + E(bestOfNote) : ''}` : `One hour to TAS a map, fastest run wins. Live championship standings, the latest result and every battle worth watching.${bestOfNote ? ' ' + E(bestOfNote) : ''}`}</p>`}
    </header>
    ${GAME === 'tmnf' ? honorsHTML(homeKey, seasonOutcome(homeKey, D)) : ''}

    <div class="home-grid">
      <article class="panel latest" aria-label="Latest edition result">
        <div class="latest-head">
          <div><div class="panel-label">${archive ? E(SEASON_INFO[ARCHIVE_DEFAULT].label) + ' finale' : 'Latest result'}</div><h2>${latestEdition ? 'Edition ' + E(latestEdition.edition) : (preSeason && info.start ? `${E(info.label)} starts ${E(fmtLisbonDay(info.start))}` : 'Waiting for the first result')}</h2>${preSeason && !archive ? `<p class="latest-sub">The opening edition's podium appears here right after the race.</p>` : ''}</div>
          ${latestEdition ? `<a class="btn" href="#/edition/${sk}${enc(latestEdition.edition)}">Full results →</a>` : ''}
        </div>
        ${latestEntries.length > 3 ? `<ol class="latest-rest" aria-label="Other finishers">${latestEntries.filter(([, place]) => place > 3).slice(0, 7).map(([n, place]) => `<li><a href="#/player/${sk}${enc(n)}"><span class="num">P${place}</span>${E(n)}</a></li>`).join('')}${latestEntries.length > 10 ? `<li class="more">+${latestEntries.length - 10} more</li>` : ''}</ol>` : ''}
        ${latestEdition ? '<div class="latest-map" id="latestMap" hidden></div>' : ''}
        ${podiumHTML(latestPodium, `#/player/${sk}`)}
      </article>
      <aside class="home-side">
        ${GAME === 'tm20' ? '' : `<div class="panel next-up" aria-label="Next edition">
          <div class="panel-label">${next && next.iso === (info && info.start) ? E(info.label) + ' opener starts in' : 'Next SpeedTAS starts in'}</div>
          <div class="countdown" id="countdown"></div>
          <small>${next ? E(fmtLisbonDay(next.iso)) + ' · ' : 'Every Saturday · '}${EDITION_HOUR_LISBON}:00 Lisbon time${next ? E(yourTime(next.at)) : ''}</small>
          ${next && next.skipped.length ? `<small class="break-note">No edition on ${next.skipped.map(fmtLisbonDay).map(E).join(', ')} (break)</small>` : ''}
        </div>`}
        <div class="panel notes">${notes}</div>
      </aside>
    </div>

    <div class="stat-strip" role="list">
      <div class="stat" role="listitem"><div class="label">Editions</div><div class="value">${totalEditions}</div></div>
      <div class="stat" role="listitem"><div class="label">Players</div><div class="value">${totalPlayers}</div></div>
      <div class="stat" role="listitem"><div class="label">Avg field size</div><div class="value">${avgParticipants}</div></div>
      <div class="stat" role="listitem"><div class="label">Podium finishes</div><div class="value">${totalPodiums}</div></div>
    </div>

    <section>
      <div class="head-row">
        <h2 class="section-title">${archive || seasonDone ? 'Final table' : 'Championship table'}</h2>${!archive && info && info.bestOf ? `<span class="head-note">Best ${info.bestOf} of ${info.editions} count · dropped results are faded</span>` : ''}
        <div class="toolbar-group">
          <div class="seg" role="group" aria-label="Leaderboard range">
            <button type="button" class="filter-btn ${range === 'all' ? 'active' : ''}" data-filter="all" aria-pressed="${range === 'all'}">All editions</button>
            ${rangeOpts.map(n => `<button type="button" class="filter-btn ${range === String(n) ? 'active' : ''}" data-filter="${n}" aria-pressed="${range === String(n)}">Last ${n}</button>`).join('')}
          </div>
          <button type="button" class="btn" id="exportCsv">Export CSV</button>
        </div>
      </div>
      <div class="panel flush">
        <div class="table-wrap">
          <table id="leaderboardTable">
            <thead><tr>
              <th data-key="rank">Pos</th>
              <th data-key="move" class="col-move"><span class="sr-only">Movement</span></th>
              <th data-key="name">Player</th>
              <th class="col-form">Last 5</th>
              <th data-key="wins" class="r"><span class="full">Wins</span><span class="abbr" aria-hidden="true">W</span></th>
              <th data-key="podiums" class="r"><span class="full">Podiums</span><span class="abbr" aria-hidden="true">Pod</span></th>
              <th data-key="avgPlacement" class="r col-avg">Avg place</th>
              <th data-key="played" class="r col-played">Races</th>
              <th class="r col-gap">Gap</th>
              <th data-key="points" class="r"><span class="full">Points</span><span class="abbr" aria-hidden="true">Pts</span></th>
            </tr></thead>
            <tbody>
              ${sorted.length ? '' : `<tr class="empty-row"><td colspan="10">No results yet. The table fills in after the first edition.</td></tr>`}
              ${sorted.map(p => `
                <tr class="${p.rank <= 3 ? 'p' + p.rank : ''}">
                  <td class="rank-cell">${p.rank}</td>
                  <td class="col-move">${moveIcon(p.movement || 0)}</td>
                  <td><a href="#/player/${sk}${enc(p.name)}"><div class="player-cell">${avatarHTML(p.name)}<b>${E(p.name)}</b><span class="move-inline">${moveIcon(p.movement || 0)}</span></div></a></td>
                  <td class="col-form"><span class="form">${p.history.slice(-5).map(h => formChip(h.placement, 'Edition ' + h.edition + ': P' + h.placement + (h.dropped ? ' (dropped)' : ''), null, h.dropped)).join('')}</span></td>
                  <td class="numc r">${p.wins}</td>
                  <td class="numc r">${p.podiums}</td>
                  <td class="numc r col-avg">${p.avgPlacement ? p.avgPlacement.toFixed(2) : '—'}</td>
                  <td class="numc r col-played">${p.played}</td>
                  <td class="numc r col-gap">${p.points === boardTop ? '—' : '−' + (boardTop - p.points)}</td>
                  <td class="pts-cell r"${p.droppedPoints ? ` title="${p.scored} scored, ${p.droppedPoints} dropped"` : ''}><b>${p.points}</b><span class="pts-bar" style="width:${boardTop ? Math.round(p.points / boardTop * 100) : 0}%"></span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    ${titleRaceHTML(archive ? null : info, ranked, totalEditions, sk)}

    <section>
      <div class="head-row"><h2 class="section-title">Title race</h2><span class="head-note">Cumulative points of the top six, edition by edition</span></div>
      <div class="panel">
        <div class="chart-box" role="img" aria-label="Line chart of cumulative points for the top six players across editions"><canvas id="progressChart"></canvas></div>
      </div>
    </section>
  `;

      setupSortableTable(board);
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.addEventListener('click', () => {leaderboardFilter = b.dataset.filter; renderHome();});
      });
      document.getElementById('exportCsv').addEventListener('click', () => exportLeaderboardCSV(sorted));
      if (GAME === 'tmnf') bindHonors(homeKey, D);

      startCountdown();
      if (GAME === 'tmnf') startLiveBanner();
      if (archivesPending) Promise.all([loadSeason1(), loadSeason2()]).catch(() => {}).then(() => {if (currentRoute().length === 0 && GAME === 'tmnf') renderHome();});
      renderProgressChart(players, editionOrder, ranked);
      if (latestEdition) fillLatestMap(homeKey, latestEdition, sk);
    }

    /* Latest-result card: the map (picture, name, author), the winning time and the margin to P2.
       Filled in once maps.json and the times are loaded; stays hidden when neither is known. */
    function fillLatestMap(seasonKey, edition, sk) {
      Promise.all([repoMaps(), seasonTimes(seasonKey)]).then(([maps, times]) => {
        const el = document.getElementById('latestMap');
        if (!el) return;
        const E = escapeHtml, ed = String(edition.edition);
        const map = (maps[mapKeyFor(seasonKey)] || {})[ed];
        const secs = Object.values(times[ed] || {}).map(t => t.secs).filter(x => x != null).sort((a, b) => a - b);
        if (!map && !secs.length) return;
        const thumb = map ? mapThumb(map) : '', href = `#/edition/${sk}${enc(ed)}`;
        const fig = (label, value) => value ? `<div><span class="panel-label">${label}</span><b>${value}</b></div>` : '';
        el.innerHTML = `
          ${thumb ? `<a class="latest-map-img" href="${href}" tabindex="-1" aria-hidden="true"><img src="${E(thumb)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
          <div class="latest-map-info"><span class="panel-label">Map</span><b>${E(map ? map.name : 'Edition ' + ed)}</b>${map && map.authors && map.authors.length ? `<small>by ${E(map.authors.join(', '))}</small>` : ''}</div>
          <div class="latest-map-figs">
            ${fig('Winning time', secs.length ? fmtMs(Math.round(secs[0] * 1000)) : '')}
            ${fig('Margin', secs.length > 1 ? '+' + (secs[1] - secs[0]).toFixed(2) : '')}
            ${fig('Author time', map && map.authorTime ? fmtMs(map.authorTime) : '')}
          </div>`;
        el.hidden = false;
      });
    }

    function sortBoard(board, state) {
      const arr = [...board];
      const keyMap = {
        rank: p => p.rank, name: p => p.name.toLowerCase(), points: p => p.points, wins: p => p.wins,
        podiums: p => p.podiums, avgPlacement: p => p.avgPlacement ?? 999, played: p => p.played, move: p => p.movement || 0
      };
      const key = keyMap[state.key] || keyMap.points;
      arr.sort((a, b) => {
        const av = key(a), bv = key(b);
        if (av < bv) return state.dir === 'asc' ? -1 : 1;
        if (av > bv) return state.dir === 'asc' ? 1 : -1;
        return 0;
      });
      return arr;
    }

    function setupSortableTable(board) {
      document.querySelectorAll('#leaderboardTable th[data-key]').forEach(th => {
        const sortBy = () => {
          if (sortState.key === th.dataset.key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
          else {sortState.key = th.dataset.key; sortState.dir = 'desc';}
          const key = th.dataset.key;
          renderHome();
          // renderHome rebuilds the table, so hand keyboard focus back to the header that was used
          const again = document.querySelector(`#leaderboardTable th[data-key="${key}"]`); if (again) again.focus();
        };
        if (th.dataset.key === sortState.key) {
          th.classList.add('sorted');
          th.setAttribute('aria-sort', sortState.dir === 'asc' ? 'ascending' : 'descending');
        }
        // Headers are keyboard-operable: Tab to focus, Enter or Space to sort
        th.tabIndex = 0;
        th.addEventListener('click', sortBy);
        th.addEventListener('keydown', e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); sortBy();}});
      });
    }

    function exportLeaderboardCSV(board) {
      const rows = [['Rank', 'Player', 'Points', 'Wins', 'Podiums', 'AvgPlacement', 'EditionsPlayed']];
      board.forEach(p => rows.push([p.rank, p.name, p.points, p.wins, p.podiums, p.avgPlacement ? p.avgPlacement.toFixed(2) : '', p.played]));
      const csv = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], {type: 'text/csv'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'speedtas_leaderboard.csv'; a.click();
      URL.revokeObjectURL(url);
    }

    /* ============ COUNTDOWN ============ */
    let countdownTimer = null;
    /* Real moment of a Lisbon wall-clock time (handles summer/winter time). */
    function lisbonMoment(y, m, d, hour) {
      const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'Europe/Lisbon', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'}).formatToParts(new Date(guess)).map(p => [p.type, p.value]));
      const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
      return new Date(guess - (shown - guess));
    }
    const isoDay = t => new Date(t).toISOString().slice(0, 10);
    /* Next points edition: Saturdays at 18:00 Lisbon, skipping the breaks and anything before the season starts.
       Returns {at: Date, skipped: [break dates passed over]}. An edition counts as "next" until its hour is over. */
    function nextEditionLisbon() {
      const now = Date.now();
      const today = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date(now)).map(p => [p.type, p.value]));
      let day = Date.UTC(+today.year, +today.month - 1, +today.day);
      day += ((6 - new Date(day).getUTCDay() + 7) % 7) * 86400000; // this or next Saturday
      const start = SEASON_INFO[CURRENT_TMNF_SEASON].start;
      const skipped = [];
      for (let i = 0; i < 60; i++) {
        const iso = isoDay(day), [y, m, d] = iso.split('-').map(Number), at = lisbonMoment(y, m, d, EDITION_HOUR_LISBON);
        if (at.getTime() + 3600e3 <= now) {day += 7 * 86400000; continue;} // still "next" during the hour it runs
        if ((start && iso < start) || SCHEDULE_BREAKS.includes(iso)) {if (!(start && iso < start)) skipped.push(iso); day += 7 * 86400000; continue;}
        return {at, skipped, iso};
      }
      return {at: lisbonMoment(...isoDay(day).split('-').map(Number), EDITION_HOUR_LISBON), skipped, iso: isoDay(day)};
    }
    const fmtLisbonDay = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
    function startCountdown() {
      if (countdownTimer) clearInterval(countdownTimer);
      function tick() {
        const target = nextEditionLisbon().at;
        const diff = target.getTime() - Date.now();
        const el = document.getElementById('countdown');
        if (!el) {clearInterval(countdownTimer); return;}
        if (diff <= 0) {el.innerHTML = '<div class="unit"><div class="num">Live</div><div class="unit-label">The edition is running now</div></div>'; return;}
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        el.innerHTML = `
      <div class="unit"><div class="num">${days}</div><div class="unit-label">Days</div></div>
      <div class="unit"><div class="num">${String(hours).padStart(2, '0')}</div><div class="unit-label">Hours</div></div>
      <div class="unit"><div class="num">${String(mins).padStart(2, '0')}</div><div class="unit-label">Minutes</div></div>
      <div class="unit"><div class="num">${String(secs).padStart(2, '0')}</div><div class="unit-label">Seconds</div></div>
    `;
      }
      tick();
      countdownTimer = setInterval(tick, 1000);
    }

    /* ============ TITLE RACE CALCULATOR ============
       Who can still be champion. Max possible = a player's best results if they win every remaining edition
       (with "best N of M", a win replaces their lowest counted result). Anyone whose max possible can reach the
       leader's current points is still in the race. Points never go down, so the leader's current total is safe. */
    function titleRace(info, ranked, played) {
      if (!info || !info.editions || !ranked.length || !played) return null;
      const left = info.editions - played;
      if (left <= 0) return null;
      const win = pointsFor(1), bestOf = info.bestOf || info.editions;
      const maxFor = p => p.history.map(h => h.points).concat(Array(left).fill(win)).sort((a, b) => b - a).slice(0, bestOf).reduce((a, b) => a + b, 0);
      const leader = ranked[0];
      const rows = ranked.map(p => ({p, max: maxFor(p)})).filter(r => r.max >= leader.points);
      return {left, leader, rows, out: ranked.length - rows.length, clinched: rows.length === 1};
    }
    function titleRaceHTML(info, ranked, played, sk = '') {
      const race = titleRace(info, ranked, played);
      if (!race || (!race.out && race.left > 4)) return ''; // shown once someone is out of it, or in the last 4 editions
      const E = escapeHtml, top = Math.max(...race.rows.map(r => r.max)), shown = race.rows.slice(0, 10);
      const status = r => r.p === race.leader ? (race.clinched ? '<span class="tr-tag win">Champion</span>' : '<span class="tr-tag lead">Leader</span>')
        : r.max === race.leader.points ? '<span class="tr-tag edge">Needs a perfect run</span>' : '<span class="tr-tag">Can still win</span>';
      return `<section>
      <div class="head-row"><h2 class="section-title">Who can still win</h2><span class="head-note">${plural(race.left, 'edition')} left · max possible = winning every remaining edition${info.bestOf ? ` (best ${info.bestOf} of ${info.editions} count)` : ''}</span></div>
      <div class="panel title-calc">
        ${race.clinched ? `<p class="tr-clinched">🏆 <b>${E(race.leader.name)}</b> has clinched the title: nobody can reach ${race.leader.points} points any more.</p>` : ''}
        <ol class="tr-list">${shown.map(r => `<li>
          <a href="#/player/${sk}${enc(r.p.name)}" class="tr-name">${avatarHTML(r.p.name, 26)}<b>${E(r.p.name)}</b></a>
          <div class="tr-bar" title="${r.p.points} points now, ${r.max} at most"><span class="now" style="width:${(r.p.points / top * 100).toFixed(1)}%"></span><span class="max" style="width:${(r.max / top * 100).toFixed(1)}%"></span></div>
          <div class="tr-nums"><b>${r.p.points}</b> now · <b>${r.max}</b> max${r.p === race.leader ? '' : ` · −${race.leader.points - r.p.points}`}</div>
          ${status(r)}</li>`).join('')}</ol>
        <p class="tr-foot">${race.rows.length > shown.length ? `+${race.rows.length - shown.length} more can still win mathematically. ` : ''}${race.out ? `${plural(race.out, 'player')} can no longer catch ${E(race.leader.name)}.` : ''}</p>
      </div>
    </section>`;
    }

    /* ============ LIVE EDITION (Saturdays) ============
       Around the edition hour the home page gets a banner: starting soon (30 min before), live (18:00-19:00 Lisbon,
       with the time left), then "results coming" until the data update has run, then "results are in" until midnight.
       data/updated.json tells when the GitHub Action last ran. */
    let liveTimer = null, UPDATED_AT = 0, updatedPoll = 0;
    const fetchUpdatedAt = () => fetch('data/updated.json', {cache: 'no-cache'}).then(r => r.ok ? r.json() : {}).then(j => {UPDATED_AT = Date.parse(j.at) || 0; return UPDATED_AT;}).catch(() => UPDATED_AT);
    function todaysEdition() {
      if (GAME !== 'tmnf') return null;
      const t = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'}).formatToParts(new Date()).map(p => [p.type, p.value]));
      const iso = `${t.year}-${t.month}-${t.day}`, start = SEASON_INFO[CURRENT_TMNF_SEASON].start;
      if (t.weekday !== 'Sat' || (start && iso < start) || SCHEDULE_BREAKS.includes(iso)) return null;
      return {iso, at: lisbonMoment(+t.year, +t.month, +t.day, EDITION_HOUR_LISBON).getTime()};
    }
    function liveState() {
      const today = todaysEdition();
      if (!today) return null;
      const now = Date.now(), end = today.at + 3600e3;
      const next = RAW.editions.length + 1, label = `SpeedTAS ${CURRENT_TMNF_SEASON.slice(1)} #${next}`;
      if (now < today.at - 1800e3) return null;
      if (now < today.at) return {phase: 'soon', label, until: today.at};
      if (now < end) return {phase: 'live', label, until: end};
      if (UPDATED_AT > end && UPDATED_AT <= now + 6e4 && RAW.editions.length) {const last = RAW.editions[RAW.editions.length - 1]; return {phase: 'results', label: `SpeedTAS ${CURRENT_TMNF_SEASON.slice(1)} #${last.edition}`, edition: last.edition};}
      return {phase: 'waiting', label};
    }
    const mmss = ms => {const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;};
    function liveBannerHTML(st) {
      const E = escapeHtml, ex = '<a class="btn" href="https://tmtas.exchange/events" target="_blank" rel="noopener">TAS Exchange ↗</a>';
      if (st.phase === 'soon') return `<div class="live-banner soon"><span class="live-tag">Soon</span><div><b>${E(st.label)}</b> starts in <b class="live-clock">${mmss(st.until - Date.now())}</b></div>${ex}</div>`;
      if (st.phase === 'live') return `<div class="live-banner on"><span class="live-tag"><i></i>Live</span><div><b>${E(st.label)}</b> is running · submissions close in <b class="live-clock">${mmss(st.until - Date.now())}</b></div>${ex}</div>`;
      if (st.phase === 'waiting') return `<div class="live-banner"><span class="live-tag">Done</span><div><b>${E(st.label)}</b> has finished · results appear here shortly</div>${ex}</div>`;
      return `<div class="live-banner"><span class="live-tag">Results</span><div><b>${E(st.label)}</b> results are in</div><a class="btn" href="#/edition/${enc(st.edition)}">See results →</a></div>`;
    }
    function startLiveBanner() {
      if (liveTimer) clearInterval(liveTimer);
      const tick = () => {
        const el = document.getElementById('liveSlot');
        if (!el) {clearInterval(liveTimer); liveTimer = null; return;}
        const st = liveState(), sig = st ? st.phase + st.label : '';
        if (el.dataset.sig !== sig) {el.dataset.sig = sig; el.innerHTML = st ? liveBannerHTML(st) : '';} // rebuild only when the phase changes
        else if (st && st.until) {const c = el.querySelector('.live-clock'); if (c) c.textContent = mmss(st.until - Date.now());}
        /* While waiting for results, check every 2 minutes whether the data update has run, then reload the data. */
        if (st && st.phase === 'waiting' && Date.now() - updatedPoll > 120e3) {
          updatedPoll = Date.now();
          const before = UPDATED_AT;
          fetchUpdatedAt().then(t => {if (t > before && t > Date.now() - 6 * 3600e3) init();});
        }
      };
      fetchUpdatedAt().then(tick);
      tick();
      liveTimer = setInterval(tick, 1000);
    }

