import { Test, TestingModule } from '@nestjs/testing';
import { ReliabilityController } from './reliability.controller';
import { ReliabilityService } from './reliability.service';
import { ReliabilityComputationService } from './reliability-computation.service';

describe('ReliabilityController', () => {
  let controller: ReliabilityController;
  let reliabilityService: jest.Mocked<ReliabilityService>;
  let computationService: jest.Mocked<ReliabilityComputationService>;

  const mockReliabilityScore = {
    lotId: 'G1',
    score: 85,
    confidence: 'HIGH' as const,
    isColdStart: false,
    computedAt: '2026-02-14T20:00:00.000Z',
    explanation: 'High confidence due to strong penetration rate',
    factors: {
      penetrationRate: {
        name: 'penetrationRate',
        rawValue: 0.7,
        normalizedValue: 0.93,
        weight: 0.35,
        weightedScore: 32.55,
      },
      dataFreshness: {
        name: 'dataFreshness',
        rawValue: 5,
        normalizedValue: 0.83,
        weight: 0.25,
        weightedScore: 20.75,
      },
      eventFrequency: {
        name: 'eventFrequency',
        rawValue: 20,
        normalizedValue: 0.67,
        weight: 0.2,
        weightedScore: 13.4,
      },
      sampleSize: {
        name: 'sampleSize',
        rawValue: 12,
        normalizedValue: 1,
        weight: 0.15,
        weightedScore: 15,
      },
      historicalAccuracy: {
        name: 'historicalAccuracy',
        rawValue: 0.5,
        normalizedValue: 0.5,
        weight: 0.05,
        weightedScore: 2.5,
      },
    },
  };

  const mockScoreSummaries = [
    { lotId: 'G1', score: 85, confidence: 'HIGH' as const, isColdStart: false, computedAt: '2026-02-14T20:00:00.000Z' },
    { lotId: 'G2', score: 55, confidence: 'MEDIUM' as const, isColdStart: false, computedAt: '2026-02-14T20:00:00.000Z' },
    { lotId: 'G3', score: 20, confidence: 'LOW' as const, isColdStart: true, computedAt: '2026-02-14T20:00:00.000Z' },
  ];

  const mockWeights = {
    penetrationRate: 0.35,
    dataFreshness: 0.25,
    eventFrequency: 0.2,
    sampleSize: 0.15,
    historicalAccuracy: 0.05,
  };

  const mockThresholds = {
    highConfidence: 70,
    mediumConfidence: 40,
    penetrationRateTarget: 0.75,
    freshnessWindowMinutes: 30,
    eventFrequencyTarget: 30,
    sampleSizeTarget: 10,
  };

  beforeEach(async () => {
    const mockReliabilityService = {
      computeReliability: jest.fn(),
      computeReliabilitySummary: jest.fn(),
      getDefaultWeights: jest.fn().mockReturnValue(mockWeights),
      getDefaultThresholds: jest.fn().mockReturnValue(mockThresholds),
    };

    const mockComputationService = {
      computeReliabilityForLot: jest.fn(),
      computeReliabilityForAllLots: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReliabilityController],
      providers: [
        { provide: ReliabilityService, useValue: mockReliabilityService },
        { provide: ReliabilityComputationService, useValue: mockComputationService },
      ],
    }).compile();

    controller = module.get<ReliabilityController>(ReliabilityController);
    reliabilityService = module.get(ReliabilityService);
    computationService = module.get(ReliabilityComputationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getLotReliability', () => {
    it('should return reliability score for a specific lot', async () => {
      computationService.computeReliabilityForLot.mockResolvedValue(mockReliabilityScore);

      const result = await controller.getLotReliability('G1');

      expect(result).toEqual(mockReliabilityScore);
      expect(computationService.computeReliabilityForLot).toHaveBeenCalledWith('G1');
    });

    it('should handle different lot IDs', async () => {
      const g2Score = { ...mockReliabilityScore, lotId: 'G2', score: 55 };
      computationService.computeReliabilityForLot.mockResolvedValue(g2Score);

      const result = await controller.getLotReliability('G2');

      expect(result.lotId).toBe('G2');
      expect(computationService.computeReliabilityForLot).toHaveBeenCalledWith('G2');
    });
  });

  describe('getAllLotsReliability', () => {
    it('should return reliability summaries for all lots', async () => {
      computationService.computeReliabilityForAllLots.mockResolvedValue(mockScoreSummaries);

      const result = await controller.getAllLotsReliability();

      expect(result).toEqual(mockScoreSummaries);
      expect(result).toHaveLength(3);
      expect(computationService.computeReliabilityForAllLots).toHaveBeenCalled();
    });

    it('should return empty array when no lots exist', async () => {
      computationService.computeReliabilityForAllLots.mockResolvedValue([]);

      const result = await controller.getAllLotsReliability();

      expect(result).toEqual([]);
    });
  });

  describe('getConfiguration', () => {
    it('should return weights and thresholds', () => {
      const result = controller.getConfiguration();

      expect(result.weights).toEqual(mockWeights);
      expect(result.thresholds).toEqual(mockThresholds);
      expect(reliabilityService.getDefaultWeights).toHaveBeenCalled();
      expect(reliabilityService.getDefaultThresholds).toHaveBeenCalled();
    });

    it('should have correct weight values summing to 1', () => {
      const result = controller.getConfiguration();
      const weightSum = Object.values(result.weights).reduce((sum, w) => sum + w, 0);

      expect(weightSum).toBeCloseTo(1.0);
    });

    it('should have thresholds where high > medium', () => {
      const result = controller.getConfiguration();

      expect(result.thresholds.highConfidence).toBeGreaterThan(result.thresholds.mediumConfidence);
    });
  });
});
