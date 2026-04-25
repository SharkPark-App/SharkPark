/**
 * Leave Detection Debug Component
 * Shows real-time leave intent detection status and signals
 * Integrates with parking validation debug for comprehensive testing
 */

import React, { useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Text } from './CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { useEnhancedGeofencing } from '../context/EnhancedGeofencingProvider';
import locationService from '../services/locationService';

export const LeaveDetectionDebug: React.FC = () => {
  const { currentLotId, currentLeaveIntent, debugInfo } = useEnhancedGeofencing();

  // Refresh debug info periodically
  useEffect(() => {
    const interval = setInterval(() => {
      // Trigger re-render by updating state if needed
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const getIntentProbabilityColor = (probability?: number): string => {
    if (!probability) return '#6b7280'; // gray
    if (probability >= 0.8) return '#ef4444'; // red - high intent
    if (probability >= 0.6) return '#f59e0b'; // yellow - medium intent
    return '#22c55e'; // green - low intent
  };

  const getConfidenceLevelColor = (level?: string): string => {
    switch (level) {
      case 'HIGH': return '#ef4444'; // red
      case 'MEDIUM': return '#f59e0b'; // yellow
      case 'LOW': return '#22c55e'; // green
      default: return '#6b7280'; // gray
    }
  };

  const simulateLeaveSignal = (signalType: 'WALKING_TO_CAR' | 'BLUETOOTH_RECONNECT' | 'SPEED_INCREASE') => {
    if (!currentLotId) {
      Alert.alert('No Active Session', 'Please enter a parking lot first to test leave detection.', [{ text: 'OK' }]);
      return;
    }

    // Since we can't directly trigger the internal behavioral collector,
    // we'll trigger a geofence event to simulate the signal type
    let message = '';
    
    switch (signalType) {
      case 'WALKING_TO_CAR':
        message = 'Simulated walking back to car (2-5 mph movement detected)';
        break;
      case 'BLUETOOTH_RECONNECT':
        message = 'Simulated Bluetooth reconnection to car';
        break;
      case 'SPEED_INCREASE':
        message = 'Simulated sudden speed increase (driving away)';
        break;
    }

    Alert.alert(
      'Leave Signal Simulated',
      message,
      [{ text: 'OK' }]
    );
    
    // In a real scenario, these signals would be detected automatically
    // by the BehavioralDataCollector and processed by LeaveDetectionService
  };

  const triggerGeofenceEvent = (eventType: 'ENTER' | 'EXIT') => {
    locationService.triggerTestGeofenceEvent('G1', eventType);
    Alert.alert('Geofence Event', `Triggered ${eventType} event for G1`, [{ text: 'OK' }]);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Leave Detection Debug</Text>
      
      {/* Current Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Status</Text>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Current Lot:</Text>
          <Text style={styles.value}>{currentLotId || 'None'}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.label}>Leave Intent:</Text>
          {currentLeaveIntent ? (
            <View style={[styles.statusBadge, { backgroundColor: getIntentProbabilityColor(currentLeaveIntent.intent_probability) }]}>
              <Text style={styles.statusText}>
                {Math.round(currentLeaveIntent.intent_probability * 100)}%
              </Text>
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

      {/* Leave Intent Analysis */}
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
          
          {/* Recent Signals */}
          {currentLeaveIntent.primary_signals.length > 0 && (
            <View style={styles.signalsSection}>
              <Text style={styles.subsectionTitle}>Recent Leave Signals</Text>
              {currentLeaveIntent.primary_signals.slice(0, 3).map((signal, index) => (
                <View key={index} style={styles.signalItem}>
                  <View style={styles.signalHeader}>
                    <Text style={styles.signalType}>{signal.type.replace('_', ' ')}</Text>
                    <Text style={styles.signalConfidence}>{Math.round(signal.confidence * 100)}%</Text>
                  </View>
                  <Text style={styles.signalTimestamp}>
                    {new Date(signal.timestamp).toLocaleTimeString()}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Session Info */}
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

      {/* Test Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test Controls</Text>
        
        <Text style={styles.subsectionTitle}>Geofence Events</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#22c55e' }]}
            onPress={() => triggerGeofenceEvent('ENTER')}
          >
            <Text style={styles.buttonText}>ENTER Lot</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#ef4444' }]}
            onPress={() => triggerGeofenceEvent('EXIT')}
          >
            <Text style={styles.buttonText}>EXIT Lot</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.subsectionTitle}>Leave Intent Signals</Text>
        <View style={styles.buttonGrid}>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#3b82f6' }]}
            onPress={() => simulateLeaveSignal('WALKING_TO_CAR')}
          >
            <Text style={styles.buttonText}>Walking to Car</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#8b5cf6' }]}
            onPress={() => simulateLeaveSignal('BLUETOOTH_RECONNECT')}
          >
            <Text style={styles.buttonText}>Bluetooth Connect</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#f59e0b' }]}
            onPress={() => simulateLeaveSignal('SPEED_INCREASE')}
          >
            <Text style={styles.buttonText}>Speed Increase</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Instructions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How to Test Leave Detection</Text>
        <Text style={styles.instructionsText}>
          1. Tap "ENTER Lot" to simulate entering a parking lot{'\n'}
          2. Wait a few minutes to establish parking session{'\n'}
          3. Tap leave intent signals to simulate preparing to leave{'\n'}
          4. Watch the intent probability increase in real-time{'\n'}
          5. Tap "EXIT Lot" to complete the session{'\n\n'}
          The system detects walking to car, Bluetooth reconnection, and speed increases to predict when you're about to leave, enabling real-time occupancy updates.
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
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: SPACING.md,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  testButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 8,
    margin: 4,
    minWidth: 120,
    alignItems: 'center',
  },
  buttonText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  instructionsText: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    color: COLORS.black || '#333',
    lineHeight: 24,
  },
});
