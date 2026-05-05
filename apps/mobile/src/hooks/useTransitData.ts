import { useState, useEffect, useCallback } from 'react';
import { MapRoute, MapStop, MapShuttle, ShuttleLocationUpdate } from '../types/transit';
import { API_CONFIG } from '../services';
import { TransitService } from '../services/api/transit';
import { io } from 'socket.io-client';

export const useTransitData = () => {
  const [routes, setRoutes] = useState<MapRoute[]>([]);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [shuttles, setShuttles] = useState<MapShuttle[]>([]);

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
  // a bus that goes offline just stops broadcasting. The backend drops it from
  // the active-bus set after a 2-minute silence window; polling here every 60s
  // ensures that change propagates to the map within ~3 minutes of the bus
  // going dark (2-min backend TTL + up to 60s poll phase).
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
      setShuttles((prevShuttles) => {
        const updatedShuttles = [...prevShuttles];

        updates.forEach((update) => {
          const index = updatedShuttles.findIndex((s) => s.id === update.id);

          if (index !== -1) {
            updatedShuttles[index] = {
              ...updatedShuttles[index],
              latitude: update.latitude,
              longitude: update.longitude,
              heading: update.heading,
              paxLoad: update.paxLoad ?? updatedShuttles[index].paxLoad,
            };
          }
        });

        return updatedShuttles;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return { routes, stops, shuttles };
};