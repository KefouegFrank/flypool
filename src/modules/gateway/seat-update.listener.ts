import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events } from '../events/events.constants';
import type {
  BookingConfirmedPayload,
  BookingInvalidatedPayload,
} from '../events/events.payloads';
import { TripsGateway } from './trips.gateway';

@Injectable()
export class SeatUpdateListener {
  private readonly logger = new Logger(SeatUpdateListener.name);

  constructor(private readonly tripsGateway: TripsGateway) {}

  @OnEvent(Events.BOOKING_CONFIRMED)
  handleBookingConfirmed(payload: BookingConfirmedPayload): void {
    // Emit real-time seat update to the driver's room
    this.tripsGateway.emitSeatUpdate({
      tripId: payload.tripId,
      availableSeats: payload.availableSeats,
      bookingId: payload.bookingId,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(
      `Seat update emitted to driver room — trip ${payload.tripId} — seats left: ${payload.availableSeats}`,
    );
  }

  @OnEvent(Events.BOOKING_INVALIDATED)
  handleBookingInvalidated(payload: BookingInvalidatedPayload): void {
    this.tripsGateway.emitBookingInvalidated({
      passengerId: payload.passengerId,
      bookingId: payload.bookingId,
      tripId: payload.tripId,
      reason: payload.reason,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(
      `Booking invalidated event emitted — booking ${payload.bookingId}`,
    );
  }
}
