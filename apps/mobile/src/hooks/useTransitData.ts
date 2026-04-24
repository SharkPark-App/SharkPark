import { useState, useEffect } from 'react';
import { MapRoute, MapStop, MapShuttle } from '../types/transit';
import { TransitService } from '../services/api/transit';

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

  // Refresh shuttles (every 10 seconds as per backend)
  useEffect(() => {
    const loadShuttles = async () => {
      try {
        const liveShuttles = await TransitService.getLiveShuttles();
        setShuttles(liveShuttles);
      } catch (error) {
        console.error('Error loading live shuttles:', error);
      }
    };

    loadShuttles(); // Initial fetch
    const intervalId = setInterval(loadShuttles, 10000); // Poll w/ delay

    return () => clearInterval(intervalId); // Cleanup
  }, []);

  return { routes, stops, shuttles };
};