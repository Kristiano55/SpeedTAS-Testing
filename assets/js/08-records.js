    /* ============ RECORDS & RIVALRIES ============ */
    function seasonSource(key) {return loadSeasonData(key);}

    function recordDefinitions(ranked) {
      const eligible = ranked.filter(p => p.played > 0);
      /* Everyone who shares the best value (ties included). zeroIsNothing: a best of 0 is not a record. */
      const top = (field, direction = 'desc', minPlayed = 0, zeroIsNothing = true) => {
        const list = eligible.filter(p => p.played >= minPlayed && p[field] != null);
        if (!list.length) return [];
        const best = list.reduce((m, p) => direction === 'asc' ? Math.min(m, p[field]) : Math.max(m, p[field]), direction === 'asc' ? Infinity : -Infinity);
        if (zeroIsNothing && best <= 0) return [];
        return list.filter(p => Math.abs(p[field] - best) < 1e-9);
      };
      const rec = (icon, label, field, holders, value, note) => ({icon, label, field, holders, player: holders[0], value, note});
      return [
        rec('🏆', 'Most wins', 'wins', top('wins'), p => p.wins + (p.wins === 1 ? ' win' : ' wins'), 'Race victories this season'),
        rec('🔥', 'Longest win streak', 'maxWinStreak', top('maxWinStreak'), p => p.maxWinStreak + ' in a row', 'Consecutive editions won'),
        rec('✨', 'Longest podium streak', 'maxPodiumStreak', top('maxPodiumStreak'), p => p.maxPodiumStreak + ' in a row', 'Consecutive top-three finishes'),
        rec('🥉', 'Most podiums', 'podiums', top('podiums'), p => p.podiums + (p.podiums === 1 ? ' podium' : ' podiums'), 'Top-three finishes'),
        rec('🎯', 'Best average placement', 'avgPlacement', top('avgPlacement', 'asc', 3, false), p => p.avgPlacement.toFixed(2), 'Minimum 3 editions played · lower is better'),
        rec('⚡', 'Highest win rate', 'winRate', top('winRate', 'desc', 3), p => Math.round(p.winRate * 100) + '%', 'Minimum 3 editions played'),
        rec('📈', 'Most points', 'points', top('points'), p => p.points + ' pts', 'Total points earned'),
        rec('🎮', 'Most appearances', 'played', top('played'), p => p.played + ' editions', 'Most races entered')
      ].concat(GAME === 'tm20' ? [
        rec('🔟', 'Most top-10 finishes', 'top10', top('top10'), p => p.top10 + (p.top10 === 1 ? ' finish' : ' finishes'), 'Scoring positions (1st-10th)'),
        rec('🧱', 'Longest top-10 streak', 'maxTop10Streak', top('maxTop10Streak'), p => p.maxTop10Streak + ' in a row', 'Consecutive editions in the top 10')
      ] : []);
    }

    function recordCard(record) {
      const E = escapeHtml;
      const holders = record.holders || (record.player ? [record.player] : []);
      const head = `<div class="record-label">${E(record.label)}</div>`;
      if (!holders.length) return `<div class="record-card">${head}<div class="record-value">—</div><div class="record-note">Not enough results yet</div></div>`;
      const p = holders[0];
      /* "5 wins" -> big figure + small unit */
      const parts = String(record.value(p)).match(/^(\S+)\s*(.*)$/);
      const value = `<div class="record-value">${E(parts[1])}${parts[2] ? `<small>${E(parts[2])}</small>` : ''}</div>`;
      if (holders.length === 1) {
        return `<a class="record-card" href="#/player/${enc(p.name)}">${head}${value}<div class="record-holder">${avatarHTML(p.name, 30)} <span>${E(p.name)}</span></div><div class="record-note">${E(record.note)}</div></a>`;
      }
      const MAX = 6;
      const chips = holders.slice(0, MAX).map(h => `<a class="record-chip" href="#/player/${enc(h.name)}">${avatarHTML(h.name, 24)}<span>${E(h.name)}</span></a>`).join('');
      const more = holders.length > MAX ? `<span class="record-chip more">+${holders.length - MAX} more</span>` : '';
      return `<div class="record-card shared">${head}${value}<div class="record-shared">Shared by ${holders.length} players</div><div class="record-holders">${chips}${more}</div><div class="record-note">${E(record.note)}</div></div>`;
    }

    function renderRecords(season = viewKey()) {
      setSeasonTheme(season);
      main.innerHTML = `
    <header class="page-head"><div class="kicker">The record book</div><h1>Season <em>records</em></h1><p>Who leads for wins, streaks, consistency and more.</p></header>
    <div class="toolbar" data-tmnf-only>${seasonSeg(season, 'record-season', seasonOptions('both'))}</div>
    <div id="recordContent" class="record-grid"><div class="loader"><div class="spinner"></div> Opening the record book…</div></div>`;
      main.querySelectorAll('[data-record-season]').forEach(b => b.addEventListener('click', () => renderRecords(b.dataset.recordSeason)));
      seasonSource(season).then(data => {
        const host = document.getElementById('recordContent'); if (!host) return;
        host.innerHTML = recordDefinitions(computeAll(data).ranked).map(recordCard).join('');
      }).catch(err => { const host = document.getElementById('recordContent'); if (host) host.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><b>Records unavailable</b>${escapeHtml(err.message)}</div>`; });
    }

    function rivalryRows(data, minShared = 3) {
      const pairs = new Map();
      data.editions.forEach(ed => {
        const entries = Object.entries(ed.results).sort((a,b) => a[0].localeCompare(b[0]));
        for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
          const [a, pa] = entries[i], [b, pb] = entries[j], key = a + '\u0000' + b;
          if (!pairs.has(key)) pairs.set(key, {a,b,aWins:0,bWins:0,ties:0,shared:0,totalGap:0});
          const r = pairs.get(key); r.shared++; r.totalGap += Math.abs(pa - pb);
          if (pa < pb) r.aWins++; else if (pb < pa) r.bWins++; else r.ties++;
        }
      });
      return [...pairs.values()].filter(r => r.shared >= minShared).map(r => ({...r, avgGap:r.totalGap / r.shared, balance:Math.abs(r.aWins - r.bWins)})).sort((x,y) => x.balance - y.balance || y.shared - x.shared || x.avgGap - y.avgGap);
    }

    /* How competitive a pair is, from the win balance across shared races. */
    function rivalryTier(r) {
      if (r.balance === 0) return {key: 'even', label: 'Dead even'};
      if (r.balance === 1) return {key: 'close', label: 'Neck and neck'};
      if (r.balance / r.shared <= 0.34) return {key: 'comp', label: 'Competitive'};
      return {key: 'lop', label: 'One-sided'};
    }

    function rivalryCard(r, season, index, featured) {
      const E = escapeHtml;
      const total = r.shared || 1;
      const aPct = Math.round(r.aWins / total * 100), bPct = Math.round(r.bWins / total * 100), tPct = Math.max(0, 100 - aPct - bPct);
      const decided = r.aWins + r.bWins;
      const aShare = decided ? Math.round(r.aWins / decided * 100) : 50;
      const tier = rivalryTier(r);
      const pl = name => `#/player/${enc(name)}`;
      return `<article class="rv-card ${featured ? 'featured' : ''}" style="--a-share:${aShare}%">
        <div class="rv-head">${featured ? `<span class="rv-kicker">Closest rivalry</span>` : `<span class="rv-rank">#${index + 1}</span>`}<span class="rv-tag tier-${tier.key}">${tier.label}</span></div>
        <div class="rv-versus">
          <a class="rv-side a" href="${pl(r.a)}">${avatarHTML(r.a, featured ? 52 : 36)}<span class="rv-name">${E(r.a)}</span></a>
          <div class="rv-score" aria-label="${E(r.a)} ${r.aWins}, ${E(r.b)} ${r.bWins}"><b class="a">${r.aWins}</b><span class="sep">–</span><b class="b">${r.bWins}</b></div>
          <a class="rv-side b" href="${pl(r.b)}">${avatarHTML(r.b, featured ? 52 : 36)}<span class="rv-name">${E(r.b)}</span></a>
        </div>
        <div>
          <div class="rv-bar" role="img" aria-label="Win share: ${E(r.a)} ${aPct}%, ties ${tPct}%, ${E(r.b)} ${bPct}%"><span class="a" style="width:${aPct}%"></span>${tPct ? `<span class="t" style="width:${tPct}%"></span>` : ''}<span class="b" style="width:${bPct}%"></span></div>
          <div class="rv-bar-legend"><span class="a">${aPct}%</span><span>Win share</span><span class="b">${bPct}%</span></div>
        </div>
        <div class="rv-foot">
          <ul class="rv-facts"><li><b>${r.shared}</b> shared races</li><li><b>${r.ties}</b> tie${r.ties === 1 ? '' : 's'}</li><li><b>${r.avgGap.toFixed(1)}</b> avg place gap</li></ul>
          <a class="rv-link" href="#/versus/${season}/${enc(r.a)}/${enc(r.b)}">Head2Head →</a>
        </div>
      </article>`;
    }

    function renderRivalries(season = viewKey(), minShared = 3, selectedPlayer = '') {
      setSeasonTheme(season);
      main.innerHTML = `
    <header class="page-head"><div class="kicker">Repeat matchups</div><h1>Rival<em>ries</em></h1><p>Pairs who keep meeting on track, ranked by how evenly matched they are.</p></header>
    <div class="toolbar">
      <span class="toolbar-group" data-tmnf-only>${seasonSeg(season, 'rival-season', seasonOptions('both'))}</span>
      <span class="toolbar-group"><label class="toolbar-label" for="rivalPlayer">Player</label><select id="rivalPlayer"><option>Loading players…</option></select></span>
      <span class="toolbar-group"><span class="toolbar-label">Shared races</span><div class="seg" role="group" aria-label="Minimum shared races">${[3, 5, 8].map(n => `<button type="button" class="filter-btn ${minShared === n ? 'active' : ''}" data-rival-min="${n}" aria-pressed="${minShared === n}">${n}+</button>`).join('')}</div></span>
    </div>
    <section><div class="head-row"><h2 id="rivalryHeading" class="section-title">Closest rivalries</h2><span class="head-note">Even records · repeat races · close finishes</span></div><div id="rivalryContent" class="rivalry-grid"><div class="loader"><div class="spinner"></div> Finding matchups…</div></div></section>`;
      main.querySelectorAll('[data-rival-season]').forEach(b => b.addEventListener('click', () => renderRivalries(b.dataset.rivalSeason, minShared, selectedPlayer)));
      main.querySelectorAll('[data-rival-min]').forEach(b => b.addEventListener('click', () => renderRivalries(season, Number(b.dataset.rivalMin), selectedPlayer)));
      seasonSource(season).then(data => {
        const host = document.getElementById('rivalryContent'), select = document.getElementById('rivalPlayer'), heading = document.getElementById('rivalryHeading'); if (!host || !select) return;
        const names = computeAll(data).ranked.map(p => p.name);
        select.innerHTML = `<option value="">All players</option>${names.map(name => `<option value="${escapeHtml(name)}" ${name === selectedPlayer ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;
        select.addEventListener('change', () => renderRivalries(season, minShared, select.value));
        const rows = rivalryRows(data, minShared).filter(r => !selectedPlayer || r.a === selectedPlayer || r.b === selectedPlayer);
        if (heading && selectedPlayer) heading.textContent = selectedPlayer + '’s rivalries';
        /* rows are already sorted most-competitive first; the top one gets the featured card. */
        host.innerHTML = rows.length ? rows.map((r, i) => rivalryCard(r, season, i, i === 0)).join('') : `<div class="empty-state" style="grid-column:1/-1"><b>No rivalries yet</b>${selectedPlayer ? escapeHtml(selectedPlayer) + ' has not shared ' + minShared + ' races with another player yet.' : 'No pairs have raced together ' + minShared + ' times yet.'}</div>`;
      }).catch(err => { const host = document.getElementById('rivalryContent'); if (host) host.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><b>Rivalries unavailable</b>${escapeHtml(err.message)}</div>`; });
    }

