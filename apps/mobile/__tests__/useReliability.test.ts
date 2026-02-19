/**
 * Tests for useReliability hooks
 * 
 * Since we don't have @testing-library/react-native, we test the hook logic
 * indirectly by testing the underlying service calls that the hooks use.
 * The hooks are thin wrappers around the reliability API service.
 */
import { reliabilityApiService } from '../src/services/api/reliability';
import { apiService } from '../src/services/api/base';

jest.mock('../src/services/api/base', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

const mockApiService = apiService as jest.Mocked<typeof apiService>;

describe('useReliability hook dependencies', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLotReliability (used by useReliability)', () => {
    const mockReliabilityScore = {
      lotId: 'G1',
      score: 85,
      confidence: 'HIGH',
      factors: {
        penetrationRate: { name: 'Penetration Rate', rawValue: 0.7, normalizedValue: 0.93, weight: 0.35, weightedScore: 0.33 },
        dataFreshness: { name: 'Data Freshness', rawValue: 5, normalizedValue: 0.96, weight: 0.25, weightedScore: 0.24 },
        eventFrequency: { name: 'Event Frequency', rawValue: 25, normalizedValue: 0.83, weight: 0.2, weightedScore: 0.17 },
        sampleSize: { name: 'Sample Size', rawValue: 15, normalizedValue: 1.0, weight: 0.15, weightedScore: 0.15 },
        historicalAccuracy: { name: 'Historical Accuracy', rawValue: 0.5, normalizedValue: 0.5, weight: 0.05, weightedScore: 0.025 },
      },
      isColdStart: false,
      explanation: 'High confidence based on strong penetration rate',
      computedAt: '2026-02-14T20:30:00.000Z',
    };

    it('returns reliability data for a valid lot ID', async () => {
      mockApiService.get.mockResolvedValueOnce({ success: true, data: mockReliabilityScore });

      const result = await reliabilityApiService.getLotReliability('G1');

      expect(result).toEqual(mockReliabilityScore);
      expect(result.confidence).toBe('HIGH');
      expect(result.score).toBe(85);
    });

    it('handles different confidence levels', async () => {
      const mediumConfidence = { ...mockReliabilityScore, confidence: 'MEDIUM', score: 55 };
      mockApiService.get.mockResolvedValueOnce({ success: true, data: mediumConfidence });

      const result = await reliabilityApiService.getLotReliability('G2');

      expect(result.confidence).toBe('MEDIUM');
    });

    it('handles cold start scenarios', async () => {
      const coldStartScore = { ...mockReliabilityScore, isColdStart: true, score: 30, confidence: 'LOW' };
      mockApiService.get.mockResolvedValueOnce({ success: true, data: coldStartScore });

      const result = await reliabilityApiService.getLotReliability('G3');

      expect(result.isColdStart).toBe(true);
      expect(result.confidence).toBe('LOW');
    });

    it('propagates errors for hook error handling', async () => {
      mockApiService.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(reliabilityApiService.getLotReliability('G1')).rejects.toThrow('Network error');
    });
  });

  describe('getAllLotsReliability (used by useAllLotsReliability)', () => {
    const mockSummaries = [
      { lotId: 'G1', score: 85, confidence: 'HIGH', isColdStart: false, computedAt: '2026-02-14T20:30:00.000Z' },
      { lotId: 'G2', score: 60, confidence: 'MEDIUM', isColdStart: false, computedAt: '2026-02-14T20:30:00.000Z' },
      { lotId: 'G3', score: 30, confidence: 'LOW', isColdStart: true, computedAt: '2026-02-14T20:30:00.000Z' },
    ];

    it('returns summaries for all lots', async () => {
      mockApiService.get.mockResolvedValueOnce({ success: true, data: mockSummaries });

      const result = await reliabilityApiService.getAllLotsReliability();

      expect(result).toHaveLength(3);
      expect(result[0].lotId).toBe('G1');
      expect(result[2].isColdStart).toBe(true);
    });

    it('returns empty array when no lots exist', async () => {
      mockApiService.get.mockResolvedValueOnce({ success: true, data: [] });

      const result = await reliabilityApiService.getAllLotsReliability();

      expect(result).toEqual([]);
    });

    it('propagates errors for hook error handling', async () => {
      mockApiService.get.mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(reliabilityApiService.getAllLotsReliability()).rejects.toThrow('Service unavailable');
    });
  });
});
