import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { NearbyTripsDto } from './dto/nearby-trips.dto';
import { AnnounceDelayDto } from './dto/announce-delay.dto';
import { Events } from '../events/events.constants';
import { TripDelayAnnouncedPayload } from '../events/events.payloads';

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(driverId: string, dto: CreateTripDto) {
    // Create the trip row via Prisma first (without geography columns)
    const trip = await this.prisma.trip.create({
      data: {
        driverId,
        departureTime: new Date(dto.departureTime),
        availableSeats: dto.availableSeats,
      },
    });

    // Update the geography columns via raw SQL
    await this.prisma.$executeRaw`
      UPDATE trips
      SET
        departure_point = ST_SetSRID(
          ST_MakePoint(${dto.departurePoint.longitude}, ${dto.departurePoint.latitude}),
          4326
        )::geography,
        arrival_point = ST_SetSRID(
          ST_MakePoint(${dto.arrivalPoint.longitude}, ${dto.arrivalPoint.latitude}),
          4326
        )::geography
      WHERE id = ${trip.id}
    `;

    return this.findById(trip.id);
  }

  async findById(id: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id } });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  async findNearby(dto: NearbyTripsDto) {
    const radius = dto.radiusMeters ?? 5000;

    const rows: any[] = await this.prisma.$queryRaw`
      SELECT
        t.id,
        t.driver_id        AS "driverId",
        t.departure_time   AS "departureTime",
        t.available_seats  AS "availableSeats",
        t.status,
        t.delay_minutes    AS "delayMinutes",
        t.version,
        t.created_at       AS "createdAt",
        ROUND(
          ST_Distance(
            t.departure_point,
            ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography
          )::numeric,
          2
        ) AS "distanceMetres"
      FROM trips t
      WHERE
        t.status = 'ACTIVE'
        AND t.available_seats > 0
        AND t.departure_time > NOW()
        AND ST_DWithin(
          t.departure_point,
          ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
          ${radius}
        )
      ORDER BY t.departure_time ASC, "distanceMetres" ASC
    `;

    return rows;
  }

  async announceDelay(tripId: string, driverId: string, dto: AnnounceDelayDto) {
    // Fetch the trip first
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');

    // Ownership check — only the driver of this trip can announce a delay
    if (trip.driverId !== driverId) {
      throw new ForbiddenException(
        'You are not the owner of this trip',
      );
    }

    // Update delay in DB
    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { delayMinutes: dto.delayMinutes },
    });

    // Emit event — MatchingService listens and recalculates
    const payload: TripDelayAnnouncedPayload = {
      tripId,
      driverId,
      delayMinutes: dto.delayMinutes,
    };
    this.eventEmitter.emit(Events.TRIP_DELAY_ANNOUNCED, payload);

    this.logger.log(
      `Delay announced for trip ${tripId}: ${dto.delayMinutes} minutes`,
    );

    return updated;
  }

  async updateStatus(
    tripId: string,
    status: 'ACTIVE' | 'FULL' | 'CANCELLED' | 'COMPLETED',
  ) {
    return this.prisma.trip.update({
      where: { id: tripId },
      data: { status },
    });
  }
}
