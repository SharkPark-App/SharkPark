/**
 * Lots Service Tests
 */
import lotsApi, { type ParkingLotResponse } from '../src/services/api/lots';
import { apiService } from '../src/services/api/base';
import { cacheService } from '../src/services/api/cache';

// Mock the API service
jest.mock('../src/services/api/base');
const mockApiService = apiService as jest.Mocked<typeof apiService>;

// Mock the cache service — pass-through by default (calls fetcher, wraps result)
jest.mock('../src/services/api/cache');
const mockCacheService = cacheService as jest.Mocked<typeof cacheService>;

describe('LotsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: getOrFetch calls the fetcher and wraps the result
    mockCacheService.getOrFetch.mockImplementation(
      async (_key, fetcher) => {
        const data = await fetcher();
        return { data, source: 'network' as const, isStale: false };
      },
    );
  });

  describe('getAllLots', () => {
    it('should fetch all parking lots successfully', async () => {
      const mockResponse = [
        { lot_id: 'G1', lot_name: 'Lot G1', capacity: 100, current_occupancy: 50 },
        { lot_id: 'G2', lot_name: 'Lot G2', capacity: 150, current_occupancy: 75 }
      ];

      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: mockResponse,
        count: 2
      });

      const result = await lotsApi.getAllLots();

      expect(mockApiService.get).toHaveBeenCalledWith('/lots');
      expect(result).toEqual(mockResponse);
    });

    it('should handle errors when fetching lots', async () => {
      const error = new Error('Network error');
      mockApiService.get.mockRejectedValueOnce(error);

      await expect(lotsApi.getAllLots()).rejects.toThrow('Network error');
    });
  });

  describe('getLotDetails', () => {
    it('should fetch specific parking lot by ID', async () => {
      const mockLotData = {
        lot_id: 'G1',
        lot_name: 'Lot G1',
        capacity: 100,
        current_occupancy: 50,
        occupancy_rate: 0.5
      };

      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: mockLotData
      });

      const result = await lotsApi.getLotDetails('G1');

      expect(mockApiService.get).toHaveBeenCalledWith('/lots/G1');
      expect(result).toEqual(mockLotData);
    });

    it('should handle 404 errors for invalid lot IDs', async () => {
      const error = new Error('HTTP 404: Not Found');
      mockApiService.get.mockRejectedValueOnce(error);

      await expect(lotsApi.getLotDetails('INVALID')).rejects.toThrow('HTTP 404: Not Found');
    });
  });

  describe('getLotHistory', () => {
    it('should fetch parking lot history', async () => {
      const mockHistory = [
        { timestamp: '2025-01-01T10:00:00Z', occupancy: 45 },
        { timestamp: '2025-01-01T11:00:00Z', occupancy: 52 }
      ];

      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: mockHistory,
        count: 2
      });

      const result = await lotsApi.getLotHistory('G1');

      expect(mockApiService.get).toHaveBeenCalledWith('/lots/G1/history');
      expect(result).toEqual(mockHistory);
    });

    it('should pass query parameters for date filtering', async () => {
      const mockHistory: unknown[] = [];
      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: mockHistory,
        count: 0
      });

      await lotsApi.getLotHistory('G1', { 
        date: '2025-01-01',
        limit: 100
      });

      expect(mockApiService.get).toHaveBeenCalledWith('/lots/G1/history?date=2025-01-01&limit=100');
    });
  });

  describe('getOccupancySummary', () => {
    it('should fetch lots summary', async () => {
      const mockSummary = {
        total_lots: 25,
        total_capacity: 3500,
        total_occupied: 2100,
        average_occupancy: 0.6
      };

      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: mockSummary
      });

      const result = await lotsApi.getOccupancySummary();

      expect(mockApiService.get).toHaveBeenCalledWith('/lots/summary');
      expect(result).toEqual(mockSummary);
    });
  });

  describe('recordOccupancyEvent', () => {
    it('should record an ENTER event with device ID', async () => {
      const mockResponse = { event_id: 'evt-123', deduplicated: false };
      mockApiService.post.mockResolvedValueOnce({
        success: true,
        data: mockResponse
      });

      const result = await lotsApi.recordOccupancyEvent({
        lotId: 'G1',
        eventType: 'ENTER',
        source: 'GEOFENCE',
      });

      expect(mockApiService.post).toHaveBeenCalledWith(
        '/occupancy-events',
        expect.objectContaining({
          lot_id: 'G1',
          event_type: 'ENTER',
          device_id: expect.any(String),
          timestamp: expect.any(String),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should record an EXIT event', async () => {
      const mockResponse = { event_id: 'evt-456', deduplicated: false };
      mockApiService.post.mockResolvedValueOnce({
        success: true,
        data: mockResponse
      });

      const result = await lotsApi.recordOccupancyEvent({
        lotId: 'E7',
        eventType: 'EXIT',
        source: 'GEOFENCE',
      });

      expect(mockApiService.post).toHaveBeenCalledWith(
        '/occupancy-events',
        expect.objectContaining({
          lot_id: 'E7',
          event_type: 'EXIT',
        })
      );
      expect(result.event_id).toBe('evt-456');
    });

    it('should handle deduplicated events', async () => {
      const mockResponse = { event_id: 'evt-789', deduplicated: true };
      mockApiService.post.mockResolvedValueOnce({
        success: true,
        data: mockResponse
      });

      const result = await lotsApi.recordOccupancyEvent({
        lotId: 'G1',
        eventType: 'ENTER',
        source: 'GEOFENCE',
      });

      expect(result.deduplicated).toBe(true);
    });

    it('should use custom timestamp when provided', async () => {
      const customTimestamp = '2026-02-07T10:30:00.000Z';
      mockApiService.post.mockResolvedValueOnce({
        success: true,
        data: { event_id: 'evt-000', deduplicated: false }
      });

      await lotsApi.recordOccupancyEvent({
        lotId: 'G1',
        eventType: 'ENTER',
        source: 'GEOFENCE',
        timestamp: customTimestamp,
      });

      expect(mockApiService.post).toHaveBeenCalledWith(
        '/occupancy-events',
        expect.objectContaining({
          timestamp: customTimestamp,
        })
      );
    });
  });

  describe('getRecommendedLots', () => {
    it('should fetch recommendations for a source lot', async () => {
      const mockRecommendations = [
        {
          lot_id: 'G2',
          lot_name: 'Lot G2',
          recommendation_score: 78,
          distance_meters: 150,
          reason: '300 spots available · very close by',
          available: 300,
          occupancy_rate: 0.25,
          fill_status: 'AVAILABLE',
        },
        {
          lot_id: 'G4',
          lot_name: 'Lot G4',
          recommendation_score: 62,
          distance_meters: 500,
          reason: '132 spots left, filling up · nearby',
          available: 132,
          occupancy_rate: 0.71,
          fill_status: 'FILLING',
        },
      ];

      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: mockRecommendations,
        count: 2,
      });

      const result = await lotsApi.getRecommendedLots('G1');

      expect(mockApiService.get).toHaveBeenCalledWith('/lots/G1/recommendations');
      expect(result).toEqual(mockRecommendations);
      expect(result).toHaveLength(2);
      expect(result[0].recommendation_score).toBe(78);
    });

    it('should pass custom limit as query parameter', async () => {
      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: [],
        count: 0,
      });

      await lotsApi.getRecommendedLots('G1', 3);

      expect(mockApiService.get).toHaveBeenCalledWith('/lots/G1/recommendations?limit=3');
    });

    it('should not append limit query param when using default (5)', async () => {
      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: [],
        count: 0,
      });

      await lotsApi.getRecommendedLots('G1');

      expect(mockApiService.get).toHaveBeenCalledWith('/lots/G1/recommendations');
    });

    it('should return empty array when no recommendations exist', async () => {
      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: [],
        count: 0,
      });

      const result = await lotsApi.getRecommendedLots('G1');

      expect(result).toEqual([]);
    });

    it('should handle network errors gracefully', async () => {
      mockApiService.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(lotsApi.getRecommendedLots('G1')).rejects.toThrow('Network error');
    });

    it('should handle 404 when lot does not exist', async () => {
      mockApiService.get.mockRejectedValueOnce(new Error('HTTP 404: Not Found'));

      await expect(lotsApi.getRecommendedLots('INVALID')).rejects.toThrow('HTTP 404: Not Found');
    });
  });

  describe('getForecast', () => {
    const mockLot = {
      lot_id: 'G1',
      capacity: 100,
      occupancy_rate: 0.5,
      confidence: 'HIGH' as const,
    } as unknown as ParkingLotResponse;

    it('should return backend predictions when available', async () => {
      const predictions = [
        {
          target_time: new Date().toISOString(),
          predicted_occupancy: 60,
          confidence_lower: 50,
          confidence_upper: 70,
        },
      ];

      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: { predictions },
      });

      const result = await lotsApi.getForecast(mockLot);

      expect(result).toHaveLength(1);
      expect(result[0].occupancy).toBe(60);
      expect(result[0].accuracy).toBe(95); // HIGH confidence
    });

    it('should fall back to local forecast when backend fails', async () => {
      mockApiService.get.mockRejectedValueOnce(new Error('Service unavailable'));

      const result = await lotsApi.getForecast(mockLot);

      expect(result).toHaveLength(20);
      result.forEach((entry) => {
        expect(entry).toHaveProperty('time');
        expect(entry).toHaveProperty('occupancy');
        expect(entry).toHaveProperty('lowerBound');
        expect(entry).toHaveProperty('upperBound');
        expect(entry.occupancy).toBeGreaterThanOrEqual(0);
        expect(entry.occupancy).toBeLessThanOrEqual(100);
      });
    });

    it('should fall back when backend returns empty predictions', async () => {
      mockApiService.get.mockResolvedValueOnce({
        success: true,
        data: { predictions: [] },
      });

      const result = await lotsApi.getForecast(mockLot);

      expect(result).toHaveLength(20); // local heuristic generates 20 entries
    });
  });

  describe('generateForecast', () => {
    it('should generate 20 hourly forecasts', () => {
      const lot = {
        occupancy_rate: 0.5,
        confidence: 'MEDIUM' as const,
        capacity: 100,
      } as unknown as ParkingLotResponse;

      const forecast = lotsApi.generateForecast(lot);

      expect(forecast).toHaveLength(20);
      forecast.forEach((entry) => {
        expect(entry.lowerBound).toBeLessThanOrEqual(entry.occupancy);
        expect(entry.upperBound).toBeGreaterThanOrEqual(entry.occupancy);
        expect(entry.accuracy).toBe(85); // MEDIUM confidence
      });
    });

    it('should map confidence to accuracy', () => {
      const low = lotsApi.generateForecast({ occupancy_rate: 0.5, confidence: 'LOW', capacity: 100 } as unknown as ParkingLotResponse);
      const high = lotsApi.generateForecast({ occupancy_rate: 0.5, confidence: 'HIGH', capacity: 100 } as unknown as ParkingLotResponse);

      expect(low[0].accuracy).toBe(70);
      expect(high[0].accuracy).toBe(95);
    });
  });

  describe('convertToUIFormat', () => {
    it('should convert API lot to UI format', () => {
      const apiLot = {
        lot_id: 'G1',
        display_name: 'Lot G1',
        lot_name: 'G1',
        occupancy_rate: 0.75,
        lot_type: 'STUDENT',
      } as unknown as ParkingLotResponse;

      const result = lotsApi.convertToUIFormat(apiLot);

      expect(result.id).toBe('G1');
      expect(result.name).toBe('Lot G1');
      expect(result.occupancy).toBe(75);
      expect(result.category).toBe('student');
    });
  });
});
