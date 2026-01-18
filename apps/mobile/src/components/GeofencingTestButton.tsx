/**
 * Geofencing Test Button - Development Only
 * Simple test button to simulate geofencing events for testing
 */

import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { COLORS } from '../constants/theme';
import locationService from '../services/locationService';

interface GeofencingTestButtonProps {
  visible?: boolean;
}

export const GeofencingTestButton: React.FC<GeofencingTestButtonProps> = ({ 
  visible = __DEV__ 
}) => {
  if (!visible) return null;

  const simulateEntry = () => {
    console.log('[GeofencingTestButton] Simulating ENTER event for lot_1');
    console.warn('GEOFENCE TEST: Simulating ENTER for Lot 1');
    locationService.triggerTestGeofenceEvent('lot_1', 'ENTER');
  };

  const simulateExit = () => {
    console.log('[GeofencingTestButton] Simulating EXIT event for lot_1'); 
    console.warn('GEOFENCE TEST: Simulating EXIT for Lot 1');
    locationService.triggerTestGeofenceEvent('lot_1', 'EXIT');
  };

  const getCurrentLocation = () => {
    console.log('[GeofencingTestButton] Getting current GPS coordinates...');
    console.warn('GPS: Getting your current coordinates...');
    
    // Use the locationService to get current position
    locationService.getCurrentPosition()
      .then((position: any) => {
        const { latitude, longitude } = position.coords;
        console.warn(`YOUR COORDINATES: ${latitude}, ${longitude}`);
        console.log(`[GeofencingTestButton] Current position: lat=${latitude}, lon=${longitude}, accuracy=${position.coords.accuracy}m`);
      })
      .catch((error: any) => {
        console.error('[GeofencingTestButton] Failed to get current position:', error);
        console.warn('GPS: Failed to get coordinates - check location permissions');
      });
  };

  const testOfflineMode = () => {
    console.log('[GeofencingTestButton] Testing offline geofence behavior...');
    console.warn('OFFLINE TEST: Simulating network failure during geofence event');
    
    // Temporarily break the API to simulate offline
    const originalRecordOccupancyEvent = require('../services/api').lotsApi.recordOccupancyEvent;
    require('../services/api').lotsApi.recordOccupancyEvent = () => {
      return Promise.reject(new Error('Network unavailable - simulated offline mode'));
    };
    
    // Trigger a geofence event while "offline"
    locationService.triggerTestGeofenceEvent('home_test_zone', 'ENTER');
    
    // Restore the API after 3 seconds
    setTimeout(() => {
      require('../services/api').lotsApi.recordOccupancyEvent = originalRecordOccupancyEvent;
      console.warn('ONLINE: Network connection restored');
    }, 3000);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>DEV: Geofencing Test</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={[styles.button, styles.enterButton]} onPress={simulateEntry}>
          <Text style={styles.buttonText}>Simulate Enter Lot 1</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.exitButton]} onPress={simulateExit}>
          <Text style={styles.buttonText}>Simulate Exit Lot 1</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={[styles.button, styles.locationButton]} onPress={getCurrentLocation}>
          <Text style={styles.buttonText}>📍 Get My Coordinates</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={[styles.button, styles.offlineButton]} onPress={testOfflineMode}>
          <Text style={styles.buttonText}>Test Offline Mode</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f59e0b',
    margin: 16,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 8,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    padding: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  enterButton: {
    backgroundColor: '#10b981',
  },
  exitButton: {
    backgroundColor: '#ef4444',
  },
  locationButton: {
    backgroundColor: '#3b82f6',
  },
  offlineButton: {
    backgroundColor: '#f97316',
  },
  buttonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});
