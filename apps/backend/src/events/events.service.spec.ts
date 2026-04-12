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

  describe('getUpcomingImpactsForLot', () => {
    it('should return upcoming events impacting a lot', async () => {
      const mockEvent = {
        id: 'ev-1',
        event_name: 'Basketball Game',
        event_type: 'ATHLETIC',
        start_time: new Date(),
        end_time: new Date(Date.now() + 3600000),
      };
      const mockImpact = {
        id: 'imp-1',
        event_id: 'ev-1',
        lot_id: 'lot-uuid',
        impact_level: 'HIGH',
        expected_increase_percent: 25,
        event: mockEvent,
      };

      prisma.eventImpact.findMany.mockResolvedValue([mockImpact]);

      const result = await service.getUpcomingImpactsForLot('lot-uuid', 24);

      expect(result).toHaveLength(1);
      expect(result[0].event.event_name).toBe('Basketball Game');
      expect(result[0].impact.impact_level).toBe('HIGH');
    });

    it('should return empty array when no impacts found', async () => {
      prisma.eventImpact.findMany.mockResolvedValue([]);
      const result = await service.getUpcomingImpactsForLot('lot-uuid');
      expect(result).toEqual([]);
    });

    it('should gracefully return empty on error', async () => {
      prisma.eventImpact.findMany.mockRejectedValue(new Error('DB error'));
      const result = await service.getUpcomingImpactsForLot('lot-uuid');
      expect(result).toEqual([]);
    });
  });

  describe('getActiveImpactsForLots', () => {
    it('should batch-fetch active impacts and return max per lot', async () => {
      const mockImpacts = [
        {
          lot_id: 'lot-1',
          expected_increase_percent: 20,
          event: { start_time: new Date(), end_time: new Date(Date.now() + 3600000) },
        },
        {
          lot_id: 'lot-1',
          expected_increase_percent: 35,
          event: { start_time: new Date(), end_time: new Date(Date.now() + 3600000) },
        },
        {
          lot_id: 'lot-2',
          expected_increase_percent: 15,
          event: { start_time: new Date(), end_time: new Date(Date.now() + 3600000) },
        },
      ];

      prisma.eventImpact.findMany.mockResolvedValue(mockImpacts);

      const result = await service.getActiveImpactsForLots(['lot-1', 'lot-2']);

      expect(result.get('lot-1')).toBe(35); // max of 20 and 35
      expect(result.get('lot-2')).toBe(15);
    });

    it('should return empty map for empty input', async () => {
      const result = await service.getActiveImpactsForLots([]);
      expect(result.size).toBe(0);
    });

    it('should return empty map on error', async () => {
      prisma.eventImpact.findMany.mockRejectedValue(new Error('DB error'));
      const result = await service.getActiveImpactsForLots(['lot-1']);
      expect(result.size).toBe(0);
    });
  });
});
