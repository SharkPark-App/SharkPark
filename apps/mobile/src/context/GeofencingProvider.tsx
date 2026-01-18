/**
 * GeofencingProvider
 * Background geofencing service that automatically detects parking lot entry/exit
 * No UI required - runs silently in the background when permissions are granted
 */

import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { Alert } from 'react-native';
import { useLocationService } from '../hooks/useLocationService';
import { useAllLotsData } from '../hooks/useAllLotsData';
import { createGeofenceRegionsFromLots, prioritizeGeofenceRegions } from '../utils/geofenceUtils';
import { lotsApi, ParkingLotResponse } from '../services/api';
import { GeofenceEvent } from '../types/location';

// Top-level log to confirm file is loaded
console.warn('GeofencingProvider.tsx file loaded!');

interface GeofencingContextType {
  isGeofencingActive: boolean;
  currentLotId: string | null;
}

const GeofencingContext = createContext<GeofencingContextType | undefined>(undefined);

export const GeofencingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  console.warn('[GeofencingProvider] Component rendering - FIRST LINE!');
  console.warn('[GeofencingProvider] Component rendering...');
  
  try {
    const { lots, loading: lotsLoading, error: lotsError } = useAllLotsData();
    const {
      isTracking,
      permissionStatus,
      addGeofenceRegions,
      lastGeofenceEvent,
      requestPermissions,
      startTracking,
    } = useLocationService();

    console.warn('🚨 [GeofencingProvider] State:', {
      lotsCount: lots.length,
      lotsLoading,
      lotsError: !!lotsError,
      isTracking,
      permissionGranted: permissionStatus?.granted,
      lastGeofenceEvent
    });

  const isInitialized = useRef(false);
  const currentLotId = useRef<string | null>(null);

  // Auto-initialize geofencing when lots data is available and permissions are granted
  useEffect(() => {
    if (lots.length > 0 && !isInitialized.current && !lotsLoading && !lotsError) {
      initializeBackgroundGeofencing();
    }
  }, [lots, lotsLoading, lotsError, permissionStatus]);

  // Handle geofence events automatically
  useEffect(() => {
    console.warn('🎯 [GeofencingProvider] lastGeofenceEvent changed:', lastGeofenceEvent);
    if (lastGeofenceEvent) {
      console.warn('🎯 [GeofencingProvider] Processing geofence event...');
      handleGeofenceEvent(lastGeofenceEvent);
    }
  }, [lastGeofenceEvent]);

  const initializeBackgroundGeofencing = async () => {
    try {
      console.log('[GeofencingProvider] Auto-initializing background geofencing...');
      
      // Request permissions if not already granted
      if (!permissionStatus?.granted) {
        const permissionsGranted = await requestPermissions();
        if (!permissionsGranted) {
          console.log('[GeofencingProvider] Permissions not granted, geofencing disabled');
          return;
        }
      }

      // Start tracking if not already active
      if (!isTracking) {
        const trackingStarted = await startTracking();
        if (!trackingStarted) {
          console.log('[GeofencingProvider] Failed to start location tracking');
          return;
        }
      }

      // Create geofence regions from parking lot data
      const allRegions = createGeofenceRegionsFromLots(lots);
      const prioritizedRegions = prioritizeGeofenceRegions(allRegions, 20);
      
      console.log('[GeofencingProvider] Setting up', prioritizedRegions.length, 'geofence regions');
      addGeofenceRegions(prioritizedRegions);

      isInitialized.current = true;
      console.log('[GeofencingProvider] Background geofencing initialized successfully');
    } catch (error) {
      console.error('[GeofencingProvider] Failed to initialize background geofencing:', error);
    }
  };

  const handleGeofenceEvent = (event: GeofenceEvent) => {
    console.log('[GeofencingProvider] Background geofence event:', event);
    console.warn(`🎯 GEOFENCE EVENT: ${event.eventType} - ${event.regionId}`);

    // Find the lot info
    const lot: ParkingLotResponse | undefined = lots.find((l: ParkingLotResponse) => l.lot_id === event.regionId);
    const lotName: string = lot?.display_name || lot?.lot_name || event.regionId;

    if (event.eventType === 'ENTER') {
      currentLotId.current = event.regionId;
      
      // Discrete notification for entry
      Alert.alert(
        '🅿️ Entered Parking Lot',
        `Welcome to ${lotName}!\n\nYour anonymous entry has been recorded to help other students find parking.`,
        [{ text: 'OK' }]
      );

      // Send anonymous occupancy event to backend
      sendOccupancyEvent(event.regionId, 'ENTER');
    } else if (event.eventType === 'EXIT') {
      currentLotId.current = null;
      
      // Discrete notification for exit
      Alert.alert(
        '🚗 Left Parking Lot',
        `Thanks for using ${lotName}!\n\nYour exit has been recorded anonymously.`,
        [{ text: 'OK' }]
      );

      // Send anonymous occupancy event to backend
      sendOccupancyEvent(event.regionId, 'EXIT');
    }
  };

  const sendOccupancyEvent = async (lotId: string, eventType: 'ENTER' | 'EXIT') => {
    try {
      console.log('[GeofencingProvider] Sending occupancy event:', {
        lotId,
        eventType,
        timestamp: new Date().toISOString(),
        source: 'GEOFENCE',
        // NO user coordinates or identifiers stored!
      });

      await lotsApi.recordOccupancyEvent({ 
        lotId, 
        eventType, 
        source: 'GEOFENCE' 
      });
      
      console.log('[GeofencingProvider] Successfully sent occupancy event');
    } catch (error) {
      console.error('[GeofencingProvider] Failed to send occupancy event:', error);
    }
  };

  const contextValue: GeofencingContextType = {
    isGeofencingActive: isTracking && isInitialized.current,
    currentLotId: currentLotId.current,
  };

  return (
    <GeofencingContext.Provider value={contextValue}>
      {children}
    </GeofencingContext.Provider>
  );
  
  } catch (error) {
    console.error('[GeofencingProvider] Error during render:', error);
    
    // Return a safe fallback provider
    const fallbackValue: GeofencingContextType = {
      isGeofencingActive: false,
      currentLotId: null,
    };

    return (
      <GeofencingContext.Provider value={fallbackValue}>
        {children}
      </GeofencingContext.Provider>
    );
  }
};

export const useGeofencing = (): GeofencingContextType => {
  const context = useContext(GeofencingContext);
  if (context === undefined) {
    // Return safe defaults instead of throwing error during development
    console.warn('[useGeofencing] Called outside of GeofencingProvider, returning defaults');
    return {
      isGeofencingActive: false,
      currentLotId: null,
    };
  }
  return context;
};
