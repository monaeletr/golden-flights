# Airline Reservation Back End - Sprints 1 and 2

Node.js + Express + PostgreSQL.

- **Sprint 1:** UI-01, UI-03, UI-05, UI-08, UI-09
- **Sprint 2:** UI-02, UI-04, UI-06, REP-03, REP-04, REP-05

## Setup

Before using the demo checkout, run `migrations/001_mock_payment_metadata.sql` once in the Supabase SQL Editor. It adds payment display metadata columns to the existing `payments` table. It does not store full card numbers, expiry dates, or CVVs.

The database tables already exist in Supabase (see `backend-database/sql/SqlScripts.txt`), so do not run any CREATE TABLE script again. This API needs the Sprint 1 **and Sprint 2** parts of that script (`flights.created_by`, `bookings.accessibility_notes` and the `booking_charges` table), so run the Sprint 2 section in Supabase if it isn't there yet. Sprint 3 columns are not used.

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
| UI-01 | `POST /api/auth/register` | - | `{ firstName, lastName, email, password }`. Password 8+ chars. Always creates a `Passenger`. |
| UI-01 | `POST /api/auth/login` | - | `{ email, password }` returns `{ token, user }` |
| UI-01 | `GET /api/auth/me` | Auth | Current user |
| UI-03 | `PATCH /api/auth/me/preferences` | Auth | `{ autoDeleteEnabled: boolean }` |
| UI-08 | `GET /api/flights` | - | Query: `departureCity`, `arrivalCity`, `date` (YYYY-MM-DD), `airline`, `sort` (`departure`/`price`/`duration`). Only future, Scheduled flights. |
| UI-08 | `GET /api/flights/airlines` | - | Values for the airline filter |
| UI-08 | `GET /api/flights/:flightId` | - | One flight |
| UI-05 | `GET /api/flights/:flightId/seats` | - | Seat map with `available` flag |
| UI-05 | `PUT /api/bookings/:bookingId/seat` | Auth | `{ seatId }`. Choose or change a seat. |
| UI-09 | `POST /api/bookings` | Auth | `{ flightId, seatId?, accessibilityNotes?, paymentDetails: { cardholderName, cardBrand, cardLastFour } }`. Creates booking, charge rows, a simulated payment record and demo receipt. |
| UI-06 | `GET /api/flights/:flightId/quote?seatId=` | - | Price breakdown (`charges[]`, `total`) to show before paying. `seatId` optional. |
| UI-04 | `PATCH /api/bookings/:bookingId/accessibility` | Auth | `{ accessibilityNotes }` (max 1000 chars, `""` clears). Also accepted when booking. |
| UI-03 | `GET /api/bookings?view=current\|previous\|all` | Auth | Own bookings (staff: all, or `&userId=`) |
| UI-03 | `GET /api/bookings/:bookingId` | Auth | Owner or staff |
| UI-03 | `GET /api/bookings/reference/:reference` | Auth | Lookup by booking code |
| UI-03 | `POST /api/bookings/:bookingId/cancel` | Auth | Sets `Cancelled`, frees the seat |

### Staff only (UI-02) - role `Staff`

| Story | Method & path | Notes |
|---|---|---|
| REP-05 | `GET /api/staff/flights` | All flights incl. cancelled/past, with `totalSeats` and `activeBookings`. Optional `?status=Scheduled\|Cancelled`. |
| REP-05 | `POST /api/staff/flights` | `{ flightNumber, airline, departureCity, arrivalCity, departureDatetime, arrivalDatetime, basePrice, status?, seatMap? }`. Dates need a time zone (e.g. `2026-12-01T09:30:00-05:00`). Seats are generated so passengers can choose seats. |
| REP-05 | `PATCH /api/staff/flights/:flightId` | Any of the same fields. Departed flights can't be edited. `status: "Cancelled"` hides the flight from search. |
| REP-04 | `GET /api/staff/flights/:flightId/passengers` | One row per ticket, ordered by passenger ID (`users.user_id`). `?includeCancelled=true` to include cancelled tickets. |
| REP-03 | `GET /api/staff/flights/:flightId/accessibility` | Notes identified by seat number only (no names/contact). Bookings with notes but no seat yet appear last with their booking reference. |

`seatMap` is optional: `{ rows: 20, columns: "ABCDEF", businessRows: 3, businessSeatFee: 0, economySeatFee: 0 }` (those are the defaults; `rows: 0` creates no seats).

Staff can also use the passenger endpoints above, plus: list/open **any** booking (`GET /api/bookings`, optional `?userId=`) and cancel any booking.

### Roles and permissions (UI-02)

Defined in `src/middleware/permissions.js`. The user object returned by login/register/`/me` includes a `permissions` array so the front end can show or hide features. The server checks the role against the database on every request, so promoting or demoting someone takes effect immediately.

Errors are `{ "error": "message", "details": {...} }` with these statuses: 400 validation, 401 not logged in, 402 payment failed, 404 not found, 409 conflict (e.g. seat taken).

## Scheduled jobs (`src/jobs/index.js`)

- **Daily 02:00** - deletes bookings whose flight departed over 12 months ago (past or cancelled), skipping users with `auto_delete_enabled = false`.
- **Every minute** - sends confirmation emails for paid payments where `email_sent = false`, then sets it to true.
- **Every 5 minutes** - fails payments stuck in Pending for 15+ minutes and releases the held seat.

## Assumptions to check against your backlog

- **Demo book + pay is one call.** The booking, seat assignment, charge breakdown and simulated payment are saved in PostgreSQL. The demo gateway always succeeds; it does not process funds.
- **Price breakdown (UI-06)** is saved in `booking_charges`: Base fare = `flights.base_price`; Seat fee = the chosen seat's `seat_fee` (line omitted when 0); Service = `SERVICE_FEE` (default 0, omitted when 0); Tax = `TAX_RATE` (default 13%) of everything before tax. Set both in `.env` and confirm the rates with your team.
- **Changing a seat recalculates the charges** but does not charge or refund the difference automatically. The booking shows it as `pricing.balanceDue` (positive = passenger owes, negative = overpaid). Refunds belong to Sprint 3.
- **Seat change sets `Changed`.** Choosing a first seat leaves the status `Confirmed`; replacing an existing seat marks the booking `Changed`.
- **Current vs previous bookings** is derived from the flight's departure time and cancellation status.
- **Flight search dates** use UTC day boundaries.
- **JSON is camelCase** (`flightId`, `departureCity`, ...) while the database is snake_case.

## Before production

- `services/paymentGateway.js` and `services/mailer.js` are demo stubs. The payment gateway always marks demo checkout successful; it must be replaced with a compliant provider integration before accepting real payments.
- If the server crashes after a successful charge but before the receipt is saved, the stale-payment job would cancel a paid booking. Use gateway idempotency keys or webhooks to close that gap.
- Cancelling does not issue a refund (Sprint 3: `cancellation_policies`, `refund_amount`, check-in are not implemented here).
- Auto-delete also removes the payment/receipt rows for deleted bookings. Check this against your record-retention requirements.
