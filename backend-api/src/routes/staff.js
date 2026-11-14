const express = require('express');
const { pool, withTransaction } = require('../db');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { HttpError, asyncHandler, parseId } = require('../utils');
const { FLIGHT_COLUMNS } = require('../flightSql');

// Everything here is for staff only (UI-02). Each route also names the specific permission it needs.
const router = express.Router();
router.use(authenticate);

const STATUSES = ['Scheduled', 'Cancelled'];
const HAS_TIMEZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const SEAT_ORDER = `NULLIF(regexp_replace(s.seat_number, '\\D', '', 'g'), '')::int NULLS LAST, s.seat_number`;

// ---------- validation helpers (REP-05) ----------

function readText(body, key, max, errors) {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) {
    errors[key] = 'Required';
  } else if (v.trim().length > max) {
    errors[key] = `At most ${max} characters`;
  } else {
    return v.trim();
  }
  return undefined;
}

function readDate(body, key, errors) {
  const v = body[key];
  const date = typeof v === 'string' && HAS_TIMEZONE.test(v.trim()) ? new Date(v.trim()) : null;
  if (!date || isNaN(date)) {
    errors[key] = 'Must be an ISO date-time with a time zone, e.g. 2026-12-01T09:30:00-05:00';
    return undefined;
  }
  return date;
}

function readPrice(value, key, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99999999.99) {
    errors[key] = 'Must be a number between 0 and 99999999.99';
    return undefined;
  }
  return Math.round(value * 100) / 100;
}

// Reads the flight fields present in `body`. With partial = true, missing fields are allowed (PATCH).
function readFlightFields(body, errors, { partial }) {
  const out = {};
  const wanted = (key) => !partial || body[key] !== undefined;

  for (const [key, column, max] of [
    ['flightNumber', 'flight_number', 20],
    ['airline', 'airline', 100],
    ['departureCity', 'departure_city', 100],
    ['arrivalCity', 'arrival_city', 100],
  ]) {
    if (wanted(key)) {
      const v = readText(body, key, max, errors);
      if (v !== undefined) out[column] = v;
    }
  }
  for (const [key, column] of [
    ['departureDatetime', 'departure_datetime'],
    ['arrivalDatetime', 'arrival_datetime'],
  ]) {
    if (wanted(key)) {
      const v = readDate(body, key, errors);
      if (v !== undefined) out[column] = v;
    }
  }
  if (wanted('basePrice')) {
    const v = readPrice(body.basePrice, 'basePrice', errors);
    if (v !== undefined) out.base_price = v;
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) errors.status = `Must be one of: ${STATUSES.join(', ')}`;
    else out.status = body.status;
  }
  return out;
}

// Rules that involve more than one field. `flight` holds the final values (existing + changes).
function checkFlightRules(flight, errors) {
  const { departure_datetime: dep, arrival_datetime: arr, departure_city: from, arrival_city: to } = flight;
  if (dep && arr && arr <= dep && !errors.arrivalDatetime) errors.arrivalDatetime = 'Must be after the departure time';
  if (from && to && from.toLowerCase() === to.toLowerCase() && !errors.arrivalCity) {
    errors.arrivalCity = 'Must be different from the departure city';
  }
}

// Optional seat map generated with a new flight so passengers can pick seats (UI-05).
// Defaults: 20 rows, columns A-F, first 3 rows Business, all seat fees 0. rows: 0 means no seats.
function readSeatMap(input, errors) {
  const map = input === undefined ? {} : input;
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    errors.seatMap = 'Must be an object';
    return null;
  }
  const rows = map.rows === undefined ? 20 : map.rows;
  if (!Number.isInteger(rows) || rows < 0 || rows > 60) errors['seatMap.rows'] = 'Must be a whole number from 0 to 60';

  const columns = (map.columns === undefined ? 'ABCDEF' : String(map.columns)).toUpperCase();
  if (!/^[A-Z]{1,10}$/.test(columns) || new Set(columns).size !== columns.length) {
    errors['seatMap.columns'] = 'Must be 1-10 different letters, e.g. "ABCDEF"';
  }

  const businessRows = map.businessRows === undefined ? Math.min(3, Number.isInteger(rows) ? rows : 0) : map.businessRows;
  if (!Number.isInteger(businessRows) || businessRows < 0 || businessRows > (Number.isInteger(rows) ? rows : 0)) {
    errors['seatMap.businessRows'] = 'Must be a whole number from 0 up to the number of rows';
  }

  const fees = {};
  for (const key of ['businessSeatFee', 'economySeatFee']) {
    const v = map[key] === undefined ? 0 : map[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 99999999.99) {
      errors[`seatMap.${key}`] = 'Must be a number 0 or more';
    }
    fees[key] = Math.round(Number(v) * 100) / 100;
  }
  return { rows, columns, businessRows, ...fees };
}

async function fetchFlight(db, flightId) {
  const { rows: [flight] } = await db.query(
    `SELECT ${FLIGHT_COLUMNS}, f.created_by AS "createdBy" FROM flights f WHERE f.flight_id = $1`,
    [flightId]
  );
  return flight || null;
}

// ---------- REP-05: add and update flights ----------

// All flights including cancelled and past ones, with seat and booking counts, for the staff screen.
router.get(
  '/flights',
  requirePermission('flights:manage'),
  asyncHandler(async (req, res) => {
    const params = [];
    let where = 'TRUE';
    if (req.query.status !== undefined) {
      if (!STATUSES.includes(req.query.status)) throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}`);
      params.push(req.query.status);
      where = 'f.status = $1';
    }
    const { rows } = await pool.query(
      `SELECT ${FLIGHT_COLUMNS},
              f.created_by AS "createdBy",
              (SELECT COUNT(*) FROM seats s WHERE s.flight_id = f.flight_id)::int AS "totalSeats",
              (SELECT COUNT(*) FROM bookings b
                WHERE b.flight_id = f.flight_id AND b.status <> 'Cancelled')::int AS "activeBookings"
         FROM flights f
        WHERE ${where}
        ORDER BY f.departure_datetime DESC
        LIMIT 200`,
      params
    );
    res.json({ flights: rows });
  })
);

// Body: { flightNumber, airline, departureCity, arrivalCity, departureDatetime, arrivalDatetime,
//         basePrice, status?, seatMap?: { rows, columns, businessRows, businessSeatFee, economySeatFee } }
router.post(
  '/flights',
  requirePermission('flights:manage'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const errors = {};
    const fields = readFlightFields(body, errors, { partial: false });
    const seatMap = readSeatMap(body.seatMap, errors);
    checkFlightRules(fields, errors);
    if (fields.departure_datetime && fields.departure_datetime <= new Date()) {
      errors.departureDatetime = 'Must be in the future';
    }
    if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);

    const flightId = await withTransaction(async (client) => {
      const { rows: [created] } = await client.query(
        `INSERT INTO flights (flight_number, airline, departure_city, arrival_city,
                              departure_datetime, arrival_datetime, base_price, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING flight_id`,
        [
          fields.flight_number,
          fields.airline,
          fields.departure_city,
          fields.arrival_city,
          fields.departure_datetime,
          fields.arrival_datetime,
          fields.base_price,
          fields.status || 'Scheduled',
          req.user.userId,
        ]
      );

      if (seatMap.rows > 0) {
        await client.query(
          `INSERT INTO seats (flight_id, seat_number, seat_class, seat_fee)
           SELECT $1::int,
                  r::text || l,
                  CASE WHEN r <= $3::int THEN 'Business' ELSE 'Economy' END,
                  CASE WHEN r <= $3::int THEN $4::numeric ELSE $5::numeric END
             FROM generate_series(1, $2::int) AS r
            CROSS JOIN unnest($6::text[]) AS l`,
          [
            created.flight_id,
            seatMap.rows,
            seatMap.businessRows,
            seatMap.businessSeatFee,
            seatMap.economySeatFee,
            seatMap.columns.split(''),
          ]
        );
      }
      return created.flight_id;
    });

    const flight = await fetchFlight(pool, flightId);
    const { rows: [{ count }] } = await pool.query('SELECT COUNT(*)::int AS count FROM seats WHERE flight_id = $1', [flightId]);
    res.status(201).json({ flight, seatCount: count });
  })
);

// Update any of the same fields (all optional). Setting status to "Cancelled" removes the flight from
// passenger search; existing bookings are kept (refunds belong to the cancellation work in Sprint 3).
router.patch(
  '/flights/:flightId',
  requirePermission('flights:manage'),
  asyncHandler(async (req, res) => {
    const flightId = parseId(req.params.flightId, 'flightId');
    const body = req.body || {};
    const errors = {};
    const changes = readFlightFields(body, errors, { partial: true });
    if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);
    if (Object.keys(changes).length === 0) throw new HttpError(400, 'Send at least one field to update');

    await withTransaction(async (client) => {
      const { rows: [current] } = await client.query('SELECT * FROM flights WHERE flight_id = $1 FOR UPDATE', [flightId]);
      if (!current) throw new HttpError(404, 'Flight not found');
      if (new Date(current.departure_datetime) <= new Date()) {
        throw new HttpError(409, 'This flight has already departed and can no longer be edited');
      }

      const merged = { ...current, ...changes };
      checkFlightRules(merged, errors);
      if (changes.departure_datetime && changes.departure_datetime <= new Date()) {
        errors.departureDatetime = 'Must be in the future';
      }
      if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', errors);

      // Column names come from the fixed whitelist in readFlightFields, never from user input.
      const columns = Object.keys(changes);
      const setSql = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
      await client.query(`UPDATE flights SET ${setSql} WHERE flight_id = $1`, [flightId, ...columns.map((c) => changes[c])]);
    });

    res.json({ flight: await fetchFlight(pool, flightId) });
  })
);

// ---------- REP-04: passenger list ----------

// Lists passengers on a flight by passenger ID (users.user_id), one row per ticket (booking).
// Cancelled bookings are left out unless ?includeCancelled=true.
router.get(
  '/flights/:flightId/passengers',
  requirePermission('passengers:read'),
  asyncHandler(async (req, res) => {
    const flightId = parseId(req.params.flightId, 'flightId');
    const flight = await fetchFlight(pool, flightId);
    if (!flight) throw new HttpError(404, 'Flight not found');

    const includeCancelled = req.query.includeCancelled === 'true';
    const { rows } = await pool.query(
      `SELECT u.user_id AS "passengerId",
              u.first_name AS "firstName",
              u.last_name AS "lastName",
              b.booking_reference AS "bookingReference",
              s.seat_number AS "seatNumber",
              s.seat_class AS "seatClass",
              b.status
         FROM bookings b
         JOIN users u ON u.user_id = b.user_id
         LEFT JOIN seats s ON s.seat_id = b.seat_id
        WHERE b.flight_id = $1
          AND ($2::boolean OR b.status <> 'Cancelled')
        ORDER BY u.user_id, b.booking_id`,
      [flightId, includeCancelled]
    );
    res.json({ flight, passengers: rows });
  })
);

// ---------- REP-03: accessibility overview ----------

// Accessibility notes for a flight, identified by seat number only (no names or contact details).
// A booking with notes but no seat yet shows seatNumber null and its booking reference, so staff can
// still follow it up; those entries are listed last.
router.get(
  '/flights/:flightId/accessibility',
  requirePermission('accessibility:read'),
  asyncHandler(async (req, res) => {
    const flightId = parseId(req.params.flightId, 'flightId');
    const flight = await fetchFlight(pool, flightId);
    if (!flight) throw new HttpError(404, 'Flight not found');

    const { rows } = await pool.query(
      `SELECT s.seat_number AS "seatNumber",
              s.seat_class AS "seatClass",
              CASE WHEN s.seat_id IS NULL THEN b.booking_reference END AS "bookingReference",
              b.accessibility_notes AS "accessibilityNotes"
         FROM bookings b
         LEFT JOIN seats s ON s.seat_id = b.seat_id
        WHERE b.flight_id = $1
          AND b.status <> 'Cancelled'
          AND NULLIF(btrim(b.accessibility_notes), '') IS NOT NULL
        ORDER BY ${SEAT_ORDER}, b.booking_id`,
      [flightId]
    );
    res.json({ flight, requests: rows });
  })
);

module.exports = router;
