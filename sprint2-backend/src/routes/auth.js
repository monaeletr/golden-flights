const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const { permissionsFor } = require('../middleware/permissions');
const { HttpError, asyncHandler, EMAIL_RE } = require('../utils');

const router = express.Router();

const toUser = (row) => ({
  userId: row.user_id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  role: row.role,
  autoDeleteEnabled: row.auto_delete_enabled,
  createdAt: row.created_at,
  permissions: permissionsFor(row.role), // UI-02: lets the front end show or hide features
});

const signToken = (user) =>
  jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
    subject: String(user.user_id),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  });

// UI-01: register. Public sign-up always creates a passenger; staff accounts are created by an admin.
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { firstName, lastName, email, password } = req.body || {};
    const errors = {};

    if (typeof firstName !== 'string' || !firstName.trim()) errors.firstName = 'First name is required';
    if (typeof lastName !== 'string' || !lastName.trim()) errors.lastName = 'Last name is required';
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) errors.email = 'A valid email is required';
    // bcrypt only uses the first 72 bytes, so cap the length instead of silently truncating.
    if (typeof password !== 'string' || password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    } else if (Buffer.byteLength(password) > 72) {
      errors.password = 'Password must be at most 72 bytes';
    }
    if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);

    const passwordHash = await bcrypt.hash(password, 12);

    let row;
    try {
      ({ rows: [row] } = await pool.query(
        `INSERT INTO users (first_name, last_name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'Passenger')
         RETURNING *`,
        [firstName.trim(), lastName.trim(), email.trim().toLowerCase(), passwordHash]
      ));
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists');
      throw err;
    }

    res.status(201).json({ token: signToken(row), user: toUser(row) });
  })
);

// UI-01: login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new HttpError(400, 'Email and password are required');
    }

    const { rows: [row] } = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [
      email.trim().toLowerCase(),
    ]);
    const ok = row && (await bcrypt.compare(password, row.password_hash));
    if (!ok) throw new HttpError(401, 'Invalid email or password'); // same message for both cases

    res.json({ token: signToken(row), user: toUser(row) });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows: [row] } = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.user.userId]);
    if (!row) throw new HttpError(404, 'User not found');
    res.json({ user: toUser(row) });
  })
);

// UI-03: opt out of (or back into) automatic booking deletion
router.patch(
  '/me/preferences',
  authenticate,
  asyncHandler(async (req, res) => {
    const { autoDeleteEnabled } = req.body || {};
    if (typeof autoDeleteEnabled !== 'boolean') {
      throw new HttpError(400, 'autoDeleteEnabled must be true or false');
    }
    const { rows: [row] } = await pool.query(
      'UPDATE users SET auto_delete_enabled = $2 WHERE user_id = $1 RETURNING *',
      [req.user.userId, autoDeleteEnabled]
    );
    if (!row) throw new HttpError(404, 'User not found');
    res.json({ user: toUser(row) });
  })
);

module.exports = router;
