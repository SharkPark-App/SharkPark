/* global global */
// src/transit/shuttle-tracker.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ShuttleTrackerService } from './shuttle-tracker.service';
import { RedisService } from '../redis/redis.service';

// Mock global fetch
global.fetch = jest.fn();

const mockRedis = {
  get: jest.fn().mockResolvedValue(null), // Cold cache by default
  set: jest.fn().mockResolvedValue(undefined),
};

describe('ShuttleTrackerService', () => {
  let service: ShuttleTrackerService;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShuttleTrackerService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<ShuttleTrackerService>(ShuttleTrackerService);

    // Silence logger
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    (global.fetch as jest.Mock).mockClear();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('fetches from PassioGO on a cold cache (Redis miss)', async () => {
      mockRedis.get.mockResolvedValue(null);
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });

      const fetchRoutesSpy = jest.spyOn(service, 'fetchRoutesAndStops');
      const fetchShuttlesSpy = jest.spyOn(service, 'fetchShuttles');

      await service.onModuleInit();

      expect(fetchRoutesSpy).toHaveBeenCalledTimes(1);
      expect(fetchShuttlesSpy).toHaveBeenCalledTimes(1);
    });

    it('loads from Redis and skips PassioGO on a warm cache', async () => {
      const cachedRoutes = [{ id: 'r1', name: 'Red', shortName: 'RD', color: '#f00', status: 'ok', coordinates: [] }];
      const cachedStops = [{ id: 's1', name: 'Stop 1', latitude: 33.1, longitude: -118.1, routeId: 'r1', color: '#f00' }];
      const cachedShuttles = [{ id: '101', busName: 'Bus A', color: '#f00', routeId: 'r1', route: 'Red', latitude: 33.1, longitude: -118.1, heading: 0, paxLoad: 0, capacity: 30 }];

      mockRedis.get
        .mockResolvedValueOnce(cachedRoutes)    // Routes
        .mockResolvedValueOnce(cachedStops)     // Stops
        .mockResolvedValueOnce(cachedShuttles); // Shuttles

      const fetchRoutesSpy = jest.spyOn(service, 'fetchRoutesAndStops');
      const fetchShuttlesSpy = jest.spyOn(service, 'fetchShuttles');

      await service.onModuleInit();

      expect(fetchRoutesSpy).not.toHaveBeenCalled();
      expect(fetchShuttlesSpy).not.toHaveBeenCalled();
      expect(service.getCurrentRoutes()).toEqual(cachedRoutes);
      expect(service.getCurrentStops()).toEqual(cachedStops);
      expect(service.getCurrentShuttles()).toEqual(cachedShuttles);
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
        routeIds: ['route-1'],
      });

      expect(mockRedis.set).toHaveBeenCalledWith('transit:routes', routes, expect.any(Number));
      expect(mockRedis.set).toHaveBeenCalledWith('transit:stops', stops, expect.any(Number));
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
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed stop'));
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

      expect(mockRedis.set).toHaveBeenCalledWith('transit:shuttles', shuttles, expect.any(Number));
    });

    it('should clear shuttles when none are active (-1 indicator)', async () => {
      service['latestShuttles'] = [{ id: '999' } as any]; // Seed

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ buses: { '-1': [] } }),
      });

      await service.fetchShuttles();

      expect(service.getCurrentShuttles()).toHaveLength(0);
      expect(mockRedis.set).toHaveBeenCalledWith('transit:shuttles', [], expect.any(Number));
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
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('malformed shuttle'));
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
          status: 'On Time',
          coordinates: [],
        },
      ];
    });

    it('should correctly parse string, number, etaR, and ignore "no vehicles"/"arrived" ETAs', async () => {
      const mockEtaPayload = {
        ETAs: {
          [stopId]: [
            { routeId: 'route-1', eta: 'Arriving in 3 mins', etaR: '3', bg: '#000', busName: 'Bus A', theStop: {} }, // etaR preferred
            { routeId: 'route-2', eta: 10, busName: 'Bus B', theStop: { routeName: 'Blue', shortName: 'BL' } },      // numeric eta fallback
            { routeId: 'route-3', eta: 'no vehicles', busName: 'Bus C', theStop: {} },                               // skipped
            { routeId: 'route-4', eta: 'arrived', busName: 'Bus D', theStop: { routeName: 'Green', shortName: 'G' } }, // skipped — bus is at stop, not upcoming
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
        abbreviation: 'MRR',
        color: '#AA0000',
        etaMinutes: 3, // Parsed from etaR
      });

      expect(arrivals[1]).toMatchObject({
        routeId: 'route-2',
        routeName: 'Blue', // Fallback to payload
        etaMinutes: 10,
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
