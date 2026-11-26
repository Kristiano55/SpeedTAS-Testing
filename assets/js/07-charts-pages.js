    /* ============ CHARTS ============ */
    const accentHex = () => getComputedStyle(document.body).getPropertyValue('--accent').trim() || (GAME === 'tm20' ? '#59d6fb' : '#b388ff');
    /* Series colours for the top-six chart: the game accent leads, the rest stay clearly apart from it. */
    const seriesColors = () => GAME === 'tm20' ? [accentHex(), '#ff4f79', '#4d8dff', '#ffb347', '#b08bff', '#e9fb59'] : [accentHex(), '#ff4f79', '#4d8dff', '#ffb347', document.body.classList.contains('season-legacy') ? '#b388ff' : '#e9fb59', '#59d6fb'];
    function chartOptions(extra = {}) {
      const tick = {color: '#9094a0', font: {family: "'JetBrains Mono', monospace", size: 11}};
      const grid = {color: '#1c1f25'};
      return {
        responsive: true, maintainAspectRatio: false,
        interaction: {mode: 'index', intersect: false},
        plugins: {
          legend: {display: false},
          tooltip: {backgroundColor: '#14161a', borderColor: '#363b45', borderWidth: 1, titleColor: accentHex(), bodyColor: '#eef0ea', padding: 10, cornerRadius: 5, usePointStyle: true, boxPadding: 4}
        },
        scales: {x: {ticks: tick, grid, border: {color: '#23262d'}}, y: {ticks: {...tick, precision: 0}, grid, border: {color: '#23262d'}}},
        ...extra
      };
    }
    let progressChartInstance = null;
    function renderProgressChart(players, editionOrder, ranked) {
      const top6 = ranked.slice(0, 6);
      const ctx = document.getElementById('progressChart');
      if (!ctx) return;
      if (!window.Chart) {whenChart(() => {if (document.body.contains(ctx)) renderProgressChart(players, editionOrder, ranked);}); return;}
      if (progressChartInstance) progressChartInstance.destroy();
      const colors = seriesColors();
      const opts = chartOptions();
      opts.plugins.legend = {display: true, position: 'bottom', labels: {color: '#eef0ea', usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 18, font: {family: "'Barlow', sans-serif", size: 13, weight: 600}}};
      opts.scales.x.title = {display: true, text: 'Edition', color: '#5f636e'};
      progressChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: editionOrder,
          datasets: top6.map((p, i) => ({
            label: p.name,
            data: p.cumulative,
            borderColor: colors[i],
            backgroundColor: colors[i],
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: i === 0 ? 3 : 2
          }))
        },
        options: opts
      });
    }

    /* ============ RENDER: PLAYERS DIRECTORY ============ */
    function renderPlayers(seasonKey = viewKey(), seasonData = null) {
      setSeasonTheme(seasonKey);
      if (seasonKey !== curKey() && !seasonData) {
        main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading player directory…</div>`;
        (seasonKey === 'both' ? loadAllTmnfSeasons() : loadSeasonData(seasonKey)).then(data => renderPlayers(seasonKey, data)).catch(seasonError);
        return;
      }
      let ranked, label;
      if (seasonKey === 'both') {
        /* seasonData = [[key, data], ...]: each season's own championship points, added up */
        const rows = comparisonRows(...seasonData.map(([key, data]) => seasonStats(key === curKey() ? RAW : data)));
        ranked = rows.map(r => ({name: r.name, points: r.total, played: r.played, wins: r.wins, podiums: r.podiums})).sort((a, b) => b.points - a.points || b.wins - a.wins).map((p, i) => ({...p, rank: i + 1})); label = 'All seasons';
      } else {ranked = seasonStats(seasonKey === curKey() ? RAW : seasonData); label = labelFor(seasonKey);}
      const linkSeason = seasonKey === 'both' ? 'all' : seasonKey;
      const E = escapeHtml;
      main.innerHTML = `
    <header class="page-head"><div class="kicker">${E(label)} · ${plural(ranked.length, 'player')}</div><h1>Player <em>directory</em></h1><p>Everyone who has entered a SpeedTAS edition, in championship order.</p></header>
    <div class="toolbar">${seasonSeg(seasonKey, 'directory-season', seasonOptions('both'))}<input id="dirSearch" class="field" type="search" placeholder="Filter players" aria-label="Filter players" autocomplete="off"></div>
    <div class="directory" id="directoryGrid">${ranked.map(p => `<a href="#/player/${linkSeason}/${enc(p.name)}" class="player-card-link" data-name="${E(p.name.toLowerCase())}"><div class="player-card ${p.rank <= 3 ? 'top r' + p.rank : ''}">${avatarHTML(p.name, 44)}<div><div class="pname">${E(p.name)}</div><div class="pmeta"><b>${p.points}</b> pts · ${plural(p.played, 'race')}</div></div><span class="prank" aria-label="Rank ${p.rank}">${p.rank}</span></div></a>`).join('')}</div>
    <div class="empty-state" id="dirEmpty" hidden>No player matches that filter.</div>
    ${ranked.length ? '' : `<div class="empty-state"><b>No players yet</b>Players appear here after their first ${E(label)} edition.</div>`}`;
      main.querySelectorAll('[data-directory-season]').forEach(btn => btn.addEventListener('click', () => renderPlayers(btn.dataset.directorySeason)));
      document.getElementById('dirSearch').addEventListener('input', e => {
        const q = e.target.value.trim().toLowerCase(); let shown = 0;
        document.querySelectorAll('#directoryGrid .player-card-link').forEach(link => {const hit = link.dataset.name.includes(q); link.style.display = hit ? '' : 'none'; if (hit) shown++;});
        document.getElementById('dirEmpty').hidden = shown > 0;
      });
    }

    /* ============ RENDER: PLAYER PROFILE ============ */
    let profileCharts = [];
    function profilePlayerFor(data, requested) {
      const computed = computeAll(data), exact = computed.players[requested];
      if (exact) return {player: exact, computed};
      const key = playerKey(requested);
      const found = Object.values(computed.players).find(p => playerKey(p.name) === key || oneLetterApart(playerKey(p.name), key));
      return {player: found, computed};
    }
    function renderPlayerProfileEnhanced(name, seasonKey = viewKey(), seasonData = null) {
      setSeasonTheme(seasonKey);
      let decoded = name;
      try {decoded = decodeURIComponent(name);} catch (e) {}
      const E = escapeHtml;
      if (seasonKey !== curKey() && !seasonData) {
        main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading player profile…</div>`;
        (seasonKey === 'all' ? loadAllTmnfSeasons() : loadSeasonData(seasonKey)).then(data => renderPlayerProfileEnhanced(decoded, seasonKey, data)).catch(seasonError);
        return;
      }
      const notFound = msg => {main.innerHTML = `<div class="breadcrumb"><a href="#/players">Players</a> / ${E(decoded)}</div><div class="empty-state"><b>No results</b>${msg}</div>`;};
      let p, profileName, history, rankLabel, seasonLabel, selected = null, profileHonor = null;
      if (seasonKey === 'all') {
        /* seasonData = [[key, data], ...] oldest first; each season's own standings, added up */
        const per = seasonData.map(([key, data]) => ({key, ...profilePlayerFor(key === curKey() ? RAW : data, decoded)}));
        const found = per.filter(x => x.player && x.player.played);
        if (!found.length) {notFound(`Player "${E(decoded)}" was not found.`); return;}
        const latest = found[found.length - 1].player;
        history = found.flatMap(x => x.player.history.map(h => ({...h, edition: `${SEASON_INFO[x.key].short} · ${h.edition}`, season: x.key, raw: h.edition, who: x.player.name})));
        const sumOf = f => found.reduce((a, x) => a + (x.player[f] || 0), 0), maxOf = f => Math.max(...found.map(x => x.player[f] || 0));
        const points = sumOf('points'), played = history.length, wins = sumOf('wins'), podiums = sumOf('podiums');
        const placements = history.map(h => h.placement), allRows = comparisonRows(...per.map(x => x.computed.ranked)), own = allRows.find(r => r.key === playerKey(latest.name));
        p = {name: latest.name, points, played, wins, podiums, placements, best: Math.min(...placements), worst: Math.max(...placements), avgPlacement: placements.reduce((a, b) => a + b, 0) / played, winRate: wins / played, podiumRate: podiums / played, avgPoints: points / played, maxWinStreak: maxOf('maxWinStreak'), maxPodiumStreak: maxOf('maxPodiumStreak'), rank: own ? allRows.indexOf(own) + 1 : null, badges: []};
        profileName = p.name; rankLabel = 'All-time'; seasonLabel = 'All-time';
      } else {
        selected = profilePlayerFor(seasonKey === curKey() ? RAW : seasonData, decoded);
        profileHonor = selected.player ? honorOf(seasonOutcome(seasonKey, seasonKey === curKey() ? RAW : seasonData), selected.player.name) : null;
        p = selected.player;
        seasonLabel = labelFor(seasonKey);
        if (!p || !p.played) {notFound(`${E(decoded)} has no results in ${E(seasonLabel)}.${GAME === 'tm20' ? '' : ' Try another season below.'}<div style="margin-top:14px">${profileTabs(seasonKey)}</div>`); bindProfileTabs(decoded); return;}
        history = p.history.map(h => ({...h, season: seasonKey, raw: h.edition, who: p.name})); profileName = p.name; rankLabel = seasonLabel;
      }
      /* "Compare" pairs the player with their nearest neighbour in the same standings. */
      let compare = '';
      if (seasonKey !== 'all') {
        const table = selected.computed.ranked, at = table.findIndex(x => x.name === p.name), other = table[at - 1] || table[at + 1];
        if (other) compare = `<a class="btn" href="#/versus/${seasonKey}/${enc(p.name)}/${enc(other.name)}">Compare with ${E(other.name)} →</a>`;
      }
      const pct = x => (x * 100).toFixed(0) + '%';
      const stat = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
      main.innerHTML = `
    <div class="breadcrumb"><a href="#/players">Players</a> / ${E(profileName)}</div>
    <div class="profile-hero">
      ${avatarHTML(profileName, 96)}
      <div>
        <h1>${E(profileName)}</h1>
        <div class="rank-tag"><span class="pos">P${p.rank ?? '—'}</span><span>${E(rankLabel)} standings</span>${seasonKey === curKey() && p.movement ? moveIcon(p.movement) : ''}</div>
      </div>
      <div class="profile-actions">${profileTabs(seasonKey)}<span class="profile-buttons">${profileHonor ? `<span class="honor-tag honor-${profileHonor}">${profileHonor === 'champion' ? '🏆 Champion' : '🥈 Runner-up'}</span>` : ''}${compare}<button type="button" class="btn" id="shareCard">${profileHonor === 'champion' ? 'Share champion card' : profileHonor === 'runner' ? 'Share runner-up card' : 'Share season card'}</button></span></div>
    </div>
    <div class="key-stats">${stat(p.droppedPoints && SEASON_INFO[seasonKey] ? `Points <span class="dim-note">best ${SEASON_INFO[seasonKey].bestOf}</span>` : 'Points', p.droppedPoints ? `${p.points}<small class="scored-note">${p.scored} scored</small>` : p.points)}${stat('Wins', p.wins)}${stat('Podiums', p.podiums)}${stat('Editions', p.played)}</div>
    <div class="stat-grid">
      ${stat('Avg placement', p.avgPlacement.toFixed(2))}${stat('Best finish', 'P' + p.best)}${stat('Worst finish', 'P' + p.worst)}${stat('Win rate', pct(p.winRate))}${stat('Podium rate', pct(p.podiumRate))}${stat('Avg pts / edition', p.avgPoints.toFixed(2))}${stat('Best win streak', p.maxWinStreak)}${stat('Best podium streak', p.maxPodiumStreak)}
    </div>
    ${p.badges && p.badges.length ? `<section><h2 class="section-title">Achievements</h2><div class="badge-list">${p.badges.map(b => `<span class="badge">${E(b.label)}</span>`).join('')}</div></section>` : ''}
    <section>
      <div class="head-row"><h2 class="section-title">Results strip</h2><span class="head-note">Every finish, oldest to newest</span></div>
      <div class="strip">${history.map(h => formChip(h.placement, 'Edition ' + h.edition + ': P' + h.placement + ' · ' + h.points + ' pts' + (h.dropped ? ' (dropped)' : ''), `#/edition/${h.season}/${enc(h.raw)}`, h.dropped)).join('')}</div>
    </section>
    <section>
      <h2 class="section-title">Performance</h2>
      <div class="chart-pair">
        <div class="panel"><div class="panel-label">Placement over time</div><div class="chart-box" role="img" aria-label="Line chart of placement per edition"><canvas id="chartPlacement"></canvas></div></div>
        <div class="panel"><div class="panel-label">Cumulative points</div><div class="chart-box" role="img" aria-label="Line chart of cumulative points"><canvas id="chartCumulative"></canvas></div></div>
      </div>
    </section>
    <section>
      <h2 class="section-title">Placement history</h2>
      <div class="panel flush"><div class="table-wrap"><table class="history-times"><thead><tr><th>Edition</th><th>Placement</th><th class="r">Time</th><th class="r">Gap to winner</th><th>Run</th><th class="r">Points</th></tr></thead><tbody>${[...history].reverse().map(h => `<tr data-tseason="${E(h.season)}" data-ted="${E(h.raw)}" data-twho="${E(h.who)}"><td><a href="#/edition/${h.season}/${enc(h.raw)}">Edition ${E(h.edition)}</a></td><td>${h.placement <= 3 ? medalFor(h.placement) : ''}P${h.placement}</td><td class="numc r t-time">—</td><td class="numc r t-gap"></td><td class="t-run"></td><td class="ptsc r">${h.dropped ? `<s class="dropped-pts" title="Dropped: only a player's best ${SEASON_INFO[h.season] ? SEASON_INFO[h.season].bestOf : ''} results count">${h.points}</s>` : h.points}</td></tr>`).join('')}</tbody></table></div></div>${(() => {const d = history.find(h => h.dropped); return d && SEASON_INFO[d.season] ? `<p class="table-foot">Struck-through points are dropped results: only the best ${SEASON_INFO[d.season].bestOf} count towards the ${E(SEASON_INFO[d.season].label)} championship.</p>` : '';})()}
    </section>`;
      bindProfileTabs(decoded);
      fillHistoryTimes();
      const shareBtn = document.getElementById('shareCard');
      if (shareBtn) shareBtn.addEventListener('click', () => openSeasonCard(p, seasonKey === 'all' ? 'All-time' : (GAME === 'tm20' ? 'TM2020' : labelFor(seasonKey)), p.rank ? `P${p.rank} ${seasonKey === 'all' ? 'all-time' : 'in the standings'}` : '', seasonKey, profileHonor));
      profileCharts.forEach(c => c.destroy()); profileCharts = [];
      if (!window.Chart) { // Chart.js is still loading (deferred): draw the profile again once it's there
        const canvas = document.getElementById('chartPlacement');
        whenChart(() => {if (canvas && document.body.contains(canvas)) renderPlayerProfileEnhanced(decoded, seasonKey, seasonData);});
        return;
      }
      const labels = history.map(h => h.edition), placements = history.map(h => h.placement), cumulative = []; let running = 0; history.forEach(h => {running += h.points; cumulative.push(running);});
      const color = accentHex();
      const medalColor = pl => pl === 1 ? '#ffcf3f' : pl === 2 ? '#c9ccd6' : pl === 3 ? '#d98a4a' : color;
      const placeOpts = chartOptions();
      placeOpts.scales.y = {...placeOpts.scales.y, reverse: true, min: 1, title: {display: true, text: 'Placement (lower is better)', color: '#5f636e'}};
      profileCharts.push(new Chart(document.getElementById('chartPlacement'), {type: 'line', data: {labels, datasets: [{label: 'Placement', data: placements, borderColor: color, borderWidth: 2, tension: .25, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: placements.map(medalColor), pointBorderColor: '#14161a', pointBorderWidth: 1.5}]}, options: placeOpts}));
      profileCharts.push(new Chart(document.getElementById('chartCumulative'), {type: 'line', data: {labels, datasets: [{label: 'Points', data: cumulative, borderColor: color, backgroundColor: color + '22', fill: true, borderWidth: 2, tension: .25, pointRadius: 0, pointHoverRadius: 5}]}, options: chartOptions()}));
    }
    function profileTabs(active) {return seasonSeg(active, 'profile-season', seasonOptions('all', 'All-time'));}
    function bindProfileTabs(decoded) {
      main.querySelectorAll('[data-profile-season]').forEach(btn => btn.addEventListener('click', () => renderPlayerProfileEnhanced(decoded, btn.dataset.profileSeason)));
    }

    /* ============ RENDER: HISTORY ============ */
    function renderHistory(seasonKey = viewKey()) {
      setSeasonTheme(seasonKey);
      main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading ${escapeHtml(labelFor(seasonKey))} editions…</div>`;
      loadSeasonData(seasonKey).then(data => {
        const E = escapeHtml;
        const editionsDesc = [...data.editions].reverse();
        const seasonLabel = labelFor(seasonKey);
        main.innerHTML = `
    <header class="page-head"><div class="kicker">${E(seasonLabel)} · ${plural(data.editions.length, 'edition')}</div><h1>Competition <em>history</em></h1><p>Every SpeedTAS edition, newest first. Open one for the full classification.</p></header>
    <div class="toolbar">${seasonSeg(seasonKey, 'history-season', seasonOptions())}</div>
    ${honorsHTML(seasonKey, seasonOutcome(seasonKey, data))}
    ${editionsDesc.length ? '' : `<div class="empty-state"><b>No editions yet</b>${E(seasonLabel)} editions appear here as soon as they are run.</div>`}
    <div class="history-grid">
      ${editionsDesc.map((ed, i) => {
        const entries = Object.entries(ed.results).sort((a, b) => a[1] - b[1]);
        const winner = entries.find(e => e[1] === 1);
        const others = entries.filter(([, place]) => place === 2 || place === 3);
        return `
        <a href="#/edition/${seasonKey}/${enc(ed.edition)}">
          <div class="history-card">
            <div class="history-top"><div class="history-edition"><small>#</small>${E(ed.edition)}</div><span class="history-tag ${i === 0 ? 'live' : ''}">${i === 0 ? 'Latest' : plural(entries.length, 'racer')}</span></div>
            <div class="history-winner">${winner ? avatarHTML(winner[0], 36) : ''}<div style="min-width:0"><div class="history-winner-label">Winner</div><div class="history-winner-name">${winner ? E(winner[0]) : 'Result pending'}</div></div></div>
            <div class="history-foot"><span class="also">${others.length ? others.map(([n]) => avatarHTML(n, 22)).join('') + '<span>completed the podium</span>' : plural(entries.length, 'racer')}</span>${hasEvents(seasonKey) ? `<span class="history-event" data-edition="${E(ed.edition)}" data-event-key="${eventKeyFor(seasonKey)}"></span>` : ''}</div>
          </div>
        </a>`;
      }).join('')}
    </div>`;
        main.querySelectorAll('[data-history-season]').forEach(btn => btn.addEventListener('click', () => renderHistory(btn.dataset.historySeason)));
        bindHonors(seasonKey, data);
        if (hasEvents(seasonKey)) loadEventIndex(eventKeyFor(seasonKey), fillHistoryEventLinks);
      }).catch(seasonError);
    }

    function renderEditionDetail(editionId, seasonKey = curKey(), data = null) {
      setSeasonTheme(seasonKey);
      if (!data) {
        if (seasonKey === curKey()) data = RAW;
        else {main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading ${escapeHtml(labelFor(seasonKey))} edition…</div>`; loadSeasonData(seasonKey).then(d => renderEditionDetail(editionId, seasonKey, d)).catch(seasonError); return;}
      }
      const E = escapeHtml;
      let decoded = editionId;
      try {decoded = decodeURIComponent(editionId);} catch (e) {}
      const at = data.editions.findIndex(e => String(e.edition) === decoded), ed = data.editions[at];
      if (!ed) {main.innerHTML = `<div class="breadcrumb"><a href="#/history">History</a></div><div class="empty-state"><b>Edition not found</b>There is no edition ${E(decoded)} in this season.</div>`; return;}
      const entries = Object.entries(ed.results).sort((a, b) => a[1] - b[1]);
      const seasonLabel = labelFor(seasonKey);
      const prev = data.editions[at - 1], next = data.editions[at + 1];
      main.innerHTML = `
    <div class="breadcrumb"><a href="#/history">History</a> / ${E(seasonLabel)} / Edition ${E(ed.edition)}</div>
    <div class="race-header">
      <header class="page-head"><div class="kicker">${E(seasonLabel)} · ${plural(entries.length, 'racer')}</div><h1>Edition <em>#${E(ed.edition)}</em></h1></header>
      <div class="race-actions">
        ${prev ? `<a class="btn" href="#/edition/${seasonKey}/${enc(prev.edition)}" aria-label="Previous edition, ${E(prev.edition)}">← #${E(prev.edition)}</a>` : ''}
        ${next ? `<a class="btn" href="#/edition/${seasonKey}/${enc(next.edition)}" aria-label="Next edition, ${E(next.edition)}">#${E(next.edition)} →</a>` : ''}
        ${hasEvents(seasonKey) ? `<a class="btn" id="eventLink" data-edition="${E(ed.edition)}" target="_blank" rel="noopener" style="display:none">TAS Exchange ↗</a>` : ''}
        <button type="button" class="btn" id="resultsPost" title="Results message to paste into Discord">Results post</button>
        <a class="btn" href="#/history">All editions</a>
      </div>
    </div>
    <div class="panel race-podium">${podiumHTML(entries, `#/player/${seasonKey}/`)}</div>
    <div class="panel edition-video" id="editionVideo" hidden></div>
    <div class="panel map-card" id="mapCard" hidden></div>
    <div class="panel flush">
      <div class="results-head"><b>Full classification</b><span class="head-note">${ed.auto ? '<span class="auto-tag" title="The sheet has no row for this edition yet, so the placements follow the times on TAS Exchange. The sheet takes over once it is filled in.">Auto-imported from TAS Exchange</span>' : 'Points by placement'}</span></div>
      <div class="table-wrap">
        <table class="results-table no-times no-runs" data-edition="${E(ed.edition)}" data-season="${seasonKey}">
          <thead><tr><th>Pos</th><th>Player</th><th class="time-th">Time</th><th class="run-th">Run</th><th class="r">Points</th></tr></thead>
          <tbody>
            ${entries.map(([name, place]) => `
              <tr>
                <td>${place <= 3 ? medalFor(place) : ''}${place}</td>
                <td><a href="#/player/${seasonKey}/${enc(name)}"><div class="player-cell">${avatarHTML(name)}<b>${E(name)}</b></div></a></td>
                <td class="time-cell" data-player="${E(name)}"></td>
                <td class="run-cell" data-player="${E(name)}"></td>
                <td class="${pointsFor(place) ? 'ptsc' : 'numc'} r">${pointsFor(place)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
      EDITION_TIMES = {}; window.__editionMap = '';
      fillMapCard(seasonKey, ed.edition, null);
      fillEditionVideo(seasonKey, ed.edition);
      document.getElementById('resultsPost').addEventListener('click', () => openResultsPost(ed, seasonKey, data));
      attachEditionEvent(ed, seasonKey);
    }

    /* ============ RENDER: VERSUS ============ */
    function h2hAvatarHTML(name, color) {
      const photo = getAvatarOverride(name);
      /* color = side colour (A/B) used for the ring; initials keep the player's own colour. */
      const ring = `box-shadow:0 0 0 3px var(--card),0 0 0 5px ${color};`;
      if (photo) return `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" class="h2h-avatar-big" style="object-fit:cover;${ring}">`;
      return `<div class="h2h-avatar-big" style="background:${colorForName(name)};${ring}">${escapeHtml(initials(name))}</div>`;
    }

    /* Every TMNF season as one dataset. seasons = [[key, data], ...] oldest first (see loadAllTmnfSeasons).
       Editions are labelled "S1 · 12"; the newest spelling of a player's name wins. Every result counts here. */
    function combinedSeasonData(seasons) {
      const list = seasons.filter(([, data]) => data);
      const preferred = {}, players = [];
      list.forEach(([, data]) => data.players.forEach(name => {const key = playerKey(name); preferred[key] = name;}));
      Object.values(preferred).forEach(name => players.push(name));
      const convert = (data, prefix) => data.editions.map(ed => {
        const results = {};
        Object.entries(ed.results).forEach(([name, place]) => {results[preferred[playerKey(name)]] = place;});
        return {edition: `${prefix} ${ed.edition}`, results};
      });
      return {players, editions: list.flatMap(([key, data]) => convert(data, `${SEASON_INFO[key].short} ·`))};
    }

    function renderVersus(p1name, p2name, seasonKey = viewKey(), suppliedData = null) {
      setSeasonTheme(seasonKey);
      if (seasonKey !== curKey() && !suppliedData) {
        main.innerHTML = `<div class="loader"><div class="spinner"></div> Loading ${escapeHtml(labelFor(seasonKey))} Head-to-Head…</div>`;
        loadSeasonData(seasonKey).then(data => renderVersus(p1name, p2name, seasonKey, data)).catch(err => {main.innerHTML = `<div class="panel"><h2 class="section-title">${escapeHtml(labelFor(seasonKey))} unavailable</h2><p style="color:var(--muted)">${escapeHtml(err.message)}</p></div>`;});
        return;
      }
      const activeData = seasonKey === curKey() ? RAW : suppliedData;
      const {players, ranked} = computeAll(activeData);
      const names = ranked.map(p => p.name);
      if (!names.length) {
        main.innerHTML = `<header class="page-head"><div class="kicker">Player A against Player B</div><h1>Head<em>2</em>Head</h1></header>
    <div class="versus-controls">${seasonSeg(seasonKey, 'h2h-season', seasonOptions('both'))}</div>
    <div class="empty-state"><b>No results yet</b>Head-to-heads open up once ${escapeHtml(labelFor(seasonKey))} has its first edition. Try an earlier season.</div>`;
        main.querySelectorAll('[data-h2h-season]').forEach(btn => btn.addEventListener('click', () => renderVersus(undefined, undefined, btn.dataset.h2hSeason)));
        return;
      }
      const a = p1name || names[0];
      const b = p2name || names[1] || names[0];

      main.innerHTML = `
    <header class="page-head"><div class="kicker">Player A against Player B</div><h1>Head<em>2</em>Head</h1><p>Pick two racers and compare their shared editions, form and results.</p></header>
    <div class="versus-controls">
      ${seasonSeg(seasonKey, 'h2h-season', seasonOptions('both'))}
      <div class="versus-selectors"><select id="selA" class="sel-a" aria-label="Player A">${names.map(n => `<option value="${escapeHtml(n)}" ${n === a ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select><span class="versus-vs" aria-hidden="true">VS</span><select id="selB" class="sel-b" aria-label="Player B">${names.map(n => `<option value="${escapeHtml(n)}" ${n === b ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select><button class="icon-btn" id="swapH2H" type="button" title="Swap players" aria-label="Swap players"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3"/></svg></button></div>
    </div>
    <div id="versusResult"></div>
  `;

      function fmtPct(x) {return (x * 100).toFixed(0) + '%';}
      function fmtNum(x, d = 0) {return (x === null || x === undefined || isNaN(x)) ? '—' : x.toFixed(d);}

      /* Renders one comparison row. higherIsBetter: true = bigger number wins,
         false = smaller number wins, null = purely informational (no highlight).
         Returns {html, winner} so the board can count category wins. */
      function statRow(label, rawA, rawB, displayA, displayB, higherIsBetter) {
        const valid = v => v !== null && v !== undefined && !isNaN(v);
        let winner = null;
        if (higherIsBetter !== null && valid(rawA) && valid(rawB)) {
          if (rawA === rawB) winner = 'even';
          else winner = (higherIsBetter ? rawA > rawB : rawA < rawB) ? 'a' : 'b';
        }
        /* Split bar: relative share of each side. For lower-is-better stats (rank,
           placement) the inverse is used so the longer bar is still the better side. */
        let bar = '';
        if (higherIsBetter !== null && valid(rawA) && valid(rawB)) {
          const va = higherIsBetter ? rawA : (rawA > 0 ? 1 / rawA : 0);
          const vb = higherIsBetter ? rawB : (rawB > 0 ? 1 / rawB : 0);
          if (va + vb > 0) {
            const pa = Math.round(va / (va + vb) * 100);
            bar = `<div class="vs-split" aria-hidden="true"><span class="a" style="width:${pa}%"></span><span class="b" style="width:${100 - pa}%"></span></div>`;
          }
        }
        const badge = '<span class="vs-win">Edge</span>';
        const cls = winner === 'a' ? 'win-a' : winner === 'b' ? 'win-b' : winner === 'even' ? 'even' : '';
        return {winner, html: `
      <div class="vs-row ${cls}">
        <div class="vs-val a">${winner === 'a' ? badge : ''}${displayA}</div>
        <div class="vs-mid"><div class="vs-label">${label}</div>${bar}</div>
        <div class="vs-val b">${displayB}${winner === 'b' ? badge : ''}</div>
      </div>`};
      }

      function draw() {
        const pa = players[document.getElementById('selA').value];
        const pb = players[document.getElementById('selB').value];
        const colorA = 'var(--side-a)', colorB = 'var(--side-b)';
        const E = escapeHtml, nA = E(pa.name), nB = E(pb.name);

        const commonEditions = pa.history.filter(h => pb.history.find(h2 => h2.edition === h.edition));
        let aH2H = 0, bH2H = 0, ties = 0;
        commonEditions.forEach(h => {
          const other = pb.history.find(h2 => h2.edition === h.edition);
          if (h.placement < other.placement) aH2H++;
          else if (h.placement > other.placement) bH2H++;
          else ties++;
        });
        const recentMatchups = commonEditions.map(h => {
          const other = pb.history.find(h2 => h2.edition === h.edition);
          const result = h.placement < other.placement ? 'A' : h.placement > other.placement ? 'B' : 'T';
          return {edition: h.edition, a: h.placement, b: other.placement, result};
        }).sort((x, y) => Number(y.edition) - Number(x.edition)).slice(0, 8);
        const avgA = commonEditions.length ? commonEditions.reduce((sum, h) => sum + h.placement, 0) / commonEditions.length : null;
        const avgB = commonEditions.length ? commonEditions.reduce((sum, h) => sum + (pb.history.find(h2 => h2.edition === h.edition)?.placement || 0), 0) / commonEditions.length : null;
        const avgGap = commonEditions.length ? (commonEditions.reduce((sum, h) => sum + Math.abs(h.placement - (pb.history.find(h2 => h2.edition === h.edition)?.placement || h.placement)), 0) / commonEditions.length).toFixed(1) : '—';

        const rows = [
          statRow('Current Rank', pa.rank ?? null, pb.rank ?? null, pa.rank ? ('#' + pa.rank) : '—', pb.rank ? ('#' + pb.rank) : '—', false),
          statRow('Head-to-Head Wins', aH2H, bH2H, aH2H, bH2H, true),
          statRow('Total Points', pa.points, pb.points, pa.points, pb.points, true),
          statRow('Avg Points / Edition', pa.avgPoints, pb.avgPoints, fmtNum(pa.avgPoints, 2), fmtNum(pb.avgPoints, 2), true),
          statRow('Wins', pa.wins, pb.wins, pa.wins, pb.wins, true),
          statRow('Podiums', pa.podiums, pb.podiums, pa.podiums, pb.podiums, true),
          statRow('Win Rate', pa.winRate, pb.winRate, fmtPct(pa.winRate), fmtPct(pb.winRate), true),
          statRow('Podium Rate', pa.podiumRate, pb.podiumRate, fmtPct(pa.podiumRate), fmtPct(pb.podiumRate), true),
          statRow('Avg Placement', pa.avgPlacement, pb.avgPlacement, fmtNum(pa.avgPlacement, 2), fmtNum(pb.avgPlacement, 2), false),
          statRow('Best Placement', pa.best, pb.best, pa.best ?? '—', pb.best ?? '—', false),
          statRow('Longest Win Streak', pa.maxWinStreak, pb.maxWinStreak, pa.maxWinStreak, pb.maxWinStreak, true),
          statRow('Longest Podium Streak', pa.maxPodiumStreak, pb.maxPodiumStreak, pa.maxPodiumStreak, pb.maxPodiumStreak, true),
          statRow('Editions Played', pa.played, pb.played, pa.played, pb.played, true),
        ];
        const catA = rows.filter(r => r.winner === 'a').length, catB = rows.filter(r => r.winner === 'b').length, catEven = rows.filter(r => r.winner === 'even').length;
        const rowsHTML = rows.map(r => r.html).join('');
        const decided = aH2H + bH2H + ties;
        const shA = decided ? Math.round(aH2H / decided * 100) : 0, shB = decided ? Math.round(bH2H / decided * 100) : 0, shT = decided ? 100 - shA - shB : 0;

        document.getElementById('versusResult').innerHTML = `
      <div class="panel matchup-board">
        <div class="fighter-stage">
          <div class="fighter side-a">${h2hAvatarHTML(pa.name, colorA)}<div><div class="fighter-tag">Player A</div><div class="fighter-name"><a href="#/player/${encodeURIComponent(pa.name)}">${nA}</a></div><div class="fighter-sub">P${pa.rank ?? '—'} · ${pa.points} pts</div></div></div>
          <div class="match-score"><div class="score"><span class="a">${aH2H}</span><span class="sep">–</span><span class="b">${bH2H}</span></div><div class="caption">Head-to-head</div></div>
          <div class="fighter right side-b"><div><div class="fighter-tag">Player B</div><div class="fighter-name"><a href="#/player/${encodeURIComponent(pb.name)}">${nB}</a></div><div class="fighter-sub">P${pb.rank ?? '—'} · ${pb.points} pts</div></div>${h2hAvatarHTML(pb.name, colorB)}</div>
        </div>
        <div class="h2h-share">${decided ? `<div class="rv-bar" role="img" aria-label="Head-to-head share: ${nA} ${shA}%, ties ${shT}%, ${nB} ${shB}%"><span class="a" style="width:${shA}%"></span>${shT ? `<span class="t" style="width:${shT}%"></span>` : ''}<span class="b" style="width:${shB}%"></span></div><div class="rv-bar-legend"><span class="a">${shA}%</span><span>Head-to-head share</span><span class="b">${shB}%</span></div>` : `<div class="rv-bar-legend" style="justify-content:center"><span>No shared editions yet</span></div>`}</div>
        <div class="match-meta"><div>Shared editions<b>${commonEditions.length}</b></div><div>Average gap<b>${avgGap}</b></div><div>Ties<b>${ties}</b></div></div>
        <div class="vs-edge"><span>Category edge</span><span class="chip a">${nA} ${catA}</span><span class="chip">Even ${catEven}</span><span class="chip b">${nB} ${catB}</span></div>
        <div class="vs-table">${rowsHTML}</div>
        <div class="h2h-matchups"><div class="h2h-matchups-head"><b>Latest shared editions</b><span>${avgA !== null ? `Avg placement: ${nA} ${avgA.toFixed(2)} · ${nB} ${avgB.toFixed(2)}` : 'No shared editions yet'}</span></div>${recentMatchups.length ? `<div class="table-wrap"><table><thead><tr><th>Edition</th><th>${nA}</th><th>${nB}</th><th>Edge</th></tr></thead><tbody>${recentMatchups.map(m => `<tr><td>${E(m.edition)}</td><td class="${m.result === 'A' ? 'cell-win-a' : ''}">P${m.a}</td><td class="${m.result === 'B' ? 'cell-win-b' : ''}">P${m.b}</td><td><span class="edge-badge ${m.result === 'A' ? 'a' : m.result === 'B' ? 'b' : ''}">${m.result === 'A' ? nA : m.result === 'B' ? nB : 'Tie'}</span></td></tr>`).join('')}</tbody></table></div>` : '<p>These players have not raced the same edition yet.</p>'}</div>
      </div>
    `;
      }
      document.getElementById('selA').addEventListener('change', draw);
      document.getElementById('selB').addEventListener('change', draw);
      main.querySelectorAll('[data-h2h-season]').forEach(btn => btn.addEventListener('click', () => renderVersus(undefined, undefined, btn.dataset.h2hSeason)));
      document.getElementById('swapH2H').addEventListener('click', () => {
        const selA = document.getElementById('selA'), selB = document.getElementById('selB');
        const oldA = selA.value; selA.value = selB.value; selB.value = oldA; draw();
      });
      draw();
    }

