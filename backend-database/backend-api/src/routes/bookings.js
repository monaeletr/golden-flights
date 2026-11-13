const express = require('express');
const { pool, withTransaction } = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  HttpError,
  asyncHandler,
  parseId,
  generateBookingReference,
  generateReceiptNumber,
} = require('../utils');
const paymentGateway = require('../services/paymentGateway');

const router = express.Router();
router.use(authenticate);

const BOOKING_SELECT = `
  SELECT b.booking_id AS "bookingId",
         b.booking_reference AS "bookingReference",
         b.user_id AS "userId",
         b.status,
         b.booked_at AS "bookedAt",
         b.updated_at AS "updatedAt",
         json_build_object(
           'flightId', f.flight_id,
           'flightNumber', f.flight_number,
           'airline', f.airline,
           'departureCity', f.departure_city,
           'arrivalCity', f.arrival_city,
           'departureDatetime', f.departure_datetime,
           'arrivalDatetime', f.arrival_datetime,
           'basePrice', f.base_price,
           'status', f.status
         ) AS flight,
         CASE WHEN s.seat_id IS NULL THEN NULL ELSE json_build_object(
           'seatId', s.seat_id,
           'seatNumber', s.seat_number,
           'seatClass', s.seat_class,
           'seatFee', s.seat_fee
         ) END AS seat,
         (SELECT json_build_object(
                   'paymentId', p.payment_id,
                   'amount', p.amount,
                   'status', p.status,
                   'receiptNumber', p.receipt_number,
                   'paidAt', p.paid_at
                 )
            FROM payments p
           WHERE p.booking_id = b.booking_id
           ORDER BY p.payment_id DESC
           LIMIT 1) AS payment
    FROM bookings b
    JOIN flights f ON f.flight_id = b.flight_id
    LEFT JOIN seats s ON s.seat_id = b.seat_id`;

async function fetchBooking(db, whereSql, params) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE ${whereSql}`, params);
  return rows[0] || null;
}

// Passengers can only see their own bookings; staff can see all. Hide existence otherwise.
function assertCanView(booking, user) {
  if (!booking || (booking.userId !== user.userId && user.role !== 'Staff')) {
    throw new HttpError(404, 'Booking not found');
  }
}

const isSeatTakenError = (err) =>
  err.code === '23505' && err.constraint === 'uq_bookings_flight_seat';

// UI-03: manage bookings.
// GET /api/bookings?view=current|previous|all   (staff may add &userId=)
//   current  = not cancelled and the flight has not departed yet
//   previous = cancelled, or the flight has already departed
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const view = req.query.view || 'all';
    if (!['current', 'previous', 'all'].includes(view)) {
      throw new HttpError(400, 'view must be one of: current, previous, all');
    }

    const where = ['TRUE'];
    const params = [];
    let targetUserId = req.user.userId;
    if (req.user.role === 'Staff') {
      targetUserId = req.query.userId ? parseId(req.query.userId, 'userId') : null;
    }
    if (targetUserId !== null) {
      params.push(targetUserId);
      where.push(`b.user_id = $${params.length}`);
    }

    let orderBy = 'b.booked_at DESC';
    if (view === 'current') {
      where.push(`b.status <> 'Cancelled'`, `f.departure_datetime >= now()`);
      orderBy = 'f.departure_datetime ASC';
    } else if (view === 'previous') {
      where.push(`(b.status = 'Cancelled' OR f.departure_datetime < now())`);
      orderBy = 'f.departure_datetime DESC';
    }

    const { rows } = await pool.query(`${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`, params);
    res.json({ bookings: rows });
  })
);

// Look up by human-friendly reference. Declared before '/:bookingId'.
router.get(
  '/reference/:reference',
  asyncHandler(async (req, res) => {
    const booking = await fetchBooking(pool, 'b.booking_reference = $1', [
      String(req.params.reference).trim().toUpperCase(),
    ]);
    assertCanView(booking, req.user);
    res.json({ booking });
  })
);

router.get(
  '/:bookingId',
  asyncHandler(async (req, res) => {
    const bookingId = parseId(req.params.bookingId, 'bookingId');
    const booking = await fetchBooking(pool, 'b.booking_id = $1', [bookingId]);
    assertCanView(booking, req.user);
    res.json({ booking });
  })
);

// UI-09: book a flight (optionally with a seat) and pay in one step.
// Body: { flightId, seatId?, paymentToken }
//
// 1. Reserve: create the booking (seat held) + a Pending payment in one transaction.
// 2. Charge the gateway (outside the transaction, so no DB locks are held during the network call).
// 3. Finalize: mark Paid + receipt number, or mark Failed and cancel the booking to free the seat.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const flightId = parseId(req.body?.flightId, 'flightId');
    const seatId = req.body?.seatId == null ? null : parseId(req.body.seatId, 'seatId');
    const { paymentToken } = req.body || {};
    if (typeof paymentToken !== 'string' || !paymentToken) {
      throw new HttpError(400, 'paymentToken is required');
    }

    // ---- 1. Reserve
    let reserved;
    try {
      reserved = await withTransaction(async (client) => {
        const { rows: [flight] } = await client.query('SELECT * FROM flights WHERE flight_id = $1', [flightId]);
        if (!flight) throw new HttpError(404, 'Flight not found');
        if (flight.status !== 'Scheduled') throw new HttpError(409, 'This flight is not available for booking');
        if (new Date(flight.departure_datetime) <= new Date()) {
          throw new HttpError(409, 'This flight has already departed');
        }

        if (seatId !== null) {
          const { rows: [seat] } = await client.query(
            'SELECT seat_id FROM seats WHERE seat_id = $1 AND flight_id = $2',
            [seatId, flightId]
          );
          if (!seat) throw new HttpError(400, 'That seat does not belong to this flight');

          const { rows: [taken] } = await client.query(
            `SELECT 1 FROM bookings WHERE seat_id = $1 AND status <> 'Cancelled'`,
            [seatId]
          );
          if (taken) throw new HttpError(409, 'That seat is already taken');
        }

        // Retry on the (very unlikely) booking_reference collision.
        let booking;
        let reference;
        for (let attempt = 0; attempt < 5 && !booking; attempt++) {
          reference = generateBookingReference();
          ({ rows: [booking] } = await client.query(
            `INSERT INTO bookings (booking_reference, user_id, flight_id, seat_id, status)
             VALUES ($1, $2, $3, $4, 'Confirmed')
             ON CONFLICT (booking_reference) DO NOTHING
             RETURNING booking_id`,
            [reference, req.user.userId, flightId, seatId]
          ));
        }
        if (!booking) throw new HttpError(500, 'Could not generate a booking reference');

        // Sprint 1 charges the base price only. Sprint 2: add the chosen seat's seat_fee here.
        const amount = flight.base_price;

        const { rows: [payment] } = await client.query(
          `INSERT INTO payments (booking_id, amount, status) VALUES ($1, $2, 'Pending') RETURNING payment_id`,
          [booking.booking_id, amount]
        );

        return { bookingId: booking.booking_id, bookingReference: reference, paymentId: payment.payment_id, amount };
      });
    } catch (err) {
      // Two people picking the same seat at once: the UNIQUE (flight_id, seat_id) constraint decides.
      if (isSeatTakenError(err)) throw new HttpError(409, 'That seat was just taken. Please choose another.');
      throw err;
    }

    // ---- 2. Charge
    let charge;
    try {
      charge = await paymentGateway.charge({
        amount: reserved.amount,
        paymentToken: req.body.paymentToken,
        reference: reserved.bookingReference,
      });
    } catch (err) {
      console.error('Payment gateway error', err);
      charge = { success: false, failureReason: 'Payment gateway unavailable' };
    }

    // ---- 3. Finalize
    if (!charge.success) {
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE payments SET status = 'Failed', gateway_transaction_id = $2 WHERE payment_id = $1`,
          [reserved.paymentId, charge.transactionId || null]
        );
        await client.query(
          `UPDATE bookings SET status = 'Cancelled', seat_id = NULL, updated_at = now() WHERE booking_id = $1`,
          [reserved.bookingId]
        );
      });
      throw new HttpError(402, 'Payment failed', { reason: charge.failureReason });
    }

    await pool.query(
      `UPDATE payments
          SET status = 'Paid', gateway_transaction_id = $2, receipt_number = $3, paid_at = now()
        WHERE payment_id = $1`,
      [reserved.paymentId, charge.transactionId, generateReceiptNumber()]
    );
    // email_sent stays FALSE; the confirmation-email job picks it up.

    const booking = await fetchBooking(pool, 'b.booking_id = $1', [reserved.bookingId]);
    res.status(201).json({ booking });
  })
);

// UI-05: choose or change the seat on an existing booking. Body: { seatId }
router.put(
  '/:bookingId/seat',
  asyncHandler(async (req, res) => {
    const bookingId = parseId(req.params.bookingId, 'bookingId');
    const seatId = parseId(req.body?.seatId, 'seatId');

    try {
      await withTransaction(async (client) => {
        const { rows: [b] } = await client.query(
          `SELECT b.booking_id, b.user_id, b.flight_id, b.seat_id, b.status, f.departure_datetime
             FROM bookings b
             JOIN flights f ON f.flight_id = b.flight_id
            WHERE b.booking_id = $1
              FOR UPDATE OF b`,
          [bookingId]
        );
        if (!b || b.user_id !== req.user.userId) throw new HttpError(404, 'Booking not found');
        if (b.status === 'Cancelled') throw new HttpError(409, 'This booking has been cancelled');
        if (new Date(b.departure_datetime) <= new Date()) throw new HttpError(409, 'This flight has already departed');

        const { rows: [seat] } = await client.query(
          'SELECT seat_id FROM seats WHERE seat_id = $1 AND flight_id = $2',
          [seatId, b.flight_id]
        );
        if (!seat) throw new HttpError(400, 'That seat does not belong to this flight');
        if (b.seat_id === seatId) return; // nothing to change

        // First seat assignment keeps the status; replacing an existing seat marks it 'Changed'.
        await client.query(
          `UPDATE bookings
              SET seat_id = $2,
                  status = CASE WHEN seat_id IS NULL THEN status ELSE 'Changed' END,
                  updated_at = now()
            WHERE booking_id = $1`,
          [bookingId, seatId]
        );
      });
    } catch (err) {
      if (isSeatTakenError(err)) throw new HttpError(409, 'That seat was just taken. Please choose another.');
      throw err;
    }

    const booking = await fetchBooking(pool, 'b.booking_id = $1', [bookingId]);
    res.json({ booking });
  })
);

// UI-03: cancel. Frees the seat (seat_id = NULL) and keeps the row for history.
router.post(
  '/:bookingId/cancel',
  asyncHandler(async (req, res) => {
    const bookingId = parseId(req.params.bookingId, 'bookingId');

    await withTransaction(async (client) => {
      const { rows: [b] } = await client.query(
        `SELECT b.booking_id, b.user_id, b.status, f.departure_datetime
           FROM bookings b
           JOIN flights f ON f.flight_id = b.flight_id
          WHERE b.booking_id = $1
            FOR UPDATE OF b`,
        [bookingId]
      );
      if (!b || (b.user_id !== req.user.userId && req.user.role !== 'Staff')) {
        throw new HttpError(404, 'Booking not found');
      }
      if (b.status === 'Cancelled') throw new HttpError(409, 'This booking is already cancelled');
      if (new Date(b.departure_datetime) <= new Date()) throw new HttpError(409, 'This flight has already departed');

      await client.query(
        `UPDATE bookings SET status = 'Cancelled', seat_id = NULL, updated_at = now() WHERE booking_id = $1`,
        [bookingId]
      );
    });

    const booking = await fetchBooking(pool, 'b.booking_id = $1', [bookingId]);
    res.json({ booking });
  })
);

module.exports = router;
