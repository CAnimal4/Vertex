const { publicSession, readSession } = require('../_lib/accessControl');

module.exports = (request, response) => {
  const session = publicSession(readSession(request.headers.cookie));
  return response.status(200).json({ premium: session.permissions.premium, role: session.role });
};
