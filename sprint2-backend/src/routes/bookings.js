const express = require('express');
const { pool, withTransaction } = require('../db');
const { authenticate } = require('../middleware/auth');
const { can } = require('../middleware/permissions');
const {
  HttpError,
  asyncHandler,
  parseId,
  parseAccessibilityNotes,
  generateBookingReference,
  generateReceiptNumber,
} = require('../utils');
const { calculateCharges, replaceCharges } = require('../services/pricing');
const paymentGateway = require('../services/paymentGateway');

const router = express.Router();
router.use(authenticate);

const BOOKING_SELECT = `
  SELECT b.booking_id AS "bookingId",
         b.booking_reference AS "bookingReference",
         b.user_id AS "userId",
         b.status,
         b.accessibility_notes AS "accessibilityNotes",
         b.booked_at AS "bookedAt",
         b.updated_at AS "updatedAt",
         u.first_name AS "passengerFirstName",
         u.last_name AS "passengerLastName",
         u.email AS "passengerEmail",
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
                   'paidAt', p.paid_at,
                   'paymentMode', p.payment_mode,
                   'paymentMethod', p.payment_method,
                   'cardBrand', p.card_brand,
                   'cardLastFour', p.card_last_four,
                   'cardholderName', p.cardholder_name
                 )
            FROM payments p
           WHERE p.booking_id = b.booking_id
           ORDER BY p.payment_id DESC
           LIMIT 1) AS payment,
         COALESCE((SELECT json_agg(json_build_object(
                                     'chargeId', c.charge_id,
                                     'chargeType', c.charge_type,
                                     'description', c.description,
                                     'amount', c.amount
                                   ) ORDER BY c.charge_id)
                     FROM booking_charges c
                    WHERE c.booking_id = b.booking_id), '[]'::json) AS charges,
         COALESCE((SELECT SUM(c.amount) FROM booking_charges c WHERE c.booking_id = b.booking_id), 0) AS "totalPrice",
         COALESCE((SELECT SUM(p.amount) FROM payments p
                    WHERE p.booking_id = b.booking_id AND p.status = 'Paid'), 0) AS "amountPaid"
    FROM bookings b
    JOIN users u ON u.user_id = b.user_id
    JOIN flights f ON f.flight_id = b.flight_id
    LEFT JOIN seats s ON s.seat_id = b.seat_id`;

// UI-06: groups the money fields into one "pricing" object.
// balanceDue > 0 means the passenger still owes money (for example after choosing a pricier seat);
// it is null for cancelled bookings and for older bookings that have no charge rows.
function shapeBooking(row) {
  if (!row) return null;
  const { charges, totalPrice, amountPaid, ...booking } = row;
  const hasCharges = charges.length > 0;
  booking.pricing = {
    charges,
    total: totalPrice,
    paid: amountPaid,
    balanceDue:
      hasCharges && booking.status !== 'Cancelled' ? Math.round((totalPrice - amountPaid) * 100) / 100 : null,
  };
  return booking;
}

async function fetchBooking(db, whereSql, params) {
  const { rows } = await db.query(`${BOOKING_SELECT} WHERE ${whereSql}`, params);
  return shapeBooking(rows[0]);
}

// UI-02: passengers only see their own bookings; roles with bookings:read:any see all.
// Otherwise respond 404 so the existence of other people's bookings isn't revealed.
function assertCanView(booking, user) {
  if (!booking || (booking.userId !== user.userId && !can(user.role, 'bookings:read:any'))) {
    throw new HttpError(404, 'Booking not found');
  }
}

const isSeatTakenError = (err) => err.code === '23505' && err.constraint === 'uq_bookings_flight_seat';

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
    if (can(req.user.role, 'bookings:read:any')) {
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
    res.json({ bookings: rows.map(shapeBooking) });
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
// Body: { flightId, seatId?, accessibilityNotes?, paymentDetails: { cardholderName, cardBrand, cardLastFour } }
// DEMO ONLY: the UI never sends a full card number, expiry date, or CVV. The mock
// gateway always succeeds and no real payment authorization or money movement occurs.
// 1. Reserve booking, price breakdown and Pending payment in one transaction.
// 2. Mark the simulated payment Paid and save a demo receipt.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const flightId = parseId(req.body?.flightId, 'flightId');
    const seatId = req.body?.seatId == null ? null : parseId(req.body.seatId, 'seatId');
    const accessibilityNotes = parseAccessibilityNotes(req.body?.accessibilityNotes); // UI-04
    const paymentDetails = req.body?.paymentDetails || {};
    const cardholderName = typeof paymentDetails.cardholderName === 'string' ? paymentDetails.cardholderName.trim() : '';
    const cardBrand = paymentDetails.cardBrand;
    const cardLastFour = paymentDetails.cardLastFour;
    const allowedBrands = ['Visa', 'Mastercard', 'American Express', 'Discover', 'Other'];
    if (!cardholderName || cardholderName.length > 120) {
      throw new HttpError(400, 'A cardholder name (up to 120 characters) is required');
    }
    if (!allowedBrands.includes(cardBrand)) {
      throw new HttpError(400, 'A supported demo card brand is required');
    }
    if (typeof cardLastFour !== 'string' || !/^\d{4}$/.test(cardLastFour)) {
      throw new HttpError(400, 'The last four card digits are required');
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

        let seat = null;
        if (seatId !== null) {
          ({ rows: [seat = null] } = await client.query(
            'SELECT seat_id, seat_number, seat_fee FROM seats WHERE seat_id = $1 AND flight_id = $2',
            [seatId, flightId]
          ));
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
            `INSERT INTO bookings (booking_reference, user_id, flight_id, seat_id, status, accessibility_notes)
             VALUES ($1, $2, $3, $4, 'Confirmed', $5)
             ON CONFLICT (booking_reference) DO NOTHING
             RETURNING booking_id`,
            [reference, req.user.userId, flightId, seatId, accessibilityNotes]
          ));
        }
        if (!booking) throw new HttpError(500, 'Could not generate a booking reference');

        const { charges, total } = calculateCharges({
          basePrice: flight.base_price,
          seatFee: seat ? seat.seat_fee : 0,
          seatNumber: seat ? seat.seat_number : null,
        });
        await replaceCharges(client, booking.booking_id, charges);

        const { rows: [payment] } = await client.query(
          `INSERT INTO payments
             (booking_id, amount, status, payment_mode, payment_method, cardholder_name, card_brand, card_last_four)
           VALUES ($1, $2, 'Pending', 'MOCK', 'Card', $3, $4, $5)
           RETURNING payment_id`,
          [booking.booking_id, total, cardholderName, cardBrand, cardLastFour]
        );

        return { bookingId: booking.booking_id, bookingReference: reference, paymentId: payment.payment_id, amount: total };
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
        reference: reserved.bookingReference,
      });
    } catch (err) {
      console.error('Payment gateway error', err);
      // A local demo payment does not depend on an external payment service.
      charge = { success: true, transactionId: `mock_${reserved.bookingReference}_${Date.now()}` };
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
// The price breakdown is recalculated for the new seat. Any difference is shown as pricing.balanceDue;
// this sprint does not charge or refund that difference automatically.
router.put(
  '/:bookingId/seat',
  asyncHandler(async (req, res) => {
    const bookingId = parseId(req.params.bookingId, 'bookingId');
    const seatId = parseId(req.body?.seatId, 'seatId');

    try {
      await withTransaction(async (client) => {
        const { rows: [b] } = await client.query(
          `SELECT b.booking_id, b.user_id, b.flight_id, b.seat_id, b.status,
                  f.departure_datetime, f.base_price
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
          'SELECT seat_id, seat_number, seat_fee FROM seats WHERE seat_id = $1 AND flight_id = $2',
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

        const { charges } = calculateCharges({
          basePrice: b.base_price,
          seatFee: seat.seat_fee,
          seatNumber: seat.seat_number,
        });
        await replaceCharges(client, bookingId, charges);
      });
    } catch (err) {
      if (isSeatTakenError(err)) throw new HttpError(409, 'That seat was just taken. Please choose another.');
      throw err;
    }

    const booking = await fetchBooking(pool, 'b.booking_id = $1', [bookingId]);
    res.json({ booking });
  })
);

// UI-04: add, change or clear accessibility notes. Body: { accessibilityNotes: "text" | "" | null }
router.patch(
  '/:bookingId/accessibility',
  asyncHandler(async (req, res) => {
    const bookingId = parseId(req.params.bookingId, 'bookingId');
    if (!req.body || !('accessibilityNotes' in req.body)) {
      throw new HttpError(400, 'accessibilityNotes is required (use "" to clear)');
    }
    const notes = parseAccessibilityNotes(req.body.accessibilityNotes);

    await withTransaction(async (client) => {
      const { rows: [b] } = await client.query(
        `SELECT b.booking_id, b.user_id, b.status, f.departure_datetime
           FROM bookings b
           JOIN flights f ON f.flight_id = b.flight_id
          WHERE b.booking_id = $1
            FOR UPDATE OF b`,
        [bookingId]
      );
      if (!b || b.user_id !== req.user.userId) throw new HttpError(404, 'Booking not found');
      if (b.status === 'Cancelled') throw new HttpError(409, 'This booking has been cancelled');
      if (new Date(b.departure_datetime) <= new Date()) throw new HttpError(409, 'This flight has already departed');

      await client.query(`UPDATE bookings SET accessibility_notes = $2, updated_at = now() WHERE booking_id = $1`, [
        bookingId,
        notes,
      ]);
    });

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
      if (!b || (b.user_id !== req.user.userId && !can(req.user.role, 'bookings:cancel:any'))) {
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
