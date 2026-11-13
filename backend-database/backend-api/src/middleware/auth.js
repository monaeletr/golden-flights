const jwt = require('jsonwebtoken');
const { HttpError } = require('../utils');

function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication required'));
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { userId: Number(payload.sub), role: payload.role };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role)
    ? next()
    : next(new HttpError(403, 'You do not have permission to do that'));

module.exports = { authenticate, requireRole };
