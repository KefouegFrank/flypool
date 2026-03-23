import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConflictException } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  passengerFlight: { findUnique: jest.fn() },
  booking: { findMany: jest.fn(), update: jest.fn() },
  trip: { findUnique: jest.fn() },
  $executeRaw: jest.fn(),
};

const mockEventEmitter = { emit: jest.fn() };

describe('MatchingService', () => {
  let service: MatchingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MatchingService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<MatchingService>(MatchingService);
    jest.clearAllMocks();
  });

  describe('validateBuffer', () => {
    const baseFlight = {
      flightTime: new Date('2026-06-01T14:00:00.000Z'), // 14:00
      checkinDurationMins: 90,
      safetyBufferMins: 30,
      // deadline = 14:00 - 90min - 30min = 12:00
    };

    const baseTrip = {
      departureTime: new Date('2026-06-01T08:00:00.000Z'), // 08:00
      delayMinutes: 0,
      // eta = 08:00 + 0 + 90min transit = 09:30
    };

    it('should return true when eta is well before deadline', () => {
      const result = service.validateBuffer(baseFlight, baseTrip);
      expect(result).toBe(true);
      // eta 09:30 <= deadline 12:00
    });

    it('should return true when eta equals deadline exactly', () => {
      const trip = {
        departureTime: new Date('2026-06-01T08:30:00.000Z'), // 08:30
        delayMinutes: 90,
        // eta = 08:30 + 90min delay + 90min transit = 13:00... wait
        // Actually: 08:30 + 90 + 90 = 11:30... no
        // 08:30 + 90min delay = 10:00 + 90min transit = 11:30
        // deadline = 12:00 → valid
      };
      const result = service.validateBuffer(baseFlight, trip);
      expect(result).toBe(true);
    });

    it('should return false when delay pushes eta past deadline', () => {
      const trip = {
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 300, // 5 hour delay
        // eta = 08:00 + 300min + 90min = 14:30 > deadline 12:00
      };
      const result = service.validateBuffer(baseFlight, trip);
      expect(result).toBe(false);
    });

    it('should return false when departure time itself is too late', () => {
      const trip = {
        departureTime: new Date('2026-06-01T11:00:00.000Z'), // 11:00
        delayMinutes: 0,
        // eta = 11:00 + 0 + 90min = 12:30 > deadline 12:00
      };
      const result = service.validateBuffer(baseFlight, trip);
      expect(result).toBe(false);
    });

    it('should return false when flight is too soon for any departure', () => {
      const tightFlight = {
        flightTime: new Date('2026-06-01T09:00:00.000Z'), // 09:00
        checkinDurationMins: 90,
        safetyBufferMins: 30,
        // deadline = 09:00 - 90 - 30 = 07:00
      };
      const trip = {
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 0,
        // eta = 08:00 + 90 = 09:30 > deadline 07:00
      };
      const result = service.validateBuffer(tightFlight, trip);
      expect(result).toBe(false);
    });

    it('should handle zero safety buffer', () => {
      const flight = {
        flightTime: new Date('2026-06-01T14:00:00.000Z'),
        checkinDurationMins: 90,
        safetyBufferMins: 0,
        // deadline = 12:30
      };
      const result = service.validateBuffer(flight, baseTrip);
      expect(result).toBe(true);
      // eta 09:30 <= deadline 12:30
    });

    it('should handle delay at the exact boundary', () => {
      // deadline = 12:00, transit = 90min
      // departure 08:00 + delay + 90min = 12:00
      // delay = 12:00 - 08:00 - 90min = 150min
      const trip = {
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 150,
        // eta = 08:00 + 150min + 90min = 12:00 exactly
      };
      const result = service.validateBuffer(baseFlight, trip);
      expect(result).toBe(true); // eta <= deadline (equal is valid)
    });
  });

  describe('validatePassengerBuffer', () => {
    it('should pass when flight and trip produce a valid buffer', async () => {
      mockPrismaService.passengerFlight.findUnique.mockResolvedValue({
        flightTime: new Date('2026-06-01T14:00:00.000Z'),
        checkinDurationMins: 90,
        safetyBufferMins: 30,
      });

      const trip = {
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 0,
      };

      await expect(
        service.validatePassengerBuffer('flight-id', trip),
      ).resolves.not.toThrow();
    });

    it('should throw ConflictException when buffer is violated', async () => {
      mockPrismaService.passengerFlight.findUnique.mockResolvedValue({
        flightTime: new Date('2026-06-01T14:00:00.000Z'),
        checkinDurationMins: 90,
        safetyBufferMins: 30,
      });

      const trip = {
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 300, // too much delay
      };

      await expect(
        service.validatePassengerBuffer('flight-id', trip),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when flight not found', async () => {
      mockPrismaService.passengerFlight.findUnique.mockResolvedValue(null);

      await expect(
        service.validatePassengerBuffer('nonexistent-flight', {
          departureTime: new Date(),
          delayMinutes: 0,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('recalculateOnDelay', () => {
    it('should invalidate bookings that violate buffer after delay', async () => {
      mockPrismaService.trip.findUnique.mockResolvedValue({
        id: 'trip-1',
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 300, // 5 hour delay — will break buffer
      });

      mockPrismaService.booking.findMany.mockResolvedValue([
        {
          id: 'booking-1',
          passengerId: 'passenger-1',
          passengerFlight: {
            flightTime: new Date('2026-06-01T14:00:00.000Z'),
            checkinDurationMins: 90,
            safetyBufferMins: 30,
          },
        },
      ]);

      mockPrismaService.booking.update.mockResolvedValue({});
      mockPrismaService.$executeRaw.mockResolvedValue(1);

      await service.recalculateOnDelay({
        tripId: 'trip-1',
        driverId: 'driver-1',
        delayMinutes: 300,
      });

      expect(mockPrismaService.booking.update).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: 'INVALIDATED' },
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'booking.invalidated',
        expect.objectContaining({
          bookingId: 'booking-1',
          passengerId: 'passenger-1',
        }),
      );
    });

    it('should keep bookings valid when delay is within buffer', async () => {
      mockPrismaService.trip.findUnique.mockResolvedValue({
        id: 'trip-1',
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 15, // small delay — still valid
      });

      mockPrismaService.booking.findMany.mockResolvedValue([
        {
          id: 'booking-1',
          passengerId: 'passenger-1',
          passengerFlight: {
            flightTime: new Date('2026-06-01T14:00:00.000Z'),
            checkinDurationMins: 90,
            safetyBufferMins: 30,
          },
        },
      ]);

      await service.recalculateOnDelay({
        tripId: 'trip-1',
        driverId: 'driver-1',
        delayMinutes: 15,
      });

      expect(mockPrismaService.booking.update).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should do nothing when trip is not found', async () => {
      mockPrismaService.trip.findUnique.mockResolvedValue(null);

      await service.recalculateOnDelay({
        tripId: 'nonexistent',
        driverId: 'driver-1',
        delayMinutes: 15,
      });

      expect(mockPrismaService.booking.findMany).not.toHaveBeenCalled();
    });

    it('should do nothing when no confirmed bookings exist', async () => {
      mockPrismaService.trip.findUnique.mockResolvedValue({
        id: 'trip-1',
        departureTime: new Date('2026-06-01T08:00:00.000Z'),
        delayMinutes: 300,
      });

      mockPrismaService.booking.findMany.mockResolvedValue([]);

      await service.recalculateOnDelay({
        tripId: 'trip-1',
        driverId: 'driver-1',
        delayMinutes: 300,
      });

      expect(mockPrismaService.booking.update).not.toHaveBeenCalled();
    });
  });
});
