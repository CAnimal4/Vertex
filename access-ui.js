/* Shared browser adapter for the small server-owned learning-app access API. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let session = { role: 'free', permissions: { premium: false } };

  const request = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Access is unavailable.');
    return body;
  };
  const isElevated = () => session.permissions && session.permissions.premium === true;
  const roleLabel = () => ({ premium: 'Premium', mod: 'Moderator', admin: 'Admin' })[session.role] || 'Free';
  const premiumEntitlements = {
    mayo_madness: { kind: 'locked', label: 'Premium only: unlock the full Mayo Madness collection.' },
    mayo_madness_1: { kind: 'locked', label: 'Premium only: unlock the Level 1 Mayo Madness vocabulary set.' },
    mayo_madness_2: { kind: 'locked', label: 'Premium only: unlock the Level 2 Mayo Madness vocabulary set.' },
    rapid_translations_2: { kind: 'locked', label: 'Premium only: unlock rapid-fire translation practice.' },
    rapid_regular_verbs: { kind: 'locked', label: 'Premium only: unlock rapid regular-verb practice.' },
    rapid_irregular_verbs: { kind: 'locked', label: 'Premium only: unlock rapid irregular-verb practice.' },
    mayo_madness_3_rapid_translations: { kind: 'locked', label: 'Premium only: unlock Level 3 rapid-fire translations.' },
    commands: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds the complete command pool.' },
    vocab: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds the complete vocabulary pool.' },
    reflexive: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more reflexive practice.' },
    tenses: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more tense practice.' },
    prices: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more price questions.' },
    weather: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more weather questions.' },
    clothing: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more clothing questions.' },
    foods: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more food questions.' },
    present_progressive: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more present-progressive practice.' },
    ser_estar: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more Ser/Estar practice.' },
    gustar: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more Gustar practice.' },
    dates: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds more date questions.' }
    ,honors_test1_review: { kind: 'locked', label: 'Premium only: unlock the complete test review.' }
    ,honors_ordinal_numbers: { kind: 'reduced', label: 'Free includes a smaller rotation; Premium adds the complete ordinal-number pool.' }
  };

  function applyPremiumBadges() {
    document.querySelectorAll('#moduleSettingsSection input[id^="toggle_"]').forEach((input) => {
      const key = input.id.slice('toggle_'.length);
      const entitlement = premiumEntitlements[key];
      if (!entitlement) return;
      const row = input.closest('.toggle') || input.closest('.mayo-madness-panel')?.querySelector('summary');
      const label = row?.querySelector('.label') || row?.querySelector('span');
      if (!row || !label || row.querySelector(`[data-premium-badge="${key}"]`)) return;
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = `premium-badge premium-badge-${entitlement.kind}`;
      badge.dataset.premiumBadge = key;
      badge.textContent = entitlement.kind === 'locked' ? '🔒' : '◐';
      badge.title = entitlement.label;
      badge.setAttribute('aria-label', entitlement.label);
      badge.dataset.premiumLock = entitlement.kind === 'locked' ? 'true' : 'false';
      badge.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        if (!isElevated()) openPremiumFromLock();
      });
      label.append(' ', badge);
    });
  }

  function setStatus(message, tone = 'neutral') {
    const status = $('premiumFeedback');
    if (status) { status.className = `feedback ${tone}`; status.textContent = message; }
  }

  function closeSettingsBeforePremium() {
    const overlay = $('settingsOverlay');
    if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
  }

  function openPremiumFromLock() {
    document.querySelector('.shared-prompt-premium')?.remove();
    closeSettingsBeforePremium();
    const app = window.SpanishPracticeApp || window.VertexApp;
    const overlay = $('premiumOverlay');
    if (overlay) {
      // The shared bootstrap intentionally hides overlays with the HTML hidden
      // attribute. App.openModal only changes display, so clear hidden here too.
      overlay.hidden = false;
      overlay.style.display = 'flex';
      overlay.style.zIndex = '1400';
    }
    app?.openPremiumAccess?.();
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
      overlay.style.zIndex = '1400';
      window.setTimeout(() => overlay.querySelector('input,button')?.focus?.(), 0);
    }
  }
  window.openPremiumFromLock = openPremiumFromLock;

  function ensureTools() {
    const modal = $('premiumOverlay')?.querySelector('.modal');
    if (!modal || $('accessLockBtn')) return;
    const row = document.createElement('div');
    row.className = 'modal-actions access-actions';
    row.innerHTML = '<button class="secondary" id="accessLockBtn" type="button" hidden>Lock this device</button>';
    modal.appendChild(row);
    $('accessLockBtn').addEventListener('click', async () => {
      try { await request('/api/access/logout', { method: 'POST' }); session = { role: 'free', permissions: { premium: false } }; sync(); setStatus('Elevated access was locked on this device.', 'good'); }
      catch (error) { setStatus(error.message, 'bad'); }
    });

    const panel = document.createElement('section');
    panel.id = 'moderationPanel'; panel.hidden = true; panel.className = 'moderation-panel';
    panel.innerHTML = '<h3>Question management</h3><p id="moderationIntro">Moderators only review learning questions and question types. They can request removal when content is unnecessary, inaccurate, or out of scope for this app.</p><button class="secondary" id="requestDeletionBtn" type="button">Request removal of current question</button><button class="secondary" id="requestTypeDeletionBtn" type="button">Request removal of this question type</button><div id="moderationHistory"></div>';
    modal.appendChild(panel);
    const overlay = document.createElement('div');
    overlay.id = 'moderationRequestOverlay'; overlay.className = 'modal-overlay'; overlay.hidden = true;
    overlay.innerHTML = '<section class="modal compact" role="dialog" aria-modal="true" aria-labelledby="moderationRequestTitle"><div class="modal-heading"><div><h2 id="moderationRequestTitle">Request question removal</h2><p>An administrator will review this question request for this app.</p></div></div><form id="moderationRequestForm"><label>Why should this be removed?<textarea id="moderationReason" maxlength="1000" required placeholder="Explain what is unnecessary, inaccurate, or out of scope."></textarea></label><div class="modal-actions"><button class="secondary" id="moderationCancel" type="button">Cancel</button><button class="primary" type="submit">Submit request</button></div><p id="moderationRequestStatus" class="feedback"></p></form></section>';
    document.body.appendChild(overlay);
    let item = null;
    const current = (type) => {
      const app = window.SpanishPracticeApp || window.VertexApp;
      const q = app?.currentQuestion;
      if (!q) return null;
      return type === 'question-type'
        ? { id: `${q.module}:type`, type, label: `Question type in ${q.module}`, moduleId: q.module }
        : { id: String(q.id), type: 'question', label: String(q.prompt || '').replace(/<[^>]+>/g, ''), moduleId: q.module };
    };
    const openRequest = (type) => { item = current(type); if (!item) return setStatus('Start a learning session and open a question first.', 'bad'); overlay.hidden = false; $('moderationReason').focus(); };
    $('requestDeletionBtn').addEventListener('click', () => openRequest('question'));
    $('requestTypeDeletionBtn').addEventListener('click', () => openRequest('question-type'));
    $('moderationCancel').addEventListener('click', () => { overlay.hidden = true; });
    $('moderationRequestForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try { await request('/api/moderation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item, reason: $('moderationReason').value }) }); overlay.hidden = true; $('moderationReason').value = ''; await loadModeration(); setStatus('Deletion request submitted for administrator review.', 'good'); }
      catch (error) { $('moderationRequestStatus').textContent = error.message; }
    });
  }

  async function loadModeration() {
    const history = $('moderationHistory');
    if (!history || !session.permissions?.viewModeration) return;
    try {
      const data = await request('/api/moderation');
      history.innerHTML = data.requests.length ? data.requests.slice(-12).reverse().map((entry) => {
        const controls = session.permissions.reviewDeletion && entry.status === 'pending'
          ? `<p><button class="secondary" data-review="approve" data-id="${entry.id}">Approve</button> <button class="secondary" data-review="reject" data-id="${entry.id}">Reject</button></p>` : '';
        return `<article class="moderation-record"><strong>${entry.item.label || entry.item.id}</strong><small>${entry.item.type} · ${entry.status} · ${new Date(entry.requestedAt).toLocaleString()}</small><p>${entry.reason}</p><small>Requested by ${entry.requestedBy}${entry.reviewedBy ? ` · reviewed by ${entry.reviewedBy}` : ''}</small>${controls}</article>`;
      }).join('') : '<p class="muted">No deletion requests yet.</p>';
      history.querySelectorAll('[data-review]').forEach((button) => button.addEventListener('click', async () => {
        try { await request('/api/moderation', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: button.dataset.id, action: button.dataset.review }) }); await loadModeration(); }
        catch (error) { setStatus(error.message, 'bad'); }
      }));
    } catch (error) { history.innerHTML = `<p class="muted">${error.message}</p>`; }
  }

  function sync() {
    applyPremiumBadges();
    const app = window.SpanishPracticeApp || window.VertexApp;
    if (app) {
      app.mayoPremiumUnlocked = isElevated();
      app.premiumAccessMode = isElevated() ? 'server' : null;
      app.premiumAccessExpiresAt = 0;
      app.hasPremiumAccess = () => isElevated();
      app.refreshSettingsUI?.(); app.updateCountsRow?.();
    }
    const button = $('premiumBtn');
    if (button) { button.classList.toggle('unlocked', isElevated()); button.querySelector('.premium-btn-label')?.replaceChildren(roleLabel()); }
    if ($('accessLockBtn')) $('accessLockBtn').hidden = !isElevated();
    if ($('moderationPanel')) $('moderationPanel').hidden = !session.permissions?.viewModeration;
    loadModeration();
  }

  async function refresh() {
    try { session = await request('/api/access/session'); } catch (_) { session = { role: 'free', permissions: { premium: false } }; }
    sync();
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Static modal markup must start closed; individual app handlers open them explicitly.
    ['settingsOverlay', 'premiumOverlay', 'feedbackOverlay', 'endSessionOverlay', 'numbersGuideOverlay', 'hiddenOverlay', 'moderationRequestOverlay'].forEach((id) => {
      const overlay = $(id);
      if (overlay) { overlay.hidden = id === 'moderationRequestOverlay'; overlay.style.display = 'none'; }
    });
    ensureTools();
    window.addEventListener('premium:open', openPremiumFromLock);
    document.addEventListener('click', async (event) => {
      if (event.target.closest('#premiumBtn,[data-premium-lock]')) closeSettingsBeforePremium();
      if (event.target.closest('#premiumSubmitBtn')) {
        event.preventDefault(); event.stopImmediatePropagation();
        const password = $('premiumPasswordInput')?.value || '';
        try { session = await request('/api/access/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); $('premiumPasswordInput').value = ''; sync(); setStatus(`${roleLabel()} access is active on this device.`, 'good'); }
        catch (error) { setStatus(error.message, 'bad'); }
      }
    }, true);
    refresh();
  });
})();
