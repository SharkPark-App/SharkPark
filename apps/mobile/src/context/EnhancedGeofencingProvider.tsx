/**
 * Enhanced Geofencing Provider with Parking Validation and Leave Detection
 * Integrates client-side behavioral analysis and leave intent detection into the geofencing workflow
 * 
 * This provider:
 * - Adds parking validation to geofence events
 * - Detects leave intent using behavioral patterns (walking to car, Bluetooth reconnect, speed increase)
 * - Collects behavioral data during parking sessions
 * - Includes validation and leave detection results in occupancy events sent to backend
 * - Provides real-time occupancy updates for improved user experience
 */

import React, { createContext, useContext, useEffect, useLayoutEffect, useCallback, ReactNode, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { GeofenceEvent } from '../types/location';
import locationService from '../services/locationService';
import parkingValidationService from '../services/parkingValidationService';
import leaveDetectionService, { LeaveIntentAnalysis } from '../services/leaveDetectionService';
import { lotsApi } from '../services/api';
import { TEST_CONSTANTS } from '../constants/geofencing';
import { ValidationAnalysis } from '../validation';
import { createGeofenceRegionsFromLots } from '../utils/geofenceUtils';
import { useAuth } from './AuthContext';

/**
 * Filters lots to ≤20 for OS geofence registration based on the user's CSULB
 * email suffix:
 *   @student.csulb.edu → STUDENT lots (G-lots)
 *   @csulb.edu         → EMPLOYEE lots (E-lots)
 *
 * The map always shows all lots — this filter only affects which geofences
 * are registered with the OS.
 */
export function filterLotsByUserType<T extends { lot_type: string }>(lots: T[], email: string): T[] {
  const isStudent = email.endsWith('@student.csulb.edu');
  const isEmployee = !isStudent && email.endsWith('@csulb.edu');

  let filtered: T[];
  if (isStudent) {
    filtered = lots.filter(l => l.lot_type === 'STUDENT');
  } else if (isEmployee) {
    filtered = lots.filter(l => l.lot_type === 'EMPLOYEE');
  } else {
    // Fallback: no email match — register no geofences (all CSULB users must log in)
    filtered = [];
  }

  // Safety cap: OS hard limit is 20 simultaneous geofences
  return filtered.slice(0, 20);
}

interface EnhancedGeofencingContextType {
  isGeofencingActive: boolean;
  currentLotId: string | null;
  currentValidationStatus: ValidationAnalysis | null;
  currentLeaveIntent: LeaveIntentAnalysis | null;
  debugInfo: {
    activeSessions: number;
    isCollectingData: boolean;
    activeLeaveMonitoring: number;
    isMonitoringLeave: boolean;
  };
}

const EnhancedGeofencingContext = createContext<EnhancedGeofencingContextType | undefined>(undefined);

export const EnhancedGeofencingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  
  const { user } = useAuth();

  // Track current parking state
  const currentZones = useRef<Set<string>>(new Set());
  const [currentLotId, setCurrentLotId] = useState<string | null>(null);
  const currentLotIdRef = useRef<string | null>(null); // ref copy for use inside callbacks
  const [currentValidationStatus, setCurrentValidationStatus] = useState<ValidationAnalysis | null>(null);
  const [currentLeaveIntent, setCurrentLeaveIntent] = useState<LeaveIntentAnalysis | null>(null);
  const lastLocationUpdate = useRef<{ speed?: number; accuracy?: number } | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const dataCollectionInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable refs that always point to the latest callback.
  // The setup effect captures these refs (not the callbacks themselves), so it
  // never needs to re-run because a callback identity changed.
  const handleGeofenceEventRef = useRef<(event: GeofenceEvent) => void>(() => {});
  const startLocationDataCollectionRef = useRef<() => void>(() => {});
  const stopLocationDataCollectionRef = useRef<() => void>(() => {});

  // Enhanced occupancy event with validation data
  const sendValidatedOccupancyEvent = useCallback(async (
    lotId: string,
    eventType: 'ENTER' | 'EXIT'
  ) => {
    const occupancyEventData = {
      lotId,
      eventType,
      source: 'GEOFENCE' as const
    };
    try {
      await lotsApi.recordOccupancyEvent(occupancyEventData);
    } catch (error) {
      if (__DEV__) console.error(`[EnhancedGeofencing] Failed to send occupancy event:`, error);
    }
  }, []);

  // Enhanced geofence event handler with parking validation
  const handleGeofenceEvent = useCallback(async (event: GeofenceEvent) => {

    if (event.eventType === 'ENTER') {
      if (!currentZones.current.has(event.regionId)) {
        currentZones.current.add(event.regionId);
        setCurrentLotId(event.regionId);
        currentLotIdRef.current = event.regionId;

        if (__DEV__) {
          Alert.alert(
            '[DEV] Entered Parking Lot',
            `Welcome to ${event.regionId}! Monitoring parking behavior and leave detection.`,
            [{ text: 'OK' }]
          );
        }

        try {
          await parkingValidationService.startParkingSession(event);
          await leaveDetectionService.startLeaveMonitoring(event, {
            onLeaveIntentDetected: async (analysis: LeaveIntentAnalysis, lotId: string) => {
              setCurrentLeaveIntent(analysis);
              // NOTE: Do NOT send an occupancy event here. Leave intent is a predictive
              // signal only — the authoritative EXIT event is sent when the user actually
              // leaves the geofence (see the EXIT branch below).
              if (analysis.confidence_level === 'HIGH' && __DEV__) {
                Alert.alert(
                  '[DEV] Preparing to Leave?',
                  `Leave intent detected for ${lotId} (HIGH confidence).`,
                  [{ text: 'OK' }]
                );
              }
            },
            onLeaveConfirmed: () => {},
            onError: (error: string) => {
              if (__DEV__) console.error('[EnhancedGeofencing] Leave detection error:', error);
            }
          });
          startLocationDataCollectionRef.current();
        } catch (error) {
          if (__DEV__) console.error('[EnhancedGeofencing] Failed to start parking validation:', error);
        }

        await sendValidatedOccupancyEvent(event.regionId, 'ENTER');
      }
    } else if (event.eventType === 'EXIT') {
      if (currentZones.current.has(event.regionId)) {
        currentZones.current.delete(event.regionId);
        setCurrentLotId(null);
        currentLotIdRef.current = null;

        try {
          const analysis = await parkingValidationService.completeParkingSession(event);
          setCurrentValidationStatus(analysis);

          const leaveAnalysis = await leaveDetectionService.completeLeaveMonitoring(event);
          setCurrentLeaveIntent(null);

          if (__DEV__) {
            let alertMessage = `Thanks for using ${event.regionId}!`;
            if (analysis) {
              switch (analysis.status) {
                case 'PARKED':
                  alertMessage += `\n\nParked (${Math.round(analysis.confidenceScore * 100)}% confidence).`;
                  break;
                case 'DROVE_THROUGH':
                  alertMessage += `\n\nDrove through without parking.`;
                  break;
                case 'SEARCHING':
                  alertMessage += `\n\nSearching for parking detected.`;
                  break;
              }
            }
            if (leaveAnalysis && leaveAnalysis.intent_probability > 0.5) {
              alertMessage += `\n\nLeave intent: ${Math.round(leaveAnalysis.intent_probability * 100)}% confidence.`;
            }
            Alert.alert('[DEV] Left Parking Lot', alertMessage, [{ text: 'OK' }]);
          }

          await sendValidatedOccupancyEvent(event.regionId, 'EXIT');
          stopLocationDataCollectionRef.current();
        } catch (error) {
          if (__DEV__) console.error('[EnhancedGeofencing] Failed to complete parking validation:', error);
          await sendValidatedOccupancyEvent(event.regionId, 'EXIT');
        }
      }
    }
  }, [sendValidatedOccupancyEvent]);

  // Keep ref in sync so the setup effect can call the latest version without
  // being listed as a dependency (which would cause it to re-fire on every render).
  useLayoutEffect(() => { handleGeofenceEventRef.current = handleGeofenceEvent; });

  // Location data collection for behavioral analysis
  const startLocationDataCollection = useCallback(() => {
    // Set up location update listener for behavioral data
    const locationUpdateInterval = setInterval(() => {
      if (currentLotIdRef.current && lastLocationUpdate.current) {
        // Record behavioral events based on location data
        recordBehavioralEvents();
      }
    }, 5000); // Every 5 seconds

    // Store interval reference for cleanup
    dataCollectionInterval.current = locationUpdateInterval;
  }, []);

  useLayoutEffect(() => { startLocationDataCollectionRef.current = startLocationDataCollection; });

  const stopLocationDataCollection = useCallback(() => {
    if (dataCollectionInterval.current) {
      clearInterval(dataCollectionInterval.current);
      dataCollectionInterval.current = null;
    }
  }, []);

  useLayoutEffect(() => { stopLocationDataCollectionRef.current = stopLocationDataCollection; });

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

  // Real location updates from LocationService
  useEffect(() => {
    let locationInterval: ReturnType<typeof setInterval> | null = null;
    let isTrackingStarted = false;
    
    // Set up real location tracking using LocationService
    const startLocationUpdates = async () => {
      try {
        // Start the location service tracking
        const started = await locationService.startLocationTracking();
        if (!started) {
          if (__DEV__) console.warn('[EnhancedGeofencing] Failed to start location tracking');
          return;
        }
        
        isTrackingStarted = true;
        
        // Set up periodic location updates for the geofencing provider
        locationInterval = setInterval(async () => {
          try {
            const position = await locationService.getCurrentPosition();
            if (position && position.coords) {
              const { latitude, longitude, speed, accuracy, altitude, heading } = position.coords;
              
              // Convert speed from m/s to mph if available
              const speedMph = speed !== null && speed !== undefined ? speed * 2.237 : undefined;
              
              lastLocationUpdate.current = {
                speed: speedMph,
                accuracy: accuracy
              };

              // Feed location data to parking validation service for behavioral analysis
              parkingValidationService.updateLocation({
                latitude,
                longitude,
                accuracy: accuracy ?? 0,
                speed: speed ?? null,
                altitude: altitude ?? null,
                heading: heading ?? null
              });

              // Also feed location data to leave detection service
              leaveDetectionService.updateLocation({
                latitude,
                longitude,
                accuracy: accuracy ?? 0,
                speed: speed ?? null,
                altitude: altitude ?? null,
                heading: heading ?? null
              });
            }
          } catch (error) {
            if (__DEV__) console.warn('[EnhancedGeofencing] Failed to get current position:', error);
          }
        }, 5000); // Update every 5 seconds
        
      } catch (error) {
        if (__DEV__) console.error('[EnhancedGeofencing] Error starting location updates:', error);
      }
    };

    startLocationUpdates();

    return () => {
      if (locationInterval) {
        clearInterval(locationInterval);
      }
      if (isTrackingStarted) {
        locationService.stopLocationTracking();
      }
    };
  }, []);

  // App state monitoring for behavioral context
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      appState.current = nextAppState;
      
      if (currentLotIdRef.current) {
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
    // Wrap refs in stable lambdas — these closures never change identity, so
    // the effect is guaranteed to run exactly once on mount.
    const geofenceListener = (event: GeofenceEvent) => {
      handleGeofenceEventRef.current(event);
    };

    locationService.setOnGeofenceEvent(geofenceListener);

    // Set up validation completion listener
    const validationListener = (analysis: ValidationAnalysis) => {
      setCurrentValidationStatus(analysis);
    };

    parkingValidationService.onValidationComplete(validationListener);

    // Set up geofences from real parking lot data.
    // Note: locationService.startLocationTracking() is already called by the
    // location feed effect above - do not call it again here.
    (async () => {
      try {
        const allLots = await lotsApi.getAllLots();

        // Filter to ≤20 lots based on the user's CSULB email suffix.
        // The map always shows all lots — this only affects OS geofence registration.
        const userEmail = user?.userId ?? '';
        const lotsToFence = filterLotsByUserType(allLots, userEmail);

        if (__DEV__) {
          console.log(`[EnhancedGeofencing] User: ${userEmail}`);
          console.log(`[EnhancedGeofencing] Registering ${lotsToFence.length}/${allLots.length} lots as geofences (${lotsToFence[0]?.lot_type ?? 'none'})`);
        }

        const realGeofenceRegions = createGeofenceRegionsFromLots(lotsToFence);

        if (realGeofenceRegions.length > 0) {
          await locationService.addGeofenceRegions(realGeofenceRegions);
        } else {
          throw new Error('No valid parking lot geofences found for this user type');
        }
      } catch (error) {
        if (__DEV__) console.warn('[EnhancedGeofencing] Failed to load real parking lot data, falling back to test geofence:', error);

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
      }
    })();

    // Cleanup
    return () => {
      locationService.removeOnGeofenceEvent(geofenceListener);
      parkingValidationService.removeValidationListener(validationListener);
      stopLocationDataCollectionRef.current();
    };
  }, []); // stable: all mutable state is accessed through refs

  const contextValue: EnhancedGeofencingContextType = {
    isGeofencingActive: true,
    currentLotId,
    currentValidationStatus,
    currentLeaveIntent,
    debugInfo: {
      ...parkingValidationService.getDebugInfo(),
      ...leaveDetectionService.getDebugInfo(),
      activeLeaveMonitoring: leaveDetectionService.getDebugInfo().activeSessions,
      isMonitoringLeave: leaveDetectionService.getDebugInfo().isMonitoring
    }
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
      currentLeaveIntent: null,
      debugInfo: {
        activeSessions: 0,
        isCollectingData: false,
        activeLeaveMonitoring: 0,
        isMonitoringLeave: false
      }
    };
  }
  return context;
};

export default EnhancedGeofencingProvider;
