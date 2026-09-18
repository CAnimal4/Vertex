/* Shared learning-app runtime utilities. App runtimes remain responsible for content/modules. */
(function(){
  const api = window.LearningAppShared = window.LearningAppShared || {};
  api.version = '1.0.0';
  api.readQuery = function(name, fallback){
    try { return new URLSearchParams(window.location.search).get(name) || fallback; } catch (_) { return fallback; }
  };
  api.setDocumentTitle = function(appName, context){
    document.title = context ? `${appName} — ${context}` : appName;
  };
  api.toggle = function(element, expanded){
    if (!element) return;
    element.hidden = !expanded;
    element.setAttribute('aria-hidden', String(!expanded));
  };
  api.prefersReducedMotion = function(){
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  // Small, shared product prompts. These are intentionally cookie-backed and
  // dismissible so they do not interrupt practice or repeat on every visit.
  api.installExperiencePrompts = function(){
    if (document.documentElement.dataset.experiencePromptsInstalled) return;
    document.documentElement.dataset.experiencePromptsInstalled = 'true';
    const appName = document.getElementById('brandName')?.textContent?.trim() || document.title.split('—')[0].trim() || 'this app';
    const cookieName = `learning_prompt_${appName.toLowerCase().replace(/[^a-z0-9]+/g,'_')}`;
    const hasCookie = (name) => document.cookie.split('; ').some((part) => part.startsWith(`${name}=`));
    const setCookie = (name) => { document.cookie = `${name}=1; max-age=31536000; path=/; SameSite=Lax`; };
    const show = (kind, title, copy, primaryLabel, onPrimary) => {
      document.querySelector('.shared-prompt')?.remove();
      const prompt = document.createElement('aside');
      prompt.className = `shared-prompt shared-prompt-${kind}`;
      prompt.setAttribute('role','dialog');
      prompt.setAttribute('aria-label', title);
      prompt.innerHTML = `<div><strong>${title}</strong><p>${copy}</p></div><div class="shared-prompt-actions"><button type="button" class="shared-prompt-primary">${primaryLabel}</button><button type="button" class="shared-prompt-dismiss" aria-label="Dismiss">Not now</button></div>`;
      document.body.appendChild(prompt);
      prompt.querySelector('.shared-prompt-primary').addEventListener('click', () => { onPrimary?.(); prompt.remove(); });
      prompt.querySelector('.shared-prompt-dismiss').addEventListener('click', () => { prompt.remove(); if (kind === 'feedback') setCookie(cookieName); });
      if (!api.prefersReducedMotion()) requestAnimationFrame(() => prompt.classList.add('is-visible'));
      else prompt.classList.add('is-visible');
    };
    const openFeedback = () => {
      const app = window.SpanishPracticeApp || window.VertexApp;
      if (typeof app?.openFeedback === 'function') app.openFeedback();
      else document.getElementById('feedbackBtn')?.click();
      setCookie(cookieName);
    };
    const openPremium = () => {
      const app = window.SpanishPracticeApp || window.VertexApp;
      if (typeof app?.openPremiumAccess === 'function') app.openPremiumAccess();
      else window.setTimeout(() => document.getElementById('premiumBtn')?.click(), 0);
    };
    window.setTimeout(() => {
      if (!hasCookie(cookieName)) show('feedback', `Welcome to ${appName}`, 'If you spot a glitch or have an idea, a quick note helps us improve the learning experience.', 'Leave feedback', openFeedback);
    }, 1400);
    document.addEventListener('click', (event) => {
      const locked = event.target.closest('.module-locked,[data-premium="true"],[data-premium-locked]');
      if (!locked || document.querySelector('.shared-prompt-premium')) return;
      show('premium', 'This is a Premium feature', 'Request access if this section or a fuller practice set would be useful for you.', 'See Premium', openPremium);
    }, true);
  };
  document.addEventListener('DOMContentLoaded', () => api.installExperiencePrompts());
})();
