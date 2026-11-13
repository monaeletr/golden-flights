const crypto = require('crypto');

/**
 * Placeholder for the real payment gateway (Stripe, Square, Moneris, ...).
 * Replace the body of charge() with the gateway SDK call; keep the return shape.
 *
 * In this stub every token succeeds except 'tok_fail', so you can test the failure path.
 *
 * @returns {Promise<{ success: boolean, transactionId?: string, failureReason?: string }>}
 */
async function charge({ amount, paymentToken, reference }) {
  if (paymentToken === 'tok_fail') {
    return { success: false, failureReason: 'Card declined' };
  }
  return { success: true, transactionId: `mock_${crypto.randomUUID()}` };
}

module.exports = { charge };
