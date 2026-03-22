/**
 * Enhanced Geofencing Provider with Parking Validation and Leave Detection
 * Combines parking validation with predictive leave intent detection
 * 
 * Features:
 * - Parking behavior validation (PARKED vs DROVE_THROUGH)
 * - Leave intent detection (walking to car, Bluetooth reconnect, speed increase)
 * - Real-time occupancy updates for both parking and leaving
 * - Seamless integration with existing geofencing workflow
 */

import React, { createContext, useContext, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';
import { GeofenceEvent } from '../types/location';
import locationService from '../services/locationService';
import parkingValidationService from '../services/parkingValidationService';
import leaveDetectionService, { LeaveIntentAnalysis } from '../services/leaveDetectionService';
import { lotsApi } from '../services/api';
import { TEST_CONSTANTS, MESSAGE_CONSTANTS } from '../constants/geofencing';
import { ValidationAnalysis } from '../validation';
import { createGeofenceRegionsFromLots } from '../utils/geofenceUtils';

interface EnhancedGeofencingContextType {
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

export const useEnhancedGeofencing = (): EnhancedGeofencingContextType => {
  const context = useContext(EnhancedGeofencingContext);
  if (!context) {
    throw new Error('useEnhancedGeofencing must be used within an EnhancedGeofencingProvider');
  }
  return context;
};

interface Props {
  children: ReactNode;
}

export const EnhancedGeofencingProvider: React.FC<Props> = ({ children }) => {
  const currentZones = useRef(new Set<string>());
  const currentLotId = useRef<string | null>(null);
  const currentValidationStatus = useRef<ValidationAnalysis | null>(null);
  const currentLeaveIntent = useRef<LeaveIntentAnalysis | null>(null);
  // Refs for managing data collection state
  const locationUpdateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLocationUpdate = useRef<{ speed?: number; accuracy?: number } | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Send validated occupancy event to backend with validation and leave intent data
  const sendValidatedOccupancyEvent = useCallback(async (
    lotId: string, 
    eventType: 'ENTER' | 'EXIT',
    validationAnalysis?: ValidationAnalysis | null,
    leaveIntentAnalysis?: LeaveIntentAnalysis | null
  ) => {
    try {
      const occupancyData: {
        lotId: string;
        eventType: 'ENTER' | 'EXIT';
        source: 'GEOFENCE';
        timestamp: string;
        validation_status?: string;
        confidence_score?: number;
        analysis_metadata?: Record<string, unknown>;
        leave_intent?: Record<string, unknown>;
      } = {
        lotId,
        eventType,
        source: 'GEOFENCE',
        timestamp: new Date().toISOString()
      };

      // Add validation data if available
      if (validationAnalysis) {
        occupancyData.validation_status = validationAnalysis.status;
        occupancyData.confidence_score = validationAnalysis.confidenceScore;
        occupancyData.analysis_metadata = {
          speed_transition_score: validationAnalysis.speedTransitionScore,
          dwell_time_score: validationAnalysis.dwellTimeScore,
          movement_pattern_score: validationAnalysis.movementPatternScore,
          bluetooth_score: validationAnalysis.bluetoothScore,
          event_count: validationAnalysis.metadata.event_count,
          time_span_minutes: validationAnalysis.metadata.time_span_minutes,
          analysis_timestamp: validationAnalysis.metadata.analysis_timestamp
        };
      }

      // Add leave intent data if available
      if (leaveIntentAnalysis) {
        occupancyData.leave_intent = {
          intent_probability: leaveIntentAnalysis.intent_probability,
          confidence_level: leaveIntentAnalysis.confidence_level,
          estimated_leave_time: leaveIntentAnalysis.estimated_leave_time,
          signal_count: leaveIntentAnalysis.analysis_metadata.signal_count,
          session_duration: leaveIntentAnalysis.analysis_metadata.session_duration_minutes
        };
      }

      await lotsApi.recordOccupancyEvent(occupancyData);
      console.log(`[EnhancedGeofencing] Sent enhanced occupancy event:`, occupancyData);
    } catch (error) {
      console.error(`[EnhancedGeofencing] Failed to send occupancy event:`, error);
    }
  }, []);

  // Enhanced geofence event handler with both validation and leave detection
  const handleGeofenceEvent = useCallback(async (event: GeofenceEvent) => {
    console.log(`[EnhancedGeofencing] Geofence event: ${event.eventType} ${event.regionId}`);

    if (event.eventType === 'ENTER') {
      // Only show alert if we weren't already inside this zone
      if (!currentZones.current.has(event.regionId)) {
        currentZones.current.add(event.regionId);
        currentLotId.current = event.regionId;

        Alert.alert(
          'Entered Parking Lot',
          `Welcome to ${event.regionId}!\n\nWe're now monitoring your parking behavior and will detect when you're ready to leave. This helps provide real-time availability to other users.`,
          [{ text: 'OK' }]
        );

        // Start both parking validation and leave monitoring
        try {
          // Start parking validation session
          const validationSessionId = await parkingValidationService.startParkingSession(event);
          console.log(`[EnhancedGeofencing] Started validation session: ${validationSessionId}`);

          // Start leave detection monitoring
          const leaveSessionId = await leaveDetectionService.startLeaveMonitoring(event, {
            onLeaveIntentDetected: async (analysis: LeaveIntentAnalysis, lotId: string) => {
              console.log(`[EnhancedGeofencing] Leave intent detected for ${lotId}:`, analysis);
              currentLeaveIntent.current = analysis;
              
              // Send real-time occupancy update with leave intent
              await sendValidatedOccupancyEvent(lotId, 'ENTER', null, analysis);
              
              // Show user notification for high confidence leave intent
              if (analysis.confidence_level === 'HIGH') {
                Alert.alert(
                  'Preparing to Leave?',
                  `We detected you might be leaving ${lotId} soon. This helps us update availability for other users in real-time.`,
                  [{ text: 'OK' }]
                );
              }
            },
            onLeaveConfirmed: (sessionId: string, lotId: string) => {
              console.log(`[EnhancedGeofencing] Leave confirmed for session ${sessionId} in ${lotId}`);
            },
            onError: (error: string) => {
              console.error('[EnhancedGeofencing] Leave detection error:', error);
            }
          });
          
          console.log(`[EnhancedGeofencing] Started leave monitoring session: ${leaveSessionId}`);
          
          // Start location data collection for behavioral analysis
          startLocationDataCollection();
        } catch (error) {
          console.error('[EnhancedGeofencing] Failed to start monitoring:', error);
        }

        // Send initial occupancy event (entry)
        await sendValidatedOccupancyEvent(event.regionId, 'ENTER');
      }
    } else if (event.eventType === 'EXIT') {
      // Only process if we were actually inside this zone
      if (currentZones.current.has(event.regionId)) {
        currentZones.current.delete(event.regionId);
        currentLotId.current = null;
        
        // Complete both parking validation and leave detection
        try {
          // Complete parking validation
          const validationAnalysis = await parkingValidationService.completeParkingSession(event);
          currentValidationStatus.current = validationAnalysis;

          // Complete leave detection
          const leaveAnalysis = await leaveDetectionService.completeLeaveMonitoring(event);
          currentLeaveIntent.current = null; // Clear current intent since user left

          let alertMessage = `Thanks for using ${event.regionId}!`;
          
          // Add validation status to alert
          if (validationAnalysis) {
            switch (validationAnalysis.status) {
              case 'PARKED':
                alertMessage += `\n\nOur analysis shows you parked here (${Math.round(validationAnalysis.confidenceScore * 100)}% confidence).`;
                break;
              case 'DROVE_THROUGH':
                alertMessage += `\n\nIt looks like you drove through without parking.`;
                break;
              case 'SEARCHING':
                alertMessage += `\n\nWe detected you were searching for parking.`;
                break;
              default:
                alertMessage += `\n\nYour parking session analysis is complete.`;
            }
          }

          // Add leave detection information
          if (leaveAnalysis && leaveAnalysis.intent_probability > 0.5) {
            alertMessage += `\n\nWe detected your leave intent ${Math.round(leaveAnalysis.intent_probability * 100)}% confidence, helping provide real-time updates to other users!`;
          }

          Alert.alert('Left Parking Lot', alertMessage, [{ text: 'OK' }]);

          // Send enhanced occupancy event with both validation and leave data
          await sendValidatedOccupancyEvent(event.regionId, 'EXIT', validationAnalysis, leaveAnalysis);
          
          // Stop location data collection
          stopLocationDataCollection();
        } catch (error) {
          console.error('[EnhancedGeofencing] Failed to complete monitoring:', error);
          
          // Still send basic exit event
          await sendValidatedOccupancyEvent(event.regionId, 'EXIT');
          stopLocationDataCollection();
        }
      }
    }
  }, [sendValidatedOccupancyEvent]);

  // Location data collection for behavioral analysis
  const startLocationDataCollection = useCallback(() => {
    console.log('[EnhancedGeofencing] Starting location data collection');
    
    // Set up location update listener for behavioral data
    const locationUpdateInterval = setInterval(() => {
      if (currentLotId.current) {
        // Record behavioral events periodically
        recordBehavioralEvents();
      }
    }, 5000); // Every 5 seconds

    // Store interval reference for cleanup
    locationUpdateIntervalRef.current = locationUpdateInterval;
  }, []);

  const stopLocationDataCollection = useCallback(() => {
    console.log('[EnhancedGeofencing] Stopped location data collection');
    
    // Clear the interval if it exists
    if (locationUpdateIntervalRef.current) {
      clearInterval(locationUpdateIntervalRef.current);
      locationUpdateIntervalRef.current = null;
    }
    
    lastLocationUpdate.current = null;
  }, []);

  const recordBehavioralEvents = useCallback(() => {
    // Since we don't have direct location access, we'll rely on the behavioral data collectors
    // The actual location data is handled by the BehavioralDataCollector in the services
    
    // Record a basic behavioral event for active sessions
    if (currentLotId.current) {
      parkingValidationService.recordBehavioralEvent('SPEED_CHANGE', {
        raw_data: {
          app_state: appState.current,
          timestamp: new Date().toISOString(),
          source: 'enhanced_geofencing_provider'
        }
      });
    }
  }, []);

  // App state tracking for behavioral analysis
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      console.log(`[EnhancedGeofencing] App state changed: ${appState.current} -> ${nextAppState}`);
      
      appState.current = nextAppState;

      // Record app state changes as behavioral events
      if (currentLotId.current) {
        parkingValidationService.recordBehavioralEvent('SPEED_CHANGE', {
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

  // Set up geofencing with both validation and leave detection
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

    // Start GPS tracking and set up geofences from real parking lot data
    locationService.startLocationTracking()
      .then(async () => {
        try {
          // Fetch lots and set up geofences
          const lots = await lotsApi.getAllLots();
          const geofenceRegions = createGeofenceRegionsFromLots(lots);
          
          if (geofenceRegions.length > 0) {
            await locationService.addGeofenceRegions(geofenceRegions);
            console.log(`[EnhancedGeofencing] Set up ${geofenceRegions.length} geofence regions`);
          } else {
            console.warn('[EnhancedGeofencing] No lots available, using test geofence');
            throw new Error('No lots available');
          }
        } catch (error) {
          console.warn('[EnhancedGeofencing] Failed to load lots, using fallback test geofence:', error);
          
          // Fallback to test geofence
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
          console.log('[EnhancedGeofencing] Using test geofence as fallback');
        }
        
        console.log('[EnhancedGeofencing] Enhanced geofencing with validation and leave detection initialized');
      })
      .catch((error) => {
        console.error('[EnhancedGeofencing] Failed to start GPS tracking:', error);
        Alert.alert(
          'Location Permission Required',
          'Location access is needed for parking lot detection, behavioral analysis, and leave intent detection. ' + MESSAGE_CONSTANTS.INFO.PRIVACY_NOTICE,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Enable', onPress: () => locationService.startLocationTracking() }
          ]
        );
      });

    return () => {
      parkingValidationService.removeValidationListener(validationListener);
      stopLocationDataCollection();
    };
  }, [handleGeofenceEvent, stopLocationDataCollection]);

  // Context value with debug info
  const contextValue: EnhancedGeofencingContextType = {
    currentLotId: currentLotId.current,
    currentValidationStatus: currentValidationStatus.current,
    currentLeaveIntent: currentLeaveIntent.current,
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
