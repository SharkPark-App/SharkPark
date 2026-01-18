/**
 * useLocationService Hook
 * React hook for privacy-first geofencing functionality
 */

import { useEffect, useState, useCallback } from 'react';
import locationService from '../services/locationService';
import { 
  LocationPermissionStatus, 
  GeofenceEvent, 
  LocationError,
  GeofenceRegion 
} from '../types/location';

interface UseLocationServiceReturn {
  // Status
  isTracking: boolean;
  isBackgroundEnabled: boolean;
  permissionStatus: LocationPermissionStatus | null;
  monitoredRegions: number;
  
  // Actions
  requestPermissions: () => Promise<boolean>;
  requestBackgroundPermissions: () => Promise<boolean>;
  startTracking: () => Promise<boolean>;
  stopTracking: () => void;
  addGeofenceRegions: (regions: GeofenceRegion[]) => void;
  
  // Events
  lastGeofenceEvent: GeofenceEvent | null;
  lastError: LocationError | null;
}

export const useLocationService = (): UseLocationServiceReturn => {
  const [isTracking, setIsTracking] = useState(false);
  const [isBackgroundEnabled, setIsBackgroundEnabled] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<LocationPermissionStatus | null>(null);
  const [monitoredRegions, setMonitoredRegions] = useState(0);
  const [lastGeofenceEvent, setLastGeofenceEvent] = useState<GeofenceEvent | null>(null);
  const [lastError, setLastError] = useState<LocationError | null>(null);

  // Set up event listeners
  useEffect(() => {
    locationService.setOnGeofenceEvent((event: GeofenceEvent) => {
      console.log('[useLocationService] Geofence event:', event);
      setLastGeofenceEvent(event);
    });

    locationService.setOnLocationError((error: LocationError) => {
      console.log('[useLocationService] Location error:', error);
      setLastError(error);
    });

    locationService.setOnPermissionChange((status: LocationPermissionStatus) => {
      console.log('[useLocationService] Permission changed:', status);
      setPermissionStatus(status);
    });

    // Initial state sync
    setIsTracking(locationService.isLocationTracking());
    setIsBackgroundEnabled(locationService.isBackgroundTrackingEnabled());
    setMonitoredRegions(locationService.getMonitoredRegionsCount());

    return () => {
      // Cleanup is handled by the service itself
    };
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const status = await locationService.requestLocationPermission();
      setPermissionStatus(status);
      return status.granted;
    } catch (error) {
      console.error('[useLocationService] Permission request failed:', error);
      return false;
    }
  }, []);

  const requestBackgroundPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const granted = await locationService.requestBackgroundPermission();
      setIsBackgroundEnabled(granted);
      return granted;
    } catch (error) {
      console.error('[useLocationService] Background permission request failed:', error);
      return false;
    }
  }, []);

  const startTracking = useCallback(async (): Promise<boolean> => {
    try {
      const success = await locationService.startLocationTracking();
      setIsTracking(success);
      return success;
    } catch (error) {
      console.error('[useLocationService] Start tracking failed:', error);
      return false;
    }
  }, []);

  const stopTracking = useCallback(() => {
    try {
      locationService.stopLocationTracking();
      setIsTracking(false);
    } catch (error) {
      console.error('[useLocationService] Stop tracking failed:', error);
    }
  }, []);

  const addGeofenceRegions = useCallback((regions: GeofenceRegion[]) => {
    try {
      locationService.addGeofenceRegions(regions);
      setMonitoredRegions(locationService.getMonitoredRegionsCount());
    } catch (error) {
      console.error('[useLocationService] Add geofence regions failed:', error);
    }
  }, []);

  return {
    // Status
    isTracking,
    isBackgroundEnabled,
    permissionStatus,
    monitoredRegions,
    
    // Actions
    requestPermissions,
    requestBackgroundPermissions,
    startTracking,
    stopTracking,
    addGeofenceRegions,
    
    // Events
    lastGeofenceEvent,
    lastError,
  };
};

export default useLocationService;
