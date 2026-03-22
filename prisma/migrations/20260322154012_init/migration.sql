-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('ACTIVE', 'FULL', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PASSENGER',
    "refresh_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "departure_time" TIMESTAMP(3) NOT NULL,
    "available_seats" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'ACTIVE',
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_flights" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flight_number" TEXT NOT NULL,
    "terminal" TEXT,
    "flight_time" TIMESTAMP(3) NOT NULL,
    "checkin_duration_mins" INTEGER NOT NULL DEFAULT 90,
    "safety_buffer_mins" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_flights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "passenger_id" TEXT NOT NULL,
    "passenger_flight_id" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_departure_time_idx" ON "trips"("departure_time");

-- CreateIndex
CREATE INDEX "passenger_flights_user_id_idx" ON "passenger_flights"("user_id");

-- CreateIndex
CREATE INDEX "bookings_trip_id_idx" ON "bookings"("trip_id");

-- CreateIndex
CREATE INDEX "bookings_passenger_id_idx" ON "bookings"("passenger_id");

-- CreateIndex
CREATE INDEX "bookings_passenger_flight_id_idx" ON "bookings"("passenger_flight_id");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_flights" ADD CONSTRAINT "passenger_flights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_passenger_flight_id_fkey" FOREIGN KEY ("passenger_flight_id") REFERENCES "passenger_flights"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
