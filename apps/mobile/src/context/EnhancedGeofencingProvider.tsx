/**
 * Enhanced Geofencing Provider with Parking Validation and Leave Detection
 *
 * Uses the native BackgroundGeolocation SDK for:
 * - OS-level geofence monitoring (works backgrounded/terminated)
 * - Two-mode operation: geofence-only (low power) ↔ full tracking (inside lot)
 * - Activity recognition (STILL/ON_FOOT/IN_VEHICLE) fed to validation & leave detection
 * - Location events fed to behavioral data collection (replaces 5s polling interval)
 */

import React, { createContext, useContext, useEffect, useLayoutEffect, useCallback, useMemo, ReactNode, useRef, useState } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Location, MotionActivityEvent, MotionChangeEvent } from 'react-native-background-geolocation';
import BackgroundGeolocation from 'react-native-background-geolocation';
import { GeofenceEvent } from '../types/location';
import locationService from '../services/locationService';
import parkingValidationService from '../services/parkingValidationService';
import leaveDetectionService, { LeaveIntentAnalysis } from '../services/leaveDetectionService';
import carpoolDetectionService, { CarpoolDetectionResult } from '../services/carpoolDetectionService';
import { sharedBehavioralCollector } from '../services/behavioralDataCollector';
import carBluetooth from '../services/carBluetooth';
import { isOnCampus } from '../utils/geoHelpers';
import { lotsApi } from '../services/api';
import { registerContributorGrant, revokeContributorGrant, refreshLotsForPermissionChange } from '../services/api/contributor';
import { TEST_CONSTANTS } from '../constants/geofencing';
import { ValidationAnalysis } from '../validation';
import { createSDKGeofencesFromLots } from '../utils/geofenceUtils';
import { LOT_POLYGONS } from '../data/lotPolygons';
import { isPointInsidePolygon } from '../utils/lotGeometry';

interface EnhancedGeofencingContextType {
  isGeofencingActive: boolean;
  currentLotId: string | null;
  parkedLotId: string | null;
  lastParkedLocation: {
    lotId: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    timestamp: string;
  } | null;
  currentValidationStatus: ValidationAnalysis | null;
  currentLeaveIntent: LeaveIntentAnalysis | null;
  carpoolPassengerMode: boolean;
  carpoolPassengerCount: number;
  latestCarpoolDetectionResult: CarpoolDetectionResult | null;
  setCarpoolPassengerMode: (enabled: boolean) => Promise<void>;
  setCarpoolPassengerCount: (count: number) => Promise<void>;
  debugInfo: {
    activeSessions: number;
    isCollectingData: boolean;
    activeLeaveMonitoring: number;
    isMonitoringLeave: boolean;
  };
}

const EnhancedGeofencingContext = createContext<EnhancedGeofencingContextType | undefined>(undefined);

interface ParkedLocationSnapshot {
  lotId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: string;
}

export const EnhancedGeofencingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Track current parking state
  const currentZones = useRef<Set<string>>(new Set());
  const [currentLotId, setCurrentLotId] = useState<string | null>(null);
  const currentLotIdRef = useRef<string | null>(null);
  const [parkedLotId, setParkedLotId] = useState<string | null>(null);
  const parkedLotIdRef = useRef<string | null>(null);
  const [lastParkedLocation, setLastParkedLocation] = useState<ParkedLocationSnapshot | null>(null);
  const latestLocationSampleRef = useRef<ParkedLocationSnapshot | null>(null);
  const [currentValidationStatus, setCurrentValidationStatus] = useState<ValidationAnalysis | null>(null);
  const [currentLeaveIntent, setCurrentLeaveIntent] = useState<LeaveIntentAnalysis | null>(null);
  const [carpoolPassengerMode, setCarpoolPassengerModeState] = useState(false);
  const [carpoolPassengerCount, setCarpoolPassengerCountState] = useState(0);
  const [latestCarpoolDetectionResult, setLatestCarpoolDetectionResult] = useState<CarpoolDetectionResult | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  const PARKING_STATE_KEY = '@SharkPark:lotParkingState';
  const LAST_PARKED_LOCATION_KEY = '@SharkPark:lastParkedLocation';
  const CARPOOL_MODE_KEY = '@SharkPark:carpoolPassengerMode';
  const CARPOOL_COUNT_KEY = '@SharkPark:carpoolPassengerCount';

  // Mutex: serialise geofence event processing so rapid ENTER/EXIT pairs
  // cannot interleave (e.g. EXIT resolving before ENTER's startParkingSession).
  const eventQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Stable refs that always point to the latest callback.
  const handleGeofenceEventRef = useRef<(event: GeofenceEvent) => void>(() => {});

  // Track ENTER timestamps per lot for drive-through detection (<60s = DROVE_THROUGH)
  const enterTimestamps = useRef<Map<string, number>>(new Map());

  // Track which lots have received a DWELL event (for overlapping lot priority)
  const dwelledLots = useRef<Set<string>>(new Set());

  // Parking detection state machine per lot.
  // Tracks whether the user drove in or walked in, and whether parking is confirmed.
  //   PENDING_VEHICLE_ENTRY → drove in, waiting for activity→still/on_foot to confirm parking
  //   UNKNOWN_ENTRY         → entered with 'unknown' activity + low speed; ambiguous.
  //                           Only 'still' or DWELL confirms (NOT on_foot — avoids phantom +1
  //                           when a pedestrian enters with unknown activity).
  //   CONFIRMED_PARKED      → parking confirmed, +1 occupancy sent
  //   WALK_IN               → entered on foot (e.g. returning from class), no occupancy
  type ParkingSessionState = 'PENDING_VEHICLE_ENTRY' | 'UNKNOWN_ENTRY' | 'CONFIRMED_PARKED' | 'WALK_IN';
  const lotParkingState = useRef<Map<string, ParkingSessionState>>(new Map());

  // Carpool detection: map lot ID → detection session ID
  const lotCarpoolDetectionSessions = useRef<Map<string, string>>(new Map());

  // Latest carpool detection result per lot (for UI)
  const lotCarpoolDetectionResults = useRef<Map<string, CarpoolDetectionResult>>(new Map());

  // Track occupancy before ENTER for carpool signal correlation
  const lotOccupancyBeforeEnter = useRef<Map<string, number>>(new Map());

  // Bluetooth subscriptions per lot (to watch for new device connections)
  const lotBluetoothSubscriptions = useRef<Map<string, { remove: () => void }>>(new Map());

  // Lots currently driven by dev/test geofence events (skip backend occupancy POSTs)
  const testLots = useRef<Set<string>>(new Set());

  const persistParkingState = useCallback(async () => {
    try {
      const entries = Array.from(lotParkingState.current.entries()).map(
        ([lotId, state]) => ({ lotId, state, ts: Date.now() })
      );
      await AsyncStorage.setItem(PARKING_STATE_KEY, JSON.stringify(entries));
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to persist parking state:', e);
    }
  }, []);

  const syncParkedLotFromState = useCallback(() => {
    const confirmedLot = Array.from(lotParkingState.current.entries()).find(
      ([, state]) => state === 'CONFIRMED_PARKED'
    )?.[0] ?? null;
    parkedLotIdRef.current = confirmedLot;
    setParkedLotId(confirmedLot);
  }, []);

  const setLotParkingState = useCallback((lotId: string, state: ParkingSessionState) => {
    lotParkingState.current.set(lotId, state);
    if (state === 'CONFIRMED_PARKED') {
      parkedLotIdRef.current = lotId;
      setParkedLotId(lotId);
    } else if (parkedLotIdRef.current === lotId) {
      syncParkedLotFromState();
    }
  }, [syncParkedLotFromState]);

  const clearLotParkingState = useCallback((lotId: string) => {
    lotParkingState.current.delete(lotId);
    if (parkedLotIdRef.current === lotId) {
      syncParkedLotFromState();
    }
  }, [syncParkedLotFromState]);

  const restoreParkingState = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(PARKING_STATE_KEY);
      if (!raw) return;
      const entries: { lotId: string; state: ParkingSessionState; ts: number }[] = JSON.parse(raw);
      const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
      const now = Date.now();
      let latestConfirmed: { lotId: string; ts: number } | null = null;
      for (const { lotId, state, ts } of entries) {
        if (now - ts < MAX_AGE_MS) {
          lotParkingState.current.set(lotId, state);
          if (state === 'CONFIRMED_PARKED') {
            currentZones.current.add(lotId);
            if (!latestConfirmed || ts > latestConfirmed.ts) {
              latestConfirmed = { lotId, ts };
            }
          }
        }
      }
      parkedLotIdRef.current = latestConfirmed?.lotId ?? null;
      setParkedLotId(latestConfirmed?.lotId ?? null);
      if (__DEV__) console.log(`[EnhancedGeofencing] Restored parking state for ${lotParkingState.current.size} lots`);
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to restore parking state:', e);
    }
  }, []);

  const restoreCarpoolPreferences = useCallback(async () => {
    try {
      const [[, modeRaw], [, countRaw]] = await AsyncStorage.multiGet([CARPOOL_MODE_KEY, CARPOOL_COUNT_KEY]);
      setCarpoolPassengerModeState(modeRaw === 'true');
      const count = Number.parseInt(countRaw ?? '0', 10);
      setCarpoolPassengerCountState(Number.isFinite(count) && count > 0 ? Math.min(count, 8) : 0);
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to restore carpool preferences:', e);
    }
  }, []);

  const setAndPersistLastParkedLocation = useCallback(async (snapshot: ParkedLocationSnapshot) => {
    setLastParkedLocation(snapshot);
    try {
      await AsyncStorage.setItem(LAST_PARKED_LOCATION_KEY, JSON.stringify(snapshot));
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to persist last parked location:', e);
    }
  }, []);

  const clearLastParkedLocation = useCallback(async (lotId?: string) => {
    setLastParkedLocation((prev) => {
      if (!prev) return null;
      if (lotId && prev.lotId !== lotId) return prev;
      return null;
    });
    try {
      const existing = await AsyncStorage.getItem(LAST_PARKED_LOCATION_KEY);
      if (!existing) return;
      const parsed = JSON.parse(existing) as ParkedLocationSnapshot;
      if (!lotId || parsed.lotId === lotId) {
        await AsyncStorage.removeItem(LAST_PARKED_LOCATION_KEY);
      }
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to clear parked location:', e);
    }
  }, []);

  const restoreLastParkedLocation = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(LAST_PARKED_LOCATION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ParkedLocationSnapshot;
      const parsedTime = new Date(parsed.timestamp).getTime();
      const MAX_AGE_MS = 24 * 60 * 60 * 1000;
      if (!Number.isFinite(parsedTime) || Date.now() - parsedTime > MAX_AGE_MS) {
        await AsyncStorage.removeItem(LAST_PARKED_LOCATION_KEY);
        return;
      }
      setLastParkedLocation(parsed);
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to restore parked location:', e);
    }
  }, []);

  const captureLastParkedLocation = useCallback(async (lotId: string) => {
    let snapshot: ParkedLocationSnapshot | null = null;

    try {
      const current = await locationService.getCurrentPosition();
      snapshot = {
        lotId,
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy: current.coords.accuracy ?? null,
        timestamp: new Date().toISOString(),
      };
    } catch {
      const sample = latestLocationSampleRef.current;
      if (sample) {
        snapshot = {
          lotId,
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracy: sample.accuracy,
          timestamp: new Date().toISOString(),
        };
      }
    }

    if (snapshot) {
      // Reject obviously invalid captures (simulator/global mock location).
      if (!isOnCampus(snapshot.latitude, snapshot.longitude)) {
        if (__DEV__) {
          console.log(`[EnhancedGeofencing] Ignored off-campus parked coordinate for ${lotId}`);
        }
        return;
      }

      const polygon = LOT_POLYGONS[lotId];
      if (polygon && polygon.length >= 3) {
        const inside = isPointInsidePolygon(snapshot.latitude, snapshot.longitude, polygon);
        if (!inside) {
          if (__DEV__) {
            console.log(`[EnhancedGeofencing] Ignored parked coordinate outside lot polygon for ${lotId}`);
          }
          return;
        }
      }

      await setAndPersistLastParkedLocation(snapshot);
      if (__DEV__) {
        console.log('[EnhancedGeofencing] Saved parked location:', snapshot);
      }
    }
  }, [setAndPersistLastParkedLocation]);

  const setCarpoolPassengerMode = useCallback(async (enabled: boolean) => {
    setCarpoolPassengerModeState(enabled);
    try {
      await AsyncStorage.setItem(CARPOOL_MODE_KEY, String(enabled));
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to persist carpool mode:', e);
    }
  }, []);

  const setCarpoolPassengerCount = useCallback(async (count: number) => {
    const safeCount = Number.isFinite(count) ? Math.max(0, Math.min(8, Math.floor(count))) : 0;
    setCarpoolPassengerCountState(safeCount);
    try {
      await AsyncStorage.setItem(CARPOOL_COUNT_KEY, String(safeCount));
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to persist carpool passenger count:', e);
    }
  }, []);

  // Enhanced occupancy event with validation data
  const sendValidatedOccupancyEvent = useCallback(async (
    lotId: string,
    eventType: 'ENTER' | 'EXIT'
  ) => {
    if (carpoolPassengerMode) {
      if (__DEV__) console.log(`[EnhancedGeofencing] Suppressed ${eventType} for ${lotId} (passenger carpool mode)`);
      return;
    }
    if (__DEV__ && testLots.current.has(lotId)) {
      console.log(`[EnhancedGeofencing] Suppressed backend ${eventType} for ${lotId} (test simulation)`);
      return;
    }
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
  }, [carpoolPassengerMode]);

  const resolveOccupancyBaseline = useCallback(async (lotId: string): Promise<number> => {
    const cached = lotOccupancyBeforeEnter.current.get(lotId);
    if (typeof cached === 'number' && Number.isFinite(cached)) {
      return cached;
    }

    try {
      const lot = await lotsApi.getLotDetails(lotId, { forceRefresh: true });
      const baseline = lot.estimated_occupancy ?? lot.current_occupancy ?? 0;
      const safeBaseline = Number.isFinite(baseline) ? Math.max(0, baseline) : 0;
      lotOccupancyBeforeEnter.current.set(lotId, safeBaseline);
      return safeBaseline;
    } catch (e) {
      if (__DEV__) {
        console.error('[EnhancedGeofencing] Failed to resolve occupancy baseline:', e);
      }
      lotOccupancyBeforeEnter.current.set(lotId, 0);
      return 0;
    }
  }, []);

  // Start carpool detection when occupancy increases due to a vehicle ENTER
  const startCarpoolDetection = useCallback(async (lotId: string, occupancyBefore: number) => {
    try {
      // Create a synthetic ENTER event for the detection service
      const detectionEvent: GeofenceEvent = {
        eventType: 'ENTER',
        regionId: lotId,
        timestamp: new Date().toISOString(),
        speed: 0,
        activity: { type: 'still', confidence: 100 },
      };

      const knownDevices = carBluetooth.getKnownDeviceIds();
      const sessionId = await carpoolDetectionService.startDetectionSession(
        detectionEvent,
        occupancyBefore,
        knownDevices
      );

      lotCarpoolDetectionSessions.current.set(lotId, sessionId);

      // Subscribe to Bluetooth connects for this session
      const existingSub = lotBluetoothSubscriptions.current.get(lotId);
      if (existingSub) existingSub.remove();

      const btSub = carBluetooth.onConnect((event) => {
        carpoolDetectionService.recordBluetoothDevice(sessionId, event.deviceAddress || event.deviceId || '');
      });

      lotBluetoothSubscriptions.current.set(lotId, btSub);

      if (__DEV__) {
        console.log(`[EnhancedGeofencing] Started carpool detection for ${lotId} (session: ${sessionId})`);
      }
    } catch (e) {
      if (__DEV__) console.error('[EnhancedGeofencing] Failed to start carpool detection:', e);
    }
  }, []);

  // Enhanced geofence event handler with activity-gated occupancy detection.
  //
  // Occupancy is gated on ACTIVITY, not just geofence boundary crossings:
  //   +1 occupancy  → only when user DROVE in AND parking is confirmed (still activity or DWELL)
  //   -1 occupancy  → only when user DRIVES out (in_vehicle activity or speed > 5 m/s)
  //   walking in/out → no occupancy change (car didn't move)
  //
  // This prevents:
  //   - Walk-to-class EXIT from decrementing occupancy (car is still parked)
  //   - Walk-back ENTER from double-counting (car was already counted)
  //   - Drive-throughs from creating phantom +1 (EXIT fires before confirmation)
  const handleGeofenceEvent = useCallback(async (event: GeofenceEvent) => {
    // ── Classify activity from SDK data attached to the geofence event ──
    const eventActivity = event.activity?.type?.toLowerCase() ?? 'unknown';
    const eventSpeed = event.speed ?? 0;
    const isVehicleActivity = eventActivity === 'in_vehicle' || eventActivity === 'automotive';
    const isPedestrianActivity = eventActivity === 'on_foot' || eventActivity === 'walking'
      || eventActivity === 'running' || eventActivity === 'on_bicycle';

    if (event.eventType === 'ENTER') {
      if (!currentZones.current.has(event.regionId)) {
        if (event.isTest) {
          testLots.current.add(event.regionId);
          lotOccupancyBeforeEnter.current.set(event.regionId, 0);
        }
        currentZones.current.add(event.regionId);
        enterTimestamps.current.set(event.regionId, Date.now());
        setCurrentLotId(event.regionId);
        currentLotIdRef.current = event.regionId;

        if (!event.isTest) {
          void resolveOccupancyBaseline(event.regionId);
        }

        // ── Determine parking session state based on how the user entered ──
        const existingState = lotParkingState.current.get(event.regionId);

        if (existingState === 'CONFIRMED_PARKED') {
          // Re-entering a lot where car is still parked (walked back from class).
          // No occupancy change — car was already counted.
          // Re-attach leave detection callbacks (they're lost on cold restart
          // since functions aren't serializable to AsyncStorage).
          await leaveDetectionService.reattachCallbacks(event.regionId, {
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
          if (__DEV__) {
            Alert.alert(
              '[DEV] Returned to Lot',
              `Welcome back to ${event.regionId}. Your car is still parked here.`,
              [{ text: 'OK' }]
            );
          }
        } else if (isPedestrianActivity) {
          // Walking into lot (e.g. shortcut through lot, or returning to car without
          // an existing session). Don't count for occupancy.
          setLotParkingState(event.regionId, 'WALK_IN');
          if (__DEV__) {
            Alert.alert(
              '[DEV] Walked Into Lot',
              `Entered ${event.regionId} on foot — no occupancy change.`,
              [{ text: 'OK' }]
            );
          }
        } else if (eventActivity === 'unknown' && eventSpeed < 2) {
          // Ambiguous: SDK hasn't classified yet and speed is low (could be walking or
          // just pulled in and stopped). Require stronger confirmation — only 'still' or
          // DWELL may promote to CONFIRMED_PARKED. This prevents the phantom +1 path:
          //   unknown ENTER → SDK fires on_foot → would falsely confirm parking.
          setLotParkingState(event.regionId, 'UNKNOWN_ENTRY');
          if (__DEV__) {
            Alert.alert(
              '[DEV] Entered Lot (Unknown)',
              `Entered ${event.regionId} with unknown activity (${(eventSpeed * 2.237).toFixed(0)} mph). ` +
              `Waiting for still/DWELL confirmation…`,
              [{ text: 'OK' }]
            );
          }
        } else {
          // Vehicle entry (explicit in_vehicle, or ambiguous activity with driving speed).
          // Start confirmation — occupancy sent when activity transitions to 'still' or DWELL fires.
          setLotParkingState(event.regionId, 'PENDING_VEHICLE_ENTRY');

          // Special case: ENTER with activity=still and near-zero speed means the user
          // is ALREADY stationary inside the lot (e.g. geofenceInitialTriggerEntry fired
          // on app launch while parked). Confirm immediately — onActivityChange won't
          // fire again for still→still.
          if (eventActivity === 'still' && eventSpeed < 1) {
            setLotParkingState(event.regionId, 'CONFIRMED_PARKED');
            // Send +1 after setup completes (below)
          }

          if (__DEV__) {
            const state = lotParkingState.current.get(event.regionId);
            Alert.alert(
              '[DEV] Entered Parking Lot',
              state === 'CONFIRMED_PARKED'
                ? `Already parked in ${event.regionId} (still, ${(eventSpeed * 2.237).toFixed(0)} mph) — occupancy +1.`
                : `Drove into ${event.regionId} (${eventActivity}, ${(eventSpeed * 2.237).toFixed(0)} mph). Waiting for parking confirmation…`,
              [{ text: 'OK' }]
            );
          }
        }

        // Always upgrade to full tracking (needed for activity monitoring + leave detection)
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

        // Send +1 immediately if ENTER already confirmed parking (still + speed ≈ 0).
        // Otherwise occupancy is deferred to parking confirmation
        // (activity→still in handleActivityChange, or DWELL backup below).
        const enterState = lotParkingState.current.get(event.regionId);
        if (enterState === 'CONFIRMED_PARKED') {
          await captureLastParkedLocation(event.regionId);
          const occupancyBefore = await resolveOccupancyBaseline(event.regionId);
          // Start carpool detection on this lot before sending occupancy
          await startCarpoolDetection(event.regionId, occupancyBefore);
          await sendValidatedOccupancyEvent(event.regionId, 'ENTER');
          
          // Trigger carpool analysis after a short delay to collect Bluetooth signals
          setTimeout(async () => {
            const sessionId = lotCarpoolDetectionSessions.current.get(event.regionId);
            if (sessionId) {
              const result = await carpoolDetectionService.analyzeCarpool(sessionId, occupancyBefore + 1);
              if (result) {
                setLatestCarpoolDetectionResult(result);
                lotCarpoolDetectionResults.current.set(event.regionId, result);
                
                if (__DEV__) {
                  console.log(`[EnhancedGeofencing] Carpool analysis: ${result.action} (confidence: ${result.confidence.toFixed(2)})`);
                }
              }
            }
          }, 3000); // 3s delay to collect signals
        }
      }
    } else if (event.eventType === 'DWELL') {
      // Native 5-min DWELL — high-confidence parking confirmation backup.
      dwelledLots.current.add(event.regionId);

      parkingValidationService.recordBehavioralEvent('DWELL', {
        raw_data: {
          lot_id: event.regionId,
          duration_ms: 300000,
          timestamp: event.timestamp,
        },
      });

      // If we haven't confirmed parking yet, DWELL is the backup confirmation.
      // This catches edge cases where activity recognition missed the still transition.
      const state = lotParkingState.current.get(event.regionId);
      if (state === 'PENDING_VEHICLE_ENTRY' || state === 'UNKNOWN_ENTRY') {
        setLotParkingState(event.regionId, 'CONFIRMED_PARKED');
        await captureLastParkedLocation(event.regionId);
        const occupancyBefore = await resolveOccupancyBaseline(event.regionId);
        
        // Start carpool detection on this lot before sending occupancy
        await startCarpoolDetection(event.regionId, occupancyBefore);
        await sendValidatedOccupancyEvent(event.regionId, 'ENTER');

        // Trigger carpool analysis after a short delay to collect Bluetooth signals
        setTimeout(async () => {
          const sessionId = lotCarpoolDetectionSessions.current.get(event.regionId);
          if (sessionId) {
            const result = await carpoolDetectionService.analyzeCarpool(sessionId, occupancyBefore + 1);
            if (result) {
              setLatestCarpoolDetectionResult(result);
              lotCarpoolDetectionResults.current.set(event.regionId, result);
              
              if (__DEV__) {
                console.log(`[EnhancedGeofencing] Carpool analysis (DWELL): ${result.action} (confidence: ${result.confidence.toFixed(2)})`);
              }
            }
          }
        }, 3000); // 3s delay to collect signals

        if (__DEV__) {
          Alert.alert(
            '[DEV] Parking Confirmed (DWELL)',
            `Parked in ${event.regionId} for 5+ minutes — occupancy +1 sent.`,
            [{ text: 'OK' }]
          );
        }
      } else if (__DEV__) {
        Alert.alert(
          '[DEV] Dwell Detected',
          `In ${event.regionId} for 5+ minutes (state: ${state ?? 'none'}).`,
          [{ text: 'OK' }]
        );
      }
    } else if (event.eventType === 'EXIT') {
      if (currentZones.current.has(event.regionId)) {
        currentZones.current.delete(event.regionId);

        const lotState = lotParkingState.current.get(event.regionId);
        const wasConfirmedParked = lotState === 'CONFIRMED_PARKED';
        const wasPendingEntry = lotState === 'PENDING_VEHICLE_ENTRY' || lotState === 'UNKNOWN_ENTRY';

        // Drive-through detection: EXIT within 60s of ENTER → DROVE_THROUGH
        // Only applies to unconfirmed entries. If parking was already confirmed
        // (+1 sent), we must allow the -1 EXIT regardless of timing.
        const enterTime = enterTimestamps.current.get(event.regionId);
        const isDriveThrough = !wasConfirmedParked && enterTime != null && (Date.now() - enterTime) < 60000;
        enterTimestamps.current.delete(event.regionId);

        // Overlapping lot priority: if multiple lots are active and this lot
        // never received a DWELL event, suppress its occupancy contribution.
        const hadDwell = dwelledLots.current.has(event.regionId);
        const otherActiveZones = currentZones.current.size > 0;
        const suppressForOverlap = otherActiveZones && !hadDwell;
        dwelledLots.current.delete(event.regionId);

        // Vehicle exit detection: in_vehicle activity OR speed > 5 m/s (~11 mph) as fallback
        // for when activity recognition has lag during the geofence crossing.
        const isVehicleExit = isVehicleActivity || eventSpeed > 5;

        setCurrentLotId(currentZones.current.size > 0 ? [...currentZones.current][0] : null);
        currentLotIdRef.current = currentZones.current.size > 0 ? [...currentZones.current][0] : null;

        try {
          const analysis = await parkingValidationService.completeParkingSession(event);
          setCurrentValidationStatus(analysis);

          const leaveAnalysis = await leaveDetectionService.completeLeaveMonitoring(event);
          setCurrentLeaveIntent(null);

          if (__DEV__) {
            let alertMessage = `Exiting ${event.regionId} (${eventActivity}, ${(eventSpeed * 2.237).toFixed(0)} mph)`;
            if (isDriveThrough) {
              alertMessage += '\n\nDrive-through (<60s, unconfirmed) — no occupancy change.';
            } else if (wasPendingEntry) {
              alertMessage += '\n\nLeft before parking confirmed — no occupancy change.';
            } else if (!wasConfirmedParked) {
              alertMessage += '\n\nNo confirmed parking session — no occupancy change.';
            } else if (!isVehicleExit) {
              alertMessage += '\n\nWalked out (on_foot) — car still parked, no -1 sent.';
            } else if (suppressForOverlap) {
              alertMessage += '\n\nOverlapping lot without DWELL — suppressed.';
            } else {
              alertMessage += `\n\nDriving away — occupancy -1 sent.`;
              if (analysis) {
                alertMessage += ` Validation: ${analysis.status} (${Math.round(analysis.confidenceScore * 100)}%).`;
              }
            }
            if (leaveAnalysis && leaveAnalysis.intent_probability > 0.5) {
              alertMessage += `\n\nLeave intent: ${Math.round(leaveAnalysis.intent_probability * 100)}%.`;
            }
            Alert.alert('[DEV] Left Parking Lot', alertMessage, [{ text: 'OK' }]);
          }

          // Only send -1 EXIT occupancy when ALL conditions are met:
          // 1. Parking was confirmed (+1 was sent earlier)
          // 2. Exit is vehicular (driving away, not walking to class)
          // 3. Not a drive-through or suppressed overlap
          if (wasConfirmedParked && isVehicleExit && !isDriveThrough && !suppressForOverlap) {
            await sendValidatedOccupancyEvent(event.regionId, 'EXIT');
          }
        } catch (error) {
          if (__DEV__) console.error('[EnhancedGeofencing] Failed to complete parking validation:', error);
          // Fallback: still send EXIT if we're confident about the conditions
          if (wasConfirmedParked && isVehicleExit && !isDriveThrough && !suppressForOverlap) {
            await sendValidatedOccupancyEvent(event.regionId, 'EXIT');
          }
        }

        // Clean up parking state:
        // - Vehicle exit or unconfirmed → clear state entirely
        // - Pedestrian exit from confirmed park → KEEP state (car is still there)
        if (wasConfirmedParked && !isVehicleExit) {
          // Walking to class — car still parked. Keep CONFIRMED_PARKED for re-entry.
        } else {
          if (wasConfirmedParked && isVehicleExit) {
            await clearLastParkedLocation(event.regionId);
          }
          clearLotParkingState(event.regionId);
          testLots.current.delete(event.regionId);
          lotOccupancyBeforeEnter.current.delete(event.regionId);
        }

        // Clean up carpool detection session and Bluetooth subscription
        const carpoolSessionId = lotCarpoolDetectionSessions.current.get(event.regionId);
        if (carpoolSessionId) {
          carpoolDetectionService.endDetectionSession(carpoolSessionId);
          lotCarpoolDetectionSessions.current.delete(event.regionId);
        }
        const btSub = lotBluetoothSubscriptions.current.get(event.regionId);
        if (btSub) {
          btSub.remove();
          lotBluetoothSubscriptions.current.delete(event.regionId);
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

    // Persist parking state after every geofence event (covers all set/delete paths above)
    await persistParkingState();
  }, [captureLastParkedLocation, clearLastParkedLocation, clearLotParkingState, persistParkingState, resolveOccupancyBaseline, sendValidatedOccupancyEvent, setLotParkingState, startCarpoolDetection]);

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

    latestLocationSampleRef.current = {
      lotId: currentLotIdRef.current,
      latitude,
      longitude,
      accuracy: accuracy ?? null,
      timestamp: new Date().toISOString(),
    };

    leaveDetectionService.updateLocation({
      latitude,
      longitude,
      accuracy: accuracy ?? 0,
      speed: safeSpeed >= 0 ? safeSpeed : null,
      altitude: altitude ?? null,
      heading: heading ?? null,
    });

    // Feed SDK Location (with battery) to behavioral collector
    sharedBehavioralCollector.updateLocation({
      latitude,
      longitude,
      accuracy: accuracy ?? 0,
      speed: safeSpeed >= 0 ? safeSpeed : null,
      altitude: altitude ?? null,
      heading: heading ?? null,
      battery_level: location.battery?.level ?? null,
      battery_charging: location.battery?.is_charging ?? null,
    });

    // NOTE: Activity recognition is handled exclusively by handleActivityChange
    // (onActivityChange SDK callback). We do NOT extract location.activity here
    // to avoid duplicate behavioral events.

    // Adjust geofence proximity radius based on on/off campus (SDK activates nearest lots)
    locationService.setGeofenceProximityRadius(isOnCampus(latitude, longitude)).catch(err => {
      if (__DEV__) console.error('[EnhancedGeofencing] Proximity radius update failed:', err);
    });
  }, []);

  // Feed SDK activity recognition events to validation + leave detection + behavioral collector.
  // This is the SINGLE source of truth for activity data — handleLocationUpdate does NOT
  // duplicate activity processing (it only feeds location/speed data).
  const handleActivityChange = useCallback(async (event: MotionActivityEvent) => {
    const { activity, confidence } = event;

    // Update behavioral collector with activity state
    sharedBehavioralCollector.updateActivity(activity, confidence);

    // Feed to leave detection for ACTIVITY_VEHICLE / WALKING_TO_CAR signals
    leaveDetectionService.processActivityChange(activity, confidence);

    // ── Parking confirmation via activity changes ──
    //
    // Iterate ALL lots with pending states, not just the last-entered lot.
    // Overlapping geofences (common in dense parking areas) mean multiple lots
    // can be in PENDING_VEHICLE_ENTRY simultaneously.
    //
    // PENDING_VEHICLE_ENTRY (drove in with known vehicle activity):
    //   still → engine off, vehicle stopped → parked
    //   on_foot/walking → drove in, now walking → must have parked
    //
    // UNKNOWN_ENTRY (entered with 'unknown' activity + low speed):
    //   still → actually was parked → confirm
    //   on_foot/walking → could be a pedestrian who entered with 'unknown' → DON'T confirm
    //                     (this is the phantom +1 guard — DWELL is the backup)
    const lowerActivity = activity.toLowerCase();
    const isStill = lowerActivity === 'still';
    const isWalking = lowerActivity === 'on_foot' || lowerActivity === 'walking';
    let anyConfirmed = false;

    for (const [lotId, parkState] of lotParkingState.current.entries()) {
      const shouldConfirm =
        (parkState === 'PENDING_VEHICLE_ENTRY' && (isStill || isWalking)) ||
        (parkState === 'UNKNOWN_ENTRY' && isStill);

      if (shouldConfirm) {
        setLotParkingState(lotId, 'CONFIRMED_PARKED');
        await captureLastParkedLocation(lotId);
        await sendValidatedOccupancyEvent(lotId, 'ENTER');
        anyConfirmed = true;

        if (__DEV__) {
          console.log(`[EnhancedGeofencing] Parking confirmed in ${lotId} (activity → ${lowerActivity})`);
          Alert.alert(
            '[DEV] Parking Confirmed',
            `Parked in ${lotId} (${lowerActivity}) — occupancy +1 sent.`,
            [{ text: 'OK' }]
          );
        }
      }
    }

    // Record activity-based validation events (for any active lot)
    if (currentLotIdRef.current) {
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

    // Persist if parking state changed in this callback
    if (anyConfirmed) {
      await persistParkingState();
    }
  }, [captureLastParkedLocation, persistParkingState, sendValidatedOccupancyEvent, setLotParkingState]);

  // Feed SDK motion change events to leave detection + behavioral collector
  const handleMotionChange = useCallback((event: MotionChangeEvent) => {
    const { isMoving } = event;

    sharedBehavioralCollector.updateMotion(isMoving);
    leaveDetectionService.processMotionChange(isMoving);
  }, []);

  // ── Car Bluetooth detection ─────────────────────────────────────────────
  //
  // Disconnect inside a geofence with pending parking → instant confirm (+1).
  // Connect while confirmed parked → strong leave-intent signal.
  const handleCarBluetoothDisconnect = useCallback(async () => {
    sharedBehavioralCollector.updateCarBluetoothState(false);

    let anyConfirmed = false;
    for (const [lotId, parkState] of lotParkingState.current.entries()) {
      if (parkState === 'PENDING_VEHICLE_ENTRY' || parkState === 'UNKNOWN_ENTRY') {
        setLotParkingState(lotId, 'CONFIRMED_PARKED');
        await captureLastParkedLocation(lotId);
        await sendValidatedOccupancyEvent(lotId, 'ENTER');
        anyConfirmed = true;

        if (__DEV__) {
          console.log(`[EnhancedGeofencing] Parking confirmed in ${lotId} (car BT disconnected)`);
          Alert.alert(
            '[DEV] Parking Confirmed (BT)',
            `Car Bluetooth disconnected in ${lotId} — occupancy +1 sent.`,
            [{ text: 'OK' }]
          );
        }
      }
    }

    if (anyConfirmed) {
      await persistParkingState();
    }
  }, [captureLastParkedLocation, sendValidatedOccupancyEvent, persistParkingState]);

  const handleCarBluetoothConnect = useCallback(() => {
    sharedBehavioralCollector.updateCarBluetoothState(true);

    // Feed to leave detection as a BLUETOOTH_RECONNECT signal for any confirmed lot
    for (const [lotId, parkState] of lotParkingState.current.entries()) {
      if (parkState === 'CONFIRMED_PARKED') {
        parkingValidationService.recordBehavioralEvent('BLUETOOTH_CONNECT', {
          raw_data: { lot_id: lotId, timestamp: new Date().toISOString() },
        });

        if (__DEV__) {
          console.log(`[EnhancedGeofencing] Car BT connected while parked in ${lotId} — leave intent signal`);
        }
      }
    }
  }, []);

  // App state monitoring for behavioral context
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousAppState = appState.current;
      appState.current = nextAppState;

      // Returning to the foreground is the right moment to reconcile with
      // OS truth. Users routinely toggle permission from Settings while
      // we're backgrounded, and iOS doesn't reliably fire a ProviderChange
      // we can latch onto. Re-check on every active transition.
      //
      // Contributor tier requires Always (BG geofences only fire under
      // Always). WhenInUse must NOT register a grant — doing so would
      // let the user read live data without being able to contribute,
      // defeating the reciprocity gate.
      if (nextAppState === 'active' && previousAppState !== 'active') {
        void (async () => {
          const isContributor = await locationService.isContributorAuthorized();
          if (isContributor) {
            void registerContributorGrant({ force: true });
          } else {
            void revokeContributorGrant();
          }
        })();
      }

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

    // Subscribe to car Bluetooth connect/disconnect events
    const removeBtDisconnect = carBluetooth.onDisconnect(() => {
      if (!destroyed) handleCarBluetoothDisconnect();
    });
    const removeBtConnect = carBluetooth.onConnect(() => {
      if (!destroyed) handleCarBluetoothConnect();
    });

    const validationListener = (analysis: ValidationAnalysis) => {
      setCurrentValidationStatus(analysis);
    };
    parkingValidationService.onValidationComplete(validationListener);

    // Track contributor-tier authorization (Always AND FullAccuracy) across
    // ProviderChange events so we can fire the contributor pub-sub the moment
    // the user flips either toggle in Settings (without waiting for the next
    // AppState 'active' transition). Both axes must be in the eligible state
    // — see `locationService.isContributorAuthorized()` for the reasoning:
    //
    //   - Always:        only auth level that fires BG geofence events.
    //   - FullAccuracy:  Reduced fuzzes coords to ~hectares, making lot
    //                    enter/exit detection effectively random.
    //
    // Dedup on the LAST ACTION SENT (not the last observation). This guarantees:
    //   1. The very first ProviderChange event after mount fires the
    //      correct action — never silently swallowed as "initial observation".
    //      (Previous bug: seeding `lastWasContributor` from getProviderState
    //      raced ProviderChange events and could swallow a real toggle.
    //      Symptom: user had to toggle BOTH Always AND Precise before the
    //      pins went grey.)
    //   2. iOS frequently emits multiple ProviderChange events per Settings
    //      toggle. Deduping on the last action means we POST grant/revoke
    //      exactly once per real-world transition.
    //   3. Off-axis changes (status WhenInUse→Denied while staying
    //      non-contributor, accuracy Full↔Reduced while staying contributor,
    //      etc.) still wipe the lots cache via refreshLotsForPermissionChange
    //      so server response shape changes (e.g. accuracy-based redaction)
    //      are reflected without waiting on the next poll tick.
    //
    // The cold-start path through the AppState 'active' handler also calls
    // grant/revoke based on isContributorAuthorized(), so a redundant POST
    // on the very first ProviderChange after launch is acceptable
    // (contributor.ts inFlight dedup will collapse them).
    let lastAction: 'grant' | 'revoke' | null = null;
    let lastPermissionKey: string | null = null;
    const removeProvider = locationService.onProviderChange((event) => {
      if (destroyed) return;
      const isAlways = event.status === BackgroundGeolocation.AuthorizationStatus.Always;
      const isFullAccuracy =
        event.accuracyAuthorization ===
        BackgroundGeolocation.AccuracyAuthorization.Full;
      const isContributor = isAlways && isFullAccuracy;
      const desiredAction: 'grant' | 'revoke' = isContributor ? 'grant' : 'revoke';
      const key = `${event.status}|${event.accuracyAuthorization}`;

      if (lastAction !== desiredAction) {
        if (desiredAction === 'grant') {
          // → contributor-eligible: register the grant + emit 'granted'
          // so lot hooks refetch with the new contributor identity
          // (live pins, unlocked forecast). force:true bypasses the
          // 1h grant-cooldown so a same-session toggle re-fires.
          if (__DEV__) console.log('[EnhancedGeofencing] Provider transition → grant (key=%s)', key);
          void registerContributorGrant({ force: true });
        } else {
          // Lost Always or dropped to Reduced accuracy: tell the backend
          // to stop treating us as a contributor and emit 'revoked' so
          // the UI flips to locked immediately.
          if (__DEV__) console.log('[EnhancedGeofencing] Provider transition → revoke (key=%s)', key);
          void revokeContributorGrant();
        }
        lastAction = desiredAction;
      } else if (lastPermissionKey !== null && key !== lastPermissionKey) {
        // Same desired action as last fire (e.g. still non-contributor)
        // but the underlying permission state changed (WhenInUse→Denied,
        // Always+Full→Always+Reduced re-prompt response, etc.). The
        // server's response shape may differ, and any cached entries are
        // now suspect. Bust the lots cache and force every subscribing
        // screen to refetch — without this, MapScreen /
        // ShortTermForecastScreen / lot detail keep showing whatever
        // they had before the toggle until the next poll tick.
        if (__DEV__) console.log('[EnhancedGeofencing] Provider off-axis change %s → %s', lastPermissionKey, key);
        void refreshLotsForPermissionChange(isContributor ? 'granted' : 'revoked');
      }
      lastPermissionKey = key;
    });

    const removeError = locationService.onError((error) => {
      if (!destroyed && error.code === 'PERMISSION_DENIED') {
        // Tell the backend to stop treating this device as a contributor
        // immediately. Without this, the server keeps serving live data
        // for up to CONTRIBUTOR_GRANT_TTL_MS (24h) after the user revoked
        // permission, because it has no other signal that anything changed.
        //
        // Intentionally silent: the user just toggled a setting they own,
        // they don't need a modal telling them what they did. The UI flips
        // to neutral pins / locked detail card via the contributor-state
        // pub-sub (see services/api/contributor.ts), and the soft-ask flow
        // (UnlockCTAButton → LocationPermissionScreen) is the *only* place
        // we should be prompting them to grant.
        void revokeContributorGrant();
      }
    });

    // Initialize SDK and register geofences
    (async () => {
      try {
        // Restore parking state BEFORE event listeners fire so
        // geofenceInitialTriggerEntry sees existing CONFIRMED_PARKED state.
        await restoreParkingState();
        await restoreLastParkedLocation();
        await restoreCarpoolPreferences();

        await locationService.initialize();
        await locationService.requestPermissions();

        // Only register the contributor grant if the OS grants Always.
        // WhenInUse is enough to drive the SDK's foreground geofence
        // monitoring but it CAN'T fire BG geofence events — so the user
        // would never actually contribute occupancy data. Registering a
        // grant under WhenInUse would unlock the live read while leaving
        // the contribution side broken (free-rider). Best-effort — the
        // helper dedupes itself and swallows network errors.
        if (await locationService.isContributorAuthorized()) {
          void registerContributorGrant();
        } else {
          // If the OS dropped us to anything below Always since last
          // launch, make sure the backend isn't still serving live data
          // off a stale grant.
          void revokeContributorGrant();
        }

        const allLots = await lotsApi.getAllLots();

        if (__DEV__) {
          console.log(`[EnhancedGeofencing] Registering all ${allLots.length} lots (SDK manages proximity)`);
        }

        // Geofence registration is intentionally device-based, not user-based:
        // guests (no Azure AD account) and non-CSULB emails must still be able
        // to contribute occupancy events so they can earn the Contributor tier
        // via ContributorPing. See docs/api-access-tiers.md.
        const geofences = createSDKGeofencesFromLots(allLots);

        if (geofences.length > 0) {
          await locationService.registerGeofences(geofences);
        } else {
          throw new Error('No valid parking lot geofences found');
        }

        // Start in geofence-only mode (low power)
        await locationService.startGeofenceMonitoring();

        // Process pending headless events queued by the Android headless task
        // while the app was terminated (see index.js registerHeadlessTask).
        try {
          const raw = await AsyncStorage.getItem('pending_geofence_events');
          if (raw) {
            const pending: Array<{
              regionId: string;
              eventType: string;
              timestamp: string;
              activity?: { type: string; confidence: number };
              speed?: number;
            }> = JSON.parse(raw);
            const oneHourAgo = Date.now() - 60 * 60 * 1000;

            for (const pendingEvent of pending) {
              const eventTime = new Date(pendingEvent.timestamp).getTime();
              // Discard events older than 1 hour (matches backend's @IsRecentTimestamp)
              if (eventTime < oneHourAgo) continue;

              handleGeofenceEventRef.current({
                regionId: pendingEvent.regionId,
                eventType: pendingEvent.eventType as 'ENTER' | 'EXIT' | 'DWELL',
                timestamp: pendingEvent.timestamp,
                activity: pendingEvent.activity,
                speed: pendingEvent.speed,
              });
            }
            await AsyncStorage.removeItem('pending_geofence_events');
          }
        } catch (e) {
          if (__DEV__) console.warn('[EnhancedGeofencing] Failed to process pending headless events:', e);
        }

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
      removeError();
      removeProvider();
      removeGeofence();
      removeLocation();
      removeActivity();
      removeMotion();
      removeBtDisconnect.remove();
      removeBtConnect.remove();
      parkingValidationService.removeValidationListener(validationListener);
    };
    // Geofencing is device-scoped per the access-tier model; identity changes
    // (sign-in / sign-out) do not affect which lots are registered, so this
    // effect runs once on mount.
  }, []);

  useEffect(() => {
    if (!currentLotId) {
      setCurrentValidationStatus(null);
      return;
    }

    let cancelled = false;

    const refreshValidationStatus = async () => {
      try {
        const analysis = await parkingValidationService.getCurrentValidationStatus(currentLotId);
        if (!cancelled) {
          setCurrentValidationStatus(analysis);
        }
      } catch (error) {
        if (__DEV__) {
          console.error('[EnhancedGeofencing] Failed to refresh validation status:', error);
        }
      }
    };

    void refreshValidationStatus();
    const interval = setInterval(() => {
      void refreshValidationStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currentLotId]);

  const contextValue: EnhancedGeofencingContextType = useMemo(() => {
    const pvDebug = parkingValidationService.getDebugInfo();
    const ldDebug = leaveDetectionService.getDebugInfo();
    return {
      isGeofencingActive: true,
      currentLotId,
      parkedLotId,
      lastParkedLocation,
      currentValidationStatus,
      currentLeaveIntent,
      carpoolPassengerMode,
      carpoolPassengerCount,
      latestCarpoolDetectionResult,
      setCarpoolPassengerMode,
      setCarpoolPassengerCount,
      debugInfo: {
        activeSessions: pvDebug.activeSessions,
        isCollectingData: pvDebug.isCollectingData,
        activeLeaveMonitoring: ldDebug.activeSessions,
        isMonitoringLeave: ldDebug.isMonitoring,
      },
    };
  }, [currentLotId, parkedLotId, lastParkedLocation, currentValidationStatus, currentLeaveIntent, carpoolPassengerMode, carpoolPassengerCount, latestCarpoolDetectionResult, setCarpoolPassengerMode, setCarpoolPassengerCount]);

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
      parkedLotId: null,
      lastParkedLocation: null,
      currentValidationStatus: null,
      currentLeaveIntent: null,
      carpoolPassengerMode: false,
      carpoolPassengerCount: 0,
      latestCarpoolDetectionResult: null,
      setCarpoolPassengerMode: async () => {},
      setCarpoolPassengerCount: async () => {},
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
