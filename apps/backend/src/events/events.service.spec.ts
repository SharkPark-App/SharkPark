import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../database/database.module';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    campusEvent: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      campusEvent: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return array of campus events', async () => {
      const mockEvents = [
        {
          id: 'uuid-1',
          event_name: 'Basketball Game',
          event_type: 'ATHLETIC',
          start_time: new Date(),
          end_time: new Date(),
        },
      ];

      prisma.campusEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.findAll();

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('should filter by event type when provided', async () => {
      prisma.campusEvent.findMany.mockResolvedValue([]);

      await service.findAll('ATHLETIC');

      expect(prisma.campusEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { event_type: 'ATHLETIC' },
        }),
      );
    });

    it('should reject invalid event type', async () => {
      await expect(service.findAll('INVALID')).rejects.toThrow('Invalid event type');
    });

    it('should pass undefined where when no filter', async () => {
      prisma.campusEvent.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.campusEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: undefined,
        }),
      );
    });
  });

  describe('findUpcoming', () => {
    it('should return events within the time window', async () => {
      const mockEvents = [
        { id: 'ev-1', event_name: 'Game', start_time: new Date(), end_time: new Date(Date.now() + 3600000) },
      ];
      prisma.campusEvent.findMany.mockResolvedValue(mockEvents);

      const windowEnd = new Date(Date.now() + 24 * 3600000);
      const result = await service.findUpcoming(windowEnd);

      expect(result).toEqual(mockEvents);
      expect(prisma.campusEvent.findMany).toHaveBeenCalledWith({
        where: {
          start_time: { lte: windowEnd },
          end_time: { gte: expect.any(Date) },
        },
        orderBy: { start_time: 'asc' },
      });
    });

    it('should return empty array when no upcoming events', async () => {
      prisma.campusEvent.findMany.mockResolvedValue([]);

      const result = await service.findUpcoming(new Date(Date.now() + 3600000));

      expect(result).toEqual([]);
    });

    it('should throw on database error', async () => {
      prisma.campusEvent.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.findUpcoming(new Date())).rejects.toThrow('DB error');
    });
  });
});
