/* global global */
// src/transit/shuttle-tracker.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ShuttleTrackerService } from './shuttle-tracker.service';

// Mock global fetch
global.fetch = jest.fn();

describe('ShuttleTrackerService', () => {
  let service: ShuttleTrackerService;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShuttleTrackerService],
    }).compile();

    service = module.get<ShuttleTrackerService>(ShuttleTrackerService);

    // Silence logger
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    
    (global.fetch as jest.Mock).mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should fetch routes, stops, and shuttles on initialization', async () => {
      // Mock successful empty responses to allow init to complete
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const fetchRoutesSpy = jest.spyOn(service, 'fetchRoutesAndStops');
      const fetchShuttlesSpy = jest.spyOn(service, 'fetchShuttles');

      await service.onModuleInit();

      expect(fetchRoutesSpy).toHaveBeenCalledTimes(1);
      expect(fetchShuttlesSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchRoutesAndStops', () => {
    const mockRoutesPayload = [
      {
        myid: 'route-1',
        name: 'Red Route',
        shortName: 'RD',
        color: '#FF0000',
        serviceTimeShort: '10 min',
      },
    ];

    const mockStopsPayload = {
      stops: {
        'stop-1': {
          stopId: 'stop-1',
          name: 'Main Station',
          latitude: 33.1,
          longitude: -118.1,
          routeId: 'route-1',
          color: '#FF0000',
        },
      },
      routePoints: {
        'route-1': [{ lat: '33.1', lng: '-118.1' }],
      },
    };

    it('should successfully fetch, transform, and cache routes and stops', async () => {
      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('getRoutes')) {
          return { ok: true, json: async () => mockRoutesPayload };
        }
        if (url.includes('getStops')) {
          return { ok: true, json: async () => mockStopsPayload };
        }
      });

      await service.fetchRoutesAndStops();

      const routes = service.getCurrentRoutes();
      const stops = service.getCurrentStops();

      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({
        id: 'route-1',
        name: 'Red Route',
        shortName: 'RD',
        color: '#FF0000',
        coordinates: [{ latitude: 33.1, longitude: -118.1 }],
      });

      expect(stops).toHaveLength(1);
      expect(stops[0]).toMatchObject({
        id: 'stop-1',
        name: 'Main Station',
        routeId: 'route-1',
      });
    });

    it('should drop malformed stops and log a warning', async () => {
      const invalidStopsPayload = {
        stops: {
          'stop-1': {
            stopId: 'stop-1',
            // Missing coords to intentionally fail class-validator
            name: 'Invalid Stop', 
          },
        },
      };

      (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (url.includes('getRoutes')) return { ok: true, json: async () => [] };
        if (url.includes('getStops')) return { ok: true, json: async () => invalidStopsPayload };
      });

      await service.fetchRoutesAndStops();

      expect(service.getCurrentStops()).toHaveLength(0);
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropping malformed stop data'));
    });

    it('should log an error if the HTTP request fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });

      await service.fetchRoutesAndStops();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to parse and merge static data',
        expect.any(Error)
      );
    });
  });

  describe('fetchShuttles', () => {
    const mockBusesPayload = {
      buses: {
        'route-1': [
          {
            busId: 101,
            busName: 'Shuttle 101',
            color: '#FF0000',
            routeId: 'route-1',
            route: 'Red Route',
            latitude: '33.5',
            longitude: '-118.5',
            calculatedCourse: '90',
            paxLoad: 5,
            totalCap: 30,
          },
        ],
      },
    };

    it('should successfully fetch, transform, and cache active shuttles', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockBusesPayload,
      });

      await service.fetchShuttles();

      const shuttles = service.getCurrentShuttles();
      expect(shuttles).toHaveLength(1);
      expect(shuttles[0]).toMatchObject({
        id: '101',
        busName: 'Shuttle 101',
        latitude: 33.5,
        longitude: -118.5,
        heading: 90,
        paxLoad: 5,
      });
    });

    it('should clear shuttles when none are active (-1 indicator)', async () => {
      service['latestShuttles'] = [{ id: '999' } as any]; // Seed

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ buses: { '-1': [] } }),
      });

      await service.fetchShuttles();

      expect(service.getCurrentShuttles()).toHaveLength(0);
    });

    it('should drop malformed shuttles and log a warning', async () => {
      const invalidBusesPayload = {
        buses: {
          'route-1': [
            {
              busId: 102,
              // Missing coords to fail validation
            },
          ],
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => invalidBusesPayload,
      });

      await service.fetchShuttles();

      expect(service.getCurrentShuttles()).toHaveLength(0);
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Dropping malformed shuttle data'));
    });

    it('should log an error if the shuttle request fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 502,
      });

      await service.fetchShuttles();

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to fetch shuttle data:',
        expect.any(Error)
      );
    });
  });

  describe('getStopETAs', () => {
    const stopId = 'stop-1';

    beforeEach(() => {
      // Test route matching
      service['currentRoutes'] = [
        {
          id: 'route-1',
          name: 'Matched Red Route',
          shortName: 'MRR',
          color: '#AA0000',
          coordinates: [],
        },
      ];
    });

    it('should correctly parse string, number, and ignore "no vehicles" ETAs', async () => {
      const mockEtaPayload = {
        ETAs: {
          [stopId]: [
            { routeId: 'route-1', eta: 'Arriving in 3 mins', bg: '#000' }, // Match cached route
            { routeId: 'route-2', eta: 10, theStop: { routeName: 'Blue', shortName: 'BL' } }, // No cached route match
            { routeId: 'route-3', eta: 'no vehicles' }, // Should be skipped
          ],
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockEtaPayload,
      });

      const arrivals = await service.getStopETAs(stopId);

      expect(arrivals).toHaveLength(2);
      
      // Sorted by closest ETA
      expect(arrivals[0]).toMatchObject({
        routeId: 'route-1',
        routeName: 'Matched Red Route', // Pulled from cache
        abbreviation: 'MRR',            // Pulled from cache
        color: '#AA0000',               // Pulled from cache
        etaMinutes: 3,                  // Parsed from string
      });

      expect(arrivals[1]).toMatchObject({
        routeId: 'route-2',
        routeName: 'Blue',              // Fallback to payload
        etaMinutes: 10,                 // Number parsed
      });
    });

    it('should return empty array and log error on HTTP failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const arrivals = await service.getStopETAs(stopId);

      expect(arrivals).toEqual([]);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        `Failed to fetch ETAs for stop ${stopId}`,
        expect.any(Error)
      );
    });

    it('should return an empty array if the stop has no ETAs', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ ETAs: {} }),
      });

      const arrivals = await service.getStopETAs('unknown-stop');

      expect(arrivals).toEqual([]);
    });
  });
});