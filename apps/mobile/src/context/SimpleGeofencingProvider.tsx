/**
 * Simple Geofencing Provider - Minimal version to test event flow
 */

import React, { createContext, useContext, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Alert } from 'react-native';
import { GeofenceEvent } from '../types/location';
import locationService from '../services/locationService';
import { lotsApi } from '../services/api';
import { TEST_CONSTANTS, MESSAGE_CONSTANTS } from '../constants/geofencing';

console.warn('SimpleGeofencingProvider.tsx file loaded!');

interface SimpleGeofencingContextType {
  isGeofencingActive: boolean;
  currentLotId: string | null;
}

const SimpleGeofencingContext = createContext<SimpleGeofencingContextType | undefined>(undefined);

export const SimpleGeofencingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  console.warn('[SimpleGeofencingProvider] Component rendering - FIRST LINE!');
  
  // Track which zones the user is currently inside to prevent duplicate alerts
  // This MUST be outside try/catch to ensure hooks are always called in same order
  const currentZones = useRef<Set<string>>(new Set());

  // Define sendOccupancyEvent first since it's used by handleGeofenceEvent
  const sendOccupancyEvent = useCallback(async (lotId: string, eventType: 'ENTER' | 'EXIT') => {
    try {
      console.log('[SimpleGeofencingProvider] Sending occupancy event:', {
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
      
      console.log('[SimpleGeofencingProvider] Successfully sent occupancy event');
    } catch (error) {
      console.error('[SimpleGeofencingProvider] Failed to send occupancy event:', error);
    }
  }, []);

  // Define the handler function with useCallback for stable reference
  const handleGeofenceEvent = useCallback(async (event: GeofenceEvent) => {
    console.warn(`GEOFENCE EVENT: ${event.eventType} - ${event.regionId}`);

    if (event.eventType === 'ENTER') {
      // Only show alert if we haven't already entered this zone
      if (!currentZones.current.has(event.regionId)) {
        currentZones.current.add(event.regionId);
        console.log(`[SimpleGeofencingProvider] First ENTER for ${event.regionId} - showing alert`);
        
        Alert.alert(
          'Entered Parking Lot',
          `Welcome to ${event.regionId}!\n\nYour anonymous entry has been recorded.`,
          [{ text: 'OK' }]
        );
        
        // Send anonymous occupancy event to backend
        await sendOccupancyEvent(event.regionId, 'ENTER');
      } else {
        console.log(`[SimpleGeofencingProvider] Already inside ${event.regionId} - skipping duplicate alert`);
      }
    } else if (event.eventType === 'EXIT') {
      // Only show alert if we were actually inside this zone
      if (currentZones.current.has(event.regionId)) {
        currentZones.current.delete(event.regionId);
        console.log(`[SimpleGeofencingProvider] First EXIT for ${event.regionId} - showing alert`);
        
        Alert.alert(
          'Left Parking Lot',
          `Thanks for using ${event.regionId}!\n\nYour exit has been recorded anonymously.`,
          [{ text: 'OK' }]
        );
        
        // Send anonymous occupancy event to backend
        await sendOccupancyEvent(event.regionId, 'EXIT');
      } else {
        console.log(`[SimpleGeofencingProvider] Wasn't inside ${event.regionId} - skipping duplicate exit alert`);
      }
    }
  }, [sendOccupancyEvent]);

  // Set up direct listener to locationService and start GPS tracking
  useEffect(() => {
    console.warn('[SimpleGeofencingProvider] Setting up direct locationService listener...');
    
    // Create listener function
    const geofenceListener = (event: GeofenceEvent) => {
      console.warn('[SimpleGeofencingProvider] Direct event from locationService:', event);
      handleGeofenceEvent(event);
    };
    
    // Set up direct listener on locationService
    locationService.setOnGeofenceEvent(geofenceListener);

    // START GPS TRACKING - This enables real geofencing!
    console.warn('[SimpleGeofencingProvider] Starting GPS location tracking...');
    locationService.startLocationTracking()
      .then(() => {
        console.log('[SimpleGeofencingProvider] GPS tracking started successfully');
        
        // Add ONE test geofence region for clean testing
        const testGeofenceRegions = [
          {
            id: TEST_CONSTANTS.TEST_LOT_ID,
            name: TEST_CONSTANTS.TEST_LOT_NAME,
            geometry: {
              type: 'circle' as const,
              center: {
                latitude: TEST_CONSTANTS.TEST_HOME.latitude,
                longitude: TEST_CONSTANTS.TEST_HOME.longitude,
              },
              radius: TEST_CONSTANTS.TEST_RADIUS,
            },
            notifyOnEntry: true,
            notifyOnExit: true
          }
        ];
        
        console.log('[SimpleGeofencingProvider] Adding test geofence regions:', testGeofenceRegions);
        locationService.addGeofenceRegions(testGeofenceRegions);
      })
      .catch((error) => {
        console.error('[SimpleGeofencingProvider] Failed to start GPS tracking:', error);
        Alert.alert(
          'Location Permission Required',
          MESSAGE_CONSTANTS.INFO.PRIVACY_NOTICE,
          [{ text: 'OK' }]
        );
      });

    // Cleanup
    return () => {
      console.warn('[SimpleGeofencingProvider] Cleaning up locationService listener');
      locationService.removeOnGeofenceEvent(geofenceListener);
      // Note: We don't stop location tracking on cleanup since other parts of the app might use it
    };
  }, [handleGeofenceEvent, sendOccupancyEvent]);

  const contextValue: SimpleGeofencingContextType = {
    isGeofencingActive: true,
    currentLotId: null,
  };

  console.warn('[SimpleGeofencingProvider] About to return provider...');

  return (
    <SimpleGeofencingContext.Provider value={contextValue}>
      {children}
    </SimpleGeofencingContext.Provider>
  );
};

export const useSimpleGeofencing = (): SimpleGeofencingContextType => {
  const context = useContext(SimpleGeofencingContext);
  if (context === undefined) {
    console.warn('[useSimpleGeofencing] Called outside of provider, returning defaults');
    return {
      isGeofencingActive: false,
      currentLotId: null,
    };
  }
  return context;
};
