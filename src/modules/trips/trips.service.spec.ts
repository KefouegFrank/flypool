import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { TripsService } from './trips.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrismaService = {
  trip: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
};

const mockEventEmitter = { emit: jest.fn() };

describe('TripsService', () => {
  let service: TripsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TripsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<TripsService>(TripsService);
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should return a trip when found', async () => {
      const mockTrip = {
        id: 'trip-1',
        driverId: 'driver-1',
        availableSeats: 3,
        status: 'ACTIVE',
      };
      mockPrismaService.trip.findUnique.mockResolvedValue(mockTrip);

      const result = await service.findById('trip-1');
      expect(result).toEqual(mockTrip);
    });

    it('should throw NotFoundException when trip not found', async () => {
      mockPrismaService.trip.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('announceDelay', () => {
    it('should update delay and emit event when driver owns the trip', async () => {
      const mockTrip = {
        id: 'trip-1',
        driverId: 'driver-1',
        delayMinutes: 0,
      };
      mockPrismaService.trip.findUnique.mockResolvedValue(mockTrip);
      mockPrismaService.trip.update.mockResolvedValue({
        ...mockTrip,
        delayMinutes: 15,
      });

      const result = await service.announceDelay('trip-1', 'driver-1', {
        delayMinutes: 15,
      });

      expect(result.delayMinutes).toBe(15);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'trip.delay.announced',
        expect.objectContaining({
          tripId: 'trip-1',
          driverId: 'driver-1',
          delayMinutes: 15,
        }),
      );
    });

    it('should throw ForbiddenException when driver does not own the trip', async () => {
      mockPrismaService.trip.findUnique.mockResolvedValue({
        id: 'trip-1',
        driverId: 'real-driver',
      });

      await expect(
        service.announceDelay('trip-1', 'other-driver', { delayMinutes: 15 }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when trip does not exist', async () => {
      mockPrismaService.trip.findUnique.mockResolvedValue(null);

      await expect(
        service.announceDelay('nonexistent', 'driver-1', { delayMinutes: 15 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
