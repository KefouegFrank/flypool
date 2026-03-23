import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { Events } from '../events/events.constants';
import {
  BookingConfirmedPayload,
  BookingCancelledPayload,
} from '../events/events.payloads';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matchingService: MatchingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createBooking(passengerId: string, dto: CreateBookingDto) {

    // ── Pre-flight: validate buffer before touching the DB lock ────────────
    const tripSnapshot = await this.getTripSnapshot(dto.tripId);
    await this.matchingService.validatePassengerBuffer(
      dto.passengerFlightId,
      tripSnapshot,
    );

    // ── Atomic booking via single raw SQL block ────────────────────────────
    // Uses a CTE to:
    // 1. Lock the trip row (FOR UPDATE)
    // 2. Check seats > 0 in the same statement
    // 3. Decrement available_seats atomically
    // 4. Insert the booking
    // 5. Mark FULL if seats reach 0
    // All in ONE round-trip — no interactive transaction, no pool exhaustion
    const bookingId = randomUUID();

    const result: any[] = await this.prisma.$queryRaw`
      WITH locked_trip AS (
        SELECT id, available_seats, status
        FROM trips
        WHERE id = ${dto.tripId}
          AND status = 'ACTIVE'
          AND available_seats > 0
        FOR UPDATE
      ),
      decrement AS (
        UPDATE trips
        SET
          available_seats = available_seats - 1,
          status = CASE
            WHEN available_seats - 1 = 0 THEN 'FULL'::"TripStatus"
            ELSE status
          END
        WHERE id = ${dto.tripId}
          AND EXISTS (SELECT 1 FROM locked_trip)
        RETURNING id, available_seats
      ),
      new_booking AS (
        INSERT INTO bookings (id, trip_id, passenger_id, passenger_flight_id, status, created_at)
        SELECT
          ${bookingId},
          ${dto.tripId},
          ${passengerId},
          ${dto.passengerFlightId},
          'CONFIRMED'::"BookingStatus",
          NOW()
        WHERE EXISTS (SELECT 1 FROM decrement)
        RETURNING id, trip_id, passenger_id, passenger_flight_id, status, created_at
      )
      SELECT
        nb.id,
        nb.trip_id             AS "tripId",
        nb.passenger_id        AS "passengerId",
        nb.passenger_flight_id AS "passengerFlightId",
        nb.status,
        nb.created_at          AS "createdAt",
        d.available_seats      AS "remainingSeats"
      FROM new_booking nb
      JOIN decrement d ON true
    `;

    // If the CTE returned nothing, the trip was full or unavailable
    if (!result || result.length === 0) {
      // Re-check to give a meaningful error
      const trip = await this.prisma.trip.findUnique({
        where: { id: dto.tripId },
      });
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.status !== 'ACTIVE') {
        throw new ConflictException(
          `Trip is not available — current status: ${trip.status}`,
        );
      }
      throw new ConflictException('No seats available on this trip');
    }

    const booking = result[0];

    this.logger.log(
      `Booking ${booking.id} confirmed — trip ${dto.tripId} — passenger ${passengerId}`,
    );

    if (booking.remainingSeats === 0) {
      this.logger.log(`Trip ${dto.tripId} is now FULL`);
    }

    // ── Emit booking.confirmed (non-blocking) ─────────────────────────────
    const confirmedPayload: BookingConfirmedPayload = {
      bookingId: booking.id,
      tripId: dto.tripId,
      passengerId,
      passengerFlightId: dto.passengerFlightId,
      availableSeats: Number(booking.remainingSeats),
    };

    this.eventEmitter.emit(Events.BOOKING_CONFIRMED, confirmedPayload);

    return {
      id: booking.id,
      tripId: booking.tripId,
      passengerId: booking.passengerId,
      passengerFlightId: booking.passengerFlightId,
      status: booking.status,
      createdAt: booking.createdAt,
    };
  }

  async cancelBooking(bookingId: string, passengerId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.passengerId !== passengerId) {
      throw new ConflictException('You can only cancel your own bookings');
    }

    if (booking.status !== 'CONFIRMED') {
      throw new ConflictException(
        `Cannot cancel a booking with status: ${booking.status}`,
      );
    }

    // Cancel uses an interactive transaction — lower contention than booking
    // creation, so pool exhaustion is not a concern on this path
    await this.prisma.$transaction(
      async (tx) => {
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'CANCELLED' },
        });

        // Restore the seat
        await tx.$executeRaw`
          UPDATE trips
          SET
            available_seats = available_seats + 1,
            status = 'ACTIVE'
          WHERE id = ${booking.tripId}
        `;
      },
      {
        timeout: 10000,
        maxWait: 15000,
      },
    );

    const cancelledPayload: BookingCancelledPayload = {
      bookingId,
      tripId: booking.tripId,
      passengerId,
    };

    this.eventEmitter.emit(Events.BOOKING_CANCELLED, cancelledPayload);

    this.logger.log(
      `Booking ${bookingId} cancelled by passenger ${passengerId}`,
    );

    return { message: 'Booking cancelled successfully' };
  }

  async findByPassenger(passengerId: string) {
    return this.prisma.booking.findMany({
      where: { passengerId },
      include: {
        trip: true,
        passengerFlight: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        trip: true,
        passengerFlight: true,
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private async getTripSnapshot(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { departureTime: true, delayMinutes: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    return {
      departureTime: trip.departureTime,
      delayMinutes: trip.delayMinutes,
    };
  }
}
