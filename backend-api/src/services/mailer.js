/**
 * Placeholder mailer. Swap the body of sendBookingConfirmation() for nodemailer,
 * SendGrid, SES, etc. It must throw if the email could not be sent, so the job
 * leaves payments.email_sent = false and retries on the next run.
 */
async function sendBookingConfirmation({ to, firstName, bookingReference, receiptNumber, amount }) {
  console.log(
    `[mailer] To: ${to} | Hi ${firstName}, booking ${bookingReference} is confirmed. ` +
      `Receipt ${receiptNumber}, total ${amount.toFixed(2)}.`
  );
}

module.exports = { sendBookingConfirmation };
