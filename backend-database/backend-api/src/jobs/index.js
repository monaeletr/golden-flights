const cron = require('node-cron');
const { pool } = require('../db');
const mailer = require('../services/mailer');

// UI-03: delete bookings whose flight departed more than 12 months ago (past or cancelled),
// skipping users who opted out. Payments are removed by ON DELETE CASCADE.
async function deleteExpiredBookings() {
  const { rowCount } = await pool.query(
    `DELETE FROM bookings b
      USING users u, flights f
      WHERE b.user_id = u.user_id
        AND b.flight_id = f.flight_id
        AND u.auto_delete_enabled = TRUE
        AND f.departure_datetime < now() - INTERVAL '12 months'`
  );
  console.log(`[job] auto-delete: removed ${rowCount} booking(s)`);
  return rowCount;
}

// UI-09: send confirmation emails for paid payments that haven't been emailed yet.
let emailRunning = false;
async function sendPendingConfirmationEmails() {
  if (emailRunning) return;
  emailRunning = true;
  try {
    const { rows } = await pool.query(
      `SELECT p.payment_id, p.receipt_number, p.amount,
              u.email, u.first_name, b.booking_reference
         FROM payments p
         JOIN bookings b ON b.booking_id = p.booking_id
         JOIN users u ON u.user_id = b.user_id
        WHERE p.status = 'Paid' AND p.email_sent = FALSE
        ORDER BY p.payment_id
        LIMIT 50`
    );
    for (const row of rows) {
      try {
        await mailer.sendBookingConfirmation({
          to: row.email,
          firstName: row.first_name,
          bookingReference: row.booking_reference,
          receiptNumber: row.receipt_number,
          amount: row.amount,
        });
        await pool.query('UPDATE payments SET email_sent = TRUE WHERE payment_id = $1', [row.payment_id]);
      } catch (err) {
        console.error(`[job] email failed for payment ${row.payment_id}; will retry`, err.message);
      }
    }
  } finally {
    emailRunning = false;
  }
}

// Safety net: if the server died between reserving a booking and finishing payment, the seat
// would stay held forever. Fail payments still Pending after 15 minutes and release the booking.
async function releaseStalePendingPayments() {
  const { rowCount } = await pool.query(
    `WITH stale AS (
       UPDATE payments p
          SET status = 'Failed'
         FROM bookings b
        WHERE p.booking_id = b.booking_id
          AND p.status = 'Pending'
          AND b.booked_at < now() - INTERVAL '15 minutes'
       RETURNING p.booking_id
     )
     UPDATE bookings
        SET status = 'Cancelled', seat_id = NULL, updated_at = now()
      WHERE booking_id IN (SELECT booking_id FROM stale)`
  );
  if (rowCount) console.log(`[job] released ${rowCount} stale unpaid booking(s)`);
  return rowCount;
}

const safe = (name, fn) => async () => {
  try {
    await fn();
  } catch (err) {
    console.error(`[job] ${name} failed`, err);
  }
};

function startJobs() {
  if (process.env.DISABLE_JOBS === 'true') {
    console.log('[job] scheduled jobs disabled');
    return;
  }
  cron.schedule('0 2 * * *', safe('auto-delete', deleteExpiredBookings)); // daily at 02:00
  cron.schedule('* * * * *', safe('confirmation emails', sendPendingConfirmationEmails)); // every minute
  cron.schedule('*/5 * * * *', safe('stale payments', releaseStalePendingPayments)); // every 5 minutes
  console.log('[job] scheduled jobs started');
}

module.exports = {
  startJobs,
  deleteExpiredBookings,
  sendPendingConfirmationEmails,
  releaseStalePendingPayments,
};
