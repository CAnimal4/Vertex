const { createSessionToken, getTtlSeconds, isSameOrigin, sessionCookie, verifyPremiumPassword } = require('../_lib/premiumAuth');

function readBody(request) {
  if (typeof request.body !== 'string') return request.body || {};
  try { return JSON.parse(request.body); } catch { return {}; }
}

module.exports = (request, response) => {
  if (request.method !== 'POST' || !isSameOrigin(request)) return response.status(405).json({ error: 'Method not allowed.' });
  if (!verifyPremiumPassword(readBody(request).password)) return response.status(401).json({ error: 'That password could not be verified.' });
  response.setHeader('Set-Cookie', sessionCookie(createSessionToken(), getTtlSeconds()));
  return response.status(200).json({ premium: true });
};
