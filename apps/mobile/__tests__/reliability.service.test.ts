import { reliabilityApiService } from '../src/services/api/reliability';
import { apiService } from '../src/services/api/base';
import API_CONFIG from '../src/services/api/config';

jest.mock('../src/services/api/base', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

const mockApiService = apiService as jest.Mocked<typeof apiService>;

describe('ReliabilityApiService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLotReliability', () => {
    it('fetches reliability score for a specific lot', async () => {
      const mockResponse = {
        data: {
          lotId: 'G1',
          score: 85,
          confidence: 'HIGH',
          factors: {
            penetrationRate: { value: 0.7, normalized: 0.93, weight: 0.35 },
            dataFreshness: { value: 5, normalized: 0.96, weight: 0.25 },
            eventFrequency: { value: 25, normalized: 0.83, weight: 0.2 },
            sampleSize: { value: 15, normalized: 1.0, weight: 0.15 },
            historicalAccuracy: { value: null, normalized: 0.5, weight: 0.05 },
          },
          isColdStart: false,
          explanation: 'High confidence based on strong penetration rate',
          computedAt: '2026-02-14T20:30:00.000Z',
        },
      };

      mockApiService.get.mockResolvedValueOnce(mockResponse);

      const result = await reliabilityApiService.getLotReliability('G1');

      expect(mockApiService.get).toHaveBeenCalledWith(
        `${API_CONFIG.BASE_URL}/api/v1/reliability/lots/G1`
      );
      expect(result).toEqual(mockResponse.data);
      expect(result.lotId).toBe('G1');
      expect(result.confidence).toBe('HIGH');
    });

    it('handles errors gracefully', async () => {
      mockApiService.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        reliabilityApiService.getLotReliability('invalid')
      ).rejects.toThrow('Network error');
    });
  });

  describe('getAllLotsReliability', () => {
    it('fetches reliability summaries for all lots', async () => {
      const mockResponse = {
        data: [
          { lotId: 'G1', score: 85, confidence: 'HIGH', isColdStart: false, computedAt: '2026-02-14T20:30:00.000Z' },
          { lotId: 'G2', score: 55, confidence: 'MEDIUM', isColdStart: false, computedAt: '2026-02-14T20:30:00.000Z' },
          { lotId: 'G3', score: 25, confidence: 'LOW', isColdStart: true, computedAt: '2026-02-14T20:30:00.000Z' },
        ],
      };

      mockApiService.get.mockResolvedValueOnce(mockResponse);

      const result = await reliabilityApiService.getAllLotsReliability();

      expect(mockApiService.get).toHaveBeenCalledWith(
        `${API_CONFIG.BASE_URL}/api/v1/reliability/lots`
      );
      expect(result).toHaveLength(3);
      expect(result[0].confidence).toBe('HIGH');
      expect(result[2].isColdStart).toBe(true);
    });

    it('returns empty array when no lots', async () => {
      mockApiService.get.mockResolvedValueOnce({ data: [] });

      const result = await reliabilityApiService.getAllLotsReliability();

      expect(result).toEqual([]);
    });
  });

  describe('getReliabilityConfig', () => {
    it('fetches reliability computation configuration', async () => {
      const mockResponse = {
        data: {
          weights: {
            penetrationRate: 0.35,
            dataFreshness: 0.25,
            eventFrequency: 0.2,
            sampleSize: 0.15,
            historicalAccuracy: 0.05,
          },
          thresholds: {
            high: 70,
            medium: 40,
          },
        },
      };

      mockApiService.get.mockResolvedValueOnce(mockResponse);

      const result = await reliabilityApiService.getReliabilityConfig();

      expect(mockApiService.get).toHaveBeenCalledWith(
        `${API_CONFIG.BASE_URL}/api/v1/reliability/config`
      );
      expect(result.weights.penetrationRate).toBe(0.35);
      expect(result.thresholds.high).toBe(70);
    });
  });
});
