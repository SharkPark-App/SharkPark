/**
 * useLocationService Hook
 * React hook wrapping the native BackgroundGeolocation SDK service
 */

import { useEffect, useState, useCallback } from 'react';
import locationService from '../services/locationService';
import type { GeofenceEvent, LocationError } from '../types/location';
import type { Geofence } from 'react-native-background-geolocation';

interface UseLocationServiceReturn {
  // Status
  isTracking: boolean;
  trackingMode: 'off' | 'geofences' | 'full';
  monitoredRegions: number;

  // Actions
  requestPermissions: () => Promise<boolean>;
  startGeofenceMonitoring: () => Promise<void>;
  stopTracking: () => Promise<void>;
  registerGeofences: (geofences: Geofence[]) => Promise<void>;

  // Events
  lastGeofenceEvent: GeofenceEvent | null;
  lastError: LocationError | null;
}

export const useLocationService = (): UseLocationServiceReturn => {
  const [isTracking, setIsTracking] = useState(false);
  const [trackingMode, setTrackingMode] = useState<'off' | 'geofences' | 'full'>('off');
  const [monitoredRegions, setMonitoredRegions] = useState(0);
  const [lastGeofenceEvent, setLastGeofenceEvent] = useState<GeofenceEvent | null>(null);
  const [lastError, setLastError] = useState<LocationError | null>(null);

  // Set up event listeners
  useEffect(() => {
    const removeGeofence = locationService.onGeofence((event: GeofenceEvent) => {
      setLastGeofenceEvent(event);
    });

    const removeError = locationService.onError((error: LocationError) => {
      setLastError(error);
    });

    // Initial state sync
    setIsTracking(locationService.isLocationTracking());
    setTrackingMode(locationService.getTrackingMode());
    locationService.getMonitoredRegionsCount().then(setMonitoredRegions);

    return () => {
      removeGeofence();
      removeError();
    };
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      return await locationService.requestPermissions();
    } catch (error) {
      if (__DEV__) console.error('[useLocationService] Permission request failed:', error);
      return false;
    }
  }, []);

  const startGeofenceMonitoring = useCallback(async (): Promise<void> => {
    try {
      await locationService.startGeofenceMonitoring();
      setIsTracking(true);
      setTrackingMode('geofences');
    } catch (error) {
      if (__DEV__) console.error('[useLocationService] Start geofence monitoring failed:', error);
    }
  }, []);

  const stopTracking = useCallback(async (): Promise<void> => {
    try {
      await locationService.stop();
      setIsTracking(false);
      setTrackingMode('off');
    } catch (error) {
      if (__DEV__) console.error('[useLocationService] Stop tracking failed:', error);
    }
  }, []);

  const registerGeofences = useCallback(async (geofences: Geofence[]): Promise<void> => {
    try {
      await locationService.registerGeofences(geofences);
      const count = await locationService.getMonitoredRegionsCount();
      setMonitoredRegions(count);
    } catch (error) {
      if (__DEV__) console.error('[useLocationService] Register geofences failed:', error);
    }
  }, []);

  return {
    // Status
    isTracking,
    trackingMode,
    monitoredRegions,

    // Actions
    requestPermissions,
    startGeofenceMonitoring,
    stopTracking,
    registerGeofences,

    // Events
    lastGeofenceEvent,
    lastError,
  };
};

export default useLocationService;
