-- Optional dev data. Run after schema.sql: psql "$DATABASE_URL" -f seed.sql

INSERT INTO flights
  (flight_number, airline, departure_city, arrival_city, departure_datetime, arrival_datetime, base_price, status)
VALUES
  ('AC123', 'Air Canada', 'Toronto',   'Vancouver', now() + interval '7 days',  now() + interval '7 days 5 hours',  389.00, 'Scheduled'),
  ('WS456', 'WestJet',    'Toronto',   'Vancouver', now() + interval '7 days 3 hours', now() + interval '7 days 8 hours', 329.00, 'Scheduled'),
  ('AC789', 'Air Canada', 'Toronto',   'Montreal',  now() + interval '3 days',  now() + interval '3 days 90 minutes', 159.00, 'Scheduled'),
  ('PD101', 'Porter',     'Montreal',  'Toronto',   now() + interval '4 days',  now() + interval '4 days 90 minutes', 149.00, 'Scheduled'),
  ('WS202', 'WestJet',    'Calgary',   'Toronto',   now() + interval '10 days', now() + interval '10 days 4 hours',  299.00, 'Cancelled');

-- 10 rows x 6 seats per flight; rows 1-3 Business, the rest Economy
INSERT INTO seats (flight_id, seat_number, seat_class, seat_fee)
SELECT f.flight_id,
       r::text || l,
       CASE WHEN r <= 3 THEN 'Business' ELSE 'Economy' END,
       CASE WHEN r <= 3 THEN 75.00 ELSE 0 END
FROM flights f
CROSS JOIN generate_series(1, 10) AS r
CROSS JOIN unnest(ARRAY['A','B','C','D','E','F']) AS l;
