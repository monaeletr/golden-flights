// Shared by the public flight routes and the staff routes. Expects the flights table aliased as "f".
const FLIGHT_COLUMNS = `
  f.flight_id AS "flightId",
  f.flight_number AS "flightNumber",
  f.airline,
  f.departure_city AS "departureCity",
  f.arrival_city AS "arrivalCity",
  f.departure_datetime AS "departureDatetime",
  f.arrival_datetime AS "arrivalDatetime",
  f.base_price AS "basePrice",
  f.status`;

module.exports = { FLIGHT_COLUMNS };
