const crypto = require('crypto');

const SESSION_COOKIE = 'vertex_premium_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function getPasswordRecords() {
  try {
    const value = JSON.parse(process.env.PREMIUM_PASSWORD_HASHES_JSON || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function getSessionSecret() {
  return process.env.PREMIUM_SESSION_SECRET || '';
}

function getTtlSeconds() {
  const configured = Number(process.env.PREMIUM_SESSION_TTL_SECONDS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_TTL_SECONDS;
}

function sign(value) {
  return crypto.createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function sameValue(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookie(cookieHeader, name) {
  const pair = String(cookieHeader || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}

function verifyPremiumPassword(password) {
  if (!getSessionSecret() || typeof password !== 'string' || password.length < 1 || password.length > 512) return false;

  return getPasswordRecords().some((record) => {
    if (!record || typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
    const iterations = Number(record.iterations);
    if (!Number.isSafeInteger(iterations) || iterations < 100000) return false;
    const derived = crypto.pbkdf2Sync(password, record.salt, iterations, 32, 'sha256').toString('base64');
    return sameValue(derived, record.hash);
  });
}

function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ premium: true, expiresAt: Date.now() + getTtlSeconds() * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function hasActiveSession(cookieHeader) {
  if (!getSessionSecret()) return false;
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!sameValue(signature, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.premium === true && Number(data.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return sessionCookie('', 0);
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers.host;
  return origin === `https://${host}` || origin === `http://${host}`;
}

module.exports = { clearSessionCookie, createSessionToken, getTtlSeconds, hasActiveSession, isSameOrigin, sessionCookie, verifyPremiumPassword };
