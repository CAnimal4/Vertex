(() => {
  'use strict';

  const root = document.getElementById('libraryOverlay');
  if (!root) return;

  const appId = document.body.dataset.appId || 'learning-app';
  const publicFiles = JSON.parse(root.dataset.publicFiles || '[]');
  if (appId === 'vertex') {
    const vertexPdfFiles = [
      ['00_geometry-sequence_highlighted.pdf', 'Course map — Geometry sequence'],
      ['01-01_points-lines-planes_annotated.pdf', 'Unit 1 — Points, lines & planes'],
      ['01-03_midpoint-and-distance-formula_annotated.pdf', 'Unit 1 — Midpoint & distance'],
      ['01-05_measuring-angles_annotated.pdf', 'Unit 1 — Measuring angles'],
      ['01-05_more-measuring-angles_annotated.pdf', 'Unit 1 — Measuring angles: extra practice'],
      ['01-06_pairs-of-angles_annotated.pdf', 'Unit 1 — Pairs of angles'],
      ['01-99_review-for-test-1_answers.pdf', 'Unit 1 — Test 1 review'],
      ['02-02_inductive-and-deductive-reasoning_part-1_annotated.pdf', 'Unit 2 — Inductive & deductive reasoning'],
      ['02-04_algebraic-reasoning_annotated.pdf', 'Unit 2 — Algebraic reasoning'],
      ['02-05_proving-segments-and-angles_annotated.pdf', 'Unit 2 — Segment & angle proofs'],
      ['02-06_proving-geometric-relationships_annotated.pdf', 'Unit 2 — Geometric relationships'],
      ['03-01_pairs-of-lines-and-angles_blank.pdf', 'Unit 3 — Lines & angles: blank practice'],
      ['03-02_parallel-lines-and-transversals_annotated.pdf', 'Unit 3 — Parallel lines & transversals'],
      ['03-03_proofs-with-parallel-lines_annotated.pdf', 'Unit 3 — Parallel line proofs'],
      ['03-04_proofs-with-perpendicular-lines_annotated.pdf', 'Unit 3 — Perpendicular line proofs'],
      ['03-99_review-for-test-2_answers.pdf', 'Unit 3 — Test 2 review']
    ];
    publicFiles.splice(0, publicFiles.length, ...vertexPdfFiles.map(([file, name]) => ({
      name,
      description: 'Public Geometry PDF resource.',
      url: `assets/canvas-geometry-pdfs/${file}`,
      type: 'pdf'
    })));
  }
  const tallyUrl = root.dataset.tallyUrl && !root.dataset.tallyUrl.includes('REPLACE') ? root.dataset.tallyUrl : 'https://tally.so/r/GxMyoj';
  const cookieKey = `learning_library_${appId}_v1`;
  const dbName = `learning_library_${appId}_v1`;
  const state = { files: [], blobs: new Map(), urls: new Map() };
  const $ = (id) => document.getElementById(id);

  function readCookie() {
    const entry = document.cookie.split('; ').find((part) => part.startsWith(`${cookieKey}=`));
    if (!entry) return [];
    try { return JSON.parse(decodeURIComponent(entry.slice(cookieKey.length + 1))) || []; } catch (_) { return []; }
  }

  function writeCookie() {
    const metadata = state.files.map(({ id, name, size, type, addedAt, status }) => ({ id, name, size, type, addedAt, status }));
    document.cookie = `${cookieKey}=${encodeURIComponent(JSON.stringify(metadata))}; max-age=31536000; path=/; SameSite=Lax`;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeBlob(file) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put({ id: file.id, blob: file.blob });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (_) { state.blobs.set(file.id, file.blob); }
  }

  async function loadBlob(id) {
    if (state.blobs.has(id)) return state.blobs.get(id);
    try {
      const db = await openDb();
      const blob = await new Promise((resolve, reject) => {
        const request = db.transaction('files', 'readonly').objectStore('files').get(id);
        request.onsuccess = () => resolve(request.result?.blob || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (blob) state.blobs.set(id, blob);
      return blob;
    } catch (_) { return null; }
  }

  function formatSize(bytes) {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function publicCard(file) {
    return `<article class="library-file-card"><div class="library-file-icon" aria-hidden="true">${file.type === 'pdf' ? 'PDF' : 'FILE'}</div><div class="library-file-copy"><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.description || 'Shared learning resource')}</small></div><a class="btn small library-open" href="${encodeURI(file.url)}" target="_blank" rel="noopener">Open ↗</a></article>`;
  }

  function userCard(file) {
    const label = file.status === 'requested' ? 'Public request sent' : 'Only visible to you';
    const action = file.status === 'requested' ? '<span class="library-status">Awaiting review</span>' : `<button class="btn small library-request" type="button" data-id="${file.id}">Request to make public</button>`;
    return `<article class="library-file-card library-user-file"><div class="library-file-icon" aria-hidden="true">${file.type === 'application/pdf' ? 'PDF' : 'FILE'}</div><div class="library-file-copy"><strong>${escapeHtml(file.name)}</strong><small>${formatSize(file.size)} · ${label}</small></div><div class="library-file-actions"><button class="btn small ghost library-open-local" type="button" data-id="${file.id}">Open</button>${action}</div></article>`;
  }

  function render() {
    $('libraryPublicList').innerHTML = publicFiles.length ? publicFiles.map(publicCard).join('') : '<p class="library-empty">Public resources will appear here as they are added.</p>';
    $('libraryYourList').innerHTML = state.files.length ? state.files.map(userCard).join('') : '<p class="library-empty">Upload a file to start your private collection.</p>';
    $('libraryCount').textContent = `${publicFiles.length} public resource${publicFiles.length === 1 ? '' : 's'} · ${state.files.length} in your library`;
    $('libraryYourList').querySelectorAll('.library-request').forEach((button) => button.addEventListener('click', () => requestPublic(button.dataset.id)));
    $('libraryYourList').querySelectorAll('.library-open-local').forEach((button) => button.addEventListener('click', () => openLocal(button.dataset.id)));
  }

  function openLocal(id) {
    loadBlob(id).then((blob) => {
      if (!blob) return alert('This file is not available in this browser anymore. Please upload it again.');
      if (state.urls.has(id)) URL.revokeObjectURL(state.urls.get(id));
      const url = URL.createObjectURL(blob);
      state.urls.set(id, url);
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  function requestPublic(id) {
    const file = state.files.find((entry) => entry.id === id);
    if (!file) return;
    if (!tallyUrl) return alert('The public-library request form is not connected yet.');
    const url = new URL(tallyUrl);
    const fields = { app_name: appId, file_name: file.name, file_type: file.type || 'file', file_size: formatSize(file.size), source: 'Library public request', page_url: window.location.href };
    Object.entries(fields).forEach(([key, value]) => url.searchParams.set(key, value));
    file.status = 'requested';
    writeCookie();
    render();
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  $('libraryUploadBtn').addEventListener('click', () => $('libraryFileInput').click());
  $('libraryFileInput').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    for (const blob of files) {
      const file = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: blob.name, size: blob.size, type: blob.type || 'application/octet-stream', addedAt: Date.now(), status: 'private', blob };
      state.files.unshift(file);
      await storeBlob(file);
    }
    event.target.value = '';
    writeCookie();
    render();
  });

  $('libraryCloseBtn').addEventListener('click', () => { root.hidden = true; root.style.display = ''; document.body.classList.remove('library-open'); });
  root.addEventListener('click', (event) => { if (event.target === root) $('libraryCloseBtn').click(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !root.hidden) $('libraryCloseBtn').click(); });
  $('openLibraryBtn').addEventListener('click', () => { root.hidden = false; root.style.display = 'flex'; document.body.classList.add('library-open'); $('libraryCloseBtn').focus(); });

  state.files = readCookie();
  render();
})();
