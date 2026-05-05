import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import type { MapStop, MapRoute, MapShuttle, RouteArrival, ShuttleLiveUpdate } from './interfaces/shuttle-tracker.interface';
import { PassioRouteDto, PassioShuttleDto, PassioStopDto, PassioEtaDto } from './dto/passiogo.dto';
import { RedisService } from '../redis/redis.service';

const REDIS_KEYS = {
  ROUTES: 'transit:routes',
  STOPS: 'transit:stops',
  SHUTTLES: 'transit:shuttles',
  ETA_PREFIX: 'transit:etas:', // prefix — append stopId to form the full key
} as const;

// Routes and stops change at most daily; 25 h gives the cron a full cycle + buffer
const ROUTES_STOPS_TTL_S = 25 * 60 * 60;
// Shuttle metadata refreshed hourly by cron; 25 h TTL keeps the key alive across restarts
const SHUTTLES_TTL_S = 25 * 60 * 60;
// ETAs are in whole-minute granularity; short cache deduplicates concurrent requests
// without showing meaningfully stale data
const ETA_TTL_S = 5;
// How often the app process re-syncs from Redis to pick up cron writes
const REDIS_SYNC_INTERVAL_MS = 2 * 60 * 1000;
// How often stale (offline) buses are pruned from in-memory state
const PRUNE_INTERVAL_MS = 30_000;
// Matches PassioGO!'s own 2-minute silence window before dropping a bus
const STALE_TTL_MS = 2 * 60 * 1000;

/** Service for shuttle tracking - live route, stop, and shuttle updates */
@Injectable()
export class ShuttleTrackerService implements OnModuleInit, OnModuleDestroy {
  private latestShuttles: MapShuttle[] = [];
  private currentRoutes: MapRoute[] = [];
  private currentStops: MapStop[] = [];
  private readonly logger = new Logger(ShuttleTrackerService.name);
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;

  // Tracks the last WS frame timestamp per bus ID for stale-bus pruning
  private readonly lastSeen = new Map<string, number>();
  // Prevents concurrent on-demand metadata fetches
  private metadataFetchPending = false;

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
      const now = Date.now();
      for (const s of this.latestShuttles) this.lastSeen.set(s.id, now);
      this.logger.log(`Loaded ${cachedShuttles.length} shuttles from Redis`);
    } else {
      void this.fetchShuttles().catch((err) =>
        this.logger.error('Initial shuttle fetch failed; data will load on first WS frame', err),
      );
    }

    // Periodically re-sync from Redis so daily cron updates propagate to all
    // app containers without requiring a restart
    this.syncInterval = setInterval(() => {
      void this.syncFromRedis();
    }, REDIS_SYNC_INTERVAL_MS);

    this.pruneInterval = setInterval(() => this.pruneStaleShuttles(), PRUNE_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
  }

  private async syncFromRedis(): Promise<void> {
    try {
      const [routes, stops, shuttles] = await Promise.all([
        this.redis.get<MapRoute[]>(REDIS_KEYS.ROUTES),
        this.redis.get<MapStop[]>(REDIS_KEYS.STOPS),
        this.redis.get<MapShuttle[]>(REDIS_KEYS.SHUTTLES),
      ]);
      if (routes) this.currentRoutes = routes;
      if (stops) this.currentStops = stops;
      if (shuttles) {
        // Preserve live WS positions — Redis holds a metadata snapshot, not
        // current coords. Same merge logic as fetchShuttles().
        const livePositions = new Map(
          this.latestShuttles.map(s => [s.id, {
            latitude: s.latitude, longitude: s.longitude,
            heading: s.heading, paxLoad: s.paxLoad,
          }]),
        );
        this.latestShuttles = shuttles.map(s => {
          const live = livePositions.get(s.id);
          return live ? { ...s, ...live } : s;
        });
      }
    } catch (error) {
      this.logger.error('Failed to sync transit data from Redis', error);
    }
  }

  getCurrentShuttles() { return this.latestShuttles; }
  getCurrentRoutes() { return this.currentRoutes; }
  getCurrentStops() { return this.currentStops; }

  /**
   * Merges a batch of live WS position frames into in-memory shuttle state.
   * Tracks last-seen timestamps for stale-bus pruning, and triggers a
   * one-off metadata fetch when an unknown bus ID is encountered.
   */
  applyLiveUpdates(updates: ShuttleLiveUpdate[]) {
    const now = Date.now();
    const knownIds = new Set(this.latestShuttles.map(s => s.id));
    let hasUnknown = false;

    for (const u of updates) {
      this.lastSeen.set(u.id, now);
      if (!knownIds.has(u.id)) hasUnknown = true;
    }

    this.latestShuttles = this.latestShuttles.map(shuttle => {
      const u = updates.find(u => u.id === shuttle.id);
      if (!u) return shuttle;
      return { ...shuttle, latitude: u.latitude, longitude: u.longitude,
               heading: u.heading, paxLoad: u.paxLoad };
    });

    if (hasUnknown && !this.metadataFetchPending) {
      this.metadataFetchPending = true;
      void this.fetchShuttles().finally(() => { this.metadataFetchPending = false; });
    }
  }

  /**
   * Resets all lastSeen timestamps to now. Called on PassioGO! WS disconnect
   * so buses are not prematurely pruned during the reconnect backoff window
   * (up to 5 min). Buses that were already offline before the disconnect will
   * naturally fail to send frames after reconnect and be pruned 2 min later.
   */
  refreshAllLastSeen() {
    const now = Date.now();
    for (const id of this.lastSeen.keys()) this.lastSeen.set(id, now);
  }

  private pruneStaleShuttles() {
    const cutoff = Date.now() - STALE_TTL_MS;
    const before = this.latestShuttles.length;
    this.latestShuttles = this.latestShuttles.filter(
      s => (this.lastSeen.get(s.id) ?? 0) >= cutoff,
    );
    for (const [id, ts] of this.lastSeen)
      if (ts < cutoff) this.lastSeen.delete(id);
    const pruned = before - this.latestShuttles.length;
    if (pruned > 0) this.logger.log(`Pruned ${pruned} stale shuttle(s)`);
  }

  /**
   * Retrieves both routes & stops, as they should be updated at the same rate
   */
  async fetchRoutesAndStops() {
    try {
      const [routesResponse, stopsResponse] = await Promise.all([
        fetch('https://passiogo.com/mapGetData.php?getRoutes=1', {
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
        routes?: Record<string, unknown[]>;
        routePoints?: Record<string, { lat: string; lng: string }[]>;
      };

      // Build stopId → routeIds[] from the routes field, which is the
      // authoritative source for multi-route stop membership. The stops dict
      // only carries one routeId (the "primary" assignment), so cross-
      // referencing here is the only way to capture shared stops correctly.
      const stopRouteIds = new Map<string, string[]>();
      for (const [routeId, routeData] of Object.entries(rawMapData.routes || {})) {
        if (!Array.isArray(routeData)) continue;
        for (let i = 2; i < routeData.length; i++) {
          const entry = routeData[i];
          if (!Array.isArray(entry) || entry.length < 2) continue;
          const stopId = String(entry[1]);
          const existing = stopRouteIds.get(stopId) ?? [];
          if (!existing.includes(routeId)) {
            stopRouteIds.set(stopId, [...existing, routeId]);
          }
        }
      }

      /** Transform/validate stops */
      const rawStopsArray = Object.values(rawMapData.stops || {});
      const stopInstances = plainToInstance(PassioStopDto, rawStopsArray);
      const validStops: PassioStopDto[] = [];

      let droppedStops = 0;
      for (const stop of stopInstances) {
        try {
          await validateOrReject(stop);
          validStops.push(stop);
        } catch {
          droppedStops++;
        }
      }
      if (droppedStops > 0) this.logger.warn(`Dropped ${droppedStops} malformed stop(s) from PassioGO!`);

      // Map stops to interface
      this.currentStops = validStops.map((stop) => ({
        id: stop.stopId,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        routeIds: stopRouteIds.get(stop.stopId) ?? ([stop.routeId].filter(Boolean) as string[]),
        color: stop.color || '#ffffff',
      }));

      /** Transform/validate routes */
      const routeInstances = plainToInstance(PassioRouteDto, rawRoutes);
      const validRoutes: PassioRouteDto[] = [];

      let droppedRoutes = 0;
      for (const route of routeInstances) {
        try {
          await validateOrReject(route);
          validRoutes.push(route);
        } catch {
          droppedRoutes++;
        }
      }
      if (droppedRoutes > 0) this.logger.warn(`Dropped ${droppedRoutes} malformed route(s) from PassioGO!`);

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
   * Fetches the current active bus list from PassioGO! and merges metadata
   * into in-memory state, preserving any live positions already tracked via WS.
   * Called by the hourly cron as a metadata refresh and on-demand when the WS
   * sees an unknown bus ID.
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
        this.lastSeen.clear();
        await this.redis.set(REDIS_KEYS.SHUTTLES, [], SHUTTLES_TTL_S);
        return;
      }

      // Extract & flatten shuttles (e.g. [ [{bus1}], [{bus2}] ] -> [ {bus1}, {bus2} ])
      const flatShuttles = Object.values(shuttlesData).flat();

      // Transform/validate shuttles
      const shuttleInstances = plainToInstance(PassioShuttleDto, flatShuttles);
      const validShuttles: PassioShuttleDto[] = [];

      let droppedShuttles = 0;
      for (const shuttle of shuttleInstances) {
        try {
          await validateOrReject(shuttle);
          validShuttles.push(shuttle);
        } catch {
          droppedShuttles++;
        }
      }
      if (droppedShuttles > 0) this.logger.warn(`Dropped ${droppedShuttles} malformed shuttle(s) from PassioGO!`);

      // Preserve live positions already tracked via WS — the REST snapshot has
      // stale coords but authoritative metadata (busName, color, route, capacity)
      const livePositions = new Map(
        this.latestShuttles.map(s => [s.id, {
          latitude: s.latitude, longitude: s.longitude,
          heading: s.heading, paxLoad: s.paxLoad,
        }]),
      );

      this.latestShuttles = validShuttles.map((shuttle) => {
        const mapped: MapShuttle = {
          id: shuttle.busId.toString(),
          busName: shuttle.busName,
          color: shuttle.color,
          routeId: shuttle.routeId,
          route: shuttle.route,
          latitude: parseFloat(shuttle.latitude),
          longitude: parseFloat(shuttle.longitude),
          heading: typeof shuttle.calculatedCourse === 'string'
            ? parseFloat(shuttle.calculatedCourse)
            : (shuttle.calculatedCourse || 0),
          paxLoad: shuttle.paxLoad || 0,
          capacity: shuttle.totalCap || 0,
        };
        const live = livePositions.get(mapped.id);
        return live ? { ...mapped, ...live } : mapped;
      });

      // Seed lastSeen for buses not yet seen via WS (gives them the 2-min grace window)
      const now = Date.now();
      for (const s of this.latestShuttles) {
        if (!this.lastSeen.has(s.id)) this.lastSeen.set(s.id, now);
      }

      await this.redis.set(REDIS_KEYS.SHUTTLES, this.latestShuttles, SHUTTLES_TTL_S);
    } catch (error) {
      this.logger.error('Failed to fetch shuttle data:', error);
    }
  }

  /**
   * Retrieve shuttle ETAs
   */
  async getStopETAs(stopId: string): Promise<RouteArrival[]> {
    const cacheKey = `${REDIS_KEYS.ETA_PREFIX}${stopId}`;
    const cached = await this.redis.get<RouteArrival[]>(cacheKey);
    if (cached) return cached;

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
      const rawArrivals = etasDict[stopId];

      if (!rawArrivals || !Array.isArray(rawArrivals)) return [];

      const arrivalInstances = plainToInstance(PassioEtaDto, rawArrivals);
      const validArrivals: PassioEtaDto[] = [];
      let droppedEtas = 0;
      for (const instance of arrivalInstances) {
        try {
          await validateOrReject(instance);
          validArrivals.push(instance);
        } catch {
          droppedEtas++;
        }
      }
      if (droppedEtas > 0) this.logger.warn(`Dropped ${droppedEtas} malformed ETA frame(s) from PassioGO! (stop ${stopId})`);

      const arrivals: RouteArrival[] = [];
      for (const arrival of validArrivals) {
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

      const sorted = arrivals.sort((a, b) => (a.etaMinutes as number) - (b.etaMinutes as number));
      await this.redis.set(cacheKey, sorted, ETA_TTL_S);
      return sorted;

    } catch (error) {
      this.logger.error(`Failed to fetch ETAs for stop ${stopId}`, error);
      return [];
    }
  }
}
