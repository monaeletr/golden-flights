const { HttpError } = require('../utils');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  // Postgres: unique violation / foreign key violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with these values already exists' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};
