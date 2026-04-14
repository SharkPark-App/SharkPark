/**
 * Enhanced Geofencing Provider with Parking Validation and Leave Detection
 *
 * Uses the native BackgroundGeolocation SDK for:
 * - OS-level geofence monitoring (works backgrounded/terminated)
 * - Two-mode operation: geofence-only (low power) ↔ full tracking (inside lot)
 * - Activity recognition (STILL/ON_FOOT/IN_VEHICLE) fed to validation & leave detection
 * - Location events fed to behavioral data collection (replaces 5s polling interval)
 */

import React, { createContext, useContext, useEffect, useLayoutEffect, useCallback, ReactNode, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import type { Location, MotionActivityEvent, MotionChangeEvent } from 'react-native-background-geolocation';
import { GeofenceEvent } from '../types/location';
import locationService from '../services/locationService';
import parkingValidationService from '../services/parkingValidationService';
import leaveDetectionService, { LeaveIntentAnalysis } from '../services/leaveDetectionService';
import { sharedBehavioralCollector } from '../services/behavioralDataCollector';
import dynamicGeofenceManager from '../services/dynamicGeofenceManager';
import { lotsApi } from '../services/api';
import type { ParkingLotResponse } from '../services/api';
import { TEST_CONSTANTS } from '../constants/geofencing';
import { ValidationAnalysis } from '../validation';
import { createSDKGeofencesFromLots } from '../utils/geofenceUtils';
import { useAuth } from './AuthContext';

/**
 * @deprecated Use `dynamicGeofenceManager.computeGeofenceSet()` instead.
 *
 * Kept for backward compatibility with tests. Returns the guaranteed set
 * for the given user type (no dynamic/proximity logic).
 */
export function filterLotsByUserType<T extends { lot_type: string }>(lots: T[], email: string): T[] {
  const isStudent = email.endsWith('@student.csulb.edu');
  const isEmployee = !isStudent && email.endsWith('@csulb.edu');

  if (isStudent) return lots.filter(l => l.lot_type === 'STUDENT').slice(0, 20);
  if (isEmployee) {
    const eLots = lots.filter(l => l.lot_type === 'EMPLOYEE');
    const gLots = lots.filter(l => l.lot_type === 'STUDENT');
    return [...eLots, ...gLots].slice(0, 20);
  }
  return [];
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
  const currentLotIdRef = useRef<string | null>(null);
  const [currentValidationStatus, setCurrentValidationStatus] = useState<ValidationAnalysis | null>(null);
  const [currentLeaveIntent, setCurrentLeaveIntent] = useState<LeaveIntentAnalysis | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Mutex: serialise geofence event processing so rapid ENTER/EXIT pairs
  // cannot interleave (e.g. EXIT resolving before ENTER's startParkingSession).
  const eventQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Stable refs that always point to the latest callback.
  const handleGeofenceEventRef = useRef<(event: GeofenceEvent) => void>(() => {});

  // Stores all lots from the API so dynamic recalculation doesn't re-fetch.
  const allLotsRef = useRef<ParkingLotResponse[]>([]);

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

  // Enhanced geofence event handler with two-mode switching
  const handleGeofenceEvent = useCallback(async (event: GeofenceEvent) => {

    if (event.eventType === 'ENTER') {
      if (!currentZones.current.has(event.regionId)) {
        currentZones.current.add(event.regionId);
        setCurrentLotId(event.regionId);
        currentLotIdRef.current = event.regionId;

        if (__DEV__) {
          Alert.alert(
            '[DEV] Entered Parking Lot',
            `Welcome to ${event.regionId}! Upgrading to full tracking mode.`,
            [{ text: 'OK' }]
          );
        }

        // Upgrade to full tracking for fine-grained location + activity
        try {
          await locationService.upgradeToFullTracking();
        } catch (e) {
          if (__DEV__) console.error('[EnhancedGeofencing] Failed to upgrade tracking:', e);
        }

        try {
          await parkingValidationService.startParkingSession(event);
          await leaveDetectionService.startLeaveMonitoring(event, {
            onLeaveIntentDetected: async (analysis: LeaveIntentAnalysis, lotId: string) => {
              setCurrentLeaveIntent(analysis);
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
        } catch (error) {
          if (__DEV__) console.error('[EnhancedGeofencing] Failed to complete parking validation:', error);
          await sendValidatedOccupancyEvent(event.regionId, 'EXIT');
        }

        // Downgrade back to geofence-only (low power) if no lots active
        if (currentZones.current.size === 0) {
          try {
            await locationService.downgradeToGeofenceOnly();
          } catch (e) {
            if (__DEV__) console.error('[EnhancedGeofencing] Failed to downgrade tracking:', e);
          }
        }
      }
    }
  }, [sendValidatedOccupancyEvent]);

  // Keep ref in sync for the setup effect
  useLayoutEffect(() => {
    const inner = handleGeofenceEvent;
    handleGeofenceEventRef.current = (event: GeofenceEvent) => {
      eventQueueRef.current = eventQueueRef.current
        .then(() => inner(event))
        .catch((err) => {
          if (__DEV__) console.error('[EnhancedGeofencing] Queued event error:', err);
        });
    };
  });

  // Feed SDK location events to validation + leave detection services
  const handleLocationUpdate = useCallback((location: Location) => {
    if (!currentLotIdRef.current) return;

    const { latitude, longitude, speed, accuracy, altitude, heading } = location.coords;
    const safeSpeed = speed != null ? speed : -1;
    const speedMph = safeSpeed >= 0 ? safeSpeed * 2.237 : undefined;

    parkingValidationService.updateLocation({
      latitude,
      longitude,
      accuracy: accuracy ?? 0,
      speed: safeSpeed >= 0 ? safeSpeed : null,
      altitude: altitude ?? null,
      heading: heading ?? null,
    });

    leaveDetectionService.updateLocation({
      latitude,
      longitude,
      accuracy: accuracy ?? 0,
      speed: safeSpeed >= 0 ? safeSpeed : null,
      altitude: altitude ?? null,
      heading: heading ?? null,
    });

    // Record behavioral events based on speed
    let eventType: 'STATIONARY' | 'WALKING' | 'DRIVING' | 'SPEED_CHANGE' = 'STATIONARY';
    if (speedMph !== undefined) {
      if (speedMph < 1) eventType = 'STATIONARY';
      else if (speedMph < 5) eventType = 'WALKING';
      else if (speedMph > 10) eventType = 'DRIVING';
      else eventType = 'SPEED_CHANGE';
    }

    parkingValidationService.recordBehavioralEvent(eventType, {
      speed_mph: speedMph,
      accuracy_meters: accuracy,
      bluetooth_state: 'UNKNOWN',
      raw_data: {
        app_state: appState.current,
        timestamp: new Date().toISOString(),
      },
    });

    // Dynamic geofence recalculation on location change
    if (
      allLotsRef.current.length > 0 &&
      dynamicGeofenceManager.shouldRecalculate(latitude, longitude)
    ) {
      const userEmail = user?.userId ?? '';
      const allocation = dynamicGeofenceManager.computeGeofenceSet(
        allLotsRef.current,
        userEmail,
        { latitude, longitude },
      );

      if (allocation.all.length > 0) {
        const geofences = createSDKGeofencesFromLots(allocation.all);
        locationService.registerGeofences(geofences).catch(err => {
          if (__DEV__) console.error('[EnhancedGeofencing] Dynamic recalc failed:', err);
        });
        if (__DEV__) {
          console.log(
            `[EnhancedGeofencing] Dynamic recalc: ${allocation.guaranteed.length} guaranteed + ${allocation.dynamic.length} dynamic = ${allocation.all.length} geofences`,
          );
        }
      }
    }
  }, [user?.userId]);

  // Feed SDK activity recognition events to validation + leave detection + behavioral collector
  const handleActivityChange = useCallback((event: MotionActivityEvent) => {
    const { activity, confidence } = event;

    // Update behavioral collector with activity state
    sharedBehavioralCollector.updateActivity(activity, confidence);

    // Feed to leave detection for ACTIVITY_VEHICLE / WALKING_TO_CAR signals
    leaveDetectionService.processActivityChange(activity, confidence);

    // Record activity-based validation events when inside a lot
    if (currentLotIdRef.current) {
      const lowerActivity = activity.toLowerCase();
      let eventType: 'ACTIVITY_STILL' | 'ACTIVITY_ON_FOOT' | 'ACTIVITY_IN_VEHICLE' | undefined;

      if (lowerActivity === 'still') eventType = 'ACTIVITY_STILL';
      else if (lowerActivity === 'on_foot' || lowerActivity === 'walking') eventType = 'ACTIVITY_ON_FOOT';
      else if (lowerActivity === 'in_vehicle' || lowerActivity === 'automotive') eventType = 'ACTIVITY_IN_VEHICLE';

      if (eventType) {
        parkingValidationService.recordBehavioralEvent(eventType, {
          raw_data: {
            activity,
            confidence,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  }, []);

  // Feed SDK motion change events to leave detection + behavioral collector
  const handleMotionChange = useCallback((event: MotionChangeEvent) => {
    const { isMoving } = event;

    sharedBehavioralCollector.updateMotion(isMoving);
    leaveDetectionService.processMotionChange(isMoving);
  }, []);

  // App state monitoring for behavioral context
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      appState.current = nextAppState;
      
      if (currentLotIdRef.current) {
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

  // Initialize SDK + register geofences + subscribe to events
  useEffect(() => {
    let destroyed = false;

    // Subscribe to SDK events via locationService
    const removeGeofence = locationService.onGeofence((event: GeofenceEvent) => {
      if (!destroyed) handleGeofenceEventRef.current(event);
    });

    const removeLocation = locationService.onLocation((location: Location) => {
      if (!destroyed) handleLocationUpdate(location);
    });

    const removeActivity = locationService.onActivityChange((event: MotionActivityEvent) => {
      if (!destroyed) handleActivityChange(event);
    });

    const removeMotion = locationService.onMotionChange((event: MotionChangeEvent) => {
      if (!destroyed) handleMotionChange(event);
    });

    const validationListener = (analysis: ValidationAnalysis) => {
      setCurrentValidationStatus(analysis);
    };
    parkingValidationService.onValidationComplete(validationListener);

    // Initialize SDK and register geofences
    (async () => {
      try {
        await locationService.initialize();
        await locationService.requestPermissions();

        const allLots = await lotsApi.getAllLots();
        allLotsRef.current = allLots;

        const userEmail = user?.userId ?? '';

        // First computation: no GPS yet → guaranteed set only
        const allocation = dynamicGeofenceManager.computeGeofenceSet(
          allLots,
          userEmail,
          null,
        );

        if (__DEV__) {
          console.log(`[EnhancedGeofencing] User: ${userEmail} (${allocation.userType})`);
          console.log(
            `[EnhancedGeofencing] Initial: ${allocation.guaranteed.length} guaranteed, ` +
            `${allocation.dynamic.length} dynamic = ${allocation.all.length} geofences` +
            (allocation.isAfterELotOpen ? ' (E-lots open)' : ''),
          );
        }

        const geofences = createSDKGeofencesFromLots(allocation.all);

        if (geofences.length > 0) {
          await locationService.registerGeofences(geofences);
        } else {
          throw new Error('No valid parking lot geofences found for this user type');
        }

        // Start in geofence-only mode (low power)
        await locationService.startGeofenceMonitoring();

      } catch (error) {
        if (__DEV__) console.warn('[EnhancedGeofencing] Failed to load real parking lot data, falling back to test geofence:', error);

        // Fallback: register a test circular geofence
        try {
          await locationService.initialize();
          await locationService.registerGeofences([{
            identifier: TEST_CONSTANTS.TEST_LOT_ID,
            latitude: TEST_CONSTANTS.CSULB_CENTER.latitude,
            longitude: TEST_CONSTANTS.CSULB_CENTER.longitude,
            radius: TEST_CONSTANTS.TEST_RADIUS,
            notifyOnEntry: true,
            notifyOnExit: true,
          }]);
          await locationService.startGeofenceMonitoring();
        } catch (e) {
          if (__DEV__) console.error('[EnhancedGeofencing] SDK init failed completely:', e);
        }
      }
    })();

    return () => {
      destroyed = true;
      removeGeofence();
      removeLocation();
      removeActivity();
      removeMotion();
      parkingValidationService.removeValidationListener(validationListener);
      dynamicGeofenceManager.reset();
    };
  }, []); // stable: all mutable state accessed through refs

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
