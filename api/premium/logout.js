const { handleLogout } = require('../_lib/accessControl');

module.exports = (request, response) => {
  const originalJson = response.json.bind(response);
  response.json = (payload) => originalJson({ premium: false, ...(payload.error ? { error: payload.error } : {}) });
  return handleLogout(request, response);
};
