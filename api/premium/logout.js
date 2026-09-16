const { clearSessionCookie, isSameOrigin } = require('../_lib/premiumAuth');

module.exports = (request, response) => {
  if (request.method !== 'POST' || !isSameOrigin(request)) return response.status(405).json({ error: 'Method not allowed.' });
  response.setHeader('Set-Cookie', clearSessionCookie());
  return response.status(200).json({ premium: false });
};
