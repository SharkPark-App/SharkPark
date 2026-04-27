/**
 * Parking Validation Debug Component
 * Shows real-time parking validation status and behavioral analysis data
 * For development and testing purposes
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Text } from './CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { useEnhancedGeofencing } from '../context/EnhancedGeofencingProvider';
import parkingValidationService from '../services/parkingValidationService';
import { sharedBehavioralCollector } from '../services/behavioralDataCollector';
import type { BehavioralMetrics } from '../services/behavioralDataCollector';
import locationService from '../services/locationService';
import { ValidationStatus } from '../validation';

export const ParkingValidationDebug: React.FC = () => {
  const { currentLotId, currentValidationStatus, debugInfo } = useEnhancedGeofencing();
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentMetrics, setCurrentMetrics] = useState<BehavioralMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Refresh debug info and fetch current behavioral metrics
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey(key => key + 1);
      // Fetch current behavioral metrics
      fetchCurrentMetrics();
    }, 3000); // Every 3 seconds

    // Initial fetch
    fetchCurrentMetrics();

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
      case 'PARKED': return '#22c55e'; // green
      case 'DROVE_THROUGH': return '#ef4444'; // red  
      case 'SEARCHING': return '#f59e0b'; // yellow
      case 'ANALYZING': return '#3b82f6'; // blue
      default: return '#6b7280'; // gray
    }
  };

  const simulateBehavioralEvent = (eventType: 'STATIONARY' | 'WALKING' | 'DRIVING' | 'BLUETOOTH_CONNECT') => {
    const metadata = {
      speed_mph: eventType === 'STATIONARY' ? 0 : eventType === 'WALKING' ? 3 : 15,
      accuracy_meters: 5 + Math.random() * 10,
      bluetooth_state: eventType === 'BLUETOOTH_CONNECT' ? 'CONNECTED' as const : 'UNKNOWN' as const,
      raw_data: { simulated: true, timestamp: new Date().toISOString() }
    };

    parkingValidationService.recordBehavioralEvent(eventType, metadata);
    
    Alert.alert(
      'Event Simulated', 
      `Recorded ${eventType} event with speed ${metadata.speed_mph} mph`,
      [{ text: 'OK' }]
    );
  };

  const triggerGeofenceEvent = (eventType: 'ENTER' | 'EXIT') => {
    locationService.triggerTestGeofenceEvent('G1', eventType);
    Alert.alert('Geofence Event', `Triggered ${eventType} event for G1`, [{ text: 'OK' }]);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Parking Validation Debug</Text>
      
      {/* Current Status */}
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

      {/* Behavioral Analysis Details */}
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

      {/* Real Behavioral Metrics */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Real Sensor Data {metricsLoading ? '(Loading...)' : ''}
        </Text>
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
              <Text style={[styles.value, { 
                color: currentMetrics.bluetooth_state === 'CONNECTED' ? '#22c55e' : 
                       currentMetrics.bluetooth_state === 'DISCONNECTED' ? '#ef4444' : '#6b7280' 
              }]}>
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

      {/* Debug Info */}
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

        <Text style={styles.subsectionTitle}>Behavioral Events</Text>
        <View style={styles.buttonGrid}>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#3b82f6' }]}
            onPress={() => simulateBehavioralEvent('STATIONARY')}
          >
            <Text style={styles.buttonText}>Stationary</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#f59e0b' }]}
            onPress={() => simulateBehavioralEvent('WALKING')}
          >
            <Text style={styles.buttonText}>Walking</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#8b5cf6' }]}
            onPress={() => simulateBehavioralEvent('DRIVING')}
          >
            <Text style={styles.buttonText}>Driving</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#06b6d4' }]}
            onPress={() => simulateBehavioralEvent('BLUETOOTH_CONNECT')}
          >
            <Text style={styles.buttonText}>Bluetooth</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.testButton, { backgroundColor: '#10b981' }]}
            onPress={fetchCurrentMetrics}
            disabled={metricsLoading}
          >
            <Text style={styles.buttonText}>
              {metricsLoading ? 'Loading...' : 'Refresh Sensors'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Instructions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How to Test</Text>
        <Text style={styles.instructionText}>
          1. Tap "ENTER Lot" to simulate entering a parking lot{'\n'}
          2. Tap behavioral events to simulate parking behavior{'\n'}
          3. Watch the validation status change in real-time{'\n'}
          4. Tap "EXIT Lot" to complete the session and see final analysis{'\n\n'}
          The system analyzes speed, movement patterns, and dwell time to determine if you actually parked or just drove through.
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
  subsectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.md || 16,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    color: COLORS.darkGray || '#333333',
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
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
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    marginBottom: SPACING.sm,
    minWidth: '48%',
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
