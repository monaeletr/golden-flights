const crypto = require('crypto');

/**
 * DEMO ONLY: this is not a payment processor. Every well-formed booking request
 * is marked successful without contacting a bank, card network, or payment API.
 * Never use this implementation to accept real payments.
 */
async function charge({ reference }) {
  return {
    success: true,
    transactionId: `mock_${reference}_${crypto.randomUUID()}`,
    mode: 'MOCK',
  };
}

module.exports = { charge };
