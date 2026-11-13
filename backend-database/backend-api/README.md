# Airline Reservation Back End - Sprint 1

Node.js + Express + PostgreSQL. Covers UI-01, UI-03, UI-05, UI-08, UI-09.

## Setup

The database tables already exist in Supabase (see `backend-database/sql/SqlScripts.txt`), so do not run any CREATE TABLE script again. This API only needs the Sprint 1 tables and works fine with the extra Sprint 2/3 columns.

```bash
cd backend-api
npm install
cp .env.example .env     # then fill in SUPABASE_DB_URL and JWT_SECRET
npm run dev
```

Optional test flights and seats: paste `seed.sql` into the Supabase SQL editor and run it.

To make a staff account, register normally, then:
`UPDATE users SET role = 'Staff' WHERE LOWER(email) = 'you@example.com';`

## Auth

Send `Authorization: Bearer <token>` on every endpoint marked **Auth**. Tokens come from register/login.

## Endpoints

| Story | Method & path | Auth | Notes |
|---|---|---|---|
| UI-01 | `POST /api/auth/register` | - | `{ firstName, lastName, email, password }`. Password 8+ chars. Always creates a `passenger`. |
| UI-01 | `POST /api/auth/login` | - | `{ email, password }` returns `{ token, user }` |
| UI-01 | `GET /api/auth/me` | Auth | Current user |
| UI-03 | `PATCH /api/auth/me/preferences` | Auth | `{ autoDeleteEnabled: boolean }` |
| UI-08 | `GET /api/flights` | - | Query: `departureCity`, `arrivalCity`, `date` (YYYY-MM-DD), `airline`, `sort` (`departure`/`price`/`duration`). Only future, Scheduled flights. |
| UI-08 | `GET /api/flights/airlines` | - | Values for the airline filter |
| UI-08 | `GET /api/flights/:flightId` | - | One flight |
| UI-05 | `GET /api/flights/:flightId/seats` | - | Seat map with `available` flag |
| UI-05 | `PUT /api/bookings/:bookingId/seat` | Auth | `{ seatId }`. Choose or change a seat. |
| UI-09 | `POST /api/bookings` | Auth | `{ flightId, seatId?, paymentToken }`. Books and pays; returns booking + receipt. |
| UI-03 | `GET /api/bookings?view=current\|previous\|all` | Auth | Own bookings (staff: all, or `&userId=`) |
| UI-03 | `GET /api/bookings/:bookingId` | Auth | Owner or staff |
| UI-03 | `GET /api/bookings/reference/:reference` | Auth | Lookup by booking code |
| UI-03 | `POST /api/bookings/:bookingId/cancel` | Auth | Sets `Cancelled`, frees the seat |

Errors are `{ "error": "message", "details": {...} }` with these statuses: 400 validation, 401 not logged in, 402 payment failed, 404 not found, 409 conflict (e.g. seat taken).

## Scheduled jobs (`src/jobs/index.js`)

- **Daily 02:00** - deletes bookings whose flight departed over 12 months ago (past or cancelled), skipping users with `auto_delete_enabled = false`.
- **Every minute** - sends confirmation emails for paid payments where `email_sent = false`, then sets it to true.
- **Every 5 minutes** - fails payments stuck in Pending for 15+ minutes and releases the held seat.

## Assumptions to check against your backlog

- **Book + pay is one call.** The booking holds the seat while the gateway is charged. If payment fails, the booking is cancelled and the seat is freed, so unpaid bookings never block seats.
- **Seat fees are not charged yet.** The amount is `flights.base_price`; Sprint 2 adds `seats.seat_fee` (marked in `routes/bookings.js`).
- **Seat change sets `Changed`.** Choosing a first seat leaves the status `Confirmed`; replacing an existing seat marks the booking `Changed`.
- **Current vs previous bookings** is derived from the flight's departure time and cancellation status.
- **Flight search dates** use UTC day boundaries.
- **JSON is camelCase** (`flightId`, `departureCity`, ...) while the database is snake_case.

## Before production

- `services/paymentGateway.js` and `services/mailer.js` are stubs. Use token `tok_fail` to test a declined payment.
- If the server crashes after a successful charge but before the receipt is saved, the stale-payment job would cancel a paid booking. Use gateway idempotency keys or webhooks to close that gap.
- Cancelling does not issue a refund.
- Auto-delete also removes the payment/receipt rows for deleted bookings. Check this against your record-retention requirements.
