import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  EventsService,
  DEFAULT_EVENTS_WINDOW_HOURS,
  MAX_EVENTS_WINDOW_HOURS,
} from './events.service';
import { PrismaService } from '../database/database.module';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    lot: { findFirst: jest.Mock; findMany: jest.Mock };
    campusEvent: { findMany: jest.Mock; deleteMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      lot: { findFirst: jest.fn(), findMany: jest.fn() },
      campusEvent: { findMany: jest.fn(), deleteMany: jest.fn() },
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

  describe('getEventsForLot', () => {
    it('should return events for lots with building associations', async () => {
      prisma.lot.findFirst.mockResolvedValue({
        lot_buildings: [{ building_id: 'bldg-1' }, { building_id: 'bldg-2' }],
      });
      const mockEvents = [
        { id: 'ev-1', event_name: 'Basketball Game', location: 'The Pyramid' },
      ];
      prisma.campusEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.getEventsForLot('G1');

      expect(result).toEqual(mockEvents);
      expect(prisma.lot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lot_id: 'G1' } }),
      );
      expect(prisma.campusEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            building_id: { in: ['bldg-1', 'bldg-2'] },
          }),
        }),
      );
    });

    it('should return [] when lot has no building associations', async () => {
      prisma.lot.findFirst.mockResolvedValue({
        lot_buildings: [],
      });

      const result = await service.getEventsForLot('G1');

      expect(result).toEqual([]);
      expect(prisma.campusEvent.findMany).not.toHaveBeenCalled();
    });

    it('should return [] when lot is not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      const result = await service.getEventsForLot('UNKNOWN');

      expect(result).toEqual([]);
      expect(prisma.campusEvent.findMany).not.toHaveBeenCalled();
    });

    it('should uppercase the lot_id for the lookup', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      await service.getEventsForLot('g1');

      expect(prisma.lot.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lot_id: 'G1' } }),
      );
    });

    it('uses the default 7-day window when within_hours is omitted', async () => {
      prisma.lot.findFirst.mockResolvedValue({
        lot_buildings: [{ building_id: 'bldg-1' }],
      });
      prisma.campusEvent.findMany.mockResolvedValue([]);

      await service.getEventsForLot('G1');

      const call = prisma.campusEvent.findMany.mock.calls[0][0];
      const start = call.where.start_time.lte as Date;
      const end = call.where.end_time.gte as Date;
      const hours = (start.getTime() - end.getTime()) / (60 * 60 * 1000);
      expect(hours).toBeCloseTo(DEFAULT_EVENTS_WINDOW_HOURS, 0);
    });

    it('honors a caller-supplied within_hours window', async () => {
      prisma.lot.findFirst.mockResolvedValue({
        lot_buildings: [{ building_id: 'bldg-1' }],
      });
      prisma.campusEvent.findMany.mockResolvedValue([]);

      await service.getEventsForLot('G1', 4);

      const call = prisma.campusEvent.findMany.mock.calls[0][0];
      const start = call.where.start_time.lte as Date;
      const end = call.where.end_time.gte as Date;
      const hours = (start.getTime() - end.getTime()) / (60 * 60 * 1000);
      expect(hours).toBeCloseTo(4, 0);
    });

    it('rejects out-of-range within_hours', async () => {
      await expect(service.getEventsForLot('G1', 0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.getEventsForLot('G1', MAX_EVENTS_WINDOW_HOURS + 1),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.getEventsForLot('G1', NaN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.lot.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getEventsSummary', () => {
    it('returns one row per lot, dedupes events linked via multiple buildings', async () => {
      const ev = {
        id: 'ev-1',
        event_name: 'Game',
        location: 'Pyramid',
        start_time: new Date('2026-05-04T20:00:00Z'),
        end_time: new Date('2026-05-04T22:00:00Z'),
      };
      prisma.lot.findMany.mockResolvedValue([
        {
          lot_id: 'G7',
          lot_buildings: [
            { building: { campus_events: [ev] } },
            { building: { campus_events: [ev] } }, // same event via second building
          ],
        },
        {
          lot_id: 'G10',
          lot_buildings: [],
        },
      ]);

      const result = await service.getEventsSummary(2);

      expect(result).toEqual([
        { lot_id: 'G7', count: 1, next_event: ev },
        { lot_id: 'G10', count: 0, next_event: null },
      ]);
    });

    it('sorts events across buildings by start_time when picking next_event', async () => {
      const later = {
        id: 'ev-late', event_name: 'Late', location: 'X',
        start_time: new Date('2026-05-04T22:00:00Z'),
        end_time: new Date('2026-05-04T23:00:00Z'),
      };
      const sooner = {
        id: 'ev-soon', event_name: 'Soon', location: 'Y',
        start_time: new Date('2026-05-04T19:00:00Z'),
        end_time: new Date('2026-05-04T20:00:00Z'),
      };
      prisma.lot.findMany.mockResolvedValue([
        {
          lot_id: 'G7',
          lot_buildings: [
            { building: { campus_events: [later] } },
            { building: { campus_events: [sooner] } },
          ],
        },
      ]);

      const result = await service.getEventsSummary(24);
      expect(result[0].count).toBe(2);
      expect(result[0].next_event).toEqual(sooner);
    });

    it('rejects out-of-range within_hours', async () => {
      await expect(service.getEventsSummary(0)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.getEventsSummary(MAX_EVENTS_WINDOW_HOURS + 1),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.lot.findMany).not.toHaveBeenCalled();
    });
  });

  describe('pruneOldEvents', () => {
    it('deletes events whose end_time is older than the retention window', async () => {
      prisma.campusEvent.deleteMany.mockResolvedValue({ count: 7 });
      const now = new Date('2026-05-04T00:00:00Z');

      const result = await service.pruneOldEvents(90, now);

      const expectedCutoff = new Date('2026-02-03T00:00:00Z');
      expect(prisma.campusEvent.deleteMany).toHaveBeenCalledWith({
        where: { end_time: { lt: expectedCutoff } },
      });
      expect(result).toEqual({ events_deleted: 7, cutoff: expectedCutoff });
    });

    it('defaults `now` to the current time when not provided', async () => {
      prisma.campusEvent.deleteMany.mockResolvedValue({ count: 0 });
      const before = Date.now();

      const result = await service.pruneOldEvents(30);

      const after = Date.now();
      const cutoffMs = result.cutoff.getTime();
      const windowMs = 30 * 24 * 60 * 60 * 1000;
      expect(cutoffMs).toBeGreaterThanOrEqual(before - windowMs);
      expect(cutoffMs).toBeLessThanOrEqual(after - windowMs);
    });

    it('rejects non-numeric or sub-1 retention values', async () => {
      await expect(service.pruneOldEvents(0)).rejects.toThrow(/retentionDays/);
      await expect(service.pruneOldEvents(-5)).rejects.toThrow(/retentionDays/);
      await expect(service.pruneOldEvents(NaN)).rejects.toThrow(/retentionDays/);
      await expect(service.pruneOldEvents(Infinity)).rejects.toThrow(/retentionDays/);
      expect(prisma.campusEvent.deleteMany).not.toHaveBeenCalled();
    });
  });
});
