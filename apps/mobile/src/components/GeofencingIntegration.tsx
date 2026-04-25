/**
 * Geofencing Integration Example
 * Shows how to integrate location tracking with parking lot data
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Button, Alert, ScrollView } from 'react-native';
import { Text } from './CustomText';
import useLocationService from '../hooks/useLocationService';
import { useAllLotsData } from '../hooks/useAllLotsData';
import { createSDKGeofencesFromLots } from '../utils/geofenceUtils';
import { lotsApi, ParkingLotResponse } from '../services/api';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { GeofenceEvent } from '../types/location';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GeofencingTestUtils = __DEV__ ? require('./GeofencingTestUtils').default : null;
import { 
  MESSAGE_CONSTANTS, 
  ACCESSIBILITY_CONSTANTS 
} from '../constants/geofencing';

interface GeofencingIntegrationProps {
  onGeofenceEvent?: (event: { lotId: string; eventType: 'ENTER' | 'EXIT' }) => void;
}

export const GeofencingIntegration: React.FC<GeofencingIntegrationProps> = ({ 
  onGeofenceEvent 
}) => {
  const { lots, loading: lotsLoading, error: lotsError } = useAllLotsData();
  const {
    isTracking,
    monitoredRegions,
    requestPermissions,
    startGeofenceMonitoring,
    registerGeofences,
    lastGeofenceEvent,
    lastError,
  } = useLocationService();

  const [isInitialized, setIsInitialized] = useState(false);
  const [currentLot, setCurrentLot] = useState<string | null>(null);

  // Initialize geofencing when lots data is available
  useEffect(() => {
    if (lots.length > 0 && !isInitialized) {
      initializeGeofencing();
    }
  }, [lots, isInitialized]);

  // Handle geofence events
  useEffect(() => {
    if (lastGeofenceEvent) {
      handleGeofenceEvent(lastGeofenceEvent);
    }
  }, [lastGeofenceEvent]);

  const initializeGeofencing = async () => {
    try {

      // Convert parking lot data to SDK geofences
      const geofences = createSDKGeofencesFromLots(lots);

      // Register geofences with the SDK (handles platform limits via geofenceProximityRadius)
      await registerGeofences(geofences);

      setIsInitialized(true);
      // Geofencing initialized successfully
    } catch (error) {
      console.error('[GeofencingIntegration] Failed to initialize geofencing:', error);
    }
  };

  const handleGeofenceEvent = (event: GeofenceEvent) => {
    // Geofence event received

    // Find the lot info
    const lot: ParkingLotResponse | undefined = lots.find((l: ParkingLotResponse) => l.lot_id === event.regionId);
    const lotName: string = lot?.display_name || lot?.lot_name || event.regionId;

    if (event.eventType === 'ENTER') {
      setCurrentLot(event.regionId);
      Alert.alert(
        'Entered Parking Lot',
        `Welcome to ${lotName}!\n\n${MESSAGE_CONSTANTS.INFO.PRIVACY_NOTICE}`,
        [{ text: 'OK' }]
      );

      // Send anonymous occupancy event to backend
      sendOccupancyEvent(event.regionId, 'ENTER');
    } else if (event.eventType === 'EXIT') {
      setCurrentLot(null);
      Alert.alert(
        'Left Parking Lot',
        `Thanks for using ${lotName}!\n\nYour exit has been recorded anonymously.`,
        [{ text: 'OK' }]
      );

      // Send anonymous occupancy event to backend
      sendOccupancyEvent(event.regionId, 'EXIT');
    }

    // Notify parent component (only for ENTER/EXIT, not DWELL)
    if (event.eventType === 'ENTER' || event.eventType === 'EXIT') {
      onGeofenceEvent?.({
        lotId: event.regionId,
        eventType: event.eventType,
      });
    }
  };

  const sendOccupancyEvent = async (lotId: string, eventType: 'ENTER' | 'EXIT') => {
    try {
      // Send anonymous occupancy event to backend
      await lotsApi.recordOccupancyEvent({ 
        lotId, 
        eventType, 
        source: 'GEOFENCE' 
      });
      
      // Successfully sent occupancy event
    } catch (error) {
      console.error('[GeofencingIntegration] Failed to send occupancy event:', error);
    }
  };

  const startGeofencing = async () => {
    const permissionsGranted = await requestPermissions();
    if (!permissionsGranted) {
      Alert.alert(
        'Permissions Required',
        MESSAGE_CONSTANTS.ERRORS.PERMISSION_DENIED,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      await startGeofenceMonitoring();
    } catch {
      Alert.alert(
        'Error',
        'Failed to start parking detection. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  if (lotsLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.statusText}>Loading parking lot data...</Text>
      </View>
    );
  }

  if (lotsError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Error loading parking lots: {lotsError}</Text>
      </View>
    );
  }

  const getCurrentLotInfo = (): ParkingLotResponse | undefined => {
    if (!currentLot) return undefined;
    return lots.find((l: ParkingLotResponse) => l.lot_id === currentLot);
  };

  const currentLotInfo: ParkingLotResponse | undefined = getCurrentLotInfo();

  return (
    <ScrollView 
      style={styles.container}
      accessibilityLabel="Smart parking detection settings"
    >
      <Text style={styles.title}>Smart Parking Detection</Text>
      
      <View 
        style={styles.statusCard}
        accessibilityLabel={ACCESSIBILITY_CONSTANTS.LABELS.GEOFENCE_STATUS}
        accessibilityValue={{ text: isTracking ? 'Active' : 'Inactive' }}
      >
        <Text style={styles.statusLabel}>Status:</Text>
        <Text style={[styles.statusValue, { 
          color: isTracking ? COLORS.primary : COLORS.gray 
        }]}>
          {isTracking ? 'Active' : 'Inactive'}
        </Text>
      </View>

      {currentLotInfo && (
        <View 
          style={styles.currentLotCard}
          accessibilityLabel={ACCESSIBILITY_CONSTANTS.LABELS.CURRENT_LOT}
          accessibilityValue={{ text: currentLotInfo.display_name || currentLotInfo.lot_name }}
        >
          <Text style={styles.currentLotLabel}>Currently in:</Text>
          <Text style={styles.currentLotName}>
            {currentLotInfo.display_name || currentLotInfo.lot_name}
          </Text>
          <Text style={styles.currentLotDetails}>
            Capacity: {currentLotInfo.capacity} • 
            Available: ~{currentLotInfo.estimated_available ?? currentLotInfo.available ?? 'N/A'} • 
            {Math.round((currentLotInfo.occupancy_rate ?? (currentLotInfo.current_occupancy / currentLotInfo.capacity)) * 100)}% full
          </Text>
        </View>
      )}

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Privacy-First Tracking</Text>
        <Text style={styles.infoText}>
          • Your exact location is never stored{'\n'}
          • Only anonymous entry/exit events are recorded{'\n'}
          • Helps other students find available parking{'\n'}
          • You can disable anytime
        </Text>
      </View>

      <View 
        style={styles.statsCard}
        accessibilityLabel="Parking detection statistics"
      >
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Permission Status:</Text>
          <Text 
            style={[styles.statValue, { 
              color: isTracking ? COLORS.primary : COLORS.gray 
            }]}
            accessibilityLabel={ACCESSIBILITY_CONSTANTS.LABELS.PERMISSION_STATUS}
            accessibilityValue={{ text: isTracking ? 'Granted' : 'Not Granted' }}
          >
            {isTracking ? 'Granted' : 'Not Granted'}
          </Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Monitored Lots:</Text>
          <Text 
            style={styles.statValue}
            accessibilityLabel={ACCESSIBILITY_CONSTANTS.LABELS.MONITORED_LOTS}
            accessibilityValue={{ text: `${monitoredRegions} of ${lots.length} lots monitored` }}
          >
            {monitoredRegions} of {lots.length}
          </Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Total Lots:</Text>
          <Text style={styles.statValue}>{lots.length}</Text>
        </View>
      </View>

      {!isTracking && (
        <View style={styles.buttonContainer}>
          <Button
            title="Enable Smart Parking Detection"
            onPress={startGeofencing}
            color={COLORS.primary}
            accessibilityLabel={ACCESSIBILITY_CONSTANTS.LABELS.LOCATION_BUTTON}
          />
        </View>
      )}

      {lastError && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorMessage}>{lastError.message}</Text>
        </View>
      )}

      {/* Development Testing Tools */}
      {__DEV__ && GeofencingTestUtils && (
        <View style={styles.devSection}>
          <GeofencingTestUtils />
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: SPACING.lg,
    backgroundColor: COLORS.white,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.black,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  statusCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    marginBottom: SPACING.md,
    minHeight: ACCESSIBILITY_CONSTANTS.MINIMUM_TOUCH_TARGET, // Ensure sufficient touch target
  },
  statusLabel: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black,
  },
  statusText: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    color: COLORS.gray,
    textAlign: 'center',
    marginVertical: SPACING.xl,
  },
  statusValue: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  currentLotCard: {
    padding: SPACING.lg,
    backgroundColor: COLORS.primary + '20',
    borderRadius: 8,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  currentLotLabel: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.gray,
    marginBottom: SPACING.xs,
  },
  currentLotName: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  currentLotDetails: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.darkGray,
  },
  infoCard: {
    padding: SPACING.lg,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    marginBottom: SPACING.md,
  },
  infoTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black,
    marginBottom: SPACING.sm,
  },
  infoText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.darkGray,
    lineHeight: 20,
  },
  statsCard: {
    padding: SPACING.lg,
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    marginBottom: SPACING.md,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  statLabel: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.gray,
  },
  statValue: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.black,
  },
  buttonContainer: {
    marginVertical: SPACING.lg,
    minHeight: ACCESSIBILITY_CONSTANTS.RECOMMENDED_TOUCH_TARGET, // Better touch target for buttons
  },
  errorCard: {
    padding: SPACING.lg,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorTitle: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: '#dc2626',
    marginBottom: SPACING.sm,
  },
  errorText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: '#dc2626',
    textAlign: 'center',
    marginVertical: SPACING.xl,
  },
  errorMessage: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: '#dc2626',
  },
  devSection: {
    marginTop: SPACING.xl,
    paddingTop: SPACING.lg,
    borderTopWidth: 2,
    borderTopColor: COLORS.primary,
  },
});

export default GeofencingIntegration;
