// UI-06: price breakdown. Charge types match booking_charges.charge_type:
// 'Base fare', 'Tax', 'Seat fee', 'Service'.
//
// Rules (all configurable in .env; confirm them with your team):
//   Base fare = flights.base_price
//   Seat fee  = seats.seat_fee of the chosen seat (row omitted when 0 or no seat)
//   Service   = SERVICE_FEE per booking (default 0, row omitted when 0)
//   Tax       = TAX_RATE x (base fare + seat fee + service), default 13%
// Money is computed in whole cents to avoid floating point drift.

const DEFAULT_TAX_RATE = 0.13;

function readNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const toCents = (amount) => Math.round(Number(amount) * 100);

function calculateCharges({ basePrice, seatFee = 0, seatNumber = null }) {
  const taxRate = readNumber('TAX_RATE', DEFAULT_TAX_RATE);
  const serviceFee = readNumber('SERVICE_FEE', 0);

  const lines = [{ chargeType: 'Base fare', description: 'Base fare', cents: toCents(basePrice) }];
  if (Number(seatFee) > 0) {
    lines.push({
      chargeType: 'Seat fee',
      description: seatNumber ? `Seat ${seatNumber}` : 'Seat selection',
      cents: toCents(seatFee),
    });
  }
  if (serviceFee > 0) {
    lines.push({ chargeType: 'Service', description: 'Booking service fee', cents: toCents(serviceFee) });
  }

  const taxable = lines.reduce((sum, l) => sum + l.cents, 0);
  lines.push({
    chargeType: 'Tax',
    description: `Tax (${+(taxRate * 100).toFixed(2)}%)`,
    cents: Math.round(taxable * taxRate),
  });

  const totalCents = lines.reduce((sum, l) => sum + l.cents, 0);
  return {
    charges: lines.map(({ cents, ...rest }) => ({ ...rest, amount: cents / 100 })),
    total: totalCents / 100,
  };
}

// Replaces all charge rows of a booking (used when the booking is created or the seat changes).
async function replaceCharges(client, bookingId, charges) {
  await client.query('DELETE FROM booking_charges WHERE booking_id = $1', [bookingId]);
  await client.query(
    `INSERT INTO booking_charges (booking_id, charge_type, description, amount)
     SELECT $1, x.t, x.d, x.a
       FROM unnest($2::text[], $3::text[], $4::numeric[]) AS x(t, d, a)`,
    [bookingId, charges.map((c) => c.chargeType), charges.map((c) => c.description), charges.map((c) => c.amount)]
  );
}

module.exports = { calculateCharges, replaceCharges };
