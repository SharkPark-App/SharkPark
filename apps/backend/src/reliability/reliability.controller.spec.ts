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
        weight: 0.3,
        weightedScore: 27.9,
      },
      dataFreshness: {
        name: 'dataFreshness',
        rawValue: 5,
        normalizedValue: 0.83,
        weight: 0.21,
        weightedScore: 17.43,
      },
      eventFrequency: {
        name: 'eventFrequency',
        rawValue: 20,
        normalizedValue: 0.67,
        weight: 0.17,
        weightedScore: 11.39,
      },
      sampleSize: {
        name: 'sampleSize',
        rawValue: 12,
        normalizedValue: 1,
        weight: 0.13,
        weightedScore: 13,
      },
      historicalAccuracy: {
        name: 'historicalAccuracy',
        rawValue: 0.5,
        normalizedValue: 0.5,
        weight: 0.04,
        weightedScore: 2,
      },
      userReports: {
        name: 'User Reports',
        rawValue: 0,
        normalizedValue: 1,
        weight: 0.15,
        weightedScore: 15,
      },
    },
  };

  const mockScoreSummaries = [
    { lotId: 'G1', score: 85, confidence: 'HIGH' as const, isColdStart: false, computedAt: '2026-02-14T20:00:00.000Z' },
    { lotId: 'G2', score: 55, confidence: 'MEDIUM' as const, isColdStart: false, computedAt: '2026-02-14T20:00:00.000Z' },
    { lotId: 'G3', score: 20, confidence: 'LOW' as const, isColdStart: true, computedAt: '2026-02-14T20:00:00.000Z' },
  ];

  const mockWeights = {
    penetrationRate: 0.3,
    dataFreshness: 0.21,
    eventFrequency: 0.17,
    sampleSize: 0.13,
    historicalAccuracy: 0.04,
    userReports: 0.15,
  };

  const mockThresholds = {
    highConfidence: 70,
    mediumConfidence: 40,
    penetrationRateTarget: 0.75,
    freshnessWindowMinutes: 30,
    eventFrequencyTarget: 30,
    sampleSizeTarget: 10,
    userReportsTarget: 5,
    userReportsWindowMinutes: 60,
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

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockReliabilityScore);
      expect(computationService.computeReliabilityForLot).toHaveBeenCalledWith('G1');
    });

    it('should handle different lot IDs', async () => {
      const g2Score = { ...mockReliabilityScore, lotId: 'G2', score: 55 };
      computationService.computeReliabilityForLot.mockResolvedValue(g2Score);

      const result = await controller.getLotReliability('G2');

      expect(result.success).toBe(true);
      expect(result.data.lotId).toBe('G2');
      expect(computationService.computeReliabilityForLot).toHaveBeenCalledWith('G2');
    });
  });

  describe('getAllLotsReliability', () => {
    it('should return reliability summaries for all lots', async () => {
      computationService.computeReliabilityForAllLots.mockResolvedValue(mockScoreSummaries);

      const result = await controller.getAllLotsReliability();

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockScoreSummaries);
      expect(result.data).toHaveLength(3);
      expect(computationService.computeReliabilityForAllLots).toHaveBeenCalled();
    });

    it('should return empty array when no lots exist', async () => {
      computationService.computeReliabilityForAllLots.mockResolvedValue([]);

      const result = await controller.getAllLotsReliability();

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('getConfiguration', () => {
    it('should return weights and thresholds', () => {
      const result = controller.getConfiguration();

      expect(result.success).toBe(true);
      expect(result.data.weights).toEqual(mockWeights);
      expect(result.data.thresholds).toEqual(mockThresholds);
      expect(reliabilityService.getDefaultWeights).toHaveBeenCalled();
      expect(reliabilityService.getDefaultThresholds).toHaveBeenCalled();
    });

    it('should have correct weight values summing to 1', () => {
      const result = controller.getConfiguration();
      const weightSum = Object.values(result.data.weights).reduce((sum: number, w: number) => sum + w, 0);

      expect(weightSum).toBeCloseTo(1.0);
    });

    it('should have thresholds where high > medium', () => {
      const result = controller.getConfiguration();

      expect(result.data.thresholds.highConfidence).toBeGreaterThan(result.data.thresholds.mediumConfidence);
    });
  });
});
