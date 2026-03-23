-- prisma/migrations/add_unique_booking_constraint.sql
CREATE UNIQUE INDEX bookings_trip_passenger_unique 
  ON bookings(trip_id, passenger_id) 
  WHERE status = 'CONFIRMED';
