jest.mock('../src/services/api/base', () => ({
  apiService: { get: jest.fn() },
}));

jest.mock('../src/services/api/cache', () => ({
  cacheService: { getOrFetch: jest.fn() },
}));

import { eventsApi } from '../src/services/api/events';
import { apiService } from '../src/services/api/base';
import { cacheService } from '../src/services/api/cache';
import { API_CONFIG } from '../src/services/api/config';

const mockGet = apiService.get as jest.Mock;
const mockGetOrFetch = cacheService.getOrFetch as jest.Mock;

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

  describe('getEventsSummary', () => {
    it('routes through cacheService.getOrFetch with the within_hours-keyed cache key', async () => {
      const summary = [{ lot_id: 'G7', count: 1, next_event: null }];
      mockGetOrFetch.mockResolvedValueOnce({ data: summary });

      const result = await eventsApi.getEventsSummary(2);

      expect(mockGetOrFetch).toHaveBeenCalledTimes(1);
      const [key, fetcher, opts] = mockGetOrFetch.mock.calls[0];
      expect(key).toBe('events:summary:2');
      expect(typeof fetcher).toBe('function');
      expect(opts).toEqual({ ttl: 5 * 60 * 1000 });
      expect(result).toBe(summary);
    });

    it('uses a different cache key per within_hours value', async () => {
      mockGetOrFetch.mockResolvedValue({ data: [] });
      await eventsApi.getEventsSummary(24);
      expect(mockGetOrFetch.mock.calls[0][0]).toBe('events:summary:24');
    });

    it('inner fetcher GETs the bulk endpoint and unwraps response.data', async () => {
      mockGetOrFetch.mockImplementationOnce(async (_k, fetcher) => ({
        data: await fetcher(),
      }));
      mockGet.mockResolvedValueOnce({ data: [{ lot_id: 'G7', count: 0, next_event: null }] });

      const result = await eventsApi.getEventsSummary(2);

      expect(mockGet).toHaveBeenCalledWith(
        `${API_CONFIG.ENDPOINTS.LOTS_EVENTS_SUMMARY}?within_hours=2`,
      );
      expect(result).toEqual([{ lot_id: 'G7', count: 0, next_event: null }]);
    });

    it('inner fetcher returns [] when response.data is missing', async () => {
      mockGetOrFetch.mockImplementationOnce(async (_k, fetcher) => ({
        data: await fetcher(),
      }));
      mockGet.mockResolvedValueOnce({ data: undefined });

      const result = await eventsApi.getEventsSummary(2);
      expect(result).toEqual([]);
    });
  });
});
