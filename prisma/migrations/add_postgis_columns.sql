-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add geospatial columns to trips table
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS departure_point GEOGRAPHY(POINT, 4326),
  ADD COLUMN IF NOT EXISTS arrival_point   GEOGRAPHY(POINT, 4326);

-- Spatial indexes (GIST) — mandatory for ST_DWithin performance
CREATE INDEX IF NOT EXISTS trips_departure_point_idx
  ON trips USING GIST(departure_point);

CREATE INDEX IF NOT EXISTS trips_arrival_point_idx
  ON trips USING GIST(arrival_point);
