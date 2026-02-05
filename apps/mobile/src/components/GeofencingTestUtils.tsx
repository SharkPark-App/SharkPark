/**
 * Geofencing Test Utilities
 * Tools for testing geofencing without physical movement
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, Button, Alert, TextInput } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import locationService from '../services/locationService';
import { GeofenceEvent } from '../types/location';
import { 
  TEST_CONSTANTS, 
  UI_CONSTANTS, 
  ACCESSIBILITY_CONSTANTS 
} from '../constants/geofencing';

export const GeofencingTestUtils: React.FC = () => {
  const [testLotId, setTestLotId] = useState<string>(TEST_CONSTANTS.TEST_LOT_ID);
  const [testEventType, setTestEventType] = useState<'ENTER' | 'EXIT'>('ENTER');

  const simulateGeofenceEvent = () => {
    const event: GeofenceEvent = {
      regionId: testLotId,
      eventType: testEventType,
      timestamp: new Date().toISOString(),
    };

    // Use the proper locationService method to trigger events
    // Triggering test geofence event
    locationService.triggerTestGeofenceEvent(testLotId, testEventType);
    
    Alert.alert(
      'Test Event Triggered',
      `Simulated ${testEventType} event for ${testLotId}\n\nCheck console for database update logs.`,
      [{ text: 'OK' }]
    );
  };

  const simulateLocationUpdate = () => {
    // Mock CSULB coordinates (around the campus)
    const mockCoordinates = {
      latitude: TEST_CONSTANTS.CSULB_CENTER.latitude,
      longitude: TEST_CONSTANTS.CSULB_CENTER.longitude,
      timestamp: Date.now(),
    };

    Alert.alert(
      'Mock Location',
      `Simulating location: ${mockCoordinates.latitude}, ${mockCoordinates.longitude}`,
      [{ text: 'OK' }]
    );

    // Trigger location update manually
    const locationServiceAny = locationService as any;
    if (locationServiceAny.handleLocationUpdate) {
      locationServiceAny.handleLocationUpdate({
        coords: mockCoordinates,
        timestamp: mockCoordinates.timestamp,
      });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Geofencing Test Tools</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Simulate Geofence Event</Text>
        
        <Text style={styles.label}>Lot ID:</Text>
        <TextInput
          style={styles.input}
          value={testLotId}
          onChangeText={setTestLotId}
          placeholder="e.g., lot-1, lot-2"
          accessibilityLabel={ACCESSIBILITY_CONSTANTS.LABELS.LOT_SELECTOR}
          accessibilityHint={ACCESSIBILITY_CONSTANTS.HINTS.LOT_SELECTION}
        />
        
        <Text style={styles.label}>Event Type:</Text>
        <View style={styles.buttonRow}>
          <Button
            title="ENTER"
            color={testEventType === 'ENTER' ? COLORS.primary : COLORS.gray}
            onPress={() => setTestEventType('ENTER')}
          />
          <View style={styles.buttonSpacer} />
          <Button
            title="EXIT"
            color={testEventType === 'EXIT' ? COLORS.primary : COLORS.gray}
            onPress={() => setTestEventType('EXIT')}
          />
        </View>
        
        <View style={styles.actionButton}>
          <Button
            title="Trigger Event"
            onPress={simulateGeofenceEvent}
            color={COLORS.primary}
            accessibilityLabel={ACCESSIBILITY_CONSTANTS.LABELS.TEST_BUTTON}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Simulate Location</Text>
        <Text style={styles.description}>
          Triggers a mock location update at CSULB coordinates
        </Text>
        
        <View style={styles.actionButton}>
          <Button
            title="Mock Location Update"
            onPress={simulateLocationUpdate}
            color={COLORS.secondary || COLORS.primary}
          />
        </View>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.infoTitle}>💡 Testing Tips</Text>
        <Text style={styles.infoText}>
          • Use "Trigger Event" to test UI responses{'\n'}
          • Check console logs for debugging{'\n'}
          • Test both ENTER and EXIT events{'\n'}
          • Try different lot IDs (lot-1 through lot-20){'\n'}
          • Monitor network requests in backend logs
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: SPACING.lg,
    backgroundColor: COLORS.white,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.black,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  section: {
    backgroundColor: COLORS.lightGray,
    padding: SPACING.lg,
    borderRadius: 8,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.black,
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.black,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.gray,
    borderRadius: 4,
    padding: SPACING.sm,
    backgroundColor: COLORS.white,
    marginBottom: SPACING.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    marginBottom: SPACING.md,
  },
  buttonSpacer: {
    width: SPACING.sm,
  },
  actionButton: {
    marginTop: SPACING.md,
  },
  description: {
    fontSize: 14,
    color: COLORS.gray,
    marginBottom: SPACING.sm,
  },
  infoSection: {
    backgroundColor: '#e3f2fd',
    padding: SPACING.lg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#90caf9',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1565c0',
    marginBottom: SPACING.sm,
  },
  infoText: {
    fontSize: 14,
    color: '#1565c0',
    lineHeight: 20,
  },
});

export default GeofencingTestUtils;
