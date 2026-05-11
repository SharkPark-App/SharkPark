import { useState, useEffect, useCallback, useRef } from 'react';
import { MapRoute, MapStop, MapShuttle, ShuttleLocationUpdate } from '../types/transit';
import { API_CONFIG } from '../services';
import { TransitService } from '../services/api/transit';
import { io } from 'socket.io-client';

// Debounce window for the on-demand metadata refetch when the socket
// reports a bus ID we don't have in local state. Long enough to coalesce
// the burst of frames a newly-active bus emits, short enough that the
// shuttle appears on the map within ~1.5s instead of waiting for the
// next 60s polling tick.
const UNKNOWN_BUS_REFETCH_DEBOUNCE_MS = 1500;

export const useTransitData = () => {
  const [routes, setRoutes] = useState<MapRoute[]>([]);
  const [stops, setStops] = useState<MapStop[]>([]);
  const [shuttles, setShuttles] = useState<MapShuttle[]>([]);
  // Snapshot of the latest known shuttle IDs, kept in a ref so the socket
  // effect (which intentionally has [] deps to avoid socket churn) can
  // detect unknown IDs without re-subscribing on every state change.
  const knownShuttleIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loadRoutesAndStops = async () => {
      try {
        const data = await TransitService.getRoutesAndStops();
        setRoutes(data.routes);
        setStops(data.stops);
      } catch (error) {
        if (__DEV__) console.error('Error loading static transit data:', error);
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
        if (prev.length === 0) {
          knownShuttleIdsRef.current = new Set(freshData.map((s) => s.id));
          return freshData;
        }
        const livePositions = new Map(
          prev.map((s) => [s.id, { latitude: s.latitude, longitude: s.longitude, heading: s.heading, paxLoad: s.paxLoad }])
        );
        const merged = freshData.map((shuttle) => {
          const live = livePositions.get(shuttle.id);
          return live ? { ...shuttle, ...live } : shuttle;
        });
        knownShuttleIdsRef.current = new Set(merged.map((s) => s.id));
        return merged;
      });
    } catch (error) {
      if (__DEV__) console.error('Error loading initial shuttles:', error);
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

    // Debounced refetch when the socket reports a bus we don't know about.
    // Coalesces the burst of frames from a newly-active bus into a single
    // metadata GET so the marker appears within ~1.5s of the first frame
    // instead of waiting for the next 60s polling tick.
    let unknownBusTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleUnknownBusRefetch = () => {
      if (unknownBusTimer) return;
      unknownBusTimer = setTimeout(() => {
        unknownBusTimer = null;
        void loadInitialShuttles();
      }, UNKNOWN_BUS_REFETCH_DEBOUNCE_MS);
    };

    // Merge live shuttle updates into existing state
    socket.on('shuttle_update', (updates: ShuttleLocationUpdate[]) => {
      // Detect unknown IDs synchronously against the ref snapshot — doing
      // it inside the setShuttles updater is unsafe under React's
      // automatic batching (the updater can run after the if-check below).
      const sawUnknown = updates.some((u) => !knownShuttleIdsRef.current.has(u.id));

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
          // Unknown IDs are intentionally not appended to state — we wait
          // for the metadata refetch (scheduled below) to bring in colour /
          // route info before showing the marker.
        });

        return updatedShuttles;
      });

      if (sawUnknown) scheduleUnknownBusRefetch();
    });

    return () => {
      if (unknownBusTimer) clearTimeout(unknownBusTimer);
      socket.disconnect();
    };
  }, [loadInitialShuttles]);

  return { routes, stops, shuttles };
};