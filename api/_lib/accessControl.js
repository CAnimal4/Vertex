'use strict';

const crypto = require('crypto');

const SESSION_COOKIE = '__Host-learning_access_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MIN_ITERATIONS = 100000;
const MAX_BODY_BYTES = 32 * 1024;
const ROLES = Object.freeze(['free', 'premium', 'mod', 'admin']);
const ROLE_PERMISSIONS = Object.freeze({
  free: Object.freeze({ premium: false, viewModeration: false, requestDeletion: false, reviewDeletion: false, suppressContent: false }),
  premium: Object.freeze({ premium: true, viewModeration: false, requestDeletion: false, reviewDeletion: false, suppressContent: false }),
  mod: Object.freeze({ premium: true, viewModeration: true, requestDeletion: true, reviewDeletion: false, suppressContent: false }),
  admin: Object.freeze({ premium: true, viewModeration: true, requestDeletion: true, reviewDeletion: true, suppressContent: true })
});

let testStoreAdapter = null;

function permissionsFor(role) {
  return { ...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.free) };
}

function publicSession(session) {
  const role = ROLES.includes(session && session.role) ? session.role : 'free';
  return { ok: true, role, actorId: role === 'free' ? null : String(session.actorId || ''), permissions: permissionsFor(role) };
}

function getCredentialRecords() {
  const configured = [process.env.ACCESS_CREDENTIALS_JSON, process.env.ROLE_CREDENTIALS_JSON, process.env.PREMIUM_PASSWORD_HASHES_JSON];
  try {
    const value = configured.flatMap((raw) => {
      if (typeof raw !== 'string' || !raw.trim()) return [];
      try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
    });
    return value.filter((record) => {
      const role = record && (record.role || 'premium');
      return record && typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128
        && ROLES.includes(role) && role !== 'free'
        && typeof record.salt === 'string' && record.salt.length > 0
        && typeof record.hash === 'string' && record.hash.length > 0
        && Number.isSafeInteger(Number(record.iterations)) && Number(record.iterations) >= MIN_ITERATIONS;
    }).map((record) => ({ ...record, role: record.role || 'premium', iterations: Number(record.iterations) }));
  } catch {
    return [];
  }
}

function getSessionSecret() {
  return process.env.ACCESS_SESSION_SECRET || process.env.PREMIUM_SESSION_SECRET || '';
}

function getTtlSeconds() {
  const configured = Number(process.env.ACCESS_SESSION_TTL_SECONDS || process.env.PREMIUM_SESSION_TTL_SECONDS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_TTL_SECONDS;
}

function sameValue(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyCredential(password) {
  if (!getSessionSecret() || typeof password !== 'string' || password.length < 1 || password.length > 512) return null;
  let match = null;
  for (const record of getCredentialRecords()) {
    let derived = '';
    try {
      derived = crypto.pbkdf2Sync(password, record.salt, record.iterations, 32, 'sha256').toString('base64');
    } catch {
      derived = '';
    }
    if (sameValue(derived, record.hash)) match = { actorId: record.id, role: record.role };
  }
  return match;
}

function readCookie(cookieHeader, name) {
  const prefix = `${name}=`;
  const pair = String(cookieHeader || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix));
  if (!pair) return '';
  try { return decodeURIComponent(pair.slice(prefix.length)); } catch { return ''; }
}

function sign(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function createSessionToken(actor, now = Date.now()) {
  if (!actor || !ROLES.includes(actor.role) || actor.role === 'free' || !getSessionSecret()) return '';
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    actorId: actor.actorId,
    role: actor.role,
    issuedAt: now,
    expiresAt: now + getTtlSeconds() * 1000
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSession(cookieHeader, now = Date.now()) {
  if (!getSessionSecret()) return { role: 'free', actorId: null };
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  const separator = token.lastIndexOf('.');
  if (separator < 1) return { role: 'free', actorId: null };
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!sameValue(signature, sign(payload))) return { role: 'free', actorId: null };
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.v !== 1 || !ROLES.includes(data.role) || data.role === 'free' || typeof data.actorId !== 'string'
      || !Number.isFinite(data.expiresAt) || data.expiresAt <= now) return { role: 'free', actorId: null };
    const current = getCredentialRecords().find((record) => record.id === data.actorId && record.role === data.role);
    return current ? { role: data.role, actorId: data.actorId } : { role: 'free', actorId: null };
  } catch {
    return { role: 'free', actorId: null };
  }
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return sessionCookie('', 0);
}

function header(request, name) {
  const headers = request && request.headers ? request.headers : {};
  return headers[name] || headers[name.toLowerCase()] || '';
}

function isSameOrigin(request) {
  const origin = header(request, 'origin');
  if (!origin) return true;
  const forwardedHost = String(header(request, 'x-forwarded-host') || header(request, 'host')).split(',')[0].trim();
  if (!forwardedHost) return false;
  try { return new URL(origin).host === forwardedHost; } catch { return false; }
}

function readBody(request) {
  if (request && typeof request.body === 'object' && request.body !== null) return request.body;
  const raw = request && typeof request.body === 'string' ? request.body : '';
  if (!raw || Buffer.byteLength(raw) > MAX_BODY_BYTES) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function send(response, status, payload) {
  if (response.setHeader) response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(payload);
}

function methodNotAllowed(response, allowed) {
  if (response.setHeader) response.setHeader('Allow', allowed.join(', '));
  return send(response, 405, { ok: false, error: 'Method not allowed.' });
}

function sessionFromRequest(request) {
  return readSession(header(request, 'cookie'));
}

function requirePermission(request, permission) {
  const session = sessionFromRequest(request);
  return permissionsFor(session.role)[permission] ? session : null;
}

function handleSession(request, response) {
  if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
  return send(response, 200, publicSession(sessionFromRequest(request)));
}

function handleLogin(request, response) {
  if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
  if (!isSameOrigin(request)) return send(response, 403, { ok: false, error: 'Request origin could not be verified.' });
  const actor = verifyCredential(readBody(request).password);
  if (!actor) return send(response, 401, { ...publicSession({ role: 'free' }), ok: false, error: 'That password could not be verified.' });
  response.setHeader('Set-Cookie', sessionCookie(createSessionToken(actor), getTtlSeconds()));
  return send(response, 200, publicSession(actor));
}

function handleLogout(request, response) {
  if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
  if (!isSameOrigin(request)) return send(response, 403, { ok: false, error: 'Request origin could not be verified.' });
  response.setHeader('Set-Cookie', clearSessionCookie());
  return send(response, 200, publicSession({ role: 'free' }));
}

function emptyModerationState() {
  return { version: 1, requests: [], suppressions: [] };
}

function normalizeModerationState(value) {
  if (!value || typeof value !== 'object') return emptyModerationState();
  return {
    version: Number.isSafeInteger(value.version) ? value.version : 1,
    requests: Array.isArray(value.requests) ? value.requests : [],
    suppressions: Array.isArray(value.suppressions) ? value.suppressions : []
  };
}

function kvConfig() {
  const namespace = process.env.MODERATION_STORE_NAMESPACE || process.env.ACCESS_APP_ID || process.env.VERCEL_PROJECT_ID || 'learning-app';
  return {
    url: process.env.MODERATION_KV_REST_API_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.MODERATION_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
    key: process.env.MODERATION_STORE_KEY || `${namespace}:moderation:v1`
  };
}

async function kvCommand(command) {
  const config = kvConfig();
  if (!config.url || !config.token || typeof fetch !== 'function') throw new Error('Moderation store is unavailable.');
  const response = await fetch(config.url.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error('Moderation store request failed.');
  const result = await response.json();
  if (result && result.error) throw new Error('Moderation store request failed.');
  return result ? result.result : null;
}

const durableStore = {
  async read() {
    const raw = await kvCommand(['GET', kvConfig().key]);
    if (!raw) return emptyModerationState();
    try { return normalizeModerationState(JSON.parse(raw)); } catch { throw new Error('Moderation store data is invalid.'); }
  },
  async write(state) {
    await kvCommand(['SET', kvConfig().key, JSON.stringify(state)]);
  }
};

function moderationStore() {
  return testStoreAdapter || durableStore;
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function cleanItem(body) {
  const source = body.item && typeof body.item === 'object' ? body.item : body;
  const id = cleanText(source.id || source.itemId, 256);
  const type = cleanText(source.type || source.itemType, 80);
  if (!id || !type) return null;
  const label = cleanText(source.label || source.title || source.prompt, 500);
  const moduleId = cleanText(source.moduleId, 256);
  return { id, type, ...(label ? { label } : {}), ...(moduleId ? { moduleId } : {}) };
}

function storeUnavailable(response) {
  return send(response, 503, { ok: false, error: 'Moderation storage is unavailable.' });
}

async function handleModeration(request, response) {
  const method = request.method || 'GET';
  if (!['GET', 'POST', 'PATCH'].includes(method)) return methodNotAllowed(response, ['GET', 'POST', 'PATCH']);
  if (method !== 'GET' && !isSameOrigin(request)) return send(response, 403, { ok: false, error: 'Request origin could not be verified.' });

  const store = moderationStore();
  if (method === 'GET') {
    try {
      const state = normalizeModerationState(await store.read());
      const actor = readSession(request.headers.cookie);
      return send(response, 200, {
        ok: true,
        requests: permissionsFor(actor.role).viewModeration ? state.requests : [],
        suppressions: state.suppressions
      });
    } catch { return storeUnavailable(response); }
  }

  const neededPermission = method === 'PATCH' ? 'reviewDeletion' : 'requestDeletion';
  const actor = requirePermission(request, neededPermission);
  if (!actor) return send(response, 403, { ok: false, error: 'You are not authorized to perform this action.' });

  const body = readBody(request);
  if (method === 'POST') {
    const reason = cleanText(body.reason, 1000);
    const item = cleanItem(body);
    if (!reason || !item) return send(response, 400, { ok: false, error: 'A reason, item ID, and item type are required.' });
    try {
      const state = normalizeModerationState(await store.read());
      const now = new Date().toISOString();
      const requestRecord = {
        id: crypto.randomUUID(), item, reason,
        requestedBy: actor.actorId, requesterRole: actor.role, requestedAt: now,
        status: 'pending', reviewedBy: null, reviewedAt: null, deletionResult: null
      };
      state.version += 1;
      state.requests.push(requestRecord);
      await store.write(state);
      return send(response, 201, { ok: true, request: requestRecord });
    } catch { return storeUnavailable(response); }
  }

  const requestId = cleanText(body.requestId, 128);
  const action = body.action === 'approve' || body.action === 'reject' ? body.action : '';
  if (!requestId || !action) return send(response, 400, { ok: false, error: 'A request ID and approve/reject action are required.' });
  try {
    const state = normalizeModerationState(await store.read());
    const target = state.requests.find((entry) => entry.id === requestId);
    if (!target) return send(response, 404, { ok: false, error: 'Deletion request was not found.' });
    if (target.status !== 'pending') return send(response, 409, { ok: false, error: 'Deletion request has already been reviewed.' });
    if (action === 'approve' && target.requestedBy === actor.actorId) return send(response, 409, { ok: false, error: 'Reviewers cannot approve their own request.' });
    const now = new Date().toISOString();
    target.status = action === 'approve' ? 'approved' : 'rejected';
    target.reviewedBy = actor.actorId;
    target.reviewedAt = now;
    if (action === 'approve') {
      const existing = state.suppressions.find((entry) => entry.item.id === target.item.id && entry.item.type === target.item.type);
      if (!existing) state.suppressions.push({ requestId: target.id, item: target.item, approvedBy: actor.actorId, approvedAt: now });
      target.deletionResult = existing ? 'already-suppressed' : 'suppressed';
    } else {
      target.deletionResult = 'not-deleted';
    }
    state.version += 1;
    await store.write(state);
    return send(response, 200, { ok: true, request: target, suppressions: state.suppressions });
  } catch { return storeUnavailable(response); }
}

function setStoreAdapterForTests(adapter) {
  testStoreAdapter = adapter || null;
}

module.exports = {
  ROLES, ROLE_PERMISSIONS, SESSION_COOKIE, clearSessionCookie, createSessionToken, getTtlSeconds,
  handleLogin, handleLogout, handleModeration, handleSession, isSameOrigin, permissionsFor,
  publicSession, readSession, sessionCookie, setStoreAdapterForTests, verifyCredential
};
