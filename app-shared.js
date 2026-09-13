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
})();
