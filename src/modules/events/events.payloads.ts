export interface BookingConfirmedPayload {
  bookingId: string;
  tripId: string;
  passengerId: string;
  passengerFlightId: string;
  availableSeats: number;
}

export interface BookingInvalidatedPayload {
  bookingId: string;
  tripId: string;
  passengerId: string;
  reason: string;
}

export interface BookingCancelledPayload {
  bookingId: string;
  tripId: string;
  passengerId: string;
}

export interface TripDelayAnnouncedPayload {
  tripId: string;
  driverId: string;
  delayMinutes: number;
}

export interface TripStatusUpdatedPayload {
  tripId: string;
  availableSeats: number;
  bookingId: string;
  timestamp: string;
}
