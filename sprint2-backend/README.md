# GoldenFlights Backend API

## Overview

The GoldenFlights backend is an Express API that handles authentication, booking operations, database access, and scheduled background tasks. It connects to the PostgreSQL database hosted by Supabase.

## Main Changes and Features

- **Database connection:** Uses PostgreSQL through the `pg` package and the connection string configured in the environment file.
- **Authentication:** Provides login functionality and checks the user's role so passenger and staff access can be handled separately.
- **Role-based access:** Staff accounts use the `Staff` role; passenger accounts use the passenger role configured in the database.
- **Booking management:** Provides backend operations used by the frontend to retrieve and manage bookings, including supported change and cancellation actions.
- **Accessibility information:** Supports saving accessibility-related booking notes.
- **Mock checkout:** Supports a simulated checkout flow for testing. It does not connect to a real payment processor or verify a real card payment.
- **Payment metadata:** The mock checkout stores limited payment metadata with the booking, such as the cardholder name, card brand, and last four digits. Full card numbers, expiry dates, and CVVs are not stored.
- **Background jobs:** Scheduled jobs handle tasks such as pending confirmation emails and cleanup of stale pending payments/bookings.

## Technology

- Node.js
- Express
- PostgreSQL
- Supabase
- `pg` for database access
- `dotenv` for environment configuration

## Environment Configuration

Create a `.env` file inside `backend-api`:

```env
PORT=3000
JWT_SECRET=your-long-random-secret
SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_HOST:5432/postgres
DB_SSL=true
CORS_ORIGIN=http://localhost:5173
```

Use the connection string and database password from your Supabase project. Do not commit `.env` or share its secrets. If your password contains special characters, URL-encode them in the connection string.

## Database Setup

- Make sure the backend's required database tables and columns exist in Supabase.
- Apply the SQL migration files included in the project before using features that depend on their schema changes.
- Staff accounts must have the appropriate staff role in the `users` table.
- Keep the database identity/sequence in sync if a user ID is manually overridden.

## Running the Backend

1. Open a terminal.
2. Navigate to the backend directory:

   ```bash
   cd backend-api
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Make sure the `.env` file is configured.
5. Start the development server:

   ```bash
   npm run dev
   ```

The API runs on the port configured in `.env` (normally port `3000`).

## Important Notes

- The frontend and backend run in separate terminals.
- Supabase database credentials must be correct. A PostgreSQL `28P01` error means database authentication failed.
- The mock checkout is not a real payment system and must not be used to collect real payment details.
- Never commit `.env`, database passwords, JWT secrets, or other credentials.
