import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ReliabilityComputationService } from './reliability-computation.service';
import { ReliabilityService } from './reliability.service';
import { PrismaService } from '../database/database.module';

describe('ReliabilityComputationService', () => {
  let service: ReliabilityComputationService;
  let prisma: {
    lot: { findFirst: jest.Mock; findMany: jest.Mock };
    occupancyEvent: { findMany: jest.Mock };
    predictionShortTerm: { findMany: jest.Mock };
    occupancySnapshot: { findMany: jest.Mock };
    report: { findMany: jest.Mock; groupBy: jest.Mock };
  };
  let reliabilityService: jest.Mocked<ReliabilityService>;

  const mockLot = {
    id: 'lot-uuid-1',
    lot_id: 'G1',
    lot_name: 'Lot G1',
    capacity: 100,
    current_occupancy: 50,
  };

  const mockReliabilityScore = {
    lotId: 'G1',
    score: 75,
    confidence: 'HIGH' as const,
    isColdStart: false,
    computedAt: '2026-02-14T20:00:00.000Z',
    explanation: 'High confidence',
    factors: {
      penetrationRate: { name: 'penetrationRate', rawValue: 0.65, normalizedValue: 0.87, weight: 0.3, weightedScore: 26.1 },
      dataFreshness: { name: 'dataFreshness', rawValue: 5, normalizedValue: 0.83, weight: 0.21, weightedScore: 17.43 },
      eventFrequency: { name: 'eventFrequency', rawValue: 3, normalizedValue: 0.1, weight: 0.17, weightedScore: 1.7 },
      sampleSize: { name: 'sampleSize', rawValue: 2, normalizedValue: 0.2, weight: 0.13, weightedScore: 2.6 },
      historicalAccuracy: { name: 'historicalAccuracy', rawValue: 0.5, normalizedValue: 0.5, weight: 0.04, weightedScore: 2 },
      userReports: { name: 'User Reports', rawValue: 0, normalizedValue: 1, weight: 0.15, weightedScore: 15 },
    },
  };

  const mockScoreSummary = {
    lotId: 'G1',
    score: 75,
    confidence: 'HIGH' as const,
    isColdStart: false,
    computedAt: '2026-02-14T20:00:00.000Z',
  };

  beforeEach(async () => {
    prisma = {
      lot: { findFirst: jest.fn(), findMany: jest.fn() },
      occupancyEvent: { findMany: jest.fn() },
      predictionShortTerm: { findMany: jest.fn().mockResolvedValue([]) },
      occupancySnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      report: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };

    const mockReliabilityService = {
      computeReliability: jest.fn().mockReturnValue(mockReliabilityScore),
      computeReliabilitySummary: jest.fn().mockReturnValue(mockScoreSummary),
      getDefaultWeights: jest.fn(),
      getDefaultThresholds: jest.fn().mockReturnValue({ userReportsWindowMinutes: 60 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReliabilityComputationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReliabilityService, useValue: mockReliabilityService },
      ],
    }).compile();

    service = module.get<ReliabilityComputationService>(ReliabilityComputationService);
    reliabilityService = module.get(ReliabilityService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeReliabilityForLot', () => {
    it('should compute reliability score for a valid lot', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue([
        { device_hash: 'hash1', event_type: 'ENTER', timestamp: new Date('2026-02-14T19:30:00Z') },
        { device_hash: 'hash2', event_type: 'ENTER', timestamp: new Date('2026-02-14T19:45:00Z') },
        { device_hash: 'hash1', event_type: 'EXIT', timestamp: new Date('2026-02-14T19:55:00Z') },
      ]);

      const result = await service.computeReliabilityForLot('G1');

      expect(result).toEqual(mockReliabilityScore);
      expect(reliabilityService.computeReliability).toHaveBeenCalledWith(
        'G1',
        expect.objectContaining({
          penetrationRate: 0.01,
          eventsInLastHour: expect.any(Number),
          minutesSinceLastEvent: expect.any(Number),
          uniqueDevicesInLastHour: expect.any(Number),
          historicalAccuracy: null,
        }),
        undefined,
        expect.any(Object),
      );
    });

    it('should throw NotFoundException for non-existent lot', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(service.computeReliabilityForLot('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should handle lot with no recent events', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue([]);

      await service.computeReliabilityForLot('G1');

      expect(reliabilityService.computeReliability).toHaveBeenCalledWith(
        'G1',
        expect.objectContaining({
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
        }),
        undefined,
        expect.any(Object),
      );
    });

    it('should pass distinct reporter count from the report query', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue([]);
      prisma.report.findMany.mockResolvedValue([
        { user_id: 'u1' },
        { user_id: 'u2' },
        { user_id: 'u3' },
      ]);

      await service.computeReliabilityForLot('G1');

      expect(prisma.report.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ distinct: ['user_id'] }),
      );
      expect(reliabilityService.computeReliability).toHaveBeenCalledWith(
        'G1',
        expect.objectContaining({ uniqueReportersInWindow: 3 }),
        undefined,
        expect.any(Object),
      );
    });

    it('should use userReportsWindowMinutes threshold for the report query window', async () => {
      reliabilityService.getDefaultThresholds.mockReturnValue({ userReportsWindowMinutes: 30 } as never);
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue([]);

      const before = Date.now();
      await service.computeReliabilityForLot('G1');
      const after = Date.now();

      const call = prisma.report.findMany.mock.calls[0][0];
      const gte: Date = call.where.created_at.gte;
      const lte: Date = call.where.created_at.lte;
      const windowMs = lte.getTime() - gte.getTime();
      
      expect(windowMs).toBe(30 * 60 * 1000);
      expect(lte.getTime()).toBeGreaterThanOrEqual(before);
      expect(lte.getTime()).toBeLessThanOrEqual(after);
    });

    it('should calculate unique devices correctly', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue([
        { device_hash: 'same-hash', event_type: 'ENTER', timestamp: new Date() },
        { device_hash: 'same-hash', event_type: 'EXIT', timestamp: new Date() },
        { device_hash: 'different-hash', event_type: 'ENTER', timestamp: new Date() },
      ]);

      await service.computeReliabilityForLot('G1');

      expect(reliabilityService.computeReliability).toHaveBeenCalledWith(
        'G1',
        expect.objectContaining({
          uniqueDevicesInLastHour: 2,
        }),
        undefined,
        expect.any(Object),
      );
    });
  });

  describe('computeReliabilityForAllLots', () => {
    it('should compute reliability for all lots', async () => {
      const allLots = [
        { ...mockLot, lot_id: 'G1' },
        { ...mockLot, id: 'lot-uuid-2', lot_id: 'G2' },
      ];

      prisma.lot.findMany.mockResolvedValue(allLots);
      prisma.occupancyEvent.findMany.mockResolvedValue([]);

      const result = await service.computeReliabilityForAllLots();

      expect(result).toHaveLength(2);
      expect(reliabilityService.computeReliabilitySummary).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no lots exist', async () => {
      prisma.lot.findMany.mockResolvedValue([]);

      const result = await service.computeReliabilityForAllLots();

      expect(result).toEqual([]);
    });

    it('should handle errors for individual lots gracefully', async () => {
      prisma.lot.findMany.mockResolvedValue([mockLot]);
      prisma.occupancyEvent.findMany.mockResolvedValue([]);

      reliabilityService.computeReliabilitySummary.mockImplementation(() => {
        throw new Error('Computation failed');
      });

      const result = await service.computeReliabilityForAllLots();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        lotId: 'G1',
        score: 0,
        confidence: 'LOW',
        isColdStart: true,
      }));
    });
  });

  describe('computeAccuracyFromSamples (private)', () => {
    // Tested directly via bracket access — recency weighting and binary search
    // aren't exercised by the public-path mocks.
    const callHelper = (
      predictions: Array<{ target_time: Date; predicted_occupancy: number }>,
      snapshots: Array<{ timestamp: Date; occupancy_rate: number }>,
      now: Date,
    ): number | null =>
      (service as unknown as {
        computeAccuracyFromSamples: (
          p: typeof predictions,
          s: typeof snapshots,
          n: Date,
        ) => number | null;
      }).computeAccuracyFromSamples(predictions, snapshots, now);

    const buildPair = (target: Date, predicted: number, actual: number) => ({
      prediction: { target_time: target, predicted_occupancy: predicted },
      snapshot: { timestamp: target, occupancy_rate: actual },
    });

    it('returns null when fewer than 10 predictions', () => {
      const now = new Date('2026-05-02T12:00:00Z');
      const pairs = Array.from({ length: 9 }, (_, i) =>
        buildPair(new Date(now.getTime() - i * 60 * 60 * 1000), 0.5, 0.5),
      );

      const result = callHelper(
        pairs.map((p) => p.prediction),
        pairs.map((p) => p.snapshot),
        now,
      );

      expect(result).toBeNull();
    });

    it('weights recent predictions more heavily than old ones', () => {
      const now = new Date('2026-05-02T12:00:00Z');
      const dayMs = 24 * 60 * 60 * 1000;

      // Scenario A: recent predictions perfect, old predictions terrible.
      // Recency weight should pull MAPE down (high accuracy).
      const recentPerfect = Array.from({ length: 10 }, (_, i) =>
        buildPair(new Date(now.getTime() - i * 60 * 60 * 1000), 0.5, 0.5),
      );
      const oldTerrible = Array.from({ length: 10 }, (_, i) =>
        buildPair(new Date(now.getTime() - (5 + i * 0.05) * dayMs), 0.9, 0.5),
      );
      const scenarioA = [...recentPerfect, ...oldTerrible];

      // Scenario B: same predictions, swapped roles (recent terrible, old perfect).
      // Recency weight should push MAPE up (low accuracy).
      const recentTerrible = Array.from({ length: 10 }, (_, i) =>
        buildPair(new Date(now.getTime() - i * 60 * 60 * 1000), 0.9, 0.5),
      );
      const oldPerfect = Array.from({ length: 10 }, (_, i) =>
        buildPair(new Date(now.getTime() - (5 + i * 0.05) * dayMs), 0.5, 0.5),
      );
      const scenarioB = [...recentTerrible, ...oldPerfect];

      const accuracyA = callHelper(
        scenarioA.map((p) => p.prediction),
        scenarioA.map((p) => p.snapshot),
        now,
      );
      const accuracyB = callHelper(
        scenarioB.map((p) => p.prediction),
        scenarioB.map((p) => p.snapshot),
        now,
      );

      expect(accuracyA).not.toBeNull();
      expect(accuracyB).not.toBeNull();
      // Same prediction set, same errors — only the temporal distribution differs.
      // Without recency weighting these would be equal; the gap proves weighting works.
      expect(accuracyA!).toBeGreaterThan(accuracyB!);
    });

    it('finds closest snapshot via binary search regardless of input order', () => {
      const now = new Date('2026-05-02T12:00:00Z');
      const target = new Date('2026-05-02T10:00:00Z');

      // 10 perfect predictions all matching the same target — predicted == actual.
      const predictions = Array.from({ length: 10 }, (_, i) => ({
        target_time: new Date(target.getTime() - i * 60 * 1000),
        predicted_occupancy: 0.5,
      }));

      // Snapshots scattered around target time
      const snapshots = [
        { timestamp: new Date(target.getTime() + 30 * 60 * 1000), occupancy_rate: 0.9 },
        { timestamp: new Date(target.getTime()), occupancy_rate: 0.5 },
        { timestamp: new Date(target.getTime() - 30 * 60 * 1000), occupancy_rate: 0.1 },
      ];
      
      // Generate enough snapshots to actually match each prediction within 10min
      const denseSnapshots = predictions.map((p) => ({
        timestamp: p.target_time,
        occupancy_rate: 0.5,
      }));

      const result = callHelper(predictions, [...snapshots, ...denseSnapshots].reverse(), now);

      expect(result).not.toBeNull();
      expect(result).toBe(1); // perfect prediction -> 1
    });
  });
});
