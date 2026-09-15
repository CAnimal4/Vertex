(() => {
  'use strict';

  const APP = { id: 'vertex', name: 'Vertex', feedbackUrl: 'https://tally.so/r/Pdq7AQ', premiumUrl: 'https://tally.so/r/Y5A1Oq' };
  const STORAGE_KEY = 'vertex_math_v2_state';
  const ROLE_RANK = { free: 0, premium: 1, mod: 2, admin: 3 };
  const curriculum = window.VertexCurriculum;
  const sections = curriculum.flattenSections();
  const sectionById = new Map(sections.map(section => [section.id, section]));
  const $ = id => document.getElementById(id);

  function defaultState() {
    return {
      version: 2,
      selectedSectionId: '1-1',
      enabledSections: Object.fromEntries(sections.map(section => [section.id, section.access === 'free'])),
      expandedUnits: { 'unit-1': true, 'unit-2': false },
      prioritizeWeakQuestions: true,
      itemStats: {},
      lifetime: { answered: 0, correct: 0, currentStreak: 0, bestStreak: 0 },
      practiceSessions: []
    };
  }

  function sanitizeState(value) {
    const base = defaultState();
    if (!value || typeof value !== 'object') return base;
    if (sectionById.has(value.selectedSectionId)) base.selectedSectionId = value.selectedSectionId;
    for (const section of sections) {
      if (typeof value.enabledSections?.[section.id] === 'boolean') base.enabledSections[section.id] = value.enabledSections[section.id];
    }
    for (const unit of curriculum.units) {
      if (typeof value.expandedUnits?.[unit.id] === 'boolean') base.expandedUnits[unit.id] = value.expandedUnits[unit.id];
    }
    if (typeof value.prioritizeWeakQuestions === 'boolean') base.prioritizeWeakQuestions = value.prioritizeWeakQuestions;
    if (value.itemStats && typeof value.itemStats === 'object') {
      for (const [id, item] of Object.entries(value.itemStats)) {
        if (!id.startsWith(`${curriculum.courseId}:`) || !item || typeof item !== 'object') continue;
        base.itemStats[id] = { attempts: Math.max(0, Number(item.attempts) || 0), correct: Math.max(0, Number(item.correct) || 0) };
      }
    }
    if (value.lifetime && typeof value.lifetime === 'object') {
      for (const key of Object.keys(base.lifetime)) base.lifetime[key] = Math.max(0, Number(value.lifetime[key]) || 0);
    }
    if (Array.isArray(value.practiceSessions)) {
      base.practiceSessions = value.practiceSessions.slice(-50).map(session => ({
        id: String(session.id || '').slice(0, 80), sectionId: sectionById.has(session.sectionId) ? session.sectionId : '1-1',
        startedAt: String(session.startedAt || ''), endedAt: String(session.endedAt || ''),
        answered: Math.max(0, Number(session.answered) || 0), correct: Math.max(0, Number(session.correct) || 0)
      })).filter(session => session.id && session.startedAt);
    }
    return base;
  }

  function loadState() {
    try { return sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (_) { return defaultState(); }
  }

  const state = loadState();
  const access = { role: 'free', actorId: null, permissions: {} };
  let moderationRequests = [];
  let moderationSuppressions = [];
  let session = null;
  let currentQuestion = null;
  let questionOrder = [];
  let questionIndex = 0;
  let answered = false;
  let lastFocus = null;

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const hasRole = required => (ROLE_RANK[access.role] || 0) >= (ROLE_RANK[required] || 0);
  const canRequestDeletion = () => hasRole('mod');
  const canReviewDeletion = () => hasRole('admin');
  const canAccessSection = section => section.access === 'free' || hasRole('premium');
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

  function normalizeAnswer(value) {
    return String(value || '').trim().toLowerCase().replace(/[°]/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/[.]+$/g, '');
  }

  function answersMatch(given, expected) {
    const left = normalizeAnswer(given);
    const right = normalizeAnswer(expected);
    if (left === right) return true;
    if (/^-?\d+(\.\d+)?$/.test(right)) return Number(left) === Number(right);
    return false;
  }

  function openModal(element, focus) {
    lastFocus = document.activeElement;
    element.hidden = false;
    setTimeout(() => (focus || element.querySelector('button,input,select'))?.focus(), 0);
  }

  function closeModal(element) {
    element.hidden = true;
    lastFocus?.focus?.();
  }

  function selectedSection() { return sectionById.get(state.selectedSectionId) || sections[0]; }

  function updateAccessUI() {
    const label = access.role === 'free' ? 'Premium' : access.role === 'premium' ? 'Premium active' : access.role === 'mod' ? 'Moderator' : 'Admin';
    $('premiumButton').textContent = label;
    $('premiumButton').classList.toggle('unlocked', hasRole('premium'));
    $('accessRole').textContent = access.role[0].toUpperCase() + access.role.slice(1);
    $('lockAccessButton').hidden = access.role === 'free';
    $('elevatedAccessNote').hidden = !hasRole('mod');
    $('moderationPanel').hidden = !hasRole('mod');
    $('moderationPanelTitle').textContent = canReviewDeletion() ? 'Admin moderation' : 'Moderator tools';
    $('moderationRequestBtn').hidden = !canRequestDeletion() || !currentQuestion;
    renderUnits();
    renderSettings();
  }

  async function requestJson(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(data.error || 'Request failed.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function refreshAccess() {
    let data = null;
    try { data = await requestJson('/api/access/session'); }
    catch (_) {
      try { data = await requestJson('/api/premium/session'); } catch (_) { data = null; }
    }
    access.role = ROLE_RANK[data?.role] != null ? data.role : data?.premium ? 'premium' : 'free';
    access.actorId = data?.actorId || null;
    access.permissions = data?.permissions || {};
    updateAccessUI();
    await loadModerationData();
  }

  async function verifyAccess(event) {
    event.preventDefault();
    const password = $('premiumPassword').value;
    const status = $('premiumStatus');
    status.textContent = 'Verifying access…';
    try {
      let data;
      const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) };
      try { data = await requestJson('/api/access/login', options); }
      catch (firstError) {
        if (firstError.status !== 404) throw firstError;
        data = await requestJson('/api/premium/verify', options);
      }
      access.role = ROLE_RANK[data.role] != null ? data.role : data.premium ? 'premium' : 'free';
      access.actorId = data.actorId || null;
      access.permissions = data.permissions || {};
      $('premiumPassword').value = '';
      status.textContent = `${access.role[0].toUpperCase() + access.role.slice(1)} access is active.`;
      updateAccessUI();
      await loadModerationData();
    } catch (_) {
      status.textContent = 'That password could not be verified.';
      $('premiumPassword').select();
    }
  }

  async function logoutAccess() {
    try { await requestJson('/api/access/logout', { method: 'POST' }); }
    catch (_) { try { await requestJson('/api/premium/logout', { method: 'POST' }); } catch (_) {} }
    access.role = 'free';
    access.actorId = null;
    access.permissions = {};
    closeModal($('premiumOverlay'));
    updateAccessUI();
  }

  function renderUnits() {
    const list = $('unitList');
    list.innerHTML = '';
    for (const unit of curriculum.units) {
      const details = document.createElement('details');
      details.className = 'unit-card';
      details.open = state.expandedUnits[unit.id] !== false;
      details.addEventListener('toggle', () => { state.expandedUnits[unit.id] = details.open; save(); });
      const summary = document.createElement('summary');
      const unitSections = unit.chapters.flatMap(chapter => chapter.sections);
      summary.innerHTML = `<span><strong>${escapeHtml(unit.title)}</strong><small>${unitSections.length} section${unitSections.length === 1 ? '' : 's'}</small></span><span class="unit-chevron" aria-hidden="true">⌄</span>`;
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'unit-body';
      for (const chapter of unit.chapters) {
        const heading = document.createElement('h3');
        heading.textContent = chapter.title;
        body.appendChild(heading);
        for (const raw of chapter.sections) {
          const section = sectionById.get(raw.id);
          const unlocked = canAccessSection(section);
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `module-card${state.selectedSectionId === section.id ? ' is-selected' : ''}${unlocked ? '' : ' is-locked'}`;
          button.innerHTML = `<span><strong>${escapeHtml(section.title)}</strong><small>${escapeHtml(section.summary)}</small></span><span class="module-access">${unlocked ? `${section.questions.length} questions` : 'Premium'}</span>`;
          button.addEventListener('click', () => selectSection(section.id));
          body.appendChild(button);
        }
      }
      details.appendChild(body);
      list.appendChild(details);
    }
    $('moduleCount').textContent = String(sections.length);
    const section = selectedSection();
    $('selectedModuleName').textContent = section.title;
    $('selectedModuleSummary').textContent = section.summary;
    $('enterPracticeBtn').disabled = !canAccessSection(section);
    $('enterPracticeBtn').textContent = canAccessSection(section) ? 'Start practice session →' : 'Unlock Premium to practice';
  }

  function selectSection(id) {
    const section = sectionById.get(id);
    if (!section) return;
    state.selectedSectionId = id;
    if (!canAccessSection(section)) {
      save();
      renderUnits();
      openPremium();
      return;
    }
    state.enabledSections[id] = true;
    save();
    renderUnits();
  }

  function renderSettings() {
    const container = $('settingsModuleList');
    container.innerHTML = '';
    for (const section of sections) {
      const label = document.createElement('label');
      label.className = `settings-module${canAccessSection(section) ? '' : ' is-locked'}`;
      label.innerHTML = `<input type="checkbox" data-section="${section.id}" ${state.enabledSections[section.id] ? 'checked' : ''} ${canAccessSection(section) ? '' : 'disabled'}><span><strong>${escapeHtml(section.title)}</strong><small>${section.access === 'free' ? 'Free' : 'Premium'}</small></span>`;
      label.querySelector('input').addEventListener('change', event => { state.enabledSections[section.id] = event.target.checked; save(); });
      container.appendChild(label);
    }
    $('prioritizeWeakQuestions').checked = state.prioritizeWeakQuestions;
  }

  function moderationItem(question = currentQuestion, type = 'question') {
    if (!question) return null;
    const sectionId = session?.sectionId || selectedSection().id;
    return type === 'question-type'
      ? { id: `vertex:type:${sectionId}:${question.type}`, type, label: `${sectionById.get(sectionId)?.title || sectionId}: ${question.type} questions`, moduleId: sectionId }
      : { id: question.id, type: 'question', label: question.prompt, moduleId: sectionId };
  }

  function isQuestionSuppressed(question, sectionId = session?.sectionId || selectedSection().id) {
    const questionItem = { id: question.id, type: 'question' };
    const typeItem = { id: `vertex:type:${sectionId}:${question.type}`, type: 'question-type' };
    return moderationSuppressions.some(entry => {
      const item = entry?.item && typeof entry.item === 'object' ? entry.item : entry;
      return item && ((item.id === questionItem.id && item.type === questionItem.type) || (item.id === typeItem.id && item.type === typeItem.type));
    });
  }

  function chooseQuestionOrder(section) {
    const questions = section.questions.filter(question => !isQuestionSuppressed(question, section.id));
    if (state.prioritizeWeakQuestions) {
      questions.sort((a, b) => {
        const sa = state.itemStats[a.id] || { attempts: 0, correct: 0 };
        const sb = state.itemStats[b.id] || { attempts: 0, correct: 0 };
        const aa = sa.attempts ? sa.correct / sa.attempts : -1;
        const ab = sb.attempts ? sb.correct / sb.attempts : -1;
        return aa - ab || Math.random() - 0.5;
      });
    } else questions.sort(() => Math.random() - 0.5);
    return questions;
  }

  function startSession() {
    const section = selectedSection();
    if (!canAccessSection(section)) { openPremium(); return; }
    state.enabledSections[section.id] = true;
    questionOrder = chooseQuestionOrder(section);
    if (!questionOrder.length) {
      $('selectedModuleSummary').textContent = 'No active questions remain in this section. An Admin has permanently removed the available items.';
      return;
    }
    questionIndex = 0;
    session = { id: `session-${Date.now()}`, sectionId: section.id, startedAt: new Date().toISOString(), answered: 0, correct: 0 };
    $('dashboardRoot').hidden = true;
    $('practiceRoot').hidden = false;
    $('practiceModuleTitle').textContent = section.title;
    $('practiceConcepts').textContent = section.concepts.join(' · ');
    updateSessionStats();
    renderQuestion();
  }

  function renderQuestion() {
    if (!session || !questionOrder.length) return;
    currentQuestion = questionOrder[questionIndex % questionOrder.length];
    $('moderationRequestBtn').hidden = !canRequestDeletion();
    answered = false;
    $('questionProgress').textContent = `Question ${(questionIndex % questionOrder.length) + 1} of ${questionOrder.length}`;
    $('questionPrompt').textContent = currentQuestion.prompt;
    $('answerFeedback').className = 'answer-feedback';
    $('answerFeedback').textContent = '';
    $('nextQuestionButton').hidden = true;
    const answer = $('answerArea');
    answer.innerHTML = '';
    if (currentQuestion.type === 'mcq') {
      const options = [...currentQuestion.options].sort(() => Math.random() - 0.5);
      const group = document.createElement('div');
      group.className = 'answer-options';
      for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'answer-option';
        button.textContent = option;
        button.addEventListener('click', () => submitAnswer(option, button));
        group.appendChild(button);
      }
      answer.appendChild(group);
    } else {
      const form = document.createElement('form');
      form.className = 'text-answer-form';
      form.innerHTML = '<label for="questionAnswer">Your answer</label><div><input id="questionAnswer" autocomplete="off" required><button class="primary" type="submit">Check answer</button></div>';
      form.addEventListener('submit', event => { event.preventDefault(); submitAnswer($('questionAnswer').value, $('questionAnswer')); });
      answer.appendChild(form);
      setTimeout(() => $('questionAnswer')?.focus(), 0);
    }
    window.syncAdminQuestionControl?.();
  }

  async function loadModerationData() {
    try {
      const data = await requestJson('/api/moderation');
      moderationRequests = hasRole('mod') && Array.isArray(data.requests) ? data.requests : [];
      moderationSuppressions = Array.isArray(data.suppressions) ? data.suppressions : [];
      renderModerationHistory();
      if (currentQuestion && isQuestionSuppressed(currentQuestion)) {
        questionOrder = chooseQuestionOrder(sectionById.get(session.sectionId));
        questionIndex = 0;
        if (questionOrder.length) renderQuestion();
        else endSession();
      }
    } catch (_) {
      $('moderationStatus').textContent = 'Moderation data is unavailable.';
    }
  }

  function renderModerationHistory() {
    const history = $('moderationHistory');
    history.innerHTML = '';
    $('moderationHistoryEmpty').hidden = moderationRequests.length > 0;
    for (const request of [...moderationRequests].reverse()) {
      const article = document.createElement('article');
      article.className = 'moderation-request';
      const controls = canReviewDeletion() && request.status === 'pending'
        ? `<div class="moderation-actions"><button class="primary" type="button" data-review="approve" data-request-id="${escapeHtml(request.id)}">Approve</button><button class="secondary" type="button" data-review="reject" data-request-id="${escapeHtml(request.id)}">Reject</button></div>` : '';
      article.innerHTML = `<div><strong>${escapeHtml(request.item?.label || request.item?.id || 'Learning item')}</strong><span>${escapeHtml(request.status || 'pending')}</span></div><p>${escapeHtml(request.reason || '')}</p><small>${escapeHtml(request.requesterRole || 'mod')} · ${escapeHtml(request.requestedAt || '')}</small>${request.reviewedAt ? `<small>Reviewed by ${escapeHtml(request.reviewedBy || 'admin')} · ${escapeHtml(request.reviewedAt)}</small>` : ''}${controls}`;
      history.appendChild(article);
    }
  }

  function openModerationRequest() {
    if (!canRequestDeletion() || !currentQuestion) return;
    $('moderationRequestItem').textContent = currentQuestion.prompt;
    $('moderationItemType').value = 'question';
    $('moderationReason').value = '';
    $('moderationRequestStatus').textContent = '';
    openModal($('moderationRequestOverlay'), $('moderationReason'));
  }

  async function submitModerationRequest(event) {
    event.preventDefault();
    const item = moderationItem(currentQuestion, $('moderationItemType').value);
    const reason = $('moderationReason').value.trim();
    if (!item || !reason || !canRequestDeletion()) return;
    try {
      await requestJson('/api/moderation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item, reason }) });
      $('moderationRequestStatus').textContent = 'Deletion request submitted for Admin review.';
      await loadModerationData();
      closeModal($('moderationRequestOverlay'));
    } catch (_) { $('moderationRequestStatus').textContent = 'The deletion request could not be submitted.'; }
  }

  async function reviewModerationRequest(requestId, action) {
    if (!canReviewDeletion() || !requestId || !['approve', 'reject'].includes(action)) return;
    try {
      await requestJson('/api/moderation', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, action }) });
      $('moderationStatus').textContent = `Request ${action === 'approve' ? 'approved' : 'rejected'}.`;
      await loadModerationData();
    } catch (_) { $('moderationStatus').textContent = 'The review decision could not be saved.'; }
  }

  function submitAnswer(value, control) {
    if (answered || !currentQuestion) return;
    answered = true;
    const correct = answersMatch(value, currentQuestion.answer);
    const item = state.itemStats[currentQuestion.id] || { attempts: 0, correct: 0 };
    item.attempts += 1;
    if (correct) item.correct += 1;
    state.itemStats[currentQuestion.id] = item;
    state.lifetime.answered += 1;
    session.answered += 1;
    if (correct) {
      state.lifetime.correct += 1;
      state.lifetime.currentStreak += 1;
      state.lifetime.bestStreak = Math.max(state.lifetime.bestStreak, state.lifetime.currentStreak);
      session.correct += 1;
    } else state.lifetime.currentStreak = 0;
    const feedback = $('answerFeedback');
    feedback.className = `answer-feedback ${correct ? 'good' : 'bad'}`;
    feedback.innerHTML = correct
      ? `<strong>Correct.</strong> ${escapeHtml(currentQuestion.explanation)}`
      : `<strong>Not quite.</strong> The expected answer is <strong>${escapeHtml(currentQuestion.answer)}</strong>. ${escapeHtml(currentQuestion.explanation)}`;
    $('answerArea').querySelectorAll('button,input').forEach(node => { node.disabled = true; });
    control?.classList?.add(correct ? 'is-correct' : 'is-incorrect');
    $('nextQuestionButton').hidden = false;
    $('nextQuestionButton').focus();
    updateSessionStats();
    save();
  }

  function nextQuestion() { questionIndex += 1; renderQuestion(); }

  function updateSessionStats() {
    $('sessionCorrect').textContent = String(session?.correct || 0);
    $('sessionAnswered').textContent = String(session?.answered || 0);
    $('sessionAccuracy').textContent = session?.answered ? `${Math.round(session.correct / session.answered * 100)}%` : '0%';
  }

  function endSession() {
    if (session) {
      state.practiceSessions.push({ ...session, endedAt: new Date().toISOString() });
      state.practiceSessions = state.practiceSessions.slice(-50);
      save();
    }
    session = null;
    currentQuestion = null;
    $('moderationRequestBtn').hidden = true;
    $('practiceRoot').hidden = true;
    $('dashboardRoot').hidden = false;
    renderDashboardStats();
  }

  function renderDashboardStats() {
    const stats = state.lifetime;
    $('allTimeAccuracy').textContent = stats.answered ? `${Math.round(stats.correct / stats.answered * 100)}%` : '0%';
    $('allTimeCorrect').textContent = String(stats.correct);
    $('allTimeAnswered').textContent = `of ${stats.answered} answered`;
    $('allTimeStreak').textContent = String(stats.currentStreak);
    $('allTimeBest').textContent = String(stats.bestStreak);
    $('allTimeSessions').textContent = String(state.practiceSessions.length);
    const history = $('sessionHistory');
    history.innerHTML = '';
    const recent = [...state.practiceSessions].reverse().slice(0, 8);
    $('sessionHistoryEmpty').hidden = recent.length > 0;
    for (const item of recent) {
      const section = sectionById.get(item.sectionId);
      const row = document.createElement('article');
      row.className = 'history-row';
      const date = new Date(item.endedAt || item.startedAt);
      row.innerHTML = `<span><strong>${escapeHtml(section?.title || item.sectionId)}</strong><small>${date.toLocaleString()}</small></span><span><strong>${item.answered ? Math.round(item.correct / item.answered * 100) : 0}%</strong><small>${item.correct}/${item.answered} correct</small></span>`;
      history.appendChild(row);
    }
  }

  function openPremium() {
    $('premiumPassword').value = '';
    $('premiumStatus').textContent = access.role === 'free' ? 'Enter an access password. Passwords are verified by the server.' : `${access.role[0].toUpperCase() + access.role.slice(1)} access is active.`;
    openModal($('premiumOverlay'), access.role === 'free' ? $('premiumPassword') : $('lockAccessButton'));
  }

  function openFeedback() {
    $('feedbackForm').reset();
    $('feedbackStatus').textContent = 'This opens the shared secure feedback form.';
    openModal($('feedbackOverlay'), $('feedbackMessage'));
  }

  function submitFeedback(event) {
    event.preventDefault();
    const type = $('feedbackType').value;
    const requested = $('requestedModule').value.trim();
    if (type === 'module_request' && !requested) { $('requestedModule').focus(); return; }
    const url = new URL(APP.feedbackUrl);
    const message = type === 'module_request' ? `Requested module: ${requested}\n\n${$('feedbackMessage').value.trim()}` : $('feedbackMessage').value.trim();
    const fields = { form_type: 'feedback', app_name: 'vertex', feedback_type: type, requested_module: requested, message, email: $('feedbackEmail').value.trim(), dashboard: 'Accelerated Geometry', module: selectedSection().title, source: 'feedback_button', page_url: location.href };
    for (const [key, value] of Object.entries(fields)) if (value) url.searchParams.set(key, value);
    window.open(url, '_blank', 'noopener,noreferrer');
    $('feedbackStatus').textContent = 'Feedback opened in a new tab. Submit it there.';
  }

  function submitPremiumRequest(event) {
    event.preventDefault();
    const url = new URL(APP.premiumUrl);
    const fields = { form_type: 'premium_access_request', app_name: 'vertex', name: $('premiumRequestName').value.trim(), email: $('premiumRequestEmail').value.trim(), dashboard: 'Accelerated Geometry', module: selectedSection().title, source: 'premium_modal', page_url: location.href };
    for (const [key, value] of Object.entries(fields)) if (value) url.searchParams.set(key, value);
    window.open(url, '_blank', 'noopener,noreferrer');
    $('premiumRequestStatus').textContent = 'Request opened in a new tab. Submit it there.';
  }

  function initEvents() {
    $('enterPracticeBtn').addEventListener('click', startSession);
    $('homeSettingsBtn').addEventListener('click', () => { renderSettings(); openModal($('settingsOverlay'), $('settingsClose')); });
    $('settingsClose').addEventListener('click', () => closeModal($('settingsOverlay')));
    $('prioritizeWeakQuestions').addEventListener('change', event => { state.prioritizeWeakQuestions = event.target.checked; save(); });
    $('endSessionButton').addEventListener('click', endSession);
    $('nextQuestionButton').addEventListener('click', nextQuestion);
    $('premiumButton').addEventListener('click', openPremium);
    $('premiumClose').addEventListener('click', () => closeModal($('premiumOverlay')));
    $('premiumForm').addEventListener('submit', verifyAccess);
    $('lockAccessButton').addEventListener('click', logoutAccess);
    $('premiumRequestToggle').addEventListener('click', () => { $('premiumRequestForm').hidden = !$('premiumRequestForm').hidden; });
    $('premiumRequestForm').addEventListener('submit', submitPremiumRequest);
    $('moderationRequestBtn').addEventListener('click', openModerationRequest);
    $('moderationRequestClose').addEventListener('click', () => closeModal($('moderationRequestOverlay')));
    $('moderationRequestCancel').addEventListener('click', () => closeModal($('moderationRequestOverlay')));
    $('moderationRequestForm').addEventListener('submit', submitModerationRequest);
    $('moderationHistory').addEventListener('click', event => {
      const button = event.target.closest('[data-review]');
      if (button) reviewModerationRequest(button.dataset.requestId, button.dataset.review);
    });
    $('feedbackButton').addEventListener('click', openFeedback);
    $('feedbackClose').addEventListener('click', () => closeModal($('feedbackOverlay')));
    $('feedbackCancel').addEventListener('click', () => closeModal($('feedbackOverlay')));
    $('feedbackType').addEventListener('change', () => { const show = $('feedbackType').value === 'module_request'; $('requestedModuleField').hidden = !show; $('requestedModule').required = show; });
    $('feedbackForm').addEventListener('submit', submitFeedback);
    document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(overlay); }));
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const open = [...document.querySelectorAll('.modal-overlay')].find(overlay => !overlay.hidden);
      if (open) closeModal(open);
    });
  }

  window.VertexApp = {
    APP, curriculum, state, access, hasRole, canAccessSection, startSession, endSession, isQuestionSuppressed,
    setCurrentQuestion(question) { currentQuestion = question || null; },
    getCurrentQuestion() { return currentQuestion; },
    selectSection
  };

  renderUnits();
  renderSettings();
  renderDashboardStats();
  initEvents();
  refreshAccess();
})();
