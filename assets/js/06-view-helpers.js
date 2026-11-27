    /* ============ SHARED VIEW HELPERS ============ */
    const enc = encodeURIComponent;
    const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
    function seasonSeg(active, attr, options) {
      return `<div class="seg" data-tmnf-only role="group" aria-label="Season">${options.map(([key, label]) => `<button type="button" class="filter-btn ${active === key ? 'active' : ''}" data-${attr}="${key}" aria-pressed="${active === key}">${escapeHtml(label)}</button>`).join('')}</div>`;
    }
    function seasonError(err) {
      main.innerHTML = `<div class="empty-state"><b>That season is unavailable right now</b>${escapeHtml(err && err.message ? err.message : String(err))}</div>`;
    }
    /* One placement as a small square: podium colours for 1-3, brighter when it scored points. */
    function formChip(place, title, href, dropped = false) {
      const cls = (place <= 3 ? 'p' + place : (pointsFor(place) > 0 ? 'pts' : '')) + (dropped ? ' dropped' : '');
      const attrs = `class="fc ${cls}" title="${escapeHtml(title)}"`;
      return href ? `<a ${attrs} href="${href}">${place}</a>` : `<span ${attrs}>${place}</span>`;
    }
    /* Classic 2-1-3 podium. entries = [[name, place], ...]; linkPrefix is the profile route prefix. */
    function podiumHTML(entries, linkPrefix = '#/player/') {
      return `<ol class="podium">${[1, 2, 3].map(place => {
        const finisher = entries.find(([, p]) => p === place);
        const who = finisher
          ? `<a class="pod-who" href="${linkPrefix}${enc(finisher[0])}">${avatarHTML(finisher[0], place === 1 ? 72 : 54)}<span class="pod-name">${escapeHtml(finisher[0])}</span><span class="pod-pts">+${pointsFor(place)} pts</span></a>`
          : `<div class="pod-who"><span class="pod-name">No result</span></div>`;
        return `<li class="pod p${place} ${finisher ? '' : 'empty'}"><span class="sr-only">Place ${place}:</span>${who}<div class="pod-block" aria-hidden="true">${place}</div></li>`;
      }).join('')}</ol>`;
    }

    /* ============ AVATAR MODAL (upload OR paste an image URL) ============
       Discord has no public, no-login API to fetch a user's avatar from just
       their numeric ID — that needs a bot token, which we won't hardcode into
       a shareable static file. The practical equivalent: in Discord, right-click
       a person's avatar → "Copy Avatar Link" → paste it here. */
    function closeAvatarModal() {
      const el = document.getElementById('avatarModalBackdrop');
      if (el) el.remove();
    }
    function openAvatarModal(name) {
      closeAvatarModal();
      const backdrop = document.createElement('div');
      backdrop.id = 'avatarModalBackdrop';
      backdrop.className = 'avatar-modal-backdrop';
      const proxyUrl = getAvatarProxyUrl();
      const safeName = escapeHtml(name);
      backdrop.innerHTML = `
    <div class="avatar-modal" role="dialog" aria-modal="true" aria-label="Change photo for ${safeName}">
      <div class="avatar-modal-head">
        <b>Change photo · ${safeName}</b>
        <button type="button" class="link-btn" id="avatarModalClose">Close</button>
      </div>
      <button type="button" class="btn" id="avatarModalUploadBtn">Upload from device</button>
      <label for="avatarUrlInput">Or paste an image URL</label>
      <div class="form-row"><input type="text" class="field" id="avatarUrlInput" placeholder="https://cdn.discordapp.com/avatars/..."><button type="button" class="btn" id="avatarUrlBtn">Use</button></div>
      <label for="avatarIdInput">Or enter a Discord ID (automatic lookup)</label>
      <div class="form-row"><input type="text" class="field" id="avatarIdInput" inputmode="numeric" placeholder="123456789012345678"><button type="button" class="btn" id="avatarIdBtn">Fetch</button></div>
      <button type="button" class="link-btn" id="avatarProxySettingsBtn" style="margin-top:10px">${proxyUrl ? 'Change lookup server' : 'Set up automatic lookup (one-time, free)'}</button>
      <div class="form-error" id="avatarModalError" role="status"></div>
      <div class="hint">
        <b>Share a server or DM with them?</b> In Discord, right-click their profile picture, choose "Copy Avatar Link" and paste it above.<br>
        <b>Only have their Discord ID?</b> Use <a href="https://www.vibebot.gg/tools/avatar-downloader" target="_blank" rel="noopener">VibeBot's Avatar Downloader ↗</a>, or set up automatic lookup.
      </div>
    </div>
  `;
      document.body.appendChild(backdrop);

      backdrop.addEventListener('click', (e) => {if (e.target === backdrop) closeAvatarModal();});
      backdrop.addEventListener('keydown', (e) => {if (e.key === 'Escape') closeAvatarModal();});
      document.getElementById('avatarModalClose').addEventListener('click', closeAvatarModal);
      document.getElementById('avatarModalUploadBtn').addEventListener('click', () => {closeAvatarModal(); promptAvatarUpload(name);});

      document.getElementById('avatarProxySettingsBtn').addEventListener('click', () => {
        const current = getAvatarProxyUrl() || '';
        const next = window.prompt(
          "Paste your Cloudflare Worker URL (see discord-avatar-worker.js for setup steps):",
          current
        );
        if (next !== null && next.trim()) {
          saveAvatarProxyUrl(next.trim().replace(/\/+$/, ''));
          openAvatarModal(name); // reopen to refresh the button label and re-bind handlers
        }
      });

      async function tryFetchById() {
        const errEl = document.getElementById('avatarModalError');
        const proxy = getAvatarProxyUrl();
        const id = document.getElementById('avatarIdInput').value.trim();
        if (!proxy) {errEl.textContent = 'Set up automatic lookup first (link above). It takes about 5 minutes, one time only.'; return;}
        if (!/^\d{15,25}$/.test(id)) {errEl.textContent = "That doesn't look like a valid Discord ID (should be a 15–25 digit number)."; return;}
        errEl.textContent = 'Looking up…';
        try {
          const res = await fetch(proxy + '/avatar?id=' + encodeURIComponent(id));
          const data = await res.json();
          if (!res.ok || data.error) {errEl.textContent = data.error || 'Lookup failed.'; return;}
          if (saveAvatarOverride(name, data.avatarUrl)) {closeAvatarModal(); render();}
        } catch (e) {
          errEl.textContent = "Couldn't reach your lookup server. Double-check its URL in the settings link above.";
        }
      }
      document.getElementById('avatarIdBtn').addEventListener('click', tryFetchById);
      document.getElementById('avatarIdInput').addEventListener('keydown', (e) => {if (e.key === 'Enter') tryFetchById();});

      function tryUseUrl() {
        const errEl = document.getElementById('avatarModalError');
        const url = document.getElementById('avatarUrlInput').value.trim();
        if (!url) {errEl.textContent = 'Paste a URL first.'; return;}
        if (!/^https?:\/\//i.test(url)) {errEl.textContent = 'That doesn\'t look like a valid URL (should start with http:// or https://).'; return;}
        errEl.textContent = 'Checking image…';
        const testImg = new Image();
        testImg.onload = () => {if (saveAvatarOverride(name, url)) {closeAvatarModal(); render();} };
        testImg.onerror = () => {errEl.textContent = "Couldn't load an image from that URL. Double-check it's a direct image link.";};
        testImg.src = url;
      }
      document.getElementById('avatarUrlBtn').addEventListener('click', tryUseUrl);
      document.getElementById('avatarUrlInput').addEventListener('keydown', (e) => {if (e.key === 'Enter') tryUseUrl();});
      document.getElementById('avatarUrlInput').focus();
    }

    /* Delegated so it works for dynamically-rendered avatars anywhere on the page,
       and stops the click from also triggering a wrapping link (e.g. a player card). */
    document.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.avatar-edit-btn');
      if (editBtn) {e.preventDefault(); e.stopPropagation(); openAvatarModal(decodeURIComponent(editBtn.dataset.player)); return;}
      const removeBtn = e.target.closest('.avatar-remove-btn');
      if (removeBtn) {e.preventDefault(); e.stopPropagation(); removeAvatarClicked(decodeURIComponent(removeBtn.dataset.player)); return;}
    });

    /* ============ COLOR HELPERS ============ */
    const PALETTE = ['#e9fb59', '#59d6fb', '#fb59c9', '#59fba0', '#fba059', '#a059fb', '#fb5959', '#59fbf0'];
    function colorForName(name) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      return PALETTE[Math.abs(hash) % PALETTE.length];
    }
    function initials(name) {
      return name.split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
    }
    function avatarHTML(name, size) {
      const s = size || 32;
      const photo = getAvatarOverride(name);
      if (photo) {
        return `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" loading="lazy" onerror="handleAvatarError(this,'${encodeURIComponent(name).replace(/'/g, '%27')}')" style="width:${s}px;height:${s}px;border-radius:50%;object-fit:cover;flex-shrink:0;background:${colorForName(name)};display:inline-block;vertical-align:middle;">`;
      }
      const c = colorForName(name);
      return `<div class="avatar" style="background:${c};${size ? `width:${size}px;height:${size}px;font-size:${size * 0.35}px;` : ''}" role="img" aria-label="${escapeHtml(name)}">${escapeHtml(initials(name))}</div>`;
    }
    /* Pictures arrive after the page is drawn. Swap them into the initials placeholders in place, instead of
       redrawing the page, which used to reset whatever season or filter the visitor had just picked. */
    function swapInAvatars() {
      document.querySelectorAll('.avatar[role="img"][aria-label]').forEach(div => {
        const name = div.getAttribute('aria-label');
        if (!getAvatarOverride(name)) return;
        const size = parseInt(div.style.width, 10) || undefined;
        const tmp = document.createElement('div');
        tmp.innerHTML = avatarHTML(name, size);
        if (tmp.firstElementChild) div.replaceWith(tmp.firstElementChild);
      });
    }
    /* If a Discord CDN image 404s or is unreachable, swap it for the same
       colored-initials avatar avatarHTML() would have used anyway. */
    function handleAvatarError(img, encodedName) {
      const name = decodeURIComponent(encodedName);
      queueAvatarRefresh(discordIdFor(name));
      const s = img.clientWidth || img.offsetWidth || 32;
      const div = document.createElement('div');
      div.className = 'avatar';
      div.style.cssText = `background:${colorForName(name)};width:${s}px;height:${s}px;font-size:${Math.round(s * 0.35)}px;`;
      div.textContent = initials(name);
      img.replaceWith(div);
    }
    /* Same as avatarHTML but wraps it with a small always-visible edit button
       that opens the file picker — this is the "easy to change" entry point. */
    function avatarEditableHTML(name, size, btnSize) {
      const bs = btnSize || Math.max(16, Math.round((size || 32) * 0.34));
      return `<div class="avatar-wrap" style="width:${size || 32}px;height:${size || 32}px;">
    ${avatarHTML(name, size)}
    <button type="button" class="avatar-edit-btn" data-player="${encodeURIComponent(name)}" title="Change photo for ${escapeHtml(name)}" aria-label="Change photo for ${escapeHtml(name)}" style="width:${bs}px;height:${bs}px;font-size:${Math.round(bs * 0.55)}px;">📷</button>
  </div>`;
    }
    function medalFor(rank) {
      if (rank >= 1 && rank <= 3) return `<span class="medal m${rank}" role="img" aria-label="${['Gold', 'Silver', 'Bronze'][rank - 1]}"></span>`;
      return '';
    }
    function moveIcon(m) {
      if (m > 0) return `<span class="move-up">▲ ${m}</span>`;
      if (m < 0) return `<span class="move-down">▼ ${Math.abs(m)}</span>`;
      return `<span class="move-same">–</span>`;
    }

