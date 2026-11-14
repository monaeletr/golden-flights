# GoldenFlights Frontend

## Overview

The GoldenFlights frontend is a React application built with Vite. It provides the user interface for searching and booking flights, managing bookings, and accessing staff features.

## Main Features

- **User login:** Passengers and staff sign in through the application.
- **Role-based access:** The interface displays the appropriate features based on the role returned by the backend.
- **Flight booking:** Users can go through the flight-booking process and enter passenger details.
- **Accessibility information:** Passengers can provide accessibility-related notes as part of their booking.
- **Mock checkout:** A simulated payment step is provided for testing. It does not process a real payment.
- **Booking management:** Passengers can view their bookings and use the available options to change or cancel a booking.
- **Staff dashboard:** Staff members can access the staff view and manage booking-related information.

## Technology

- React
- Vite
- JavaScript
- CSS
- Backend communication through HTTP API requests

## Running the Frontend

1. Open a terminal.
2. Navigate to the frontend directory:

   ```bash
   cd frontend
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open the local URL printed by Vite in the terminal (usually `http://localhost:5173`).

## Backend Requirement

The backend API must also be running for login, booking, and staff features to work. Start it separately from the `backend-api` directory using `npm run dev`.

## Notes

- The mock checkout is for development/testing only.
- Booking and user data are handled by the backend and stored in the connected database.
