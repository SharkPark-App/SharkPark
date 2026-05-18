/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ScrollView, Linking } from 'react-native';
import { Text } from '../components/CustomText';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { SectionCard } from '../components/SectionCard';
import { Header } from '../components';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootTabParamList, MapStackParamList } from '../types/navigation';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ParkingValidationDebug = __DEV__ ? require('../components/ParkingValidationDebug').default : null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LeaveDetectionDebug = __DEV__ ? require('../components/LeaveDetectionDebug').LeaveDetectionDebug : null;
import useLocationService from '../hooks/useLocationService';
import { useEnhancedGeofencing } from '../context/EnhancedGeofencingProvider';
import { TYPOGRAPHY, SPACING, COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { deleteMyAccount, getUserProfile, updateNotificationPreferences } from '../services/api/users';
import type { NotificationPreferences } from '../services/api/users';
import locationService from '../services/locationService';
import { simulateForegroundPushMessage } from '../services/pushNotifications';
import { sendDebugPushNotification } from '../services/api/notifications';

const ProfileScreen: React.FC = () => {
  const { themeMode, setThemeMode, colors, isDark } = useTheme();

  // Notification preferences — keys match the backend DTO.
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>({
    favorites_filling: true,
    favorites_clearing: true,
    surge_alerts: false,
    event_alerts: true,
  });
  const [savingNotif, setSavingNotif] = useState(false);

  const { logout, userEmail, isAuthenticated, isGuest } = useAuth();

  // Composite nav: from the Profile tab we need to jump into the Map stack to
  // push the LocationPermission soft-ask screen.
  const navigation = useNavigation<
    CompositeNavigationProp<
      BottomTabNavigationProp<RootTabParamList, 'Profile'>,
      StackNavigationProp<MapStackParamList>
    >
  >();

  // Location service hook for permission checking
  const {
    isTracking,
    requestPermissions,
  } = useLocationService();

  // Geofencing status from enhanced provider
  const {
    isGeofencingActive,
    currentLotId,
    parkedLotId,
    currentValidationStatus,
    currentLeaveIntent,
    carpoolPassengerMode,
    carpoolPassengerCount,
    setCarpoolPassengerMode,
    setCarpoolPassengerCount,
    latestCarpoolDetectionResult,
    debugInfo,
  } = useEnhancedGeofencing();
  const [showValidationDebug, setShowValidationDebug] = useState(false);
  const [showLeaveDebug, setShowLeaveDebug] = useState(false);

  // Track if we've already processed the latest carpool detection result
  const [lastProcessedResultTimestamp, setLastProcessedResultTimestamp] = useState<string | null>(null);

  // Initialize permissions check
  useEffect(() => {
    // Background geofencing will automatically start when permissions are granted
    if (isTracking) {
      // Location permissions granted, background geofencing available
    }
  }, [isTracking]);

  // Hydrate notification toggles from the backend on mount / when the
  // signed-in user changes. Without this the toggles would always start at
  // the hardcoded defaults above and silently misrepresent the server state
  // until the user interacted with each one.
  useEffect(() => {
    let cancelled = false;
    if (!userEmail || !isAuthenticated || isGuest) return;
    (async () => {
      const profile = await getUserProfile(userEmail);
      if (cancelled || !profile?.notification_preferences) return;
      const prefs = profile.notification_preferences;
      setNotifPrefs((prev) => ({
        favorites_filling: prefs.favorites_filling ?? prev.favorites_filling,
        favorites_clearing: prefs.favorites_clearing ?? prev.favorites_clearing,
        surge_alerts: prefs.surge_alerts ?? prev.surge_alerts,
        event_alerts: prefs.event_alerts ?? prev.event_alerts,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [userEmail, isAuthenticated, isGuest]);

  // Handle carpool detection results: auto-toggle at high confidence, prompt at medium
  useEffect(() => {
    if (!latestCarpoolDetectionResult || latestCarpoolDetectionResult.timestamp === lastProcessedResultTimestamp) {
      return; // Already processed this result
    }

    setLastProcessedResultTimestamp(latestCarpoolDetectionResult.timestamp);

    if (latestCarpoolDetectionResult.action === 'auto_toggle' && !carpoolPassengerMode) {
      // High confidence carpool detected - auto-enable passenger mode
      void setCarpoolPassengerMode(true);
      if (__DEV__) {
        Alert.alert(
          'Carpool Detected',
          `High confidence carpool (${Math.round(latestCarpoolDetectionResult.confidence * 100)}%). ` +
          `Passenger mode enabled automatically with ${latestCarpoolDetectionResult.estimatedPassengers} riders.`,
          [{ text: 'OK' }]
        );
      }
    } else if (latestCarpoolDetectionResult.action === 'prompt_user' && !carpoolPassengerMode) {
      // Medium confidence - ask user
      Alert.alert(
        'Add Passenger?',
        `Possible carpool detected (${Math.round(latestCarpoolDetectionResult.confidence * 100)}% confidence). ` +
        `Enable passenger mode to exclude this phone from occupancy counts?`,
        [
          {
            text: 'No',
            onPress: () => {
              if (__DEV__) console.log('[ProfileScreen] User declined carpool prompt');
            },
            style: 'cancel',
          },
          {
            text: 'Yes',
            onPress: () => {
              void setCarpoolPassengerMode(true);
              void setCarpoolPassengerCount(latestCarpoolDetectionResult.estimatedPassengers);
            },
          },
        ]
      );
    }
  }, [latestCarpoolDetectionResult, lastProcessedResultTimestamp, carpoolPassengerMode, setCarpoolPassengerMode, setCarpoolPassengerCount]);

  // Show geofencing status to user
  const getGeofencingStatusText = () => {
    if (!isTracking) {
      return 'Location access needed';
    }
    if (isGeofencingActive) {
      return currentLotId ? 'Active - In parking lot' : 'Active - Monitoring';
    }
    return 'Initializing...';
  };

  // Open the SharkPark soft-ask screen so users can re-read what we collect
  // and (if iOS still has no decision) re-trigger the OS dialog. If the OS has
  // already cached a decision, the SDK won't re-prompt — in that case the
  // soft-ask screen offers an "Open device settings" link instead.
  const openLocationSettings = () => {
    navigation.navigate('Map', { screen: 'LocationPermission', params: {} });
  };

  // Toggle a single notification preference and persist it to the backend.
  // Optimistic update: flip the local state immediately then save in the
  // background — this keeps the UI snappy. On failure the Alert surfaces an
  // error and rolls back the toggle.
  const toggleNotifPref = useCallback(
    async (key: keyof NotificationPreferences) => {
      if (!userEmail) return;
      const next = !notifPrefs[key];
      setNotifPrefs((prev) => ({ ...prev, [key]: next }));
      setSavingNotif(true);
      try {
        await updateNotificationPreferences(userEmail, { [key]: next });
      } catch (err) {
        // Roll back on failure
        setNotifPrefs((prev) => ({ ...prev, [key]: !next }));
        Alert.alert(
          'Could not save',
          err instanceof Error ? err.message : 'Failed to update notification preference.',
        );
      } finally {
        setSavingNotif(false);
      }
    },
    [notifPrefs, userEmail],
  );

  // Simple toggle component for notifications
  const ToggleSwitch = ({ value }: { value: boolean }) => (
    <View style={[
        styles.toggleContainer,
      { backgroundColor: value ? colors.primary : colors.toggleGray }
    ]}>
      <View style={[
          styles.toggleThumb,
          {
            backgroundColor: colors.white,
            shadowColor: colors.shadowDark,
          transform: [{ translateX: value ? 20 : 0 }] 
        }
      ]} />
    </View>
  );

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Logout',
        style: 'destructive',
          onPress: () => {logout()},
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account, favorites, and reports. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMyAccount();
              await logout();
            } catch (error) {
              Alert.alert(
                'Error',
                error instanceof Error ? error.message : 'Failed to delete account. Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  const triggerDevGeofence = (eventType: 'ENTER' | 'EXIT') => {
    locationService.triggerTestGeofenceEvent('G1', eventType);
  };

  const simulateNotification = useCallback(
    (
      kind: 'favorites_filling' | 'favorites_clearing' | 'surge' | 'events',
    ) => {
      const lotId = parkedLotId ?? currentLotId ?? 'G1';
      if (kind === 'favorites_filling') {
        simulateForegroundPushMessage({
          title: 'Favorite Lot Filling Up',
          body: `G1 just passed 80% occupancy.`,
          data: { type: 'favorites_filling', lotId },
        });
        return;
      }
      if (kind === 'favorites_clearing') {
        simulateForegroundPushMessage({
          title: 'Favorite Lot Clearing Up',
          body: `G1 dropped below 30% occupancy.`,
          data: { type: 'favorites_clearing', lotId },
        });
        return;
      }
      if (kind === 'surge') {
        simulateForegroundPushMessage({
          title: 'Campus Surge Alert',
          body: 'Multiple lots are over 90% full right now.',
          data: { type: 'surge', lotId },
        });
        return;
      }
      simulateForegroundPushMessage({
        title: 'Campus Event Reminder',
        body: 'A campus event starts in about 2 hours.',
        data: { type: 'events' },
      });
    },
    [currentLotId, parkedLotId],
  );

  const sendRemoteNotificationTest = useCallback(
    async (kind: 'favorites_filling' | 'favorites_clearing' | 'surge' | 'events') => {
      try {
        const lotId = parkedLotId ?? currentLotId ?? 'G1';
        const result = await sendDebugPushNotification(
          kind,
          kind === 'events' ? undefined : lotId,
        );
        if (result.sent) {
          Alert.alert(
            'Push sent',
            'Backend accepted the request and at least one registered device token received the push send attempt.',
          );
        } else if (!result.pushConfigured) {
          Alert.alert(
            'Push not configured',
            'Backend Firebase push credentials are missing in this environment. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY on the backend.',
          );
        } else if (result.tokenCount === 0) {
          Alert.alert(
            'No device token registered',
            'This account has no push tokens yet. On this device: enable notifications, then sign out and sign in to force token registration.',
          );
        } else {
          Alert.alert(
            'No push sent',
            'Push was configured and tokens exist, but FCM did not accept delivery for this request. Check backend logs for FCM errors and token cleanup warnings.',
          );
        }
      } catch (error) {
        Alert.alert(
          'Push test failed',
          error instanceof Error ? error.message : 'Could not trigger backend push test.',
        );
      }
    },
    [currentLotId, parkedLotId],
  );

  const openGeofencePolygonViewer = () => {
    navigation.navigate('Map', { screen: 'GeofenceDebug' });
  };

  const handleTogglePassengerMode = useCallback(() => {
    if (currentLotId || parkedLotId) {
      Alert.alert(
        'Finish Current Session First',
        'For accurate occupancy counts, change Passenger mode before entering a lot or after fully leaving it.',
        [{ text: 'OK' }],
      );
      return;
    }
    void setCarpoolPassengerMode(!carpoolPassengerMode);
  }, [carpoolPassengerMode, currentLotId, parkedLotId, setCarpoolPassengerMode]);

  return (
    <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
      {/* Header */}
      <Header 
        title="Profile & Settings"
      />

      {/* Scrollable Content */}
      <SafeAreaView style={styles.scrollView} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Notification Settings */}
          <SectionCard title="Notifications">
            <View style={styles.settingsList}>

              <View style={styles.settingItem}>
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, { color: colors.black }]}>Lot Filling Up</Text>
                  <Text style={[styles.settingDescription, { color: colors.gray }]}>Alert when a favorite lot goes above 80%</Text>
                </View>
                <TouchableOpacity
                  disabled={savingNotif || !isAuthenticated || isGuest}
                  onPress={() => toggleNotifPref('favorites_filling')}
                  accessibilityRole="switch"
                  accessibilityLabel="Lot Filling Up notifications"
                  accessibilityHint="Alert when a favourite lot goes above 80%"
                  accessibilityState={{ checked: !!notifPrefs.favorites_filling, disabled: savingNotif || !isAuthenticated || isGuest }}
                >
                  <ToggleSwitch value={!!notifPrefs.favorites_filling} />
                </TouchableOpacity>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

              <View style={styles.settingItem}>
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, { color: colors.black }]}>Lot Clearing Up</Text>
                  <Text style={[styles.settingDescription, { color: colors.gray }]}>Alert when a favorite lot drops below 30%</Text>
                </View>
                <TouchableOpacity
                  disabled={savingNotif || !isAuthenticated || isGuest}
                  onPress={() => toggleNotifPref('favorites_clearing')}
                  accessibilityRole="switch"
                  accessibilityLabel="Lot Clearing Up notifications"
                  accessibilityHint="Alert when a favourite lot drops below 30%"
                  accessibilityState={{ checked: !!notifPrefs.favorites_clearing, disabled: savingNotif || !isAuthenticated || isGuest }}
                >
                  <ToggleSwitch value={!!notifPrefs.favorites_clearing} />
                </TouchableOpacity>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

              <View style={styles.settingItem}>
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, { color: colors.black }]}>Campus Surge Alerts</Text>
                  <Text style={[styles.settingDescription, { color: colors.gray }]}>Notify when multiple lots exceed 90% full</Text>
                </View>
                <TouchableOpacity
                  disabled={savingNotif || !isAuthenticated || isGuest}
                  onPress={() => toggleNotifPref('surge_alerts')}
                  accessibilityRole="switch"
                  accessibilityLabel="Campus Surge Alerts notifications"
                  accessibilityHint="Notify when multiple lots exceed 90% full"
                  accessibilityState={{ checked: !!notifPrefs.surge_alerts, disabled: savingNotif || !isAuthenticated || isGuest }}
                >
                  <ToggleSwitch value={!!notifPrefs.surge_alerts} />
                </TouchableOpacity>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

              <View style={styles.settingItem}>
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, { color: colors.black }]}>Event Alerts</Text>
                  <Text style={[styles.settingDescription, { color: colors.gray }]}>Notify about campus events starting in 2 hours</Text>
                </View>
                <TouchableOpacity
                  disabled={savingNotif || !isAuthenticated || isGuest}
                  onPress={() => toggleNotifPref('event_alerts')}
                  accessibilityRole="switch"
                  accessibilityLabel="Event Alerts notifications"
                  accessibilityHint="Notify about campus events starting in 2 hours"
                  accessibilityState={{ checked: !!notifPrefs.event_alerts, disabled: savingNotif || !isAuthenticated || isGuest }}
                >
                  <ToggleSwitch value={!!notifPrefs.event_alerts} />
                </TouchableOpacity>
              </View>

              {(!isAuthenticated || isGuest) && (
                <Text style={[styles.settingDescription, { color: colors.gray, marginTop: SPACING.sm }]}>
                  Sign in to manage notification preferences.
                </Text>
              )}
            </View>
          </SectionCard>

          {/* Location & Privacy Settings */}
          <SectionCard title="Smart Parking Detection">
            <View style={styles.settingsList}>
              <View style={styles.settingItem}>
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, { color: colors.black }]}>
                  <Icon name="location-outline" size={16} color={colors.primary} /> Background Geofencing
                  </Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>
                    Automatically detects when you enter or leave parking lots
                  </Text>
                </View>
                <View style={styles.statusBadge}>
                <Text style={[styles.statusBadgeText, {
                  color: isGeofencingActive
                    ? (isDark ? '#6ee7b7' : '#10b981')
                    : colors.gray,
                  backgroundColor: isGeofencingActive
                    ? (isDark ? 'rgba(16, 185, 129, 0.18)' : '#ecfdf5')
                    : colors.lightGray,
                }]}>
                    {getGeofencingStatusText()}
                  </Text>
                </View>
              </View>

            {!isTracking && (
              <TouchableOpacity 
                style={[styles.settingsButton, { backgroundColor: colors.primary }]}
                  onPress={openLocationSettings}
                  accessibilityRole="button"
                  accessibilityLabel="Grant location access"
                  accessibilityHint="Opens location permission settings"
                >
                  <Text style={styles.settingsButtonText}>
                    Grant Location Access
                  </Text>
                </TouchableOpacity>
              )}

              {/* Always-visible privacy disclosure entry — required by App Review
                  guidelines so users (and reviewers) can re-read what we collect
                  without needing to first deny permissions. */}
              <TouchableOpacity
                style={styles.privacyLink}
                onPress={openLocationSettings}
                accessibilityRole="button"
                accessibilityLabel="Learn how SharkPark uses your location"
              >
                <Icon name="shield-checkmark-outline" size={16} color={colors.primary} />
                <Text style={[styles.privacyLinkText, { color: colors.primary }]}>
                  How SharkPark uses your location
                </Text>
              </TouchableOpacity>

              {currentLotId && (
              <View style={[styles.statusInfo, {
                backgroundColor: isDark ? 'rgba(16, 185, 129, 0.18)' : '#ecfdf5',
                borderColor: isDark ? 'rgba(16, 185, 129, 0.4)' : '#10b981',
              }]}>
                <Text style={[styles.statusText, { color: isDark ? '#6ee7b7' : '#059669' }]}>
                  📍 Currently in parking lot
                </Text>
              </View>
            )}
          </View>
        </SectionCard>

        <SectionCard title="Carpool Assistance">
          <View style={styles.settingsList}>
            <View style={styles.settingItem}>
              <View style={styles.settingText}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>Passenger mode</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Suppresses occupancy updates from this phone so shared rides do not inflate the lot.</Text>
              </View>
              <TouchableOpacity
                onPress={handleTogglePassengerMode}
                accessibilityRole="switch"
                accessibilityLabel="Passenger mode"
                accessibilityHint="When enabled, this phone does not contribute parking occupancy"
                accessibilityState={{ checked: carpoolPassengerMode }}
              >
                <ToggleSwitch value={carpoolPassengerMode} />
              </TouchableOpacity>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

            <View style={styles.settingItem}>
              <View style={styles.settingText}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>Other riders</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Optional manual count for demoing a shared ride.</Text>
              </View>
              <View style={styles.carpoolStepper}>
                <TouchableOpacity
                  onPress={() => void setCarpoolPassengerCount(Math.max(0, carpoolPassengerCount - 1))}
                  style={[styles.carpoolStepButton, { backgroundColor: colors.lightGray, borderColor: colors.borderGray }]}
                  accessibilityRole="button"
                  accessibilityLabel="Decrease carpool riders"
                >
                  <Icon name="remove" size={18} color={colors.textPrimary} accessible={false} />
                </TouchableOpacity>
                <View style={[styles.carpoolCountPill, { backgroundColor: colors.yellowLight, borderColor: colors.borderGray }]}>
                  <Text style={[styles.carpoolCountText, { color: colors.textPrimary }]}>{carpoolPassengerCount}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => void setCarpoolPassengerCount(Math.min(8, carpoolPassengerCount + 1))}
                  style={[styles.carpoolStepButton, { backgroundColor: colors.lightGray, borderColor: colors.borderGray }]}
                  accessibilityRole="button"
                  accessibilityLabel="Increase carpool riders"
                >
                  <Icon name="add" size={18} color={colors.textPrimary} accessible={false} />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={[styles.settingDescription, { color: colors.gray }]}>When passenger mode is on, the map still highlights your parked lot locally, but this device will not send occupancy updates.</Text>

                        {latestCarpoolDetectionResult && (
                          <View style={[styles.detectionResultCard, {
                            backgroundColor: latestCarpoolDetectionResult.action === 'auto_toggle' ? '#ecfdf5' : '#fef3c7',
                            borderColor: latestCarpoolDetectionResult.action === 'auto_toggle' ? '#10b981' : '#f59e0b'
                          }]}>
                            <View style={styles.detectionResultHeader}>
                              <Icon
                                name={latestCarpoolDetectionResult.action === 'auto_toggle' ? 'checkmark-circle' : 'alert-circle'}
                                size={20}
                                color={latestCarpoolDetectionResult.action === 'auto_toggle' ? '#059669' : '#d97706'}
                              />
                              <Text style={[styles.detectionResultTitle, {
                                color: latestCarpoolDetectionResult.action === 'auto_toggle' ? '#059669' : '#d97706'
                              }]}>
                                {latestCarpoolDetectionResult.action === 'auto_toggle' ? 'Carpool Detected' : 'Possible Carpool'}
                              </Text>
                            </View>
                            <Text style={[styles.detectionResultConfidence, { color: colors.gray }]}>
                              Confidence: {Math.round(latestCarpoolDetectionResult.confidence * 100)}%
                            </Text>
                            {latestCarpoolDetectionResult.estimatedPassengers > 0 && (
                              <Text style={[styles.detectionResultPassengers, { color: colors.textPrimary }]}>
                                Estimated passengers: {latestCarpoolDetectionResult.estimatedPassengers}
                              </Text>
                            )}
                            {__DEV__ && latestCarpoolDetectionResult.reasoning.length > 0 && (
                              <Text style={[styles.detectionResultReasoning, { color: colors.gray }]}>
                                {latestCarpoolDetectionResult.reasoning.join(' • ')}
                              </Text>
                            )}
                          </View>
                        )}
            {parkedLotId && (
              <Text style={[styles.settingDescription, { color: colors.gray }]}>Current parked lot: {parkedLotId}</Text>
            )}
          </View>
        </SectionCard>

        {__DEV__ && (
          <SectionCard title="Dev Demo Toolkit">
            <View style={styles.settingsList}>
              <Text style={[styles.settingDescription, { color: colors.gray }]}>Use this section in order during your class demo: simulate enter, validate parking, inspect lot/building polygons, then simulate exit.</Text>

              <View style={styles.devActionRow}>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#22c55e' }]}
                  onPress={() => triggerDevGeofence('ENTER')}
                  accessibilityRole="button"
                  accessibilityLabel="Simulate geofence enter for lot G1"
                >
                  <Text style={styles.devActionButtonText}>ENTER G1</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#ef4444' }]}
                  onPress={() => triggerDevGeofence('EXIT')}
                  accessibilityRole="button"
                  accessibilityLabel="Simulate geofence exit for lot G1"
                >
                  <Text style={styles.devActionButtonText}>EXIT G1</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.devWideButton, { backgroundColor: colors.lightGray, borderColor: colors.borderGray }]}
                onPress={openGeofencePolygonViewer}
                accessibilityRole="button"
                accessibilityLabel="Open lot and building polygon viewer"
              >
                <Icon name="map-outline" size={18} color={colors.textPrimary} accessible={false} />
                <Text style={[styles.devWideButtonText, { color: colors.textPrimary }]}>Open Lot/Building Polygon Viewer</Text>
              </TouchableOpacity>

              <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

              <View style={styles.devChecklist}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>Notification simulation</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Triggers the same foreground push handler used by real FCM messages.</Text>
              </View>

              <View style={styles.devActionRow}>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#2563eb' }]}
                  onPress={() => simulateNotification('favorites_filling')}
                  accessibilityRole="button"
                  accessibilityLabel="Simulate favorite lot filling up notification"
                >
                  <Text style={styles.devActionButtonText}>Fill Up Alert</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#0891b2' }]}
                  onPress={() => simulateNotification('favorites_clearing')}
                  accessibilityRole="button"
                  accessibilityLabel="Simulate favorite lot clearing up notification"
                >
                  <Text style={styles.devActionButtonText}>Clearing Alert</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.devActionRow}>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#7c3aed' }]}
                  onPress={() => simulateNotification('surge')}
                  accessibilityRole="button"
                  accessibilityLabel="Simulate campus surge notification"
                >
                  <Text style={styles.devActionButtonText}>Surge Alert</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#ea580c' }]}
                  onPress={() => simulateNotification('events')}
                  accessibilityRole="button"
                  accessibilityLabel="Simulate campus event notification"
                >
                  <Text style={styles.devActionButtonText}>Event Alert</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

              <View style={styles.devChecklist}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>Real remote push (backend → FCM)</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Use when validating true push delivery behavior in foreground, background, and app-closed states.</Text>
              </View>

              <View style={styles.devActionRow}>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#1d4ed8' }]}
                  onPress={() => void sendRemoteNotificationTest('favorites_filling')}
                  accessibilityRole="button"
                  accessibilityLabel="Send real favorite lot filling push notification"
                >
                  <Text style={styles.devActionButtonText}>Send Fill-Up Push</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#0e7490' }]}
                  onPress={() => void sendRemoteNotificationTest('favorites_clearing')}
                  accessibilityRole="button"
                  accessibilityLabel="Send real favorite lot clearing push notification"
                >
                  <Text style={styles.devActionButtonText}>Send Clearing Push</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.devActionRow}>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#6d28d9' }]}
                  onPress={() => void sendRemoteNotificationTest('surge')}
                  accessibilityRole="button"
                  accessibilityLabel="Send real campus surge push notification"
                >
                  <Text style={styles.devActionButtonText}>Send Surge Push</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.devActionButton, { backgroundColor: '#c2410c' }]}
                  onPress={() => void sendRemoteNotificationTest('events')}
                  accessibilityRole="button"
                  accessibilityLabel="Send real event push notification"
                >
                  <Text style={styles.devActionButtonText}>Send Event Push</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.devChecklist}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>Live checklist</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Geofencing active: {isGeofencingActive ? 'Yes' : 'No'}</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Current lot: {currentLotId ?? 'None'}</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Parked lot: {parkedLotId ?? 'None'}</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Validation sessions: {debugInfo.activeSessions}</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Leave-monitor sessions: {debugInfo.activeLeaveMonitoring}</Text>
              </View>

              {ParkingValidationDebug && (
                <TouchableOpacity
                  style={[styles.devWideButton, { backgroundColor: colors.yellowLight, borderColor: colors.borderGray }]}
                  onPress={() => setShowValidationDebug((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle parking validation debug panel"
                >
                  <Text style={[styles.devWideButtonText, { color: colors.textPrimary }]}>
                    {showValidationDebug ? 'Hide Parking Validation Panel' : 'Show Parking Validation Panel'}
                  </Text>
                </TouchableOpacity>
              )}
              {showValidationDebug && ParkingValidationDebug && <ParkingValidationDebug />}

              {LeaveDetectionDebug && (
                <TouchableOpacity
                  style={[styles.devWideButton, { backgroundColor: colors.yellowLight, borderColor: colors.borderGray }]}
                  onPress={() => setShowLeaveDebug((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle leave detection debug panel"
                >
                  <Text style={[styles.devWideButtonText, { color: colors.textPrimary }]}>
                    {showLeaveDebug ? 'Hide Leave Detection Panel' : 'Show Leave Detection Panel'}
                  </Text>
                </TouchableOpacity>
              )}
              {showLeaveDebug && LeaveDetectionDebug && <LeaveDetectionDebug />}
            </View>
          </SectionCard>
        )}

          {/* Appearance Settings */}
          <SectionCard title="Appearance">
            <View
              style={styles.themeList}
              accessibilityRole="radiogroup"
              accessibilityLabel="Theme selection"
            >
              <TouchableOpacity
                onPress={() => setThemeMode('light')}
                style={[
                  styles.themeButton,
                  { borderColor: colors.borderGray },
                themeMode === 'light' && { borderColor: colors.primary, backgroundColor: colors.yellowLight }
                ]}
                accessibilityRole="radio"
                accessibilityLabel="Light mode"
                accessibilityState={{ checked: themeMode === 'light' }}
              >
                <Text style={[styles.themeLabel, { color: colors.black }]}>
                  Light Mode
                </Text>
              {themeMode === 'light' && <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]} accessible={false} />}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setThemeMode('dark')}
                style={[
                  styles.themeButton,
                  { borderColor: colors.borderGray },
                themeMode === 'dark' && { borderColor: colors.primary, backgroundColor: colors.yellowLight }
                ]}
                accessibilityRole="radio"
                accessibilityLabel="Dark mode"
                accessibilityState={{ checked: themeMode === 'dark' }}
              >
                <Text style={[styles.themeLabel, { color: colors.black }]}>
                  Dark Mode
                </Text>
              {themeMode === 'dark' && <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]} accessible={false} />}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setThemeMode('system')}
                style={[
                  styles.themeButton,
                  { borderColor: colors.borderGray },
                themeMode === 'system' && { borderColor: colors.primary, backgroundColor: colors.yellowLight }
                ]}
                accessibilityRole="radio"
                accessibilityLabel="System default theme"
                accessibilityState={{ checked: themeMode === 'system' }}
              >
                <Text style={[styles.themeLabel, { color: colors.black }]}>
                  System Settings
                </Text>
              {themeMode === 'system' && <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]} accessible={false} />}
              </TouchableOpacity>
            </View>
          </SectionCard>

          {/* Logout Button */}
          <TouchableOpacity
            style={[
              styles.logoutButton,
            { backgroundColor: colors.errorLight, borderColor: colors.errorBorder }
            ]}
            onPress={handleLogout}
            accessibilityRole="button"
            accessibilityLabel="Logout"
          >
            <Icon name="log-out-outline" size={20} color={colors.errorText} accessible={false} />
          <Text style={[styles.logoutButtonText, { color: colors.errorText }]}>Logout</Text>
          </TouchableOpacity>

          {/* Delete Account Button */}
          <TouchableOpacity
            style={[styles.deleteAccountButton, { borderColor: colors.errorBorder }]}
            onPress={handleDeleteAccount}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            accessibilityHint="Permanently deletes your SharkPark account and all data"
          >
            <Icon name="trash-outline" size={18} color={colors.errorText} accessible={false} />
            <Text style={[styles.deleteAccountText, { color: colors.errorText }]}>
              Delete Account
            </Text>
          </TouchableOpacity>


        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: SPACING.xxxl,
    gap: SPACING.xxxl,
    paddingBottom: SPACING.xxxl, // Add proper padding for better layout
  },
  settingsList: {
    gap: SPACING.lg,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingText: {
    flex: 1,
    marginRight: SPACING.lg,
  },
  settingLabel: {
    fontSize: TYPOGRAPHY.fontSize.md,
    marginBottom: SPACING.xs,
  },
  settingDescription: {
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  divider: {
    height: 1,
  },
  statusInfo: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.black,
    borderRadius: SPACING.sm,
  },
  carpoolStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  carpoolStepButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carpoolCountPill: {
    minWidth: 44,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  carpoolCountText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  devActionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  devActionButton: {
    flex: 1,
    borderRadius: SPACING.sm,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  devActionButtonText: {
    color: COLORS.white,
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  devWideButton: {
    borderRadius: SPACING.sm,
    borderWidth: 1,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  devWideButtonText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  devChecklist: {
    gap: SPACING.xs,
  },
  statusText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginBottom: SPACING.xs,
  },
  toggleContainer: {
    width: 48,
    height: 24,
    borderRadius: SPACING.lg,
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  toggleThumbActive: {
    transform: [{ translateX: 24 }],
  },
  themeList: {
    gap: SPACING.xs, // Reduced gap to accommodate the third button
  },
  themeButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: SPACING.lg,
    borderWidth: 2,
  },
  themeLabel: {
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  selectedIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderRadius: SPACING.lg, // More rounded
    borderWidth: 2,
    justifyContent: 'center',
    marginTop: SPACING.md,
  },
  logoutButtonText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginLeft: SPACING.md,
  },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
    borderRadius: SPACING.lg,
    borderWidth: 1,
    marginTop: SPACING.sm,
  },
  deleteAccountText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginLeft: SPACING.sm,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  statusBadgeText: {
    fontSize: 12,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textAlign: 'center',
  },
  settingsButton: {
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  settingsButtonText: {
    color: 'white',
    fontSize: 14,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textAlign: 'center',
  },
  privacyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  privacyLinkText: {
    fontSize: 13,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    textDecorationLine: 'underline',
  },
  detectionResultCard: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: SPACING.md,
    borderWidth: 1,
  },
  detectionResultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  detectionResultTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  detectionResultConfidence: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginBottom: SPACING.xs,
  },
  detectionResultPassengers: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginBottom: SPACING.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  detectionResultReasoning: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    marginTop: SPACING.sm,
    fontStyle: 'italic',
  },
});

export default ProfileScreen;
