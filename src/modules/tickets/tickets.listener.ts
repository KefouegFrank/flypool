import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { Events } from '../events/events.constants';
import type { BookingConfirmedPayload } from '../events/events.payloads';
import { randomBytes } from 'crypto';

@Injectable()
export class TicketsListener {
  private readonly logger = new Logger(TicketsListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(Events.BOOKING_CONFIRMED)
  async handleBookingConfirmed(payload: BookingConfirmedPayload): Promise<void> {
    try {
      const ticketToken = randomBytes(16).toString('hex').toUpperCase();

      // In production: persist to a tickets table and deliver to passenger
      // For this implementation we log the generated ticket
      this.logger.log(
        JSON.stringify({
          event: 'ticket.generated',
          ticketToken,
          bookingId: payload.bookingId,
          tripId: payload.tripId,
          passengerId: payload.passengerId,
          passengerFlightId: payload.passengerFlightId,
          issuedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      // Ticket generation must never crash the booking flow
      this.logger.error(
        `Failed to generate ticket for booking ${payload.bookingId}: ${error}`,
      );
    }
  }
}
