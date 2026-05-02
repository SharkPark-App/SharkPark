import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { PrismaService } from '../database/database.module';

describe('EventsService', () => {
  let service: EventsService;
  let prisma: {
    lot: { findFirst: jest.Mock };
    campusEvent: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      lot: { findFirst: jest.fn() },
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
  });
});
