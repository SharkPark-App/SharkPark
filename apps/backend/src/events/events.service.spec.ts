import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../database/database.module';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    campusEvent: { findMany: jest.Mock };
    eventImpact: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      campusEvent: { findMany: jest.fn() },
      eventImpact: { findMany: jest.fn() },
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
          event_id: 'basketball-2025',
          event_name: 'Basketball Game',
          event_type: 'SPORTS',
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

      await service.findAll('SPORTS');

      expect(prisma.campusEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { event_type: 'SPORTS' },
        }),
      );
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

  describe('getImpacts', () => {
    it('should return parking impacts for event', async () => {
      const mockImpacts = [
        {
          id: 'uuid-1',
          event_id: 'basketball-2025',
          lot_id: 'lot-uuid',
          impact_level: 'HIGH',
        },
      ];

      prisma.eventImpact.findMany.mockResolvedValue(mockImpacts);

      const result = await service.getImpacts('basketball-2025');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(prisma.eventImpact.findMany).toHaveBeenCalledWith({
        where: { event_id: 'basketball-2025' },
      });
    });
  });
});
