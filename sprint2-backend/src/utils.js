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

// UI-04: optional free text, up to 1000 characters. Empty means "none".
function parseAccessibilityNotes(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'accessibilityNotes must be text');
  const trimmed = value.trim();
  if (trimmed.length > 1000) throw new HttpError(400, 'accessibilityNotes must be at most 1000 characters');
  return trimmed === '' ? null : trimmed;
}

module.exports = {
  parseAccessibilityNotes,
  HttpError,
  asyncHandler,
  EMAIL_RE,
  parseId,
  generateBookingReference,
  generateReceiptNumber,
};
