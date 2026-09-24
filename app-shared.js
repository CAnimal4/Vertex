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
  api.registerUpdate = function(update){
    if(!update?.id||!update.title||!update.copy)return;
    window.STUDY_APP_UPDATES=window.STUDY_APP_UPDATES||[];
    if(!window.STUDY_APP_UPDATES.some(item=>item.id===update.id))window.STUDY_APP_UPDATES.push(update);
    api.refreshUpdates?.();
  };

  // Product updates, reusable mini-tours, and the learner's cross-module review set.
  api.installStudyTools = function(){
    if (document.documentElement.dataset.studyToolsInstalled) return;
    document.documentElement.dataset.studyToolsInstalled = 'true';
    const appId = document.body.dataset.appId || 'learning-app';
    const key = `learning_study_tools_${appId}_v1`;
    const read = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { return {}; } };
    const save = (data) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (_) {} };
    let data = read(); data.saved = Array.isArray(data.saved) ? data.saved : []; data.seen = data.seen || {};
    data.updates = Array.isArray(data.updates) ? data.updates : [];
    const notices = [
      { id:'v2-review-collection', title:'Save questions for later', copy:'Use the star beside a question to add it to My Review. Your saved questions can come from any module.', tour:'review' },
      { id:'v2-app-tour', title:'Take a quick app tour', copy:'See where modules, practice, progress, and settings live. You can replay this tour any time.', tour:'app' }
    ];
    // App teams can register future releases from app.js without changing this shared UI.
    (window.STUDY_APP_UPDATES || []).filter(n=>!n.app||n.app===appId||n.app==='all').forEach(n=>{if(!data.updates.some(x=>x.id===n.id))data.updates.push(n);});
    const bell = document.createElement('button'); bell.className='study-notification-button'; bell.type='button'; bell.setAttribute('aria-label','Notifications'); bell.setAttribute('aria-expanded','false'); bell.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><i aria-hidden="true"></i>';
    const headerActions=document.querySelector('.top-actions,.header-actions');
    if(headerActions) headerActions.append(bell); else document.querySelector('.brand')?.append(bell);
    const panel=document.createElement('section'); panel.className='study-notification-panel'; panel.hidden=true; panel.setAttribute('aria-label','App updates');
    panel.innerHTML=`<header><strong>What’s new</strong><button type="button" aria-label="Close">×</button></header><div class="study-notice-list"></div><button type="button" class="study-tour-open">Take the app tour</button>`;
    document.body.append(panel);
    const settingsHeader=document.querySelector('#settingsOverlay .modal-header,#settingsOverlay .modal-head,#settingsOverlay .modal-heading,#settingsOverlay [class*="modal-header"]');
    const settingsTools=document.createElement('div');settingsTools.className='study-settings-tools';settingsTools.innerHTML='<button type="button">My Review</button><button type="button">Feature guides</button>';if(settingsHeader)settingsHeader.append(settingsTools);else panel.append(settingsTools);
    const guide=document.createElement('div'); guide.className='study-guide-backdrop'; guide.hidden=true; guide.innerHTML='<section class="study-guide" role="dialog" aria-modal="true" aria-labelledby="studyGuideTitle"><button class="study-guide-close" aria-label="Close guide">×</button><small class="study-guide-step"></small><h2 id="studyGuideTitle"></h2><p></p><footer><button class="study-guide-skip">Skip tour</button><button class="study-guide-next">Next</button></footer></section>'; document.body.append(guide);
    let tourSteps=[], tourIndex=0;
    const selectors={modules:'#settingsBtn',home:'#homeCard,.home-card',practice:'#mainCard,.main-card',review:'.study-question-star',test2:'#test2ReviewModuleRow'};
    let lastFocusedNode=null;const focusFeature=(target)=>{if(lastFocusedNode)lastFocusedNode.classList.remove('study-guide-focus');if(target==='test2'&&window.SpanishPracticeApp?.currentLevel!=='spanish2')window.SpanishPracticeApp?.setLevel?.('spanish2');if(target==='modules'||target==='test2')window.SpanishPracticeApp?.openSettings?.();const node=document.querySelector(selectors[target]);lastFocusedNode=node||null;if(!node)return;node.scrollIntoView({behavior:'smooth',block:'center'});node.classList.add('study-guide-focus');};
    const tour=(kind)=>{ tourSteps=Array.isArray(kind)?kind.map(s=>[s.title,s.copy,s.target]):kind==='review'?[['Mark a question','Below Submit and Next, tap ☆ Mark for review. The button stays available before and after your answer.','review'],['Find your collection','Open Modules. Use My Review in Settings to view or remove saved questions.','modules'],['Practice the set','From the My Review panel, choose Start review to practice your selected questions.','modules']]:kind==='test2'?[['Find Test 2 Review','I switched Claro to Spanish 2 Honors and opened Modules. Test 2 Review is in this list.','test2'],['Practice the forms','The module mixes regular preterite and imperfect forms, irregular preterites, and time-word clues.','test2'],['Work through Rogelio scenes','Each prompt covers 2–3 boxes. Choose among hacía, hizo, and estaba haciendo, then read why each form fits.','practice']]:[['Welcome to '+(document.getElementById('brandName')?.textContent.trim()||'your app'),'Use this app for short, focused study sessions.','home'],['Choose what to study','Open Modules to choose a topic. Turn on one module for focused practice or several for a mixed session.','modules'],['Start practicing','Start from Home. During a session, answer the prompt and use the question star when you want to revisit it.','practice']]; tourIndex=0; if(kind==='app'){window.SpanishPracticeApp?.closeModal?.(window.SpanishPracticeApp.$?.settingsOverlay);} showStep(); };
    const showStep=()=>{ const [title,copy,target]=tourSteps[tourIndex]; guide.querySelector('h2').textContent=title; guide.querySelector('p').textContent=copy; guide.querySelector('.study-guide-step').textContent=`Step ${tourIndex+1} of ${tourSteps.length}`; guide.querySelector('.study-guide-next').textContent=tourIndex===tourSteps.length-1?'Done':'Next';guide.querySelector('.study-guide-next').dataset.target=target; guide.hidden=false; guide.querySelector('.study-guide-next').focus(); };
    const guideFinish=()=>{guide.hidden=true;if(lastFocusedNode)lastFocusedNode.classList.remove('study-guide-focus');lastFocusedNode=null;if(guideNotice){data.seen[guideNotice]=true;save(data);guideNotice=null;updateBell();}};let guideNotice=null;
    guide.querySelector('.study-guide-next').onclick=()=>{focusFeature(guide.querySelector('.study-guide-next').dataset.target);if(++tourIndex>=tourSteps.length)guideFinish();else showStep();}; guide.querySelector('.study-guide-skip').onclick=guide.querySelector('.study-guide-close').onclick=guideFinish;
    guide.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();guideFinish();return;}if(e.key==='Tab'){const controls=[...guide.querySelectorAll('button:not([disabled])')],first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
    const allNotices=()=>[...notices,...data.updates];
    const render=()=>{ const list=panel.querySelector('.study-notice-list'); list.replaceChildren(); const all=allNotices().filter(n=>!data.seen[n.id]);if(!all.length){const empty=document.createElement('p');empty.className='study-notice-empty';empty.textContent='You’re all caught up.';list.append(empty);}all.forEach(n=>{const row=document.createElement('article'),title=document.createElement('strong'),copy=document.createElement('p'),actions=document.createElement('div'),button=document.createElement('button'),dismiss=document.createElement('button');title.textContent=n.title;copy.textContent=n.copy;actions.className='study-notice-actions';button.type='button';button.textContent=n.tour==='app'?'Take tour':'Show me';button.onclick=()=>{guideNotice=n.id;tour(n.tourSteps||n.tour||'app');};dismiss.type='button';dismiss.className='study-notice-dismiss';dismiss.textContent='Dismiss';dismiss.onclick=()=>{data.seen[n.id]=true;save(data);render();updateBell();};actions.append(button,dismiss);row.append(title,copy,actions);list.append(row);});};
    const updateBell=()=>bell.classList.toggle('has-unread',allNotices().some(n=>!data.seen[n.id]));
    api.refreshUpdates=()=>{let changed=false;(window.STUDY_APP_UPDATES||[]).filter(n=>!n.app||n.app===appId||n.app==='all').forEach(n=>{if(!data.updates.some(x=>x.id===n.id)){data.updates.push(n);changed=true;}});if(changed)save(data);render();updateBell();};
    bell.onclick=()=>{panel.hidden=!panel.hidden;bell.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)render();};
    document.addEventListener('click',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!bell.contains(e.target)){panel.hidden=true;bell.setAttribute('aria-expanded','false');}});
    panel.querySelector('header button').onclick=()=>{panel.hidden=true;bell.setAttribute('aria-expanded','false');}; panel.querySelector('.study-tour-open').onclick=()=>tour('app');
    const review=document.createElement('section');review.className='study-review-manager';review.hidden=true;review.innerHTML='<header><strong>My Review</strong><button type="button" aria-label="Close My Review">×</button></header><p class="study-review-empty">Save a question during practice to add it to this collection.</p><div class="study-review-list"></div><button type="button" class="study-review-start">Start selected review</button>';const reviewPanel=document.createElement('div');reviewPanel.className='study-review-backdrop';reviewPanel.hidden=true;reviewPanel.append(review);document.body.append(reviewPanel);reviewPanel.addEventListener('click',e=>{if(e.target===reviewPanel){reviewPanel.hidden=true;review.hidden=true;}});
    const openReviewManager=()=>{renderReview();reviewPanel.hidden=false;review.hidden=false;};settingsTools.children[0].onclick=()=>openReviewManager();
    const guides=document.createElement('section');guides.className='study-guides-panel';guides.hidden=true;guides.innerHTML='<header><strong>Guides</strong><button type="button" aria-label="Close guides">×</button></header><p>Replay a quick tour of the app or a specific feature.</p><div class="study-guides-list"></div>';const guidesBackdrop=document.createElement('div');guidesBackdrop.className='study-review-backdrop';guidesBackdrop.hidden=true;guidesBackdrop.append(guides);document.body.append(guidesBackdrop);
    const openGuides=()=>{const list=guides.querySelector('.study-guides-list');list.replaceChildren();allNotices().forEach(n=>{const b=document.createElement('button');b.type='button';b.className='study-guide-choice';b.innerHTML=`<strong></strong><span></span>`;b.querySelector('strong').textContent=n.title;b.querySelector('span').textContent=n.copy;b.onclick=()=>{guidesBackdrop.hidden=true;guides.hidden=true;guideNotice=n.id;tour(n.tourSteps||n.tour||'app');};list.append(b);});guidesBackdrop.hidden=false;guides.hidden=false;};
    settingsTools.children[1].onclick=openGuides;guides.querySelector('header button').onclick=()=>{guidesBackdrop.hidden=true;guides.hidden=true;};guidesBackdrop.addEventListener('click',e=>{if(e.target===guidesBackdrop){guidesBackdrop.hidden=true;guides.hidden=true;}});panel.querySelector('.study-tour-open').onclick=()=>{panel.hidden=true;guideNotice='v2-app-tour';tour('app');};
    window.LearningStudyTools=window.LearningStudyTools||{};window.LearningStudyTools.openReview=openReviewManager;window.LearningStudyTools.tour=tour;
    const renderReview=()=>{const list=review.querySelector('.study-review-list');list.replaceChildren();review.querySelector('.study-review-empty').hidden=!!data.saved.length;data.saved.forEach((q,i)=>{const row=document.createElement('div'),check=document.createElement('input'),span=document.createElement('span'),name=document.createElement('span'),small=document.createElement('small'),remove=document.createElement('button');row.className='study-review-item';check.type='checkbox';check.checked=q.selected!==false;check.setAttribute('aria-label','Include question in review');check.onchange=()=>{q.selected=check.checked;save(data);renderReview();};name.textContent=q.prompt||'Saved question';small.textContent=q.moduleName||q.module||'';span.append(name,small);remove.type='button';remove.setAttribute('aria-label','Remove saved question');remove.textContent='×';remove.onclick=()=>{data.saved.splice(i,1);save(data);renderReview();};row.append(check,span,remove);list.append(row);});review.querySelector('.study-review-start').disabled=!data.saved.some(q=>q.selected!==false);};
    review.querySelector('header button').onclick=()=>{reviewPanel.hidden=true;review.hidden=true;};
    render();renderReview();updateBell();
    const addQuestion=(q)=>{if(!q)return;const id=`${q.module||''}:${q.id||q.prompt||''}`;if(data.saved.some(x=>x.key===id))return;const prompt=q.prompt?new DOMParser().parseFromString(q.prompt,'text/html').body.textContent.trim():q.en||q.question||q.expectedDisplay||q.sp||(q.number!=null?`Number ${q.number}`:'Question');data.saved.push({key:id,qid:q.id,module:q.module,moduleName:document.querySelector('#activeModuleLabel')?.textContent||q.module,prompt,answer:q.expectedDisplay||q.sp||q.answer||'',number:q.number,mode:q.mode,options:q.options,correctIndex:q.correctIndex,acceptable:[...(q.acceptable||[])],explanation:q.explanation,selected:true});save(data);syncStar(q);renderReview();};
    const star=document.createElement('button');star.type='button';star.className='study-question-star';star.textContent='☆ Mark for review';star.setAttribute('aria-label','Mark this question for review');star.onclick=()=>{const app=window.SpanishPracticeApp;if(!app?.currentQuestion)return;addQuestion(app.currentQuestion);};
    const starRow=document.createElement('div');starRow.className='study-review-question-action';starRow.append(star);
    const mount=()=>{const actions=document.querySelector('#mainCard .actions,#submitBtn')?.closest('.actions');if(actions){actions.insertAdjacentElement('afterend',starRow);} };
    const syncStar=(q)=>{const isSaved=!!q&&data.saved.some(x=>x.key===`${q.module||''}:${q.id||q.prompt||''}`);star.hidden=!q;star.disabled=isSaved;star.textContent=isSaved?'✓ Added to My Review':'☆ Mark for review';star.setAttribute('aria-label',isSaved?'Question is in My Review':'Mark this question for review');};
    const timer=setInterval(()=>{const app=window.SpanishPracticeApp;if(!app)return;clearInterval(timer);mount();syncStar(app.currentQuestion);const orig=app.renderQuestion?.bind(app);if(orig)app.renderQuestion=(q,o)=>{const out=orig(q,o);mount();syncStar(q);return out;};const origNext=app.nextQuestion?.bind(app);if(origNext)app.nextQuestion=function(...args){const result=origNext(...args);syncStar(this.currentQuestion);return result;};setInterval(()=>{if(app.currentQuestion)syncStar(app.currentQuestion);},200);review.querySelector('.study-review-start').onclick=()=>{const selected=data.saved.filter(q=>q.selected!==false);if(!selected.length)return;review.hidden=true;const app=window.SpanishPracticeApp;if(!app)return;app.__reviewQueue=[...selected];app.__reviewLast=false;if(!app.__baseNextQuestion)app.__baseNextQuestion=app.nextQuestion.bind(app);app.__reviewNext=app.__baseNextQuestion;app.nextQuestion=function(opts={}){if(this.__reviewLast){if(this.currentQuestion&&!this.canAdvanceFromCurrentQuestion())return this.__reviewNext(opts);this.__reviewLast=false;this.__reviewQueue=null;this.finishPracticeSession();this.showBanner?.('My Review session complete.');return;}if(this.__reviewQueue?.length){const item=this.__reviewQueue.shift();if(!this.__reviewQueue.length)this.__reviewLast=true;const q={...item,id:item.qid||item.key,module:item.module,mode:item.mode||(item.module==='numbers'?'numbers':'text'),prompt:item.prompt,expectedDisplay:item.answer,number:item.number,sp:item.answer,acceptable:new Set(item.acceptable||[]),options:item.options,correctIndex:item.correctIndex,explanation:item.explanation};this.currentQuestion=q;this.currentNumber=q.number??this.currentNumber;this.answered=false;this.sessionQuestionRecorded=false;this.prepareAnswerTarget?.(q);this.updateActiveModuleChip?.(q.module);this.renderQuestion(q);return;}this.__reviewQueue=null;this.__reviewNext(opts);};if(document.body.classList.contains('home-mode')){app.$.homeCard.style.display='none';app.$.mainCard.style.display='block';document.body.classList.remove('home-mode');document.body.classList.add('practice-mode');app.startPracticeSession();app.currentQuestion=null;app.nextQuestion();}else {app.currentQuestion=null;app.nextQuestion();}};},50);
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
    const showFeedbackPrompt = () => {
      const firstRun = document.getElementById('firstRunOverlay');
      if (firstRun && firstRun.style.display === 'flex') {
        window.setTimeout(showFeedbackPrompt, 800);
        return;
      }
      if (!hasCookie(cookieName)) show('feedback', `Welcome to ${appName}`, 'If you spot a glitch or have an idea, a quick note helps us improve the learning experience.', 'Leave feedback', openFeedback);
    };
    window.setTimeout(showFeedbackPrompt, 1400);
    document.addEventListener('click', (event) => {
      const locked = event.target.closest('.module-locked,[data-premium="true"],[data-premium-locked]');
      if (!locked || document.querySelector('.shared-prompt-premium')) return;
      show('premium', 'This is a Premium feature', 'Request access if this section or a fuller practice set would be useful for you.', 'See Premium', openPremium);
    }, true);
  };
  document.addEventListener('DOMContentLoaded', () => { api.installExperiencePrompts(); api.installStudyTools(); });
})();
