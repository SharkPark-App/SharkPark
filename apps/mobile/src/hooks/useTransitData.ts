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

  // Fetch static/non-live shuttle data
  const loadInitialShuttles = useCallback(async () => {
    try {
      const initialData = await TransitService.getLiveShuttles();
      setShuttles(initialData);
    } catch (error) {
      console.error('Error loading initial shuttles:', error);
    }
  }, []);

  useEffect(() => {
    loadInitialShuttles();
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
          // Get existing shuttle
          const index = updatedShuttles.findIndex((s) => s.id === update.id);
          
          if (index !== -1) {
            // Perform update (coords/heading)
            updatedShuttles[index] = {
              ...updatedShuttles[index],
              latitude: update.latitude,
              longitude: update.longitude,
              heading: update.heading,
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