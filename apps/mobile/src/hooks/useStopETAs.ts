// src/hooks/useStopETAs.ts
import { useState, useEffect } from 'react';
import { TransitService } from '../services/api/transit';
import type { RouteArrival } from '../types/transit';

export const useStopETAs = (stopId: string | undefined) => {
  const [arrivals, setArrivals] = useState<RouteArrival[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stopId) {
      setArrivals([]);
      return;
    }

    let isMounted = true;

    const loadETAs = async (showLoadingSpinner = true) => {
      if (showLoadingSpinner) setIsLoading(true);
      setError(null);
      
      try {
        const data = await TransitService.getStopETAs(stopId);
        if (isMounted) setArrivals(data);
      } catch (err) {
        if (isMounted) setError((err as Error).message);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    // load w/ spinner
    loadETAs(true);

    // refresh every 30 seconds while modal is open (w/o spinner)
    const intervalId = setInterval(() => {
      loadETAs(false);
    }, 30000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [stopId]);

  return { arrivals, isLoading, error };
};