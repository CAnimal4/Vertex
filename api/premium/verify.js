const { handleLogin } = require('../_lib/accessControl');

module.exports = (request, response) => {
  const originalJson = response.json.bind(response);
  response.json = (payload) => originalJson(payload.ok
    ? { premium: payload.permissions.premium, role: payload.role }
    : { premium: false, error: payload.error });
  return handleLogin(request, response);
};
