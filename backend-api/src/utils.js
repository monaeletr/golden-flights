const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Forwards rejected promises from async route handlers to the error middleware.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseId(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return n;
}

// No 0/O/1/I so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

const generateBookingReference = () => randomCode(6);

function generateReceiptNumber() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `RCP-${d}-${randomCode(10)}`;
}

module.exports = {
  HttpError,
  asyncHandler,
  EMAIL_RE,
  parseId,
  generateBookingReference,
  generateReceiptNumber,
};
