/* Vertex content adapter: keeps Claro's session UI while supplying Geometry data. */
(() => {
  'use strict';
  const MODULES = [
    ['unit-1','1-1','Points, Lines, and Planes','01-01_points-lines-planes_annotated.pdf'],
    ['unit-1','1-3','Midpoint and Distance Formula','01-03_midpoint-and-distance-formula_annotated.pdf'],
    ['unit-1','1-5','Measuring and Constructing Angles','01-05_measuring-angles_annotated.pdf, 01-05_more-measuring-angles_annotated.pdf'],
    ['unit-1','1-6','Pairs of Angles','01-06_pairs-of-angles_annotated.pdf'],
    ['unit-1','review','Test 1 Review','01-99_review-for-test-1_answers.pdf'],
    ['unit-2','2-2','Inductive and Deductive Reasoning','02-02_inductive-and-deductive-reasoning_part-1_annotated.pdf'],
    ['unit-2','2-4','Algebraic Reasoning','02-04_algebraic-reasoning_annotated.pdf'],
    ['unit-2','2-5','Proving Statements about Segments and Angles','02-05_proving-segments-and-angles_annotated.pdf'],
    ['unit-2','2-6','Proving Geometric Relationships','02-06_proving-geometric-relationships_annotated.pdf'],
    ['unit-3','3-1','Pairs of Lines and Angles','03-01_pairs-of-lines-and-angles_blank.pdf']
  ].map(([unit, section, name, sources]) => ({ key: `geometry-${section}`, unit, section, name, sources: sources.split(', ') }));
  const QUESTIONS = {
    'geometry-1-1': [['u1-1-point','What is an undefined term that names an exact location?', 'point'], ['u1-1-collinear','Points on the same line are called what?', 'collinear'], ['u1-1-ray','A part of a line with one endpoint that extends forever in one direction is a?', 'ray']],
    'geometry-1-3': [['u1-3-midpoint','What formula finds the midpoint of a segment in the coordinate plane?', 'midpoint formula'], ['u1-3-distance','What theorem/formula supports finding distance between two coordinate points?', 'distance formula']],
    'geometry-1-5': [['u1-5-addition','If D is inside ∠ABC, what postulate gives m∠ABD + m∠DBC = m∠ABC?', 'angle addition postulate'], ['u1-5-bisect','If BD bisects ∠ABC, what relationship is true?', 'm∠ABD = m∠DBC'], ['u1-5-congruent','If BD bisects ∠ABC, what congruence statement is true?', '∠ABD ≅ ∠DBC']],
    'geometry-1-6': [['u1-6-vertical','Which angle relationship is always congruent?', 'vertical angles'], ['u1-6-linear','Adjacent angles that form a line are a?', 'linear pair'], ['u1-6-complementary','Complementary angles have measures that add to?', '90'], ['u1-6-supplementary','Supplementary angles have measures that add to?', '180']],
    'geometry-review': [['review-linear','What postulate describes adjacent angles that form a line?', 'linear pair postulate'], ['review-midpoint','A point dividing a segment into two congruent segments is its?', 'midpoint']],
    'geometry-2-2': [['u2-2-inductive','Reasoning that uses patterns to form a conjecture is?', 'inductive reasoning'], ['u2-2-counterexample','An example that proves a conjecture false is a?', 'counterexample'], ['u2-2-deductive','Reasoning that uses facts, definitions, postulates, and theorems is?', 'deductive reasoning']],
    'geometry-2-4': [['u2-4-segment','What postulate says that if B is between A and C, AB + BC = AC?', 'segment addition postulate'], ['u2-4-substitution','What property permits replacing equal values in an equation?', 'substitution property of equality'], ['u2-4-reflexive','What property states a quantity is equal to itself?', 'reflexive property of equality'], ['u2-4-proof','What are the two columns in a 2-Column Proof?', 'statements and reasons']],
    'geometry-2-5': [['u2-5-symmetric','If AB ≅ CD, then CD ≅ AB. Name the property.', 'symmetric property of congruence'], ['u2-5-transitive','If AB ≅ CD and CD ≅ RT, then AB ≅ RT. Name the property.', 'transitive property of congruence'], ['u2-5-definition','If AB ≅ CD, then AB = CD. Name the reason.', 'definition of congruent segments']],
    'geometry-2-6': [['u2-6-vertical','What theorem proves vertical angles are congruent?', 'vertical angle theorem'], ['u2-6-supplements','What theorem says angles supplementary to the same angle are congruent?', 'congruent supplements theorem'], ['u2-6-complements','What theorem says angles complementary to the same angle are congruent?', 'congruent complements theorem']],
    'geometry-3-1': [['u3-1-perpendicular','Lines that intersect to form right angles are?', 'perpendicular lines'], ['u3-1-transversal','A line that intersects two or more coplanar lines is a?', 'transversal']]
  };
  const normalize = (value) => String(value).toLowerCase().replace(/[∠≅.,?]/g, '').replace(/\s+/g, ' ').trim();
  document.addEventListener('DOMContentLoaded', () => { setTimeout(() => {
    const app = window.SpanishPracticeApp;
    if (!app) return;
    window.VertexApp = app;
    document.title = 'Vertex — Accelerated Geometry';
    document.documentElement.style.setProperty('--accent', '#166534');
    document.querySelectorAll('#brandName, .app-switcher-menu a.is-current span').forEach((node) => { if (node) node.textContent = 'Vertex'; });
    const subtitle = document.getElementById('subtitle'); if (subtitle) subtitle.textContent = 'Accelerated Geometry';
    const header = document.getElementById('headerLevel'); if (header) header.textContent = 'Accelerated Geometry';
    const classSwitcher = document.querySelector('.dashboard-switcher'); if (classSwitcher) classSwitcher.hidden = true;
    const homeHeading = document.querySelector('#homeCard > .home-copy h1, #homeCard h1'); if (homeHeading) homeHeading.textContent = 'Practice Accelerated Geometry';
    const homeLead = document.querySelector('#homeCard > .home-copy > p:not(.eyebrow), #homeCard .home-copy > p:not(.eyebrow)'); if (homeLead) homeLead.textContent = 'Choose sections, then start a focused geometry session.';
    document.querySelectorAll('.app-switcher-menu .is-current small, #classSwitcherLabel, #headerLevel').forEach((node) => { node.textContent = 'Accelerated Geometry'; });
    document.querySelectorAll('small, p, span, button').forEach((node) => {
      if (node.children.length) return;
      if (node.textContent.trim() === 'Spanish 1') node.textContent = 'Accelerated Geometry';
      if (node.textContent.trim() === 'Choose a level. Start practicing.') node.textContent = 'Choose sections. Start practicing.';
      if (node.textContent.trim() === 'Enter practice session') node.textContent = 'Enter geometry session';
    });
    const tabs = document.querySelector('.level-tabs'); if (tabs) tabs.hidden = true;
    const panel2 = document.getElementById('spanish2Panel'); if (panel2) panel2.hidden = true;
    const panel = document.getElementById('spanish1Panel');
    const geometryMarkup = ['unit-1','unit-2','unit-3'].map((unit, index) => `<details class="module-group" open><summary>Unit ${index + 1}</summary><div class="module-group-content">${MODULES.filter((m) => m.unit === unit).map((m) => `<div class="toggle"><div><div class="label">${m.section} ${m.name}</div><div class="desc">Practice questions from this geometry section.</div></div><label><input type="checkbox" data-geometry-module="${m.key}" aria-label="Toggle ${m.section} ${m.name} module" checked><span class="switch" aria-hidden="true"></span></label></div>`).join('')}</div></details>`).join('');
    if (panel) {
      // Keep Claro's dashboard structure and hierarchy. Only the content is Vertex-specific.
      panel.innerHTML = '<div class="home-overview-card"><span class="home-overview-label">Ready to practice</span><strong id="homeModuleSummary">Geometry sections</strong><small>Enabled sections are used when you choose All enabled modules.</small></div><div class="home-overview-card home-overview-card-muted"><span class="home-overview-label">Simple by default</span><strong>One question at a time</strong><small>Your progress stays in this browser.</small></div>';
    }
    const settingsModules = document.getElementById('moduleSettingsSection');
    if (settingsModules) {
      settingsModules.innerHTML = `<div class="module-settings-heading"><strong>Geometry modules</strong><small>Select the sections you want to practice.</small></div>${geometryMarkup}`;
      const saved = app.state?.geometryModules || {};
      settingsModules.querySelectorAll('[data-geometry-module]').forEach((box) => {
        box.checked = saved[box.dataset.geometryModule] !== false;
        box.addEventListener('change', () => { app.state.geometryModules = Object.fromEntries([...settingsModules.querySelectorAll('[data-geometry-module]')].map((item) => [item.dataset.geometryModule, item.checked])); app.saveSoon(); });
      });
    }
    app.setLevel('geometry', { historyMode: 'replace' });
    // Access-session refreshes can re-render the shared Claro header after this adapter runs.
    // Re-apply Vertex labels whenever that shared UI refreshes so the subject branding stays stable.
    const applyVertexLabels = () => {
      const headerLabel = document.getElementById('headerLevel');
      const classLabel = document.getElementById('classSwitcherLabel');
      if (headerLabel) headerLabel.textContent = 'Accelerated Geometry';
      if (classLabel) classLabel.textContent = 'Accelerated Geometry';
    };
    if (typeof app.refreshSettingsUI === 'function') {
      const refreshSettingsUI = app.refreshSettingsUI.bind(app);
      app.refreshSettingsUI = (...args) => { const result = refreshSettingsUI(...args); app.currentLevel = 'geometry'; applyVertexLabels(); return result; };
    }
    applyVertexLabels();
    app.getEnabledModules = () => MODULES.filter((m) => app.state?.geometryModules?.[m.key] !== false).map((m) => m.key);
    app.isModulePracticeEnabled = (key) => app.getEnabledModules().includes(key);
    app.updateHomeSummary = () => {
      const summary = document.getElementById('homeModuleSummary');
      if (!summary) return;
      const names = MODULES.filter((module) => app.state?.geometryModules?.[module.key] !== false).map((module) => module.name);
      summary.textContent = names.length ? names.join(', ') : 'No sections selected yet';
    };
    app.getModuleCounts = (key) => ({ total: (QUESTIONS[key] || []).length, available: (QUESTIONS[key] || []).filter(([id]) => !app.state.hiddenItems[id]).length });
    app.generateQuestion = (key) => {
      const choices = (QUESTIONS[key] || []).filter(([id]) => !app.state.hiddenItems[id]);
      const item = choices[Math.floor(Math.random() * choices.length)]; if (!item) return null;
      const [id, prompt, answer] = item;
      return { module: key, id, mode: 'text', prompt, expectedDisplay: answer, acceptable: new Set([normalize(answer)]), explanation: 'Use the exact classroom terminology from this section.' };
    };
    const renderQuestion = app.renderQuestion.bind(app);
    app.renderQuestion = (question, options) => {
      renderQuestion(question, options);
      const name = MODULES.find((module) => module.key === question?.module)?.name;
      if (name && app.$.qaTitle) app.$.qaTitle.textContent = name;
      if (app.$.answerInput) app.$.answerInput.placeholder = 'Type your answer...';
    };
    if (app.$.accentToolbar) app.$.accentToolbar.hidden = true;
    if (app.$.keyHintStrip) app.$.keyHintStrip.hidden = true;
    if (app.$.answerInput) app.$.answerInput.placeholder = 'Type your answer...';
    app.getSessionTarget = () => window.VertexApp?.hasPremiumAccess?.() ? 18 : 10;
    app.updateDocumentTitle = () => { document.title = 'Vertex — Accelerated Geometry'; };
    const enter = document.getElementById('enterPracticeBtn'); if (enter) { enter.textContent = 'Enter geometry session →'; enter.setAttribute('aria-label', 'Enter geometry session'); }
    app.refreshSettingsUI?.();
  }, 0); });
})();
