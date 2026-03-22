import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
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
    const booking = await this.prisma.$transaction(
      async (tx) => {
        // ── Step 1: Acquire row-level lock ─────────────────────────────────────
        // SELECT FOR UPDATE blocks any concurrent transaction from reading
        // this row until we COMMIT. This is the anti-overbooking guarantee.
        // Under 100 concurrent requests, transactions queue here and wait —
        // the 30s timeout gives each one enough time to acquire the lock.
        const trips: any[] = await tx.$queryRaw`
        SELECT
          id,
          available_seats  AS "availableSeats",
          status,
          departure_time   AS "departureTime",
          delay_minutes    AS "delayMinutes"
        FROM trips
        WHERE id = ${dto.tripId}
        FOR UPDATE
      `;

        const trip = trips[0];

        if (!trip) {
          throw new NotFoundException('Trip not found');
        }

        if (trip.status !== 'ACTIVE') {
          throw new ConflictException(
            `Trip is not available — current status: ${trip.status}`,
          );
        }

        if (trip.availableSeats <= 0) {
          throw new ConflictException('No seats available on this trip');
        }

        // ── Step 2: Validate Buffer de Sécurité Voyageur ───────────────────────
        // Done INSIDE the transaction so the trip data is consistent
        // with what we just locked
        await this.matchingService.validatePassengerBuffer(
          dto.passengerFlightId,
          {
            departureTime: new Date(trip.departureTime),
            delayMinutes: Number(trip.delayMinutes),
          },
        );

        // ── Step 3: Decrement seat count atomically ────────────────────────────
        await tx.$executeRaw`
        UPDATE trips
        SET available_seats = available_seats - 1
        WHERE id = ${dto.tripId}
      `;

        // ── Step 4: Create the confirmed booking ──────────────────────────────
        const newBooking = await tx.booking.create({
          data: {
            tripId: dto.tripId,
            passengerId,
            passengerFlightId: dto.passengerFlightId,
            status: 'CONFIRMED',
          },
        });

        // ── Step 5: Mark trip FULL if no seats remain ─────────────────────────
        if (trip.availableSeats - 1 === 0) {
          await tx.$executeRaw`
          UPDATE trips
          SET status = 'FULL'
          WHERE id = ${dto.tripId}
        `;
          this.logger.log(`Trip ${dto.tripId} is now FULL`);
        }

        return newBooking;

        // COMMIT here — row-level lock is released
        // Any queued concurrent transaction now reads updated available_seats
      },
      {
        timeout: 30000, // 30s — allows all 100 queued transactions to complete
        maxWait: 35000, // max time waiting for a connection from the pool
      },
    );

    // ── Step 6: Emit booking.confirmed (outside transaction — non-blocking) ──
    // Listeners: NotificationsListener, TicketListener, SeatUpdateListener
    const confirmedPayload: BookingConfirmedPayload = {
      bookingId: booking.id,
      tripId: dto.tripId,
      passengerId,
      passengerFlightId: dto.passengerFlightId,
      availableSeats: await this.getRemainingSeats(dto.tripId),
    };

    this.eventEmitter.emit(Events.BOOKING_CONFIRMED, confirmedPayload);

    this.logger.log(
      `Booking ${booking.id} confirmed — trip ${dto.tripId} — passenger ${passengerId}`,
    );

    return booking;
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

    await this.prisma.$transaction(
      async (tx) => {
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'CANCELLED' },
        });

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

  private async getRemainingSeats(tripId: string): Promise<number> {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { availableSeats: true },
    });
    return trip?.availableSeats ?? 0;
  }
}
