    /* ============ PLAYER NAMES & HTML ESCAPING ============
       Shared by every page: escapeHtml for anything from the sheets, and the identity rules that
       treat different spellings of one player as the same person across seasons and games. */
    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    }

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
