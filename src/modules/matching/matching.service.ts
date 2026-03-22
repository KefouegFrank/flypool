import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { Events } from '../events/events.constants';
import type {
  TripDelayAnnouncedPayload,
  BookingInvalidatedPayload,
} from '../events/events.payloads';

// Estimated transit duration from pickup point to airport in minutes
const ESTIMATED_TRANSIT_MINS = 90;

interface PassengerFlight {
  flightTime: Date;
  checkinDurationMins: number;
  safetyBufferMins: number;
}

interface TripSnapshot {
  departureTime: Date;
  delayMinutes: number;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Core algorithm — Buffer de Sécurité Voyageur
   *
   * deadline  = flight_time - checkin_duration - safety_buffer
   * eta       = departure_time + delay_minutes + transit_duration
   * VALID iff eta <= deadline
   */
  validateBuffer(flight: PassengerFlight, trip: TripSnapshot): boolean {
    const deadlineMs =
      flight.flightTime.getTime() -
      flight.checkinDurationMins * 60_000 -
      flight.safetyBufferMins * 60_000;

    const etaMs =
      trip.departureTime.getTime() +
      trip.delayMinutes * 60_000 +
      ESTIMATED_TRANSIT_MINS * 60_000;

    const isValid = etaMs <= deadlineMs;

    this.logger.debug(
      `Buffer check — ` +
        `deadline: ${new Date(deadlineMs).toISOString()} | ` +
        `eta: ${new Date(etaMs).toISOString()} | ` +
        `valid: ${isValid}`,
    );

    return isValid;
  }

  /**
   * Called by BookingsService before creating a booking.
   * Fetches the flight and trip, runs the buffer check.
   * Throws ConflictException if the match would cause a missed flight.
   */
  async validatePassengerBuffer(
    passengerFlightId: string,
    trip: TripSnapshot,
  ): Promise<void> {
    const flight = await this.prisma.passengerFlight.findUnique({
      where: { id: passengerFlightId },
    });

    if (!flight) {
      throw new ConflictException('Passenger flight not found');
    }

    const isValid = this.validateBuffer(flight, trip);

    if (!isValid) {
      throw new ConflictException(
        'This trip would cause you to miss your flight',
      );
    }
  }

  /**
   * Triggered by trip.delay.announced event.
   * Recalculates all CONFIRMED bookings for the affected trip.
   * Invalidates any booking where the new delay breaks the safety buffer.
   */
  @OnEvent(Events.TRIP_DELAY_ANNOUNCED)
  async recalculateOnDelay(payload: TripDelayAnnouncedPayload): Promise<void> {
    this.logger.log(
      `Recalculating bookings for trip ${payload.tripId} — new delay: ${payload.delayMinutes} min`,
    );

    // Fetch the updated trip
    const trip = await this.prisma.trip.findUnique({
      where: { id: payload.tripId },
    });

    if (!trip) {
      this.logger.error(
        `Trip ${payload.tripId} not found during recalculation`,
      );
      return;
    }

    // Fetch all confirmed bookings with their associated flight
    const confirmedBookings = await this.prisma.booking.findMany({
      where: {
        tripId: payload.tripId,
        status: 'CONFIRMED',
      },
      include: {
        passengerFlight: true,
      },
    });

    if (confirmedBookings.length === 0) {
      this.logger.log(
        `No confirmed bookings to recalculate for trip ${payload.tripId}`,
      );
      return;
    }

    const invalidatedIds: string[] = [];

    for (const booking of confirmedBookings) {
      const isStillValid = this.validateBuffer(booking.passengerFlight, {
        departureTime: trip.departureTime,
        delayMinutes: trip.delayMinutes,
      });

      if (!isStillValid) {
        invalidatedIds.push(booking.id);

        // Update booking status to INVALIDATED
        await this.prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'INVALIDATED' },
        });

        // Restore the seat — delay invalidation frees the place
        await this.prisma.$executeRaw`
          UPDATE trips
          SET available_seats = available_seats + 1,
              status = 'ACTIVE'
          WHERE id = ${payload.tripId}
        `;

        // Emit booking.invalidated — NotificationsListener picks this up
        const invalidatedPayload: BookingInvalidatedPayload = {
          bookingId: booking.id,
          tripId: payload.tripId,
          passengerId: booking.passengerId,
          reason: `Driver announced ${payload.delayMinutes} minute delay — flight buffer violated`,
        };

        this.eventEmitter.emit(Events.BOOKING_INVALIDATED, invalidatedPayload);

        this.logger.warn(
          `Booking ${booking.id} invalidated — passenger ${booking.passengerId} would miss flight`,
        );
      } else {
        this.logger.log(
          `Booking ${booking.id} still valid after delay recalculation`,
        );
      }
    }

    this.logger.log(
      `Recalculation complete — ${invalidatedIds.length} booking(s) invalidated out of ${confirmedBookings.length}`,
    );
  }
}
