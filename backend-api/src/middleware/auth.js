const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { HttpError } = require('../utils');

// Verifies the token, then loads the user's CURRENT role from the database, so a role change
// (for example demoting a staff member) takes effect immediately instead of when the token expires.
async function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication required'));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(new HttpError(401, 'Invalid or expired token'));
  }

  try {
    const { rows: [user] } = await pool.query('SELECT user_id, role FROM users WHERE user_id = $1', [
      Number(payload.sub),
    ]);
    if (!user) return next(new HttpError(401, 'Account no longer exists'));
    req.user = { userId: user.user_id, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate };
