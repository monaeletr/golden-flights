const express = require('express');
const { pool } = require('../db');
const { HttpError, asyncHandler, parseId } = require('../utils');

const router = express.Router();

const FLIGHT_COLUMNS = `
  f.flight_id AS "flightId",
  f.flight_number AS "flightNumber",
  f.airline,
  f.departure_city AS "departureCity",
  f.arrival_city AS "arrivalCity",
  f.departure_datetime AS "departureDatetime",
  f.arrival_datetime AS "arrivalDatetime",
  f.base_price AS "basePrice",
  f.status`;

// UI-05: a seat is available if it is not in a non-cancelled booking.
const SEAT_AVAILABLE_SQL = `NOT EXISTS (
  SELECT 1 FROM bookings b WHERE b.seat_id = s.seat_id AND b.status <> 'Cancelled'
)`;

const SORTS = {
  departure: 'f.departure_datetime ASC',
  price: 'f.base_price ASC',
  duration: '(f.arrival_datetime - f.departure_datetime) ASC',
};

// UI-08: search by city, date and airline. All filters are optional.
// GET /api/flights?departureCity=Toronto&arrivalCity=Vancouver&date=2026-12-01&airline=WestJet&sort=price
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { departureCity, arrivalCity, date, airline } = req.query;
    const sort = req.query.sort || 'departure';
    if (!SORTS[sort]) throw new HttpError(400, 'sort must be one of: departure, price, duration');

    const where = [`f.status = 'Scheduled'`, `f.departure_datetime > now()`];
    const params = [];
    const addFilter = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (departureCity) addFilter('LOWER(f.departure_city) = LOWER(?)', String(departureCity).trim());
    if (arrivalCity) addFilter('LOWER(f.arrival_city) = LOWER(?)', String(arrivalCity).trim());
    if (airline) addFilter('LOWER(f.airline) = LOWER(?)', String(airline).trim());

    if (date) {
      const start = new Date(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(start) || start.toISOString().slice(0, 10) !== date) {
        throw new HttpError(400, 'date must be a valid YYYY-MM-DD');
      }
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      addFilter('f.departure_datetime >= ?', start); // day boundaries are UTC
      addFilter('f.departure_datetime < ?', end);
    }

    const { rows } = await pool.query(
      `SELECT ${FLIGHT_COLUMNS},
              (SELECT COUNT(*) FROM seats s
                WHERE s.flight_id = f.flight_id AND ${SEAT_AVAILABLE_SQL})::int AS "availableSeats"
         FROM flights f
        WHERE ${where.join(' AND ')}
        ORDER BY ${SORTS[sort]}
        LIMIT 100`,
      params
    );
    res.json({ flights: rows });
  })
);

// Populates the airline filter dropdown. Must be declared before '/:flightId'.
router.get(
  '/airlines',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT airline FROM flights WHERE status = 'Scheduled' ORDER BY airline`
    );
    res.json({ airlines: rows.map((r) => r.airline) });
  })
);

router.get(
  '/:flightId',
  asyncHandler(async (req, res) => {
    const flightId = parseId(req.params.flightId, 'flightId');
    const { rows: [flight] } = await pool.query(
      `SELECT ${FLIGHT_COLUMNS} FROM flights f WHERE f.flight_id = $1`,
      [flightId]
    );
    if (!flight) throw new HttpError(404, 'Flight not found');
    res.json({ flight });
  })
);

// UI-05: seat map for a flight, with availability
router.get(
  '/:flightId/seats',
  asyncHandler(async (req, res) => {
    const flightId = parseId(req.params.flightId, 'flightId');
    const { rows: [flight] } = await pool.query('SELECT flight_id FROM flights WHERE flight_id = $1', [flightId]);
    if (!flight) throw new HttpError(404, 'Flight not found');

    const { rows } = await pool.query(
      `SELECT s.seat_id AS "seatId",
              s.seat_number AS "seatNumber",
              s.seat_class AS "seatClass",
              s.seat_fee AS "seatFee",
              ${SEAT_AVAILABLE_SQL} AS available
         FROM seats s
        WHERE s.flight_id = $1
        ORDER BY NULLIF(regexp_replace(s.seat_number, '\\D', '', 'g'), '')::int, s.seat_number`,
      [flightId]
    );
    res.json({ seats: rows });
  })
);

module.exports = router;
