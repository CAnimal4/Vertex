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

  function setStatus(message, tone = 'neutral') {
    const status = $('premiumFeedback');
    if (status) { status.className = `feedback ${tone}`; status.textContent = message; }
  }

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
    panel.innerHTML = '<h3>Question management</h3><p id="moderationIntro">Request review of the current question or question type.</p><button class="secondary" id="requestDeletionBtn" type="button">Request deletion of current question</button><button class="secondary" id="requestTypeDeletionBtn" type="button">Request deletion of this question type</button><div id="moderationHistory"></div>';
    modal.appendChild(panel);
    const overlay = document.createElement('div');
    overlay.id = 'moderationRequestOverlay'; overlay.className = 'modal-overlay'; overlay.hidden = true;
    overlay.innerHTML = '<section class="modal compact" role="dialog" aria-modal="true" aria-labelledby="moderationRequestTitle"><div class="modal-heading"><div><h2 id="moderationRequestTitle">Request permanent deletion</h2><p>Describe the issue briefly. An administrator must review it.</p></div></div><form id="moderationRequestForm"><label>Reason<textarea id="moderationReason" maxlength="1000" required></textarea></label><div class="modal-actions"><button class="secondary" id="moderationCancel" type="button">Cancel</button><button class="primary" type="submit">Submit request</button></div><p id="moderationRequestStatus" class="feedback"></p></form></section>';
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
    ensureTools();
    document.addEventListener('click', async (event) => {
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
