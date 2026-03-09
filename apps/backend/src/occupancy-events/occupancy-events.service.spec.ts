import { Test, TestingModule } from '@nestjs/testing';
import { OccupancyEventsService } from './occupancy-events.service';
import { PrismaService } from '../database/database.module';
import { ReliabilityService } from '../reliability/reliability.service';
import { ReliabilityComputationService } from '../reliability/reliability-computation.service';

describe('OccupancyEventsService', () => {
  let service: OccupancyEventsService;
  let prisma: {
    lot: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    occupancyEvent: { create: jest.Mock; findMany: jest.Mock };
    occupancySnapshot: { create: jest.Mock; findMany: jest.Mock };
    deviceState: { findUnique: jest.Mock; upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockReliabilityService: {
    computeReliabilitySummary: jest.Mock;
  };
  let mockReliabilityComputationService: {
    computeReliability: jest.Mock;
    gatherReliabilityInput: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      lot: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      occupancyEvent: { create: jest.fn(), findMany: jest.fn() },
      occupancySnapshot: { create: jest.fn(), findMany: jest.fn() },
      deviceState: { findUnique: jest.fn(), upsert: jest.fn() },
      $transaction: jest.fn(),
    };

    mockReliabilityService = {
      computeReliabilitySummary: jest.fn().mockReturnValue({
        lotId: 'test-lot',
        score: 50,
        confidence: 'MEDIUM',
        isColdStart: false,
        computedAt: new Date().toISOString(),
      }),
    };

    mockReliabilityComputationService = {
      computeReliability: jest.fn().mockReturnValue(50),
      gatherReliabilityInput: jest.fn().mockResolvedValue({
        penetrationRate: 0.8,
        eventCount: 10,
        lastEventAge: 5,
        snapshotConsistency: 0.9,
        isCampusOpen: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OccupancyEventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReliabilityService, useValue: mockReliabilityService },
        { provide: ReliabilityComputationService, useValue: mockReliabilityComputationService },
      ],
    }).compile();

    service = module.get<OccupancyEventsService>(OccupancyEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    const validDto = {
      lot_id: 'G1',
      event_type: 'ENTER' as const,
      device_id: 'test-device-123',
      timestamp: '2026-02-07T14:30:00.000Z',
    };

    const mockLot = {
      id: 'lot-uuid-1',
      lot_id: 'G1',
      capacity: 100,
      current_occupancy: 50,
      penetration_rate: 0.65,
    };

    it('should create an event and update occupancy for ENTER', async () => {
      // No duplicate found
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.deviceState.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) => {
        await fn(prisma);
      });

      const result = await service.create(validDto);

      expect(result.lot_id).toBe('G1');
      expect(result.event_type).toBe('ENTER');
      expect(result.deduplicated).toBe(false);
      expect(result.event_id).toBeDefined();
    });

    it('should create an event and decrement occupancy for EXIT', async () => {
      const exitDto = { ...validDto, event_type: 'EXIT' as const };

      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.deviceState.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) => {
        await fn(prisma);
      });

      const result = await service.create(exitDto);

      expect(result.event_type).toBe('EXIT');
      expect(result.deduplicated).toBe(false);
    });

    it('should return deduplicated=true when duplicate detected', async () => {
      // Duplicate found: device last event was also ENTER
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.deviceState.findUnique.mockResolvedValue({
        device_hash: 'some-hash',
        lot_id: 'lot-uuid-1',
        last_event_type: 'ENTER',
      });

      const result = await service.create(validDto);

      expect(result.deduplicated).toBe(true);
      // Transaction should NOT be called for duplicates
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle device hash consistently', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.deviceState.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) => {
        await fn(prisma);
      });

      const result1 = await service.create(validDto);

      prisma.deviceState.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<void>) => {
        await fn(prisma);
      });

      const result2 = await service.create(validDto);

      expect(result1.lot_id).toBe(result2.lot_id);
    });

    it('should throw InternalServerErrorException on database error', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.deviceState.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(new Error('Database error'));

      await expect(service.create(validDto)).rejects.toThrow('Failed to record occupancy event');
    });
  });

  describe('findByLot', () => {
    it('should return events for a lot within date range', async () => {
      const mockLot = { id: 'lot-uuid-1', lot_id: 'G1' };
      const mockEvents = [
        { id: '1', lot_id: 'lot-uuid-1', event_type: 'ENTER', timestamp: new Date('2026-02-07T10:00:00Z'), device_hash: 'h1' },
        { id: '2', lot_id: 'lot-uuid-1', event_type: 'EXIT', timestamp: new Date('2026-02-07T12:00:00Z'), device_hash: 'h2' },
      ];

      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.findByLot('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(result).toHaveLength(2);
      expect(result[0].event_type).toBe('ENTER');
      expect(result[1].event_type).toBe('EXIT');
    });

    it('should return empty array when no events found', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: 'lot-uuid-1', lot_id: 'G1' });
      prisma.occupancyEvent.findMany.mockResolvedValue([]);

      const result = await service.findByLot('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(result).toEqual([]);
    });

    it('should return empty array when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      const result = await service.findByLot('INVALID', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(result).toEqual([]);
    });

    it('should throw InternalServerErrorException on error', async () => {
      prisma.lot.findFirst.mockRejectedValue(new Error('Query failed'));

      await expect(service.findByLot('G1', '2026-02-07', '2026-02-07T23:59:59Z'))
        .rejects.toThrow('Failed to fetch events for lot G1');
    });
  });

  describe('getEventStats', () => {
    it('should calculate correct statistics', async () => {
      const mockLot = { id: 'lot-uuid-1', lot_id: 'G1' };
      const mockEvents = [
        { event_type: 'ENTER', timestamp: new Date(), device_hash: 'h1' },
        { event_type: 'ENTER', timestamp: new Date(), device_hash: 'h2' },
        { event_type: 'EXIT', timestamp: new Date(), device_hash: 'h3' },
      ];

      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue(mockEvents);

      const stats = await service.getEventStats('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(stats.total_enters).toBe(2);
      expect(stats.total_exits).toBe(1);
      expect(stats.net_change).toBe(1);
    });

    it('should handle empty events', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: 'lot-uuid-1', lot_id: 'G1' });
      prisma.occupancyEvent.findMany.mockResolvedValue([]);

      const stats = await service.getEventStats('G1', '2026-02-07', '2026-02-07T23:59:59Z');

      expect(stats.total_enters).toBe(0);
      expect(stats.total_exits).toBe(0);
      expect(stats.net_change).toBe(0);
    });
  });

  describe('createSnapshots', () => {
    it('should create snapshots for all lots', async () => {
      const mockLots = [
        { id: 'lot-uuid-1', lot_id: 'G1', current_occupancy: 50, capacity: 100, penetration_rate: 0.8 },
        { id: 'lot-uuid-2', lot_id: 'E7', current_occupancy: 30, capacity: 80, penetration_rate: 0.5 },
      ];

      prisma.lot.findMany.mockResolvedValue(mockLots);
      prisma.occupancyEvent.findMany.mockResolvedValue([]);
      prisma.occupancySnapshot.create.mockResolvedValue({});

      const result = await service.createSnapshots();

      expect(result.count).toBe(2);
      expect(result.timestamp).toBeDefined();
      expect(prisma.occupancySnapshot.create).toHaveBeenCalledTimes(2);
    });

    it('should throw InternalServerErrorException on error', async () => {
      prisma.lot.findMany.mockRejectedValue(new Error('Query failed'));

      await expect(service.createSnapshots()).rejects.toThrow('Failed to create occupancy snapshots');
    });
  });

  describe('getSnapshots', () => {
    it('should return snapshots for a lot on a specific date', async () => {
      const mockLot = { id: 'lot-uuid-1', lot_id: 'G1' };
      const mockSnapshots = [
        { lot_id: 'lot-uuid-1', timestamp: new Date('2026-02-07T10:00:00Z'), occupancy: 50 },
        { lot_id: 'lot-uuid-1', timestamp: new Date('2026-02-07T10:15:00Z'), occupancy: 52 },
      ];

      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancySnapshot.findMany.mockResolvedValue(mockSnapshots);

      const result = await service.getSnapshots('G1', '2026-02-07');

      expect(result).toHaveLength(2);
    });

    it('should return empty array when lot not found', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      const result = await service.getSnapshots('INVALID', '2026-02-07');

      expect(result).toEqual([]);
    });

    it('should throw InternalServerErrorException on error', async () => {
      prisma.lot.findFirst.mockRejectedValue(new Error('Query failed'));

      await expect(service.getSnapshots('G1', '2026-02-07'))
        .rejects.toThrow('Failed to fetch snapshots for lot G1');
    });
  });
});
