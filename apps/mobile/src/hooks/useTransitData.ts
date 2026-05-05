import { useState, useEffect, useCallback, useRef } from 'react';
import { MapRoute, MapStop, MapShuttle, ShuttleLocationUpdate } from '../types/transit';
import { API_CONFIG } from '../services';
import { TransitService } from '../services/api/transit';
import { io } from 'socket.io-client';

export const useTransitData = () => {
  const [routes, setRoutes] = useState<MapRoute[]>([]);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [shuttles, setShuttles] = useState<MapShuttle[]>([]);
  // Mirror of `shuttles` we can read synchronously inside socket callbacks
  // without depending on React having flushed pending state.
  const shuttlesRef = useRef<MapShuttle[]>([]);
  shuttlesRef.current = shuttles;

  useEffect(() => {
    const loadRoutesAndStops = async () => {
      try {
        const data = await TransitService.getRoutesAndStops();
        setRoutes(data.routes);
        setStops(data.stops);
      } catch (error) {
        console.error('Error loading static transit data:', error);
      }
    };

    loadRoutesAndStops();
  }, []);

  // Fetch static shuttle metadata (busName, color, route, capacity).
  // Uses a functional update so live socket positions already in state are
  // preserved — calling this during a backfill must not teleport shuttles
  // back to the stale API snapshot.
  const loadInitialShuttles = useCallback(async () => {
    try {
      const freshData = await TransitService.getLiveShuttles();
      setShuttles((prev) => {
        if (prev.length === 0) return freshData;
        const livePositions = new Map(
          prev.map((s) => [s.id, { latitude: s.latitude, longitude: s.longitude, heading: s.heading, paxLoad: s.paxLoad }])
        );
        return freshData.map((shuttle) => {
          const live = livePositions.get(shuttle.id);
          return live ? { ...shuttle, ...live } : shuttle;
        });
      });
    } catch (error) {
      console.error('Error loading initial shuttles:', error);
    }
  }, []);

  useEffect(() => {
    loadInitialShuttles();
  }, [loadInitialShuttles]);

  // Prune out-of-service shuttles. The socket never sends a removal event —
  // a bus that goes offline just stops broadcasting. Polling the REST endpoint
  // every 60s keeps the list in sync: any shuttle absent from the response is
  // dropped from state via the functional update in loadInitialShuttles.
  useEffect(() => {
    const interval = setInterval(loadInitialShuttles, 60_000);
    return () => clearInterval(interval);
  }, [loadInitialShuttles]);

  useEffect(() => {
    const socket = io(API_CONFIG.SOCKET_ORIGIN + '/shuttles', {
      transports: ['websocket'],
      path: API_CONFIG.SOCKET_PATH,
      auth: { token: API_CONFIG.WS_SECRET },
    });

    if (__DEV__) {
      socket.on('connect', () => {
        console.log('[useTransitData] Socket connection success:', socket.id);
      });

      socket.on('disconnect', (reason) => {
        console.log('[useTransitData] Socket disconnected. Reason:', reason);
      });

      socket.on('connect_error', (error) => {
        console.warn('[useTransitData] Socket connection error:', error.message);
      });
    }

    // Merge live shuttle updates into existing state
    socket.on('shuttle_update', (updates: ShuttleLocationUpdate[]) => {
      // Determine up-front whether any incoming update belongs to a shuttle
      // we haven't seen yet. We read from a ref so the decision doesn't
      // depend on whether React has flushed pending state from the updater.
      const knownIds = new Set(shuttlesRef.current.map((s) => s.id));
      const sawUnknownShuttle = updates.some((u) => !knownIds.has(u.id));

      setShuttles((prevShuttles) => {
        const updatedShuttles = [...prevShuttles];

        updates.forEach((update) => {
          // Get existing shuttle
          const index = updatedShuttles.findIndex((s) => s.id === update.id);

          if (index !== -1) {
            // Perform update (coords/heading/paxLoad)
            updatedShuttles[index] = {
              ...updatedShuttles[index],
              latitude: update.latitude,
              longitude: update.longitude,
              heading: update.heading,
              paxLoad: update.paxLoad ?? updatedShuttles[index].paxLoad,
            };
          } else {
            // Shuttle not seeded by the daily cron yet (e.g. went on-route
            // mid-day). Insert a placeholder so it still renders; the next
            // refresh below backfills the static metadata (busName/color).
            updatedShuttles.push({
              id: update.id,
              busName: 'Shuttle',
              route: '',
              routeId: '',
              latitude: update.latitude,
              longitude: update.longitude,
              heading: update.heading,
              paxLoad: update.paxLoad ?? 0,
              capacity: 0,
            });
          }
        });

        return updatedShuttles;
      });

      // Pull the static metadata once for the new shuttle so the placeholder
      // gets its real busName/color/route without waiting for the daily cron.
      if (sawUnknownShuttle) {
        loadInitialShuttles();
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [loadInitialShuttles]);

  return { routes, stops, shuttles };
};