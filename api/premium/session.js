const { hasActiveSession } = require('../_lib/premiumAuth');

module.exports = (request, response) => response.status(200).json({ premium: hasActiveSession(request.headers.cookie) });
