/**
 * Leave Detection Debug Component
 * Shows real-time leave intent detection and scenario-based departure flows.
 */

import React from 'react';
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { useEnhancedGeofencing } from '../context/EnhancedGeofencingProvider';
import locationService from '../services/locationService';
import leaveDetectionService from '../services/leaveDetectionService';

type LeaveScenarioKey =
  | 'walk_back_to_car'
  | 'unlock_and_reconnect'
  | 'start_driving_away'
  | 'full_departure_sequence'
  | 'confirm_vehicle_exit';

export const LeaveDetectionDebug: React.FC = () => {
  const { currentLotId, parkedLotId, currentLeaveIntent, debugInfo } = useEnhancedGeofencing();
  const activeLotId = currentLotId ?? parkedLotId;

  const getIntentProbabilityColor = (probability?: number): string => {
    if (!probability) return '#6b7280';
    if (probability >= 0.8) return '#ef4444';
    if (probability >= 0.6) return '#f59e0b';
    return '#22c55e';
  };

  const getConfidenceLevelColor = (level?: string): string => {
    switch (level) {
      case 'HIGH':
        return '#ef4444';
      case 'MEDIUM':
        return '#f59e0b';
      case 'LOW':
        return '#22c55e';
      default:
        return '#6b7280';
    }
  };

  const ensureMonitoringSession = async (): Promise<string> => {
    if (activeLotId) {
      return activeLotId;
    }

    locationService.triggerTestGeofenceEvent('G1', 'ENTER');
    await leaveDetectionService.debugSetSessionAge('G1', 20);
    return 'G1';
  };

  const injectBluetoothReconnect = async (lotId: string) => {
    await leaveDetectionService.debugInjectSignal(lotId, {
      type: 'BLUETOOTH_RECONNECT',
      confidence: 0.8,
      metadata: {
        bluetooth_state: 'CONNECTED',
        time_since_park: 20,
        raw_data: { simulated: true, source: 'debug_scenario' },
      },
    });
  };

  const injectSpeedIncrease = async (lotId: string, speedMph: number) => {
    await leaveDetectionService.debugInjectSignal(lotId, {
      type: 'SPEED_INCREASE',
      confidence: Math.min(0.95, speedMph / 25),
      metadata: {
        speed_mph: speedMph,
        time_since_park: 20,
        raw_data: { simulated: true, source: 'debug_scenario' },
      },
    });
  };

  const runScenario = async (scenario: LeaveScenarioKey) => {
    const lotId = await ensureMonitoringSession();
    await leaveDetectionService.debugSetSessionAge(lotId, 20);

    switch (scenario) {
      case 'walk_back_to_car':
        leaveDetectionService.processMotionChange(true);
        leaveDetectionService.processActivityChange('walking', 92);
        Alert.alert('Scenario Started', 'Simulated: user finishes class and walks back toward the parked car. Intent should rise, but not necessarily hit HIGH by itself.');
        break;
      case 'unlock_and_reconnect':
        await injectBluetoothReconnect(lotId);
        Alert.alert('Scenario Started', 'Simulated: user unlocks the car and the phone reconnects to car Bluetooth. This is a strong leave-intent signal.');
        break;
      case 'start_driving_away':
        leaveDetectionService.processMotionChange(true);
        leaveDetectionService.processActivityChange('in_vehicle', 96);
        await injectSpeedIncrease(lotId, 18);
        Alert.alert('Scenario Started', 'Simulated: user gets in the car and starts driving away. Leave intent should jump quickly.');
        break;
      case 'full_departure_sequence':
        leaveDetectionService.processMotionChange(true);
        leaveDetectionService.processActivityChange('walking', 90);
        await injectBluetoothReconnect(lotId);
        leaveDetectionService.processActivityChange('in_vehicle', 98);
        await injectSpeedIncrease(lotId, 20);
        Alert.alert('Scenario Started', 'Simulated: user walks to the car, reconnects Bluetooth, then drives away. This should produce the strongest leave-intent result.');
        break;
      case 'confirm_vehicle_exit':
        locationService.triggerTestGeofenceEvent(
          lotId,
          'EXIT',
          { type: 'in_vehicle', confidence: 95 },
          12,
        );
        Alert.alert('Exit Simulated', 'Vehicle EXIT fired for this lot. Parked state and lot highlight should now clear.');
        break;
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Leave Detection Debug</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Status</Text>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Active Lot:</Text>
          <Text style={styles.value}>{activeLotId || 'None'}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Leave Intent:</Text>
          {currentLeaveIntent ? (
            <View style={[styles.statusBadge, { backgroundColor: getIntentProbabilityColor(currentLeaveIntent.intent_probability) }]}>
              <Text style={styles.statusText}>{Math.round(currentLeaveIntent.intent_probability * 100)}%</Text>
            </View>
          ) : (
            <Text style={styles.value}>No Intent</Text>
          )}
        </View>
        {currentLeaveIntent && (
          <View style={styles.statusRow}>
            <Text style={styles.label}>Confidence:</Text>
            <View style={[styles.confidenceBadge, { backgroundColor: getConfidenceLevelColor(currentLeaveIntent.confidence_level) }]}>
              <Text style={styles.confidenceText}>{currentLeaveIntent.confidence_level}</Text>
            </View>
          </View>
        )}
      </View>

      {currentLeaveIntent && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Intent Analysis</Text>
          <View style={styles.analysisGrid}>
            <View style={styles.analysisItem}>
              <Text style={styles.analysisLabel}>Intent Probability</Text>
              <Text style={styles.analysisValue}>{Math.round(currentLeaveIntent.intent_probability * 100)}%</Text>
            </View>
            <View style={styles.analysisItem}>
              <Text style={styles.analysisLabel}>Signal Count</Text>
              <Text style={styles.analysisValue}>{currentLeaveIntent.primary_signals.length}</Text>
            </View>
            {currentLeaveIntent.estimated_leave_time && (
              <View style={styles.analysisItem}>
                <Text style={styles.analysisLabel}>Est. Leave Time</Text>
                <Text style={styles.analysisValue}>{currentLeaveIntent.estimated_leave_time} min</Text>
              </View>
            )}
            <View style={styles.analysisItem}>
              <Text style={styles.analysisLabel}>Should Notify</Text>
              <Text style={[styles.analysisValue, { color: currentLeaveIntent.should_notify_occupancy ? '#22c55e' : '#ef4444' }]}>
                {currentLeaveIntent.should_notify_occupancy ? 'YES' : 'NO'}
              </Text>
            </View>
          </View>

          {currentLeaveIntent.primary_signals.length > 0 && (
            <View style={styles.signalsSection}>
              <Text style={styles.subsectionTitle}>Recent Leave Signals</Text>
              {currentLeaveIntent.primary_signals.slice(0, 4).map((signal, index) => (
                <View key={index} style={styles.signalItem}>
                  <View style={styles.signalHeader}>
                    <Text style={styles.signalType}>{signal.type.replace(/_/g, ' ')}</Text>
                    <Text style={styles.signalConfidence}>{Math.round(signal.confidence * 100)}%</Text>
                  </View>
                  <Text style={styles.signalTimestamp}>
                    {new Date(signal.timestamp).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true,
                    })}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Session Information</Text>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Active Leave Sessions:</Text>
          <Text style={styles.value}>{debugInfo.activeLeaveMonitoring}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Is Monitoring Leave:</Text>
          <Text style={[styles.value, { color: debugInfo.isMonitoringLeave ? '#22c55e' : '#ef4444' }]}>
            {debugInfo.isMonitoringLeave ? 'Yes' : 'No'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Departure Scenarios</Text>
        <Text style={styles.instructionsText}>
          These scenarios simulate the actual behaviors that happen after a car has been parked for a while, not raw internal signals. Leave intent alone does not unpark the lot; a vehicular EXIT event does.
        </Text>

        <View style={styles.scenarioList}>
          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#3b82f6' }]} onPress={() => void runScenario('walk_back_to_car')}>
            <Text style={styles.scenarioTitle}>Walk Back To Car</Text>
            <Text style={styles.scenarioDescription}>User leaves class and starts walking toward the parked car. Good for medium-confidence leave intent.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#8b5cf6' }]} onPress={() => void runScenario('unlock_and_reconnect')}>
            <Text style={styles.scenarioTitle}>Unlock And Reconnect Bluetooth</Text>
            <Text style={styles.scenarioDescription}>Phone reconnects to car Bluetooth after the user returns. Strong signal that departure is near.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#f59e0b' }]} onPress={() => void runScenario('start_driving_away')}>
            <Text style={styles.scenarioTitle}>Start Driving Away</Text>
            <Text style={styles.scenarioDescription}>In-vehicle activity plus rising speed. Useful for showing why the app should notify occupancy right away.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#ef4444' }]} onPress={() => void runScenario('full_departure_sequence')}>
            <Text style={styles.scenarioTitle}>Full Departure Sequence</Text>
            <Text style={styles.scenarioDescription}>Walk back, reconnect Bluetooth, then drive away. Highest-confidence departure story for the demo.</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.scenarioCard, { borderColor: '#dc2626' }]} onPress={() => void runScenario('confirm_vehicle_exit')}>
            <Text style={styles.scenarioTitle}>Confirm Vehicle Exit</Text>
            <Text style={styles.scenarioDescription}>Sends a vehicular EXIT event for the active lot. Use this to clear parked state and remove map highlight after leave-intent scenarios.</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How To Demo Leave Detection</Text>
        <Text style={styles.instructionsText}>
          1. Run one departure scenario at a time.{"\n"}
          2. The panel automatically creates or ages a monitored parking session so you do not have to wait 5 real minutes.{"\n"}
          3. Watch the intent probability and confidence badges update.{"\n"}
          4. Use Full Departure Sequence when you want the clearest high-confidence example.{"\n"}
          5. Run Confirm Vehicle Exit to clear parked state and map highlight.
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
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg || 18,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#333',
    marginBottom: SPACING.md,
  },
  subsectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#333',
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    color: COLORS.black || '#333',
    flex: 1,
  },
  value: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#333',
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 50,
    alignItems: 'center',
  },
  statusText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  confidenceBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 60,
    alignItems: 'center',
  },
  confidenceText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  analysisGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  analysisItem: {
    width: '48%',
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: 6,
    marginBottom: SPACING.sm,
    alignItems: 'center',
  },
  analysisLabel: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    color: COLORS.gray || '#666',
    textAlign: 'center',
    marginBottom: 4,
  },
  analysisValue: {
    fontSize: TYPOGRAPHY.fontSize.lg || 18,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.black || '#333',
    textAlign: 'center',
  },
  signalsSection: {
    marginTop: SPACING.md,
  },
  signalItem: {
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: 6,
    marginBottom: SPACING.sm,
  },
  signalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  signalType: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#333',
    textTransform: 'capitalize',
  },
  signalConfidence: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.primary || '#007AFF',
  },
  signalTimestamp: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    color: COLORS.gray || '#666',
  },
  instructionsText: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    color: COLORS.black || '#333',
    lineHeight: 24,
  },
  scenarioList: {
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  scenarioCard: {
    backgroundColor: COLORS.white,
    borderRadius: 10,
    borderWidth: 1,
    padding: SPACING.md,
  },
  scenarioTitle: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black || '#333',
    marginBottom: SPACING.xs,
  },
  scenarioDescription: {
    fontSize: TYPOGRAPHY.fontSize.sm || 14,
    color: COLORS.gray || '#666',
    lineHeight: 20,
  },
});

export default LeaveDetectionDebug;
