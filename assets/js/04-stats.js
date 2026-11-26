    /* ============ COMPUTE STATS ============ */
    function computeAll(data) {
      const players = {}; // name -> stats object
      data.players.forEach(name => {
        players[name] = {
          name, points: 0, wins: 0, podiums: 0, played: 0, placements: [],
          cumulative: [], history: [] // {edition, placement, points}
        };
      });

      data.editions.forEach(ed => {
        Object.entries(ed.results).forEach(([name, place]) => {
          if (!players[name]) players[name] = {name, points: 0, wins: 0, podiums: 0, played: 0, placements: [], cumulative: [], history: []};
          const pts = pointsFor(place);
          const p = players[name];
          p.points += pts;
          p.played += 1;
          if (place === 1) p.wins += 1;
          if (place <= 3) p.podiums += 1;
          p.placements.push(place);
          p.history.push({edition: ed.edition, placement: place, points: pts});
        });
      });

      /* Best-of scoring (Season 3: best 9 of 12, old F1 style). Only a player's `bestOf` highest-scoring results
         count; the others are marked dropped (lowest points first, the earliest among equals).
         p.points = counted total, p.scored = every point scored. Datasets without bestOf are untouched. */
      const bestOf = data.bestOf || null;
      const countedSum = pts => bestOf ? [...pts].sort((a, b) => b - a).slice(0, bestOf).reduce((a, b) => a + b, 0) : pts.reduce((a, b) => a + b, 0);
      if (bestOf) {
        Object.values(players).forEach(p => {
          p.scored = p.points;
          const order = p.history.map((h, i) => i).sort((a, b) => p.history[a].points - p.history[b].points || a - b);
          order.slice(0, Math.max(0, p.history.length - bestOf)).forEach(i => {p.history[i].dropped = true;});
          p.points = p.history.reduce((a, h) => a + (h.dropped ? 0 : h.points), 0);
          p.droppedPoints = p.scored - p.points;
        });
      }

      // cumulative points per player aligned to edition order
      const editionOrder = data.editions.map(e => e.edition);
      Object.values(players).forEach(p => {
        let running = 0;
        const map = {};
        if (bestOf) p.history.forEach((h, i) => {map[h.edition] = countedSum(p.history.slice(0, i + 1).map(x => x.points));});
        else p.history.forEach(h => {running += h.points; map[h.edition] = running;});
        let last = 0;
        p.cumulative = editionOrder.map(e => {if (map[e] !== undefined) last = map[e]; return last;});
      });

      // derived stats
      Object.values(players).forEach(p => {
        p.avgPlacement = p.placements.length ? (p.placements.reduce((a, b) => a + b, 0) / p.placements.length) : null;
        p.best = p.placements.length ? Math.min(...p.placements) : null;
        p.worst = p.placements.length ? Math.max(...p.placements) : null;
        p.top10 = p.placements.filter(x => x <= 10).length;
        p.winRate = p.played ? p.wins / p.played : 0;
        p.podiumRate = p.played ? p.podiums / p.played : 0;
        p.avgPoints = p.played ? (bestOf ? p.scored : p.points) / p.played : 0; // true average per race, dropped results included
      });

      // Streaks — computed over the FULL edition order (not just the player's
      // played editions), because a missed edition must break a streak even
      // though it's not the same as a bad placement. E.g. win, skip, win, win
      // is a streak of 2, not 3 — a gap in participation resets the counter.
      Object.values(players).forEach(p => {p.maxWinStreak = 0; p.maxPodiumStreak = 0; p.maxTop10Streak = 0;});
      {
        const curWin = {}, curPodium = {}, curTop10 = {};
        data.editions.forEach(ed => {
          Object.values(players).forEach(p => {
            const place = ed.results[p.name];
            if (place === undefined) {
              curWin[p.name] = 0;
              curPodium[p.name] = 0;
              curTop10[p.name] = 0;
            } else {
              curWin[p.name] = (place === 1) ? (curWin[p.name] || 0) + 1 : 0;
              curPodium[p.name] = (place <= 3) ? (curPodium[p.name] || 0) + 1 : 0;
              curTop10[p.name] = (place <= 10) ? (curTop10[p.name] || 0) + 1 : 0;
              if (curTop10[p.name] > p.maxTop10Streak) p.maxTop10Streak = curTop10[p.name];
              if (curWin[p.name] > p.maxWinStreak) p.maxWinStreak = curWin[p.name];
              if (curPodium[p.name] > p.maxPodiumStreak) p.maxPodiumStreak = curPodium[p.name];
            }
          });
        });
      }

      // ranking + movement (rank now vs rank excluding last edition)
      const ranked = Object.values(players).filter(p => p.played > 0).sort((a, b) => b.points - a.points);
      ranked.forEach((p, i) => p.rank = i + 1);

      const editionsMinusLast = data.editions.slice(0, -1);
      const prevPoints = {};
      if (bestOf) {
        const prevLists = {};
        editionsMinusLast.forEach(ed => Object.entries(ed.results).forEach(([name, place]) => {(prevLists[name] = prevLists[name] || []).push(pointsFor(place));}));
        Object.entries(prevLists).forEach(([name, pts]) => {prevPoints[name] = countedSum(pts);});
      } else editionsMinusLast.forEach(ed => Object.entries(ed.results).forEach(([name, place]) => {
        prevPoints[name] = (prevPoints[name] || 0) + pointsFor(place);
      }));
      const prevRanked = Object.entries(prevPoints).sort((a, b) => b[1] - a[1]).map(x => x[0]);
      const prevRankMap = {}; prevRanked.forEach((name, i) => prevRankMap[name] = i + 1);
      ranked.forEach(p => {
        const prevRank = prevRankMap[p.name];
        if (prevRank === undefined) p.movement = 0;
        else p.movement = prevRank - p.rank;
      });

      // most improved: compare avg points per edition first half vs second half
      Object.values(players).forEach(p => {
        const h = p.history;
        if (h.length >= 4) {
          const mid = Math.floor(h.length / 2);
          const firstAvg = h.slice(0, mid).reduce((a, b) => a + b.points, 0) / mid;
          const secondAvg = h.slice(mid).reduce((a, b) => a + b.points, 0) / (h.length - mid);
          p.improvement = secondAvg - firstAvg;
        } else p.improvement = null;
      });

      // achievements
      Object.values(players).forEach(p => {
        const badges = [];
        if (p.wins >= 1) badges.push({icon: '🏆', label: 'Champion'});
        if (p.wins >= 3) badges.push({icon: '🥇', label: 'Multi Winner'});
        if (p.maxPodiumStreak >= 5) badges.push({icon: '🔥', label: '5 Podium Streak'});
        if (p.rank && p.rank <= 3) badges.push({icon: '⭐', label: 'Top 3 Leaderboard'});
        if (p.played >= 10) badges.push({icon: '🎯', label: '10 Editions Played'});
        if (p.points >= 100) badges.push({icon: '💯', label: '100 Points'});
        if (GAME === 'tm20' && p.top10 >= 10) badges.push({icon: '🔟', label: '10 Top-10 Finishes'});
        p.badges = badges;
      });

      return {players, editionOrder, ranked};
    }

    /* ============ CUSTOM PROFILE PICTURES ============
       Stored in the browser's localStorage (this file runs standalone, not
       inside Claude's artifact sandbox, so localStorage works normally here).
       Photos are resized client-side before saving so they stay small. */
    const AVATAR_KEY_PREFIX = 'speedtas_v1_avatar_';

    /* avatarHTML() calls getAvatarOverride() once per player row - 50+ times
       on a single Players directory render. Reading localStorage that many
       times on every render adds up, so overrides are read into memory once
       at init and kept in sync from there instead of re-reading storage on
       every single card. */
    let AVATAR_OVERRIDES_CACHE = {};
    function loadAvatarOverridesCache() {
      const cache = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(AVATAR_KEY_PREFIX) && key !== AVATAR_PROXY_KEY) {
            cache[decodeURIComponent(key.slice(AVATAR_KEY_PREFIX.length))] = localStorage.getItem(key);
          }
        }
      } catch (e) { /* localStorage unavailable - cache stays empty, falls through to Discord avatars */ }
      AVATAR_OVERRIDES_CACHE = cache;
    }

    /* Discord serves any size and format: ask for WebP at 128 px (enough for the 72 px podium on sharp screens)
       instead of the stored PNG, several times lighter. Animated avatars (a_...) keep their own format. */
    function sizedAvatar(url) {
      if (!url || !/^https:\/\/cdn\.discordapp\.com\/avatars\//.test(url)) return url;
      try {
        const u = new URL(url);
        if (!/\/a_[^/]+$/.test(u.pathname)) u.pathname = u.pathname.replace(/\.(png|jpe?g)$/i, '.webp');
        u.searchParams.set('size', '128');
        return u.toString();
      } catch (e) {return url;}
    }
    function getAvatarOverride(name) {
      if (Object.prototype.hasOwnProperty.call(AVATAR_OVERRIDES_CACHE, name)) return AVATAR_OVERRIDES_CACHE[name];
      const id = discordIdFor(name);
      return id ? sizedAvatar(DISCORD_AVATARS[id] || null) : null;
    }
    function saveAvatarOverride(name, dataUrl) {
      try {localStorage.setItem(AVATAR_KEY_PREFIX + encodeURIComponent(name), dataUrl); AVATAR_OVERRIDES_CACHE[name] = dataUrl; return true;}
      catch (e) {
        console.error('Could not save avatar:', e);
        alert("Couldn't save that photo — your browser's local storage may be full or restricted.");
        return false;
      }
    }
    function deleteAvatarOverride(name) {
      try {localStorage.removeItem(AVATAR_KEY_PREFIX + encodeURIComponent(name));} catch (e) { }
      delete AVATAR_OVERRIDES_CACHE[name];
    }

    /* Optional: URL of a self-hosted Discord-ID-to-avatar lookup proxy (see
       discord-avatar-worker.js). Entirely optional — only needed if the person
       sets up the free automatic-lookup Worker. */
    const AVATAR_PROXY_KEY = 'speedtas_v1_avatar_proxy_url';
    function getAvatarProxyUrl() {
      try {return localStorage.getItem(AVATAR_PROXY_KEY);} catch (e) {return null;}
    }
    function saveAvatarProxyUrl(url) {
      try {localStorage.setItem(AVATAR_PROXY_KEY, url); return true;} catch (e) {return false;}
    }

    /* Downscales an uploaded image client-side (max dimension in px) and
       returns a compressed JPEG data URL via callback, keeping storage lean. */
    function resizeImageToDataURL(file, maxDim, callback) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > h) {if (w > maxDim) {h = Math.round(h * maxDim / w); w = maxDim;} }
          else {if (h > maxDim) {w = Math.round(w * maxDim / h); h = maxDim;} }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          callback(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => alert("That file couldn't be read as an image.");
        img.src = e.target.result;
      };
      reader.onerror = () => alert("Couldn't read that file.");
      reader.readAsDataURL(file);
    }

    function promptAvatarUpload(name) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      const cleanup = () => {if (input.parentNode) input.remove();};
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) resizeImageToDataURL(file, 300, (dataUrl) => {if (saveAvatarOverride(name, dataUrl)) render(); cleanup();});
        else cleanup();
      });
      input.addEventListener('cancel', cleanup);
      input.click();
    }
    function removeAvatarClicked(name) {
      deleteAvatarOverride(name);
      render();
    }
