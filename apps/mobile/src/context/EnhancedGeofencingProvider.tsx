/**
 * Enhanced Geofencing Provider with Parking Validation
 * Integrates client-side behavioral analysis into the geofencing workflow
 * 
 * This provider:
 * - Maintains all existing geofencing functionality
 * - Adds parking validation to geofence events
 * - Collects behavioral data during parking sessions
 * - Includes validation results in occupancy events sent to backend
 */

import React, { createContext, useContext, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { GeofenceEvent } from '../types/location';
import locationService from '../services/locationService';
import parkingValidationService from '../services/parkingValidationService';
import { lotsApi } from '../services/api';
import { TEST_CONSTANTS, MESSAGE_CONSTANTS } from '../constants/geofencing';
import { ValidationAnalysis } from '../validation';

interface EnhancedGeofencingContextType {
  isGeofencingActive: boolean;
  currentLotId: string | null;
  currentValidationStatus: ValidationAnalysis | null;
  debugInfo: {
    activeSessions: number;
    isCollectingData: boolean;
  };
}

const EnhancedGeofencingContext = createContext<EnhancedGeofencingContextType | undefined>(undefined);

export const EnhancedGeofencingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  
  // Track current parking state
  const currentZones = useRef<Set<string>>(new Set());
  const currentLotId = useRef<string | null>(null);
  const currentValidationStatus = useRef<ValidationAnalysis | null>(null);
  const lastLocationUpdate = useRef<{ speed?: number; accuracy?: number } | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const dataCollectionInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enhanced occupancy event with validation data
  const sendValidatedOccupancyEvent = useCallback(async (
    lotId: string, 
    eventType: 'ENTER' | 'EXIT', 
    validationAnalysis?: ValidationAnalysis | null
  ) => {
    try {
      console.log(`[EnhancedGeofencing] Sending ${eventType} event for ${lotId}`, {
        hasValidation: !!validationAnalysis,
        status: validationAnalysis?.status,
        confidence: validationAnalysis?.confidenceScore
      });

      // Base occupancy event (matches existing API)
      const occupancyEventData = {
        lotId,
        eventType,
        source: 'GEOFENCE' as const,
        // Enhanced with client-side validation results
        ...(validationAnalysis && {
          validation_status: validationAnalysis.status,
          confidence_score: validationAnalysis.confidenceScore,
          analysis_metadata: {
            speed_transition_score: validationAnalysis.speedTransitionScore,
            dwell_time_score: validationAnalysis.dwellTimeScore,
            movement_pattern_score: validationAnalysis.movementPatternScore,
            bluetooth_score: validationAnalysis.bluetoothScore,
            event_count: validationAnalysis.metadata.event_count,
            time_span_minutes: validationAnalysis.metadata.time_span_minutes,
            analysis_timestamp: validationAnalysis.metadata.analysis_timestamp
          }
        })
      };

      await lotsApi.recordOccupancyEvent(occupancyEventData);
      console.log(`[EnhancedGeofencing] Successfully sent validated occupancy event`);
      
    } catch (error) {
      console.error(`[EnhancedGeofencing] Failed to send occupancy event:`, error);
    }
  }, []);

  // Enhanced geofence event handler with parking validation
  const handleGeofenceEvent = useCallback(async (event: GeofenceEvent) => {
    console.log(`[EnhancedGeofencing] Geofence event: ${event.eventType} ${event.regionId}`);

    if (event.eventType === 'ENTER') {
      // Only show alert if we weren't already inside this zone
      if (!currentZones.current.has(event.regionId)) {
        currentZones.current.add(event.regionId);
        currentLotId.current = event.regionId;

        Alert.alert(
          'Entered Parking Lot',
          `Welcome to ${event.regionId}!\n\nWe're now tracking your parking behavior to improve occupancy accuracy. All analysis happens on your device - your location is never stored.`,
          [{ text: 'OK' }]
        );

        // Start parking validation session
        try {
          const sessionId = await parkingValidationService.startParkingSession(event);
          console.log(`[EnhancedGeofencing] Started validation session: ${sessionId}`);
          
          // Start location data collection for behavioral analysis
          startLocationDataCollection();
        } catch (error) {
          console.error('[EnhancedGeofencing] Failed to start parking validation:', error);
        }

        // Send occupancy event without validation data (entry)
        await sendValidatedOccupancyEvent(event.regionId, 'ENTER');
      }
    } else if (event.eventType === 'EXIT') {
      // Only process if we were actually inside this zone
      if (currentZones.current.has(event.regionId)) {
        currentZones.current.delete(event.regionId);
        currentLotId.current = null;
        
        // Complete parking validation and get analysis
        try {
          const analysis = await parkingValidationService.completeParkingSession(event);
          currentValidationStatus.current = analysis;

          let alertMessage = `Thanks for using ${event.regionId}!`;
          if (analysis) {
            switch (analysis.status) {
              case 'PARKED':
                alertMessage += `\n\nOur analysis shows you parked here (${Math.round(analysis.confidenceScore * 100)}% confidence). This helps us provide accurate availability data!`;
                break;
              case 'DROVE_THROUGH':
                alertMessage += `\n\nIt looks like you drove through without parking. Thanks for helping us maintain accurate lot data!`;
                break;
              case 'SEARCHING':
                alertMessage += `\n\nWe detected you were searching for parking. This helps us understand lot usage patterns.`;
                break;
              default:
                alertMessage += `\n\nYour parking behavior analysis is complete.`;
            }
          }

          Alert.alert('Left Parking Lot', alertMessage, [{ text: 'OK' }]);

          // Send enhanced occupancy event with validation results
          await sendValidatedOccupancyEvent(event.regionId, 'EXIT', analysis);
          
          // Stop location data collection
          stopLocationDataCollection();
        } catch (error) {
          console.error('[EnhancedGeofencing] Failed to complete parking validation:', error);
          
          // Still send basic occupancy event
          await sendValidatedOccupancyEvent(event.regionId, 'EXIT');
        }
      }
    }
  }, [sendValidatedOccupancyEvent]);

  // Location data collection for behavioral analysis
  const startLocationDataCollection = useCallback(() => {
    console.log('[EnhancedGeofencing] Starting location data collection');
    
    // Set up location update listener for behavioral data
    const locationUpdateInterval = setInterval(() => {
      if (currentLotId.current && lastLocationUpdate.current) {
        // Record behavioral events based on location data
        recordBehavioralEvents();
      }
    }, 5000); // Every 5 seconds

    // Store interval reference for cleanup
    dataCollectionInterval.current = locationUpdateInterval;
  }, []);

  const stopLocationDataCollection = useCallback(() => {
    console.log('[EnhancedGeofencing] Stopping location data collection');
    
    if (dataCollectionInterval.current) {
      clearInterval(dataCollectionInterval.current);
      dataCollectionInterval.current = null;
    }
  }, []);

  const recordBehavioralEvents = useCallback(() => {
    if (!lastLocationUpdate.current) return;

    const { speed, accuracy } = lastLocationUpdate.current;

    // Determine event type based on speed
    let eventType: 'STATIONARY' | 'WALKING' | 'DRIVING' | 'SPEED_CHANGE' = 'STATIONARY';
    if (speed !== undefined) {
      if (speed < 1) eventType = 'STATIONARY';
      else if (speed < 5) eventType = 'WALKING';
      else if (speed > 10) eventType = 'DRIVING';
      else eventType = 'SPEED_CHANGE';
    }

    // Record the behavioral event
    parkingValidationService.recordBehavioralEvent(eventType, {
      speed_mph: speed,
      accuracy_meters: accuracy,
      bluetooth_state: 'UNKNOWN', // Could be enhanced with actual Bluetooth detection
      raw_data: {
        app_state: appState.current,
        timestamp: new Date().toISOString()
      }
    });
  }, []);

  // Mock location updates for demonstration (in real app, this would come from location service)
  useEffect(() => {
    const mockLocationUpdates = setInterval(() => {
      // Simulate varying speed and accuracy for behavioral analysis
      const mockSpeed = Math.random() < 0.3 ? 0 : Math.random() * 20; // 30% chance of being stationary
      const mockAccuracy = 5 + Math.random() * 20; // 5-25 meter accuracy
      
      lastLocationUpdate.current = {
        speed: mockSpeed,
        accuracy: mockAccuracy
      };
    }, 2000); // Every 2 seconds

    return () => clearInterval(mockLocationUpdates);
  }, []);

  // App state monitoring for behavioral context
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      appState.current = nextAppState;
      
      if (currentLotId.current) {
        // Record app state changes during parking sessions
        parkingValidationService.recordBehavioralEvent('GPS_ACCURACY_CHANGE', {
          raw_data: {
            app_state_change: nextAppState,
            timestamp: new Date().toISOString()
          }
        });
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, []);

  // Set up geofencing and validation
  useEffect(() => {
    // Set up geofence event listener
    const geofenceListener = (event: GeofenceEvent) => {
      handleGeofenceEvent(event);
    };
    
    locationService.setOnGeofenceEvent(geofenceListener);

    // Set up validation completion listener
    const validationListener = (analysis: ValidationAnalysis, lotId: string) => {
      currentValidationStatus.current = analysis;
      console.log(`[EnhancedGeofencing] Validation completed for ${lotId}:`, analysis.status);
    };
    
    parkingValidationService.onValidationComplete(validationListener);

    // Start GPS tracking with single test geofence
    locationService.startLocationTracking()
      .then(() => {
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
        
        locationService.addGeofenceRegions(testGeofenceRegions);
        console.log('[EnhancedGeofencing] Geofencing with parking validation initialized');
      })
      .catch((error) => {
        console.error('[EnhancedGeofencing] Failed to start GPS tracking:', error);
        Alert.alert(
          'Location Permission Required',
          'Location access is needed for parking lot detection and behavioral analysis. ' + MESSAGE_CONSTANTS.INFO.PRIVACY_NOTICE,
          [{ text: 'OK' }]
        );
      });

    // Cleanup
    return () => {
      locationService.removeOnGeofenceEvent(geofenceListener);
      parkingValidationService.removeValidationListener(validationListener);
      stopLocationDataCollection();
    };
  }, [handleGeofenceEvent, startLocationDataCollection, stopLocationDataCollection]);

  const contextValue: EnhancedGeofencingContextType = {
    isGeofencingActive: true,
    currentLotId: currentLotId.current,
    currentValidationStatus: currentValidationStatus.current,
    debugInfo: parkingValidationService.getDebugInfo()
  };

  return (
    <EnhancedGeofencingContext.Provider value={contextValue}>
      {children}
    </EnhancedGeofencingContext.Provider>
  );
};

export const useEnhancedGeofencing = (): EnhancedGeofencingContextType => {
  const context = useContext(EnhancedGeofencingContext);
  if (context === undefined) {
    return {
      isGeofencingActive: false,
      currentLotId: null,
      currentValidationStatus: null,
      debugInfo: {
        activeSessions: 0,
        isCollectingData: false
      }
    };
  }
  return context;
};

export default EnhancedGeofencingProvider;
