import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Events } from '../events/events.constants';
import type {
  BookingConfirmedPayload,
  BookingInvalidatedPayload,
  BookingCancelledPayload,
} from '../events/events.payloads';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  @OnEvent(Events.BOOKING_CONFIRMED)
  handleBookingConfirmed(payload: BookingConfirmedPayload): void {
    // In production: trigger push notification + email to passenger
    this.logger.log(
      JSON.stringify({
        event: Events.BOOKING_CONFIRMED,
        message: `Booking confirmed — notifying passenger`,
        bookingId: payload.bookingId,
        passengerId: payload.passengerId,
        tripId: payload.tripId,
        remainingSeats: payload.availableSeats,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  @OnEvent(Events.BOOKING_INVALIDATED)
  handleBookingInvalidated(payload: BookingInvalidatedPayload): void {
    // In production: alert passenger their trip is compromised
    this.logger.warn(
      JSON.stringify({
        event: Events.BOOKING_INVALIDATED,
        message: `Booking invalidated — alerting passenger`,
        bookingId: payload.bookingId,
        passengerId: payload.passengerId,
        tripId: payload.tripId,
        reason: payload.reason,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  @OnEvent(Events.BOOKING_CANCELLED)
  handleBookingCancelled(payload: BookingCancelledPayload): void {
    this.logger.log(
      JSON.stringify({
        event: Events.BOOKING_CANCELLED,
        message: `Booking cancelled — notifying passenger`,
        bookingId: payload.bookingId,
        passengerId: payload.passengerId,
        tripId: payload.tripId,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
