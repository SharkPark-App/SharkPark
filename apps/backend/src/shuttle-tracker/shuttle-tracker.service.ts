import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import type { MapStop, MapRoute, MapShuttle, RouteArrival } from './interfaces/shuttle-tracker.interface';
import { PassioRouteDto, PassioShuttleDto, PassioStopDto, PassioEtaDto } from './dto/passiogo.dto';
import { RedisService } from '../redis/redis.service';

const REDIS_KEYS = {
  ROUTES: 'transit:routes',
  STOPS: 'transit:stops',
  SHUTTLES: 'transit:shuttles',
} as const;

// Routes and stops change at most daily; 25 h gives the cron a full cycle + buffer
const ROUTES_STOPS_TTL_S = 25 * 60 * 60;
// Shuttle list (static metadata, not live positions) is also refreshed daily
const SHUTTLES_TTL_S = 25 * 60 * 60;
// How often the app process re-syncs from Redis to pick up cron writes
const REDIS_SYNC_INTERVAL_MS = 2 * 60 * 1000;

/** Service for shuttle tracking - live route, stop, and shuttle updates */
@Injectable()
export class ShuttleTrackerService implements OnModuleInit, OnModuleDestroy {
  private latestShuttles: MapShuttle[] = [];
  private currentRoutes: MapRoute[] = [];
  private currentStops: MapStop[] = [];
  private readonly logger = new Logger(ShuttleTrackerService.name);
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly redis: RedisService) {}

  async onModuleInit() {
    this.logger.log('Initializing Passio GO! transit data');

    // Populate from Redis if available (avoids PassioGO interaction every restart)
    // Ensures all app instances start with the same snapshot the cron last wrote
    const [cachedRoutes, cachedStops, cachedShuttles] = await Promise.all([
      this.redis.get<MapRoute[]>(REDIS_KEYS.ROUTES),
      this.redis.get<MapStop[]>(REDIS_KEYS.STOPS),
      this.redis.get<MapShuttle[]>(REDIS_KEYS.SHUTTLES),
    ]);

    if (cachedRoutes && cachedStops) {
      this.currentRoutes = cachedRoutes;
      this.currentStops = cachedStops;
      this.logger.log(`Loaded ${cachedRoutes.length} routes and ${cachedStops.length} stops from Redis`);
    } else {
      void this.fetchRoutesAndStops().catch((err) =>
        this.logger.error('Initial route fetch failed; will retry on next cron tick', err),
      );
    }

    if (cachedShuttles) {
      this.latestShuttles = cachedShuttles;
      this.logger.log(`Loaded ${cachedShuttles.length} shuttles from Redis`);
    } else {
      void this.fetchShuttles().catch((err) =>
        this.logger.error('Initial shuttle fetch failed; will retry on next cron tick', err),
      );
    }

    // Periodically re-sync from Redis so daily cron updates propagate to all
    // app containers without requiring a restart
    this.syncInterval = setInterval(() => {
      void this.syncFromRedis();
    }, REDIS_SYNC_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  private async syncFromRedis(): Promise<void> {
    const [routes, stops, shuttles] = await Promise.all([
      this.redis.get<MapRoute[]>(REDIS_KEYS.ROUTES),
      this.redis.get<MapStop[]>(REDIS_KEYS.STOPS),
      this.redis.get<MapShuttle[]>(REDIS_KEYS.SHUTTLES),
    ]);
    if (routes) this.currentRoutes = routes;
    if (stops) this.currentStops = stops;
    if (shuttles) this.latestShuttles = shuttles;
  }

  getCurrentShuttles() { return this.latestShuttles; }
  getCurrentRoutes() { return this.currentRoutes; }
  getCurrentStops() { return this.currentStops; }

  /**
   * Retrieves both routes & stops, as they should be updated at the same rate
   */
  async fetchRoutesAndStops() {
    try {
      const [routesResponse, stopsResponse] = await Promise.all([
        fetch('https://passiogo.com//mapGetData.php?getRoutes=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemSelected0: 4163, amount: 1 }),
        }),
        fetch('https://passiogo.com/mapGetData.php?getStops=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ s0: 4163, sA: 1 }),
        })
      ]);

      if (!routesResponse.ok) throw new Error(`Routes request returned ${routesResponse.status}`);
      if (!stopsResponse.ok) throw new Error(`Stops request returned ${stopsResponse.status}`);

      const rawRoutes = (await routesResponse.json()) as unknown[];
      const rawMapData = (await stopsResponse.json()) as {
        stops?: Record<string, unknown>;
        routePoints?: Record<string, { lat: string; lng: string }[]>;
      };

      /** Transform/validate stops */
      const rawStopsArray = Object.values(rawMapData.stops || {});
      const stopInstances = plainToInstance(PassioStopDto, rawStopsArray);
      const validStops: PassioStopDto[] = [];

      for (const stop of stopInstances) {
        try {
          await validateOrReject(stop);
          validStops.push(stop);
        } catch {
          this.logger.warn(`Dropping malformed stop data from PassioGO! (Stop ID: ${stop.stopId || 'unknown'})`);
        }
      }

      // Map stops to interface
      this.currentStops = validStops.map((stop) => ({
        id: stop.stopId,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        routeId: stop.routeId,
        color: stop.color || '#ffffff', // Should be provided, but just in case
      }));

      /** Transform/validate routes */
      const routeInstances = plainToInstance(PassioRouteDto, rawRoutes);
      const validRoutes: PassioRouteDto[] = [];

      for (const route of routeInstances) {
        try {
          await validateOrReject(route);
          validRoutes.push(route);
        } catch {
          this.logger.warn(`Invalid route data received from PassioGO! (ID: ${route.myid || 'unknown'})`);
        }
      }

      // Map routes to interface
      this.currentRoutes = validRoutes.map((routeData) => {
        const actualRouteId = routeData.myid;
        const rawPoints: { lat: string; lng: string }[] = rawMapData.routePoints?.[actualRouteId] || [];

        const parsedCoordinates = rawPoints.map((point: { lat: string; lng: string }) => ({
          latitude: parseFloat(point.lat),
          longitude: parseFloat(point.lng),
        }));

        return {
          id: actualRouteId,
          name: routeData.nameOrig || routeData.name,
          shortName: routeData.shortName,
          color: routeData.color,
          status: routeData.serviceTimeShort || 'N/A',
          coordinates: parsedCoordinates,
        };
      });

      this.logger.log(`Successfully joined ${this.currentRoutes.length} shuttle routes`);

      await Promise.all([
        this.redis.set(REDIS_KEYS.ROUTES, this.currentRoutes, ROUTES_STOPS_TTL_S),
        this.redis.set(REDIS_KEYS.STOPS, this.currentStops, ROUTES_STOPS_TTL_S),
      ]);
    } catch (error) {
      this.logger.error('Failed to parse and merge static data', error);
    }
  }

  /**
   * Retrieves initial data for all active shuttles per cron tick.
   * Provides static data (e.g. color, busName) that isn't & does not need to be provided by the WS gateway.
   * Instantiates shuttles for immediate frontend access (user doesn't have to wait for WS gateway).
   */
  async fetchShuttles() {
    try {
      const shuttlesResponse = await fetch('https://passiogo.com/mapGetData.php?getBuses=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s0: 4163, sA: 1 }),
      });

      if (!shuttlesResponse.ok) {
        throw new Error(`Shuttles request returned HTTP ${shuttlesResponse.status}`);
      }

      const rawShuttles = (await shuttlesResponse.json()) as {
        buses?: Record<string, unknown[]>;
      };
      const shuttlesData = rawShuttles.buses || {};

      // One shuttle with ID -1 indicates that none are active (empty array shouldn't occur, but check regardless)
      if (shuttlesData['-1'] || Object.keys(shuttlesData).length === 0) {
        this.latestShuttles = [];
        await this.redis.set(REDIS_KEYS.SHUTTLES, [], SHUTTLES_TTL_S);
        return;
      }

      // Extract & flatten shuttles (e.g. [ [{bus1}], [{bus2}] ] -> [ {bus1}, {bus2} ])
      const flatShuttles = Object.values(shuttlesData).flat();

      // Transform/validate shuttles
      const shuttleInstances = plainToInstance(PassioShuttleDto, flatShuttles);
      const validShuttles: PassioShuttleDto[] = [];

      for (const shuttle of shuttleInstances) {
        try {
          await validateOrReject(shuttle);
          validShuttles.push(shuttle);
        } catch {
          // Drop shuttle if malformed
          this.logger.warn(`Dropping malformed shuttle data from PassioGO! (Bus ID: ${shuttle.busId || 'unknown'})`);
        }
      }

      // Map shuttles to interface
      this.latestShuttles = validShuttles.map((shuttle) => ({
        id: shuttle.busId.toString(),
        busName: shuttle.busName,
        color: shuttle.color,
        routeId: shuttle.routeId,
        route: shuttle.route,
        latitude: parseFloat(shuttle.latitude),
        longitude: parseFloat(shuttle.longitude),
        heading: typeof shuttle.calculatedCourse === 'string' ? parseFloat(shuttle.calculatedCourse) : (shuttle.calculatedCourse || 0),
        paxLoad: shuttle.paxLoad || 0,
        capacity: shuttle.totalCap || 0,
      }));

      await this.redis.set(REDIS_KEYS.SHUTTLES, this.latestShuttles, SHUTTLES_TTL_S);
    } catch (error) {
      this.logger.error('Failed to fetch shuttle data:', error);
    }
  }

  /**
   * Retrieve shuttle ETAs
   */
  async getStopETAs(stopId: string): Promise<RouteArrival[]> {
    try {
      const etaResponse = await fetch(`https://passiogo.com/mapGetData.php?eta=1&stopIds=${stopId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s0: 4163, sA: 1 }),
      });

      if (!etaResponse.ok) {
        throw new Error(`ETA request returned HTTP ${etaResponse.status}`);
      }

      const rawJson = (await etaResponse.json()) as {
        ETAs?: Record<string, PassioEtaDto[]>
      };

      const etasDict = rawJson.ETAs || {};
      const stopArrivals = etasDict[stopId];

      if (!stopArrivals || !Array.isArray(stopArrivals)) return [];
      const arrivals: RouteArrival[] = [];

      for (const arrival of stopArrivals) {
        if (arrival.eta === 'no vehicles') continue;

        let etaVal: number | null = null;

        if (typeof arrival.eta === 'string') {
          // Find first sequence of digits
          const match = arrival.eta.match(/\d+/);
          if (match) etaVal = parseInt(match[0], 10);
        } else if (typeof arrival.eta === 'number') {
          etaVal = arrival.eta;
        }

        if (etaVal === null || !arrival.routeId) continue;

        // Match w/ cached routes if possible
        const matchingRoute = this.currentRoutes.find(r => r.id === arrival.routeId);

        arrivals.push({
          routeId: arrival.routeId,
          routeName: matchingRoute ? matchingRoute.name : (arrival.theStop?.routeName || 'Unknown Route'),
          abbreviation: matchingRoute ? matchingRoute.shortName : (arrival.theStop?.shortName || ''),
          color: matchingRoute ? matchingRoute.color : (arrival.bg || '#ffffff'),
          etaMinutes: etaVal,
        });
      }

      // Sort from closest to furthest ETA
      return arrivals.sort((a, b) => (a.etaMinutes as number) - (b.etaMinutes as number));

    } catch (error) {
      this.logger.error(`Failed to fetch ETAs for stop ${stopId}`, error);
      return [];
    }
  }
}
