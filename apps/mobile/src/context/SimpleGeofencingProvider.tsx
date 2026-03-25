/**
 * Simple Geofencing Provider - Minimal version to test event flow
 */

import React, { createContext, useContext, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Alert } from 'react-native';
import { GeofenceEvent } from '../types/location';
import locationService from '../services/locationService';
import { lotsApi } from '../services/api';
import { TEST_CONSTANTS, MESSAGE_CONSTANTS } from '../constants/geofencing';
import { createGeofenceRegionsFromLots } from '../utils/geofenceUtils';

interface SimpleGeofencingContextType {
  isGeofencingActive: boolean;
  currentLotId: string | null;
}

const SimpleGeofencingContext = createContext<SimpleGeofencingContextType | undefined>(undefined);

export const SimpleGeofencingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  
  // Track which zones the user is currently inside to prevent duplicate alerts
  // This MUST be outside try/catch to ensure hooks are always called in same order
  const currentZones = useRef<Set<string>>(new Set());

  // Define sendOccupancyEvent first since it's used by handleGeofenceEvent
  const sendOccupancyEvent = useCallback(async (lotId: string, eventType: 'ENTER' | 'EXIT') => {
    try {
      await lotsApi.recordOccupancyEvent({ 
        lotId, 
        eventType, 
        source: 'GEOFENCE' 
      });
    } catch (error) {
      console.error('[SimpleGeofencingProvider] Failed to send occupancy event:', error);
    }
  }, []);

  // Define the handler function with useCallback for stable reference
  const handleGeofenceEvent = useCallback(async (event: GeofenceEvent) => {
    if (event.eventType === 'ENTER') {
      // Only show alert if we haven't already entered this zone
      if (!currentZones.current.has(event.regionId)) {
        currentZones.current.add(event.regionId);
        
        Alert.alert(
          'Entered Parking Lot',
          `Welcome to ${event.regionId}!\n\nYour anonymous entry has been recorded.`,
          [{ text: 'OK' }]
        );
        
        // Send anonymous occupancy event to backend
        await sendOccupancyEvent(event.regionId, 'ENTER');
      }
    } else if (event.eventType === 'EXIT') {
      // Only show alert if we were actually inside this zone
      if (currentZones.current.has(event.regionId)) {
        currentZones.current.delete(event.regionId);
        
        Alert.alert(
          'Left Parking Lot',
          `Thanks for using ${event.regionId}!\n\nYour exit has been recorded anonymously.`,
          [{ text: 'OK' }]
        );
        
        // Send anonymous occupancy event to backend
        await sendOccupancyEvent(event.regionId, 'EXIT');
      }
    }
  }, [sendOccupancyEvent]);

  // Set up direct listener to locationService and start GPS tracking
  useEffect(() => {
    
    // Create listener function
    const geofenceListener = (event: GeofenceEvent) => {
      handleGeofenceEvent(event);
    };
    
    // Set up direct listener on locationService
    locationService.setOnGeofenceEvent(geofenceListener);

    // START GPS TRACKING - This enables real geofencing!
    locationService.startLocationTracking()
      .then(async () => {
        try {
          console.log('[SimpleGeofencingProvider] Fetching real parking lot data for geofencing...');
          
          // Fetch all parking lots from API
          const allLots = await lotsApi.getAllLots();
          
          // Convert to geofence regions
          const realGeofenceRegions = createGeofenceRegionsFromLots(allLots);
          
          if (realGeofenceRegions.length > 0) {
            await locationService.addGeofenceRegions(realGeofenceRegions);
            console.log(`[SimpleGeofencingProvider] Successfully set up ${realGeofenceRegions.length} real parking lot geofences:`, 
              realGeofenceRegions.map(r => r.name).join(', '));
          } else {
            throw new Error('No valid parking lot geofences found');
          }
          
        } catch (error) {
          console.warn('[SimpleGeofencingProvider] Failed to load real parking lot data, falling back to test geofence:', error);
          
          // Fallback to single test geofence for development/testing
          const testGeofenceRegions = [
            {
              id: TEST_CONSTANTS.TEST_LOT_ID,
              name: TEST_CONSTANTS.TEST_LOT_NAME,
              geometry: {
                type: 'circle' as const,
                center: {
                  latitude: TEST_CONSTANTS.CSULB_CENTER.latitude,
                  longitude: TEST_CONSTANTS.CSULB_CENTER.longitude,
                },
                radius: TEST_CONSTANTS.TEST_RADIUS,
              },
              notifyOnEntry: true,
              notifyOnExit: true
            }
          ];
          
          await locationService.addGeofenceRegions(testGeofenceRegions);
          console.log('[SimpleGeofencingProvider] Using test geofence as fallback');
        }
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
      locationService.removeOnGeofenceEvent(geofenceListener);
      // Note: We don't stop location tracking on cleanup since other parts of the app might use it
    };
  }, [handleGeofenceEvent, sendOccupancyEvent]);

  const contextValue: SimpleGeofencingContextType = {
    isGeofencingActive: true,
    currentLotId: null,
  };

  return (
    <SimpleGeofencingContext.Provider value={contextValue}>
      {children}
    </SimpleGeofencingContext.Provider>
  );
};

export const useSimpleGeofencing = (): SimpleGeofencingContextType => {
  const context = useContext(SimpleGeofencingContext);
  if (context === undefined) {
    return {
      isGeofencingActive: false,
      currentLotId: null,
    };
  }
  return context;
};
