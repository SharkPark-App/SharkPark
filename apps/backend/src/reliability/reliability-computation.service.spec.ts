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
    occupancySnapshot: { findFirst: jest.Mock };
  };
  let reliabilityService: jest.Mocked<ReliabilityService>;

  const mockLot = {
    id: 'lot-uuid-1',
    lot_id: 'G1',
    lot_name: 'Lot G1',
    capacity: 100,
    penetration_rate: 0.65,
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
      penetrationRate: { name: 'penetrationRate', rawValue: 0.65, normalizedValue: 0.87, weight: 0.35, weightedScore: 30.45 },
      dataFreshness: { name: 'dataFreshness', rawValue: 5, normalizedValue: 0.83, weight: 0.25, weightedScore: 20.75 },
      eventFrequency: { name: 'eventFrequency', rawValue: 3, normalizedValue: 0.1, weight: 0.2, weightedScore: 2 },
      sampleSize: { name: 'sampleSize', rawValue: 2, normalizedValue: 0.2, weight: 0.15, weightedScore: 3 },
      historicalAccuracy: { name: 'historicalAccuracy', rawValue: 0.5, normalizedValue: 0.5, weight: 0.05, weightedScore: 2.5 },
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
      occupancySnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const mockReliabilityService = {
      computeReliability: jest.fn().mockReturnValue(mockReliabilityScore),
      computeReliabilitySummary: jest.fn().mockReturnValue(mockScoreSummary),
      getDefaultWeights: jest.fn(),
      getDefaultThresholds: jest.fn(),
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
      expect(reliabilityService.computeReliability).toHaveBeenCalledWith('G1', expect.objectContaining({
        penetrationRate: 0.65,
        eventsInLastHour: expect.any(Number),
        minutesSinceLastEvent: expect.any(Number),
        uniqueDevicesInLastHour: expect.any(Number),
        historicalAccuracy: null,
      }));
    });

    it('should throw NotFoundException for non-existent lot', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(service.computeReliabilityForLot('INVALID')).rejects.toThrow(NotFoundException);
    });

    it('should handle lot with no recent events', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue([]);

      await service.computeReliabilityForLot('G1');

      expect(reliabilityService.computeReliability).toHaveBeenCalledWith('G1', expect.objectContaining({
        eventsInLastHour: 0,
        uniqueDevicesInLastHour: 0,
      }));
    });

    it('should calculate unique devices correctly', async () => {
      prisma.lot.findFirst.mockResolvedValue(mockLot);
      prisma.occupancyEvent.findMany.mockResolvedValue([
        { device_hash: 'same-hash', event_type: 'ENTER', timestamp: new Date() },
        { device_hash: 'same-hash', event_type: 'EXIT', timestamp: new Date() },
        { device_hash: 'different-hash', event_type: 'ENTER', timestamp: new Date() },
      ]);

      await service.computeReliabilityForLot('G1');

      expect(reliabilityService.computeReliability).toHaveBeenCalledWith('G1', expect.objectContaining({
        uniqueDevicesInLastHour: 2,
      }));
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
});
