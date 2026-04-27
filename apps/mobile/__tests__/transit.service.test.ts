/**
 * Transit Service Tests
 */
import { TransitService } from '../src/services/api/transit';
import { apiService } from '../src/services/api/base';

// Mock the base API service
jest.mock('../src/services/api/base', () => {
  return {
    apiService: {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    },
    ApiError: class MockApiError {
      status: number;
      message: string;
      constructor(status: number, message: string) {
        this.status = status;
        this.message = message;
      }
    }
  };
});

const mockApiService = apiService as jest.Mocked<typeof apiService>;

const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

describe('TransitService', () => {
  afterAll(() => {
    consoleSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getRoutesAndStops', () => {
    it('fetches and returns both routes and stops data', async () => {
      const mockRoutes = [{ id: 'r1', color: '#ff0000', coordinates: [] }];
      const mockStops = [{ id: 's1', name: 'Student Union', latitude: 33.0, longitude: -118.0 }];
      
      // Mock the two sequential GET calls
      mockApiService.get
        .mockResolvedValueOnce({ success: true, data: mockRoutes }) // First call: routes
        .mockResolvedValueOnce({ success: true, data: mockStops }); // Second call: stops

      const result = await TransitService.getRoutesAndStops();

      // Verify the correct endpoints were hit in order
      expect(mockApiService.get).toHaveBeenNthCalledWith(1, '/transit/routes');
      expect(mockApiService.get).toHaveBeenNthCalledWith(2, '/transit/stops');
      
      // Verify the data was bundled correctly
      expect(result).toEqual({
        routes: mockRoutes,
        stops: mockStops
      });
      
      // Verify DEV logging occurred
      expect(consoleSpy).toHaveBeenCalledWith('[transitService] Routes Data:', mockRoutes);
      expect(consoleSpy).toHaveBeenCalledWith('[transitService] Stops Data:', mockStops);
    });
  });

  describe('getLiveShuttles', () => {
    it('fetches and returns live shuttle data', async () => {
      const mockShuttles = [
        { id: 'sh1', busName: 'Beach City', route: 'All Campus', latitude: 33.0, longitude: -118.0 }
      ];
      
      mockApiService.get.mockResolvedValueOnce({ success: true, data: mockShuttles });

      const result = await TransitService.getLiveShuttles();

      expect(mockApiService.get).toHaveBeenCalledWith('/transit/shuttles');
      expect(result).toEqual(mockShuttles);
    });
  });

  describe('getStopETAs', () => {
    it('fetches and returns ETAs for a specific stop', async () => {
      const stopId = 's1-union';
      const mockETAs = [
        { routeId: 'r1', arrivalTime: '10:00 AM', secondsAway: 300 }
      ];
      
      mockApiService.get.mockResolvedValueOnce({ success: true, data: mockETAs });

      const result = await TransitService.getStopETAs(stopId);

      // Verify query string was appended correctly
      expect(mockApiService.get).toHaveBeenCalledWith(`/transit/etas/${stopId}`);
      expect(result).toEqual(mockETAs);
      
      // Verify DEV logging
      expect(consoleSpy).toHaveBeenCalledWith(`[transitService] Retrieved Stop ${stopId} Data:`, mockETAs);
    });
  });
});