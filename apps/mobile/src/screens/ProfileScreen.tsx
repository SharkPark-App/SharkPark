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
// Dev-only components: loaded conditionally so Metro strips them from production bundles
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GeofencingTestButton = __DEV__ ? require('../components/GeofencingTestButton').GeofencingTestButton : null;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ParkingValidationDebug = __DEV__ ? require('../components/ParkingValidationDebug').default : null;
import useLocationService from '../hooks/useLocationService';
import { useEnhancedGeofencing } from '../context/EnhancedGeofencingProvider';
import { TYPOGRAPHY, SPACING, COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { deleteMyAccount, updateNotificationPreferences } from '../services/api/users';
import type { NotificationPreferences } from '../services/api/users';

const ProfileScreen: React.FC = () => {
  const { themeMode, setThemeMode, colors } = useTheme();

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
  const { isGeofencingActive, currentLotId, currentValidationStatus, currentLeaveIntent, debugInfo } = useEnhancedGeofencing();

  // Initialize permissions check
  useEffect(() => {
    // Background geofencing will automatically start when permissions are granted
    if (isTracking) {
      // Location permissions granted, background geofencing available
    }
  }, [isTracking]);

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
                        color: isGeofencingActive ? '#10b981' : colors.gray,
                  backgroundColor: isGeofencingActive ? '#ecfdf5' : colors.lightGray,
                }]}>
                    {getGeofencingStatusText()}
                  </Text>
                </View>
              </View>

            {!isTracking && (
              <TouchableOpacity 
                style={[styles.settingsButton, { backgroundColor: colors.primary }]}
                  onPress={openLocationSettings}
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
              <View style={[styles.statusInfo, { backgroundColor: '#ecfdf5', borderColor: '#10b981' }]}>
                <Text style={[styles.statusText, { color: '#059669' }]}>
                  📍 Currently in parking lot
                </Text>
              </View>
            )}
          </View>
        </SectionCard>

        {/* Parking Validation Debug - Development Only */}
        {__DEV__ && ParkingValidationDebug && (
          <SectionCard title="Parking Validation Debug">
            <ParkingValidationDebug />
          </SectionCard>
        )}

          {/* Appearance Settings */}
          <SectionCard title="Appearance">
            <View style={styles.themeList}>
              <TouchableOpacity
                onPress={() => setThemeMode('light')}
                style={[
                  styles.themeButton,
                  { borderColor: colors.borderGray },
                themeMode === 'light' && { borderColor: colors.primary, backgroundColor: colors.yellowLight }
                ]}
              >
                <Text style={[styles.themeLabel, { color: colors.black }]}>
                  Light Mode
                </Text>
              {themeMode === 'light' && <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]} />}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setThemeMode('dark')}
                style={[
                  styles.themeButton,
                  { borderColor: colors.borderGray },
                themeMode === 'dark' && { borderColor: colors.primary, backgroundColor: colors.yellowLight }
                ]}
              >
                <Text style={[styles.themeLabel, { color: colors.black }]}>
                  Dark Mode
                </Text>
              {themeMode === 'dark' && <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]} />}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setThemeMode('system')}
                style={[
                  styles.themeButton,
                  { borderColor: colors.borderGray },
                themeMode === 'system' && { borderColor: colors.primary, backgroundColor: colors.yellowLight }
                ]}
              >
                <Text style={[styles.themeLabel, { color: colors.black }]}>
                  System Settings
                </Text>
              {themeMode === 'system' && <View style={[styles.selectedIndicator, { backgroundColor: colors.primary }]} />}
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
          >
            <Icon name="log-out-outline" size={20} color={colors.errorText} />
          <Text style={[styles.logoutButtonText, { color: colors.errorText }]}>Logout</Text>
          </TouchableOpacity>

          {/* Delete Account Button */}
          <TouchableOpacity
            style={[styles.deleteAccountButton, { borderColor: colors.errorBorder }]}
            onPress={handleDeleteAccount}
          >
            <Icon name="trash-outline" size={18} color={colors.errorText} />
            <Text style={[styles.deleteAccountText, { color: colors.errorText }]}>
              Delete Account
            </Text>
          </TouchableOpacity>

        {/* Development Test Button */}
        {__DEV__ && GeofencingTestButton && <GeofencingTestButton />}
        {__DEV__ && (
          <TouchableOpacity
            style={[styles.deleteAccountButton, { backgroundColor: colors.lightGray, borderColor: colors.borderGray }]}
            onPress={() => navigation.navigate('Map', { screen: 'GeofenceDebug' })}
            accessibilityLabel="Open geofence debug screen"
          >
            <Icon name="map-outline" size={18} color={colors.textPrimary} />
            <Text style={[styles.deleteAccountText, { color: colors.textPrimary }]}>
              Geofence Debug (dev)
            </Text>
          </TouchableOpacity>
        )}
        
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
});

export default ProfileScreen;
