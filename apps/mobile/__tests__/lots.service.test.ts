/**
 * Lots Service Tests
 */
import lotsApi from '../src/services/api/lots';
import { apiService } from '../src/services/api/base';

// Mock the API service
jest.mock('../src/services/api/base');
const mockApiService = apiService as jest.Mocked<typeof apiService>;

describe('LotsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
