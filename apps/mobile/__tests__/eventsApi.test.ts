jest.mock('../src/services/api/base', () => ({
  apiService: { get: jest.fn() },
}));

import { eventsApi } from '../src/services/api/events';
import { apiService } from '../src/services/api/base';
import { API_CONFIG } from '../src/services/api/config';

const mockGet = apiService.get as jest.Mock;

describe('eventsApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getEventsForLot', () => {
    it('GETs the per-lot endpoint and returns the data array', async () => {
      const data = [{ id: 'ev-1' }];
      mockGet.mockResolvedValueOnce({ data });

      const result = await eventsApi.getEventsForLot('G7');

      expect(mockGet).toHaveBeenCalledWith(API_CONFIG.ENDPOINTS.EVENTS_FOR_LOT('G7'));
      expect(result).toBe(data);
    });
  });

  describe('getNearbyEvents', () => {
    it('appends within_hours=2 by default', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });
      await eventsApi.getNearbyEvents('G7');
      expect(mockGet).toHaveBeenCalledWith(
        `${API_CONFIG.ENDPOINTS.LOT_NEARBY_EVENTS('G7')}?within_hours=2`,
      );
    });

    it('honors a custom within_hours value', async () => {
      mockGet.mockResolvedValueOnce({ data: [{ id: 'a' }] });
      const out = await eventsApi.getNearbyEvents('G7', 24);
      expect(mockGet).toHaveBeenCalledWith(
        `${API_CONFIG.ENDPOINTS.LOT_NEARBY_EVENTS('G7')}?within_hours=24`,
      );
      expect(out).toEqual([{ id: 'a' }]);
    });

    it('returns [] when the response data is missing', async () => {
      mockGet.mockResolvedValueOnce({ data: undefined });
      const out = await eventsApi.getNearbyEvents('G7');
      expect(out).toEqual([]);
    });
  });
});
