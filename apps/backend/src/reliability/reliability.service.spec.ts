import { Test, TestingModule } from '@nestjs/testing';
import { ReliabilityService } from './reliability.service';
import {
  ReliabilityInput,
  ReliabilityWeights,
  ReliabilityThresholds,
} from './interfaces';

describe('ReliabilityService', () => {
  let service: ReliabilityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReliabilityService],
    }).compile();

    service = module.get<ReliabilityService>(ReliabilityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeReliability', () => {
    describe('confidence levels', () => {
      it('should return HIGH confidence for excellent input data', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.6,
          minutesSinceLastEvent: 5,
          eventsInLastHour: 15,
          uniqueDevicesInLastHour: 25,
          historicalAccuracy: 0.9,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-1', input);

        expect(result.confidence).toBe('HIGH');
        expect(result.score).toBeGreaterThanOrEqual(70);
        expect(result.isColdStart).toBe(false);
      });

      it('should return MEDIUM confidence for moderate input data', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.25,
          minutesSinceLastEvent: 30,
          eventsInLastHour: 5,
          uniqueDevicesInLastHour: 10,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-2', input);

        expect(result.confidence).toBe('MEDIUM');
        expect(result.score).toBeGreaterThanOrEqual(40);
        expect(result.score).toBeLessThan(70);
      });

      it('should return LOW confidence for poor input data', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.05,
          minutesSinceLastEvent: 55,
          eventsInLastHour: 2,
          uniqueDevicesInLastHour: 2,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-3', input);

        expect(result.confidence).toBe('LOW');
        expect(result.score).toBeLessThan(40);
      });
    });

    describe('cold-start detection', () => {
      it('should detect cold-start when penetration rate is very low', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.04, // < 10% of 0.5 target
          minutesSinceLastEvent: 10,
          eventsInLastHour: 5,
          uniqueDevicesInLastHour: 5,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-cold-1', input);
        expect(result.isColdStart).toBe(true);
        expect(result.explanation).toContain('Limited data');
      });

      it('should detect cold-start when very few events', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.3,
          minutesSinceLastEvent: 10,
          eventsInLastHour: 1, // < 2 events
          uniqueDevicesInLastHour: 1,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-cold-2', input);
        expect(result.isColdStart).toBe(true);
      });

      it('should detect cold-start when very few unique devices', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.3,
          minutesSinceLastEvent: 10,
          eventsInLastHour: 5,
          uniqueDevicesInLastHour: 2, // < 3 devices
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-cold-3', input);
        expect(result.isColdStart).toBe(true);
      });

      it('should detect cold-start when data is stale', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.3,
          minutesSinceLastEvent: 130, // > 2x 60 min window
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-cold-4', input);
        expect(result.isColdStart).toBe(true);
      });

      it('should not be cold-start with sufficient data', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.3,
          minutesSinceLastEvent: 10,
          eventsInLastHour: 8,
          uniqueDevicesInLastHour: 6,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-warm', input);
        expect(result.isColdStart).toBe(false);
      });
    });

    describe('factor scoring', () => {
      it('should compute penetration rate factor correctly', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.25, // 50% of 0.5 target
          minutesSinceLastEvent: 0,
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-pen', input);
        const penFactor = result.factors.penetrationRate;

        expect(penFactor.rawValue).toBe(0.25);
        expect(penFactor.normalizedValue).toBe(0.5);
        expect(penFactor.weight).toBe(0.3);
        expect(penFactor.weightedScore).toBeCloseTo(0.15, 3);
      });

      it('should cap penetration rate factor at 1.0', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.8, // > 0.5 target
          minutesSinceLastEvent: 0,
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-high-pen', input);
        expect(result.factors.penetrationRate.normalizedValue).toBe(1.0);
      });

      it('should compute data freshness factor correctly', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0,
          minutesSinceLastEvent: 30, // 50% of 60 min window
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-fresh', input);
        const freshFactor = result.factors.dataFreshness;

        expect(freshFactor.rawValue).toBe(30);
        expect(freshFactor.normalizedValue).toBe(0.5);
        expect(freshFactor.weight).toBe(0.21);
        expect(freshFactor.weightedScore).toBeCloseTo(0.105, 3);
      });

      it('should return 0 freshness for stale data', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0,
          minutesSinceLastEvent: 70, // > 60 min window
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-stale', input);
        expect(result.factors.dataFreshness.normalizedValue).toBe(0);
      });

      it('should compute event frequency factor correctly', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0,
          minutesSinceLastEvent: 0,
          eventsInLastHour: 5, // 50% of 10 target
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-freq', input);
        const freqFactor = result.factors.eventFrequency;

        expect(freqFactor.rawValue).toBe(5);
        expect(freqFactor.normalizedValue).toBe(0.5);
      });

      it('should compute sample size factor correctly', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0,
          minutesSinceLastEvent: 0,
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 10, // 50% of 20 target
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-sample', input);
        const sampleFactor = result.factors.sampleSize;

        expect(sampleFactor.rawValue).toBe(10);
        expect(sampleFactor.normalizedValue).toBe(0.5);
      });

      it('should use neutral value for historical accuracy when null', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0,
          minutesSinceLastEvent: 0,
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-no-hist', input);
        const histFactor = result.factors.historicalAccuracy;

        expect(histFactor.rawValue).toBe(-1); // Indicates no data
        expect(histFactor.normalizedValue).toBe(0.5); // Neutral
      });

      it('should use actual historical accuracy when provided', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0,
          minutesSinceLastEvent: 0,
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: 0.85,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-hist', input);
        expect(result.factors.historicalAccuracy.normalizedValue).toBe(0.85);
      });
    });

    describe('score calculation', () => {
      it('should compute total score as sum of weighted factors', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.5, // 100% normalized
          minutesSinceLastEvent: 0, // 100% freshness
          eventsInLastHour: 10, // 100% frequency
          uniqueDevicesInLastHour: 20, // 100% sample
          historicalAccuracy: 1.0, // 100% accuracy
          uniqueReportersInWindow: 0, // 100% userReports
        };

        const result = service.computeReliability('lot-perfect', input);

        // All factors at max = score of 100
        expect(result.score).toBe(100);
        expect(result.confidence).toBe('HIGH');
      });

      it('should compute score of 0 for all zero inputs', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0,
          minutesSinceLastEvent: 120, // Stale (0% freshness)
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: 0,
          // Reporters at the target zeroes out the userReports factor too,
          // matching the test's "all zero inputs" intent.
          uniqueReportersInWindow: 5,
        };

        const result = service.computeReliability('lot-zero', input);
        expect(result.score).toBe(0);
        expect(result.confidence).toBe('LOW');
      });
    });

    describe('explanation generation', () => {
      it('should explain cold-start mode', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.02,
          minutesSinceLastEvent: 10,
          eventsInLastHour: 1,
          uniqueDevicesInLastHour: 1,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-cold', input);
        expect(result.explanation).toContain('Limited data');
      });

      it('should explain HIGH confidence', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.6,
          minutesSinceLastEvent: 5,
          eventsInLastHour: 15,
          uniqueDevicesInLastHour: 25,
          historicalAccuracy: 0.9,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-high', input);
        expect(result.explanation).toContain('High confidence');
      });

      it('should explain MEDIUM confidence with weakest factor', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.4,
          minutesSinceLastEvent: 10,
          eventsInLastHour: 2, // This is the weakest
          uniqueDevicesInLastHour: 10,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const result = service.computeReliability('lot-med', input);
        expect(result.explanation).toContain('Moderate confidence');
      });
    });

    describe('custom weights and thresholds', () => {
      it('should accept custom weights', () => {
        const input: ReliabilityInput = {
          penetrationRate: 1.0,
          minutesSinceLastEvent: 0,
          eventsInLastHour: 0,
          uniqueDevicesInLastHour: 0,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const customWeights: ReliabilityWeights = {
          penetrationRate: 1.0, // 100% weight on penetration rate
          dataFreshness: 0,
          eventFrequency: 0,
          sampleSize: 0,
          historicalAccuracy: 0,
          userReports: 0,
        };

        const result = service.computeReliability(
          'lot-custom',
          input,
          customWeights,
        );

        // Score should be 100% since only penetration rate matters and it's at max
        expect(result.score).toBe(100);
      });

      it('should accept custom thresholds', () => {
        const input: ReliabilityInput = {
          penetrationRate: 0.3,
          minutesSinceLastEvent: 20,
          eventsInLastHour: 5,
          uniqueDevicesInLastHour: 10,
          historicalAccuracy: null,
          uniqueReportersInWindow: 0,
        };

        const customThresholds: ReliabilityThresholds = {
          highConfidence: 30, // Lower threshold
          mediumConfidence: 20,
          penetrationRateTarget: 0.5,
          freshnessWindowMinutes: 60,
          eventFrequencyTarget: 10,
          sampleSizeTarget: 20,
          userReportsTarget: 5,
          userReportsWindowMinutes: 60,
        };

        const result = service.computeReliability(
          'lot-custom-thresh',
          input,
          undefined,
          customThresholds,
        );

        // Should be HIGH with lower threshold
        expect(result.confidence).toBe('HIGH');
      });
    });
  });

  describe('computeReliabilitySummary', () => {
    it('should return simplified summary', () => {
      const input: ReliabilityInput = {
        penetrationRate: 0.3,
        minutesSinceLastEvent: 10,
        eventsInLastHour: 5,
        uniqueDevicesInLastHour: 10,
        historicalAccuracy: null,
        uniqueReportersInWindow: 0,
      };

      const result = service.computeReliabilitySummary('lot-summary', input);

      expect(result).toHaveProperty('lotId', 'lot-summary');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('isColdStart');
      expect(result).toHaveProperty('computedAt');
      expect(result).not.toHaveProperty('factors');
      expect(result).not.toHaveProperty('explanation');
    });
  });

  describe('computeReliabilityBatch', () => {
    it('should compute reliability for multiple lots', () => {
      const inputs = [
        {
          lotId: 'lot-1',
          input: {
            penetrationRate: 0.5,
            minutesSinceLastEvent: 5,
            eventsInLastHour: 10,
            uniqueDevicesInLastHour: 15,
            historicalAccuracy: null,
            uniqueReportersInWindow: 0,
          },
        },
        {
          lotId: 'lot-2',
          input: {
            penetrationRate: 0.1,
            minutesSinceLastEvent: 45,
            eventsInLastHour: 2,
            uniqueDevicesInLastHour: 3,
            historicalAccuracy: null,
            uniqueReportersInWindow: 0,
          },
        },
      ];

      const results = service.computeReliabilityBatch(inputs);

      expect(results).toHaveLength(2);
      expect(results[0].lotId).toBe('lot-1');
      expect(results[1].lotId).toBe('lot-2');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });

  describe('user reports factor', () => {
    const baseHighInput: ReliabilityInput = {
      penetrationRate: 0.6,
      minutesSinceLastEvent: 5,
      eventsInLastHour: 15,
      uniqueDevicesInLastHour: 25,
      historicalAccuracy: 0.9,
      uniqueReportersInWindow: 0,
    };

    it('gives full credit when no reporters', () => {
      const result = service.computeReliability('lot-no-reports', baseHighInput);
      expect(result.factors.userReports.rawValue).toBe(0);
      expect(result.factors.userReports.normalizedValue).toBe(1);
    });

    it('drops normalized value as distinct reporters approach the target', () => {
      const result = service.computeReliability('lot-some-reports', {
        ...baseHighInput,
        uniqueReportersInWindow: 2,
      });
      expect(result.factors.userReports.normalizedValue).toBeCloseTo(0.6, 5);
    });

    it('clamps normalized value to 0 once reporters meet or exceed the target', () => {
      const result = service.computeReliability('lot-many-reports', {
        ...baseHighInput,
        uniqueReportersInWindow: 50,
      });
      expect(result.factors.userReports.normalizedValue).toBe(0);
    });

    it('moves a HIGH lot toward MEDIUM when reports accumulate', () => {
      const clean = service.computeReliability('lot-clean', baseHighInput);
      const reported = service.computeReliability('lot-reported', {
        ...baseHighInput,
        uniqueReportersInWindow: 5,
      });
      // userReports weight 0.15 -> losing all of it shaves ~15 points off score
      expect(clean.score - reported.score).toBeGreaterThanOrEqual(14);
      expect(clean.score - reported.score).toBeLessThanOrEqual(16);
    });

    it('uses report-aware copy at MEDIUM when user reports are the weakest factor', () => {
      // Push the sensor factors down enough to land in MEDIUM, then make
      // user reports the weakest of the lot (5 reporters = normalized 0).
      const result = service.computeReliability('lot-report-weakest', {
        penetrationRate: 0.4,
        minutesSinceLastEvent: 15,
        eventsInLastHour: 8,
        uniqueDevicesInLastHour: 16,
        historicalAccuracy: 0.7,
        uniqueReportersInWindow: 5,
      });

      expect(result.confidence).toBe('MEDIUM');
      expect(result.explanation.toLowerCase()).toContain('user reports');
    });
  });

  describe('getDefaultWeights', () => {
    it('should return default weights that sum to 1.0', () => {
      const weights = service.getDefaultWeights();

      const sum = Object.values(weights).reduce((acc, val) => acc + val, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it('should return copy of weights (immutable)', () => {
      const weights1 = service.getDefaultWeights();
      const weights2 = service.getDefaultWeights();

      weights1.penetrationRate = 0.99;
      expect(weights2.penetrationRate).toBe(0.3);
    });
  });

  describe('getDefaultThresholds', () => {
    it('should return sensible default thresholds', () => {
      const thresholds = service.getDefaultThresholds();

      expect(thresholds.highConfidence).toBeGreaterThan(
        thresholds.mediumConfidence,
      );
      expect(thresholds.mediumConfidence).toBeGreaterThan(0);
      expect(thresholds.penetrationRateTarget).toBeGreaterThan(0);
      expect(thresholds.freshnessWindowMinutes).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle negative values gracefully', () => {
      const input: ReliabilityInput = {
        penetrationRate: -0.1, // Invalid
        minutesSinceLastEvent: -10, // Invalid
        eventsInLastHour: -5, // Invalid
        uniqueDevicesInLastHour: -3, // Invalid
        historicalAccuracy: -0.5, // Invalid
        uniqueReportersInWindow: 0,
      };

      const result = service.computeReliability('lot-negative', input);

      // Should clamp to 0
      expect(result.factors.penetrationRate.normalizedValue).toBe(0);
      expect(result.factors.historicalAccuracy.normalizedValue).toBe(0);
    });

    it('should handle extremely large values', () => {
      const input: ReliabilityInput = {
        penetrationRate: 10.0, // Way above target
        minutesSinceLastEvent: 0,
        eventsInLastHour: 1000,
        uniqueDevicesInLastHour: 500,
        historicalAccuracy: 1.5, // Invalid >1
        uniqueReportersInWindow: 0,
      };

      const result = service.computeReliability('lot-large', input);

      // Should cap at normalized 1.0
      expect(result.factors.penetrationRate.normalizedValue).toBeLessThanOrEqual(
        1.0,
      );
      expect(result.factors.eventFrequency.normalizedValue).toBeLessThanOrEqual(
        1.0,
      );
      expect(result.factors.sampleSize.normalizedValue).toBeLessThanOrEqual(1.0);
      expect(
        result.factors.historicalAccuracy.normalizedValue,
      ).toBeLessThanOrEqual(1.0);
    });

    it('should handle weights that do not sum to 1.0', () => {
      const input: ReliabilityInput = {
        penetrationRate: 0.5,
        minutesSinceLastEvent: 0,
        eventsInLastHour: 10,
        uniqueDevicesInLastHour: 20,
        historicalAccuracy: 1.0,
        uniqueReportersInWindow: 0,
      };

      const badWeights: ReliabilityWeights = {
        penetrationRate: 0.5,
        dataFreshness: 0.5,
        eventFrequency: 0.5,
        sampleSize: 0.5,
        historicalAccuracy: 0.5,
        userReports: 0.5, // Sum = 3.0
      };

      // Should normalize and still produce valid result
      const result = service.computeReliability('lot-bad-weights', input, badWeights);

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });
});
