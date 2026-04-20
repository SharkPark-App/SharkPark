/* global fetch */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import type { MapStop, MapRoute, MapShuttle } from './interfaces/shuttle-tracker.interface';
import { PassioRouteDto, PassioShuttleDto, PassioStopDto } from './dto/passiogo.dto';

// Stop coords are provided as floats, but route & shuttle coords are provided as strings
interface RawRoutePoint {
  lat: string;
  lng: string;
}

/** Service for shuttle tracking - live route, stop, and shuttle updates */
@Injectable()
export class ShuttleTrackerService implements OnModuleInit {
  private latestShuttles: MapShuttle[] = [];
  private currentRoutes: MapRoute[] = [];
  private currentStops: MapStop[] = [];
  private readonly logger = new Logger(ShuttleTrackerService.name);

  async onModuleInit() {
    this.logger.log('Initializing Passio GO! transit data');
    await this.fetchRoutesAndStops(); 
    await this.fetchShuttles();
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

      if (!routesResponse.ok) throw new Error(`Routes API returned ${routesResponse.status}`);
      if (!stopsResponse.ok) throw new Error(`Stops API returned ${stopsResponse.status}`);

      const rawRoutes: unknown[] = await routesResponse.json();
      const rawMapData = await stopsResponse.json();

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

      // Map stops to inteface
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
        const rawPoints: RawRoutePoint[] = rawMapData.routePoints?.[actualRouteId] || [];
        
        const parsedCoordinates = rawPoints.map((point: RawRoutePoint) => ({
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
    } catch (error) {
      this.logger.error('Failed to parse and merge static data', error);
    }
  }

  /**
   * Retrieves list of active shuttles
   */
  async fetchShuttles() {
    try {
      const shuttlesResponse = await fetch('https://passiogo.com/mapGetData.php?getBuses=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s0: 4163, sA: 1 }),
      });
      
      if (!shuttlesResponse.ok) {
        throw new Error(`Shuttles API returned HTTP ${shuttlesResponse.status}`);
      }

      const rawShuttles = await shuttlesResponse.json();
      const shuttlesData = rawShuttles.buses || {};

      // One shuttle with ID -1 indicates that none are active (empty array shouldn't occur, but check regardless)
      if (shuttlesData['-1'] || Object.keys(shuttlesData).length === 0) {
        this.latestShuttles = [];
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

    } catch (error) {
      this.logger.error('Failed to fetch shuttle data:', error);
    }
  }
}