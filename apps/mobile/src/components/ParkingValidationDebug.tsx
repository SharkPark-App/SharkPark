/**
 * Parking Validation Debug Component
 * Shows real-time parking validation status and behavior-oriented test scenarios.
 */

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { useEnhancedGeofencing } from '../context/EnhancedGeofencingProvider';
import parkingValidationService from '../services/parkingValidationService';
import { sharedBehavioralCollector } from '../services/behavioralDataCollector';
import type { BehavioralMetrics } from '../services/behavioralDataCollector';
import locationService from '../services/locationService';
import { ValidationStatus } from '../validation';

type ParkingScenarioKey =
  | 'drive_in_and_park'
  | 'quick_drive_through'
  | 'already_parked'
  | 'walk_through_lot';

export const ParkingValidationDebug: React.FC = () => {
  const { currentLotId, currentValidationStatus, debugInfo } = useEnhancedGeofencing();
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentMetrics, setCurrentMetrics] = useState<BehavioralMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [runningScenario, setRunningScenario] = useState<ParkingScenarioKey | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey((key) => key + 1);
      void fetchCurrentMetrics();
    }, 3000);

    void fetchCurrentMetrics();
    return () => clearInterval(interval);
  }, []);

  const fetchCurrentMetrics = async () => {
    setMetricsLoading(true);
    try {
      const metrics = await sharedBehavioralCollector.getCurrentMetrics();
      setCurrentMetrics(metrics);
    } catch (error) {
      console.warn('[ParkingValidationDebug] Failed to fetch metrics:', error);
    } finally {
      setMetricsLoading(false);
    }
  };

  const getStatusColor = (status?: ValidationStatus | null): string => {
    switch (status) {
      case 'PARKED':
        return '#22c55e';
      case 'DROVE_THROUGH':
        return '#ef4444';
      case 'SEARCHING':
        return '#f59e0b';
      case 'ANALYZING':
        return '#3b82f6';
      case 'INSUFFICIENT_DATA':
        return '#6b7280';
      default:
        return '#6b7280';
    }
  };

  const triggerGeofenceEvent = (
    eventType: 'ENTER' | 'EXIT',
    activity?: { type: string; confidence: number },
    speed?: number,
  ) => {
    locationService.triggerTestGeofenceEvent('G1', eventType, activity, speed);
  };

  const recordBehavior = (
    eventType: 'STATIONARY' | 'WALKING' | 'DRIVING' | 'BLUETOOTH_CONNECT' | 'ACTIVITY_STILL' | 'ACTIVITY_ON_FOOT' | 'ACTIVITY_IN_VEHICLE' | 'DWELL',
    speedMph?: number,
  ) => {
    parkingValidationService.recordBehavioralEvent(eventType, {
      speed_mph: speedMph ?? (eventType === 'STATIONARY' ? 0 : eventType === 'WALKING' ? 3 : eventType === 'DRIVING' ? 18 : undefined),
      accuracy_meters: 6,
      bluetooth_state: eventType === 'BLUETOOTH_CONNECT' ? 'CONNECTED' : 'UNKNOWN',
      raw_data: {
        simulated: true,
        scenario: runningScenario,
        timestamp: new Date().toISOString(),
      },
    });
  };

  const runScenario = async (scenario: ParkingScenarioKey) => {
    setRunningScenario(scenario);

    try {
      if (currentLotId) {
        triggerGeofenceEvent('EXIT');
      }

      switch (scenario) {
        case 'drive_in_and_park':
          triggerGeofenceEvent('ENTER', { type: 'in_vehicle', confidence: 95 }, 8);
          locationService.triggerTestActivityChange('in_vehicle', 95);
          recordBehavior('DRIVING', 18);
          locationService.triggerTestActivityChange('still', 95);
          recordBehavior('STATIONARY', 0);
          locationService.triggerTestActivityChange('on_foot', 90);
          recordBehavior('WALKING', 3);
          Alert.alert('Scenario Started', 'Driver enters the lot, stops, parks, and walks away. Validation should trend toward PARKED.');
          break;
        case 'quick_drive_through':
          triggerGeofenceEvent('ENTER', { type: 'in_vehicle', confidence: 95 }, 14);
          locationService.triggerTestActivityChange('in_vehicle', 95);
          recordBehavior('DRIVING', 22);
          recordBehavior('DRIVING', 20);
          triggerGeofenceEvent('EXIT', { type: 'in_vehicle', confidence: 95 }, 14);
          Alert.alert('Scenario Started', 'Vehicle passes through the lot without stopping. Final validation should lean toward DROVE_THROUGH.');
          break;
        case 'already_parked':
          triggerGeofenceEvent('ENTER', { type: 'still', confidence: 95 }, 0);
          recordBehavior('STATIONARY', 0);
          locationService.triggerTestActivityChange('still', 95);
          recordBehavior('DWELL');
          Alert.alert('Scenario Started', 'App opens while the car is already parked in the lot. Still plus dwell should confirm parking quickly.');
          break;
        case 'walk_through_lot':
          triggerGeofenceEvent('ENTER', { type: 'on_foot', confidence: 95 }, 1.5);
          locationService.triggerTestActivityChange('on_foot', 95);
          recordBehavior('WALKING', 3);
          triggerGeofenceEvent('EXIT', { type: 'on_foot', confidence: 95 }, 1.5);
          Alert.alert('Scenario Started', 'Pedestrian walks through the lot on foot. Validation should avoid treating this as a parked car.');
          break;
      }
    } finally {
      setRunningScenario(null);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Parking Validation Debug</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Status</Text>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Current Lot:</Text>
          <Text style={styles.value}>{currentLotId || 'None'}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Validation Status:</Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(currentValidationStatus?.status) }]}>
            <Text style={styles.statusText}>{currentValidationStatus?.status || 'NONE'}</Text>
          </View>
        </View>
        {currentValidationStatus && (
          <View style={styles.statusRow}>
            <Text style={styles.label}>Confidence:</Text>
            <Text style={styles.value}>{Math.round((currentValidationStatus.confidenceScore || 0) * 100)}%</Text>
          </View>
        )}
      </View>

      {currentValidationStatus && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Analysis Details</Text>
          <View style={styles.analysisGrid}>
            <View style={styles.analysisItem}>
              <Text style={styles.analysisLabel}>Speed Transition</Text>
              <Text style={styles.analysisValue}>{Math.round(currentValidationStatus.speedTransitionScore * 100)}%</Text>
            </View>
            <View style={styles.analysisItem}>
              <Text style={styles.analysisLabel}>Dwell Time</Text>
              <Text style={styles.analysisValue}>{Math.round(currentValidationStatus.dwellTimeScore * 100)}%</Text>
            </View>
            <View style={styles.analysisItem}>
              <Text style={styles.analysisLabel}>Movement Pattern</Text>
              <Text style={styles.analysisValue}>{Math.round(currentValidationStatus.movementPatternScore * 100)}%</Text>
            </View>
            <View style={styles.analysisItem}>
              <Text style={styles.analysisLabel}>Bluetooth</Text>
              <Text style={styles.analysisValue}>{Math.round(currentValidationStatus.bluetoothScore * 100)}%</Text>
            </View>
          </View>

          <View style={styles.metadataSection}>
            <Text style={styles.metadataTitle}>Session Metadata</Text>
            <Text style={styles.metadataText}>Events: {currentValidationStatus.metadata.event_count}</Text>
            <Text style={styles.metadataText}>Duration: {Math.round(currentValidationStatus.metadata.time_span_minutes * 100) / 100} min</Text>
            {currentValidationStatus.metadata.speed_range && (
              <Text style={styles.metadataText}>
                Speed Range: {currentValidationStatus.metadata.speed_range[0]}-{currentValidationStatus.metadata.speed_range[1]} mph
              </Text>
            )}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Real Sensor Data {metricsLoading ? '(Loading...)' : ''}</Text>
        {currentMetrics ? (
          <View style={styles.metricsContainer}>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Speed:</Text>
              <Text style={[styles.value, { color: currentMetrics.speed_mph !== null ? '#22c55e' : '#6b7280' }]}>
                {currentMetrics.speed_mph !== null ? `${currentMetrics.speed_mph} mph` : 'No GPS'}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>GPS Accuracy:</Text>
              <Text style={[styles.value, { color: currentMetrics.accuracy_meters !== null ? '#22c55e' : '#6b7280' }]}>
                {currentMetrics.accuracy_meters !== null ? `${Math.round(currentMetrics.accuracy_meters)}m` : 'Unknown'}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>WiFi:</Text>
              <Text style={[styles.value, { color: currentMetrics.wifi_connected ? '#22c55e' : '#ef4444' }]}>
                {currentMetrics.wifi_connected ? 'Connected' : 'Disconnected'}
              </Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Network:</Text>
              <Text style={styles.value}>{currentMetrics.network_type || 'Unknown'}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.label}>Bluetooth:</Text>
              <Text
                style={[
                  styles.value,
                  {
                    color: currentMetrics.bluetooth_state === 'CONNECTED'
                      ? '#22c55e'
                      : currentMetrics.bluetooth_state === 'DISCONNECTED'
                        ? '#ef4444'
                        : '#6b7280',
                  },
                ]}
              >
                {currentMetrics.bluetooth_state || 'Unknown'}
              </Text>
            </View>
            <View style={styles.deviceInfo}>
              <Text style={styles.deviceTitle}>Device Info</Text>
              <Text style={styles.deviceText}>{currentMetrics.device_info.brand} {currentMetrics.device_info.model}</Text>
              <Text style={styles.deviceText}>OS: {currentMetrics.device_info.system_version}</Text>
              <Text style={styles.deviceText}>App: v{currentMetrics.device_info.app_version}</Text>
              {currentMetrics.device_info.battery_level && (
                <Text style={styles.deviceText}>Battery: {Math.round(currentMetrics.device_info.battery_level * 100)}%</Text>
              )}
            </View>
          </View>
        ) : (
          <Text style={styles.noData}>No sensor data available</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>System Debug (Refresh: {refreshKey})</Text>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Active Sessions:</Text>
          <Text style={styles.value}>{debugInfo.activeSessions}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Collecting Data:</Text>
          <Text style={[styles.value, { color: debugInfo.isCollectingData ? '#22c55e' : '#ef4444' }]}>
            {debugInfo.isCollectingData ? 'YES' : 'NO'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Parking Scenarios</Text>
        <Text style={styles.instructionText}>
          Run realistic parking stories instead of pressing raw implementation events. Each scenario sends the geofence and behavior sequence needed to test a distinct use case.
        </Text>

        <View style={styles.scenarioList}>
          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#22c55e' }]} onPress={() => void runScenario('drive_in_and_park')} disabled={runningScenario !== null}>
            <Text style={styles.scenarioTitle}>Drive In And Park</Text>
            <Text style={styles.scenarioDescription}>Vehicle enters, slows, stops, and the driver walks away. Best case for true positive parking detection.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#ef4444' }]} onPress={() => void runScenario('quick_drive_through')} disabled={runningScenario !== null}>
            <Text style={styles.scenarioTitle}>Quick Drive-Through</Text>
            <Text style={styles.scenarioDescription}>Vehicle crosses the lot without parking. Confirms that the validator resists false occupancy spikes.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#3b82f6' }]} onPress={() => void runScenario('already_parked')} disabled={runningScenario !== null}>
            <Text style={styles.scenarioTitle}>Already Parked On App Open</Text>
            <Text style={styles.scenarioDescription}>Simulates cold-start while already sitting in a space. Uses still plus dwell confirmation.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#f59e0b' }]} onPress={() => void runScenario('walk_through_lot')} disabled={runningScenario !== null}>
            <Text style={styles.scenarioTitle}>Walk Through Lot</Text>
            <Text style={styles.scenarioDescription}>Pedestrian enters and leaves on foot. Validates that a person cutting through the lot is not counted as parked.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.testButton, { backgroundColor: '#10b981' }]} onPress={fetchCurrentMetrics} disabled={metricsLoading || runningScenario !== null}>
            <Text style={styles.buttonText}>{metricsLoading ? 'Loading...' : 'Refresh Sensors'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How To Demo</Text>
        <Text style={styles.instructionText}>
          1. Choose the scenario that matches the story you want to tell.{"\n"}
          2. Wait a few seconds for realtime validation to update.{"\n"}
          3. Watch the status move from INSUFFICIENT_DATA to ANALYZING or a final classification.{"\n"}
          4. Use the analysis breakdown to explain why the app called it parked or not parked.{"\n\n"}
          Recommended sequence: Drive In And Park, then Quick Drive-Through, then Walk Through Lot.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
    padding: SPACING.lg,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxl || 24,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.primary || '#007AFF',
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  section: {
    backgroundColor: COLORS.lightGray || '#f5f5f5',
    borderRadius: 8,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg || 18,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#000000',
    marginBottom: SPACING.md,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    color: COLORS.darkGray || '#333333',
  },
  value: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    color: COLORS.black || '#000000',
  },
  statusBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 16,
  },
  statusText: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    color: '#ffffff',
  },
  analysisGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  analysisItem: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    alignItems: 'center',
  },
  analysisLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    color: COLORS.darkGray || '#333333',
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  analysisValue: {
    fontSize: TYPOGRAPHY.fontSize.lg || 18,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.primary || '#007AFF',
  },
  metadataSection: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: SPACING.md,
    marginTop: SPACING.md,
  },
  metadataTitle: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#000000',
    marginBottom: SPACING.sm,
  },
  metadataText: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    color: COLORS.darkGray || '#333333',
    marginBottom: SPACING.xs,
  },
  testButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    color: '#ffffff',
  },
  instructionText: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    lineHeight: 20,
    color: COLORS.darkGray || '#333333',
  },
  scenarioList: {
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  scenarioCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    padding: SPACING.md,
  },
  scenarioTitle: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#000000',
    marginBottom: SPACING.xs,
  },
  scenarioDescription: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    color: COLORS.darkGray || '#333333',
    lineHeight: 20,
  },
  metricsContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: SPACING.md,
  },
  deviceInfo: {
    backgroundColor: '#f8f9fa',
    borderRadius: 6,
    padding: SPACING.sm,
    marginTop: SPACING.md,
  },
  deviceTitle: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#000000',
    marginBottom: SPACING.xs,
  },
  deviceText: {
    fontSize: TYPOGRAPHY.fontSize.xs || 12,
    color: COLORS.darkGray || '#333333',
    marginBottom: 2,
  },
  noData: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    color: COLORS.darkGray || '#333333',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});

export default ParkingValidationDebug;
