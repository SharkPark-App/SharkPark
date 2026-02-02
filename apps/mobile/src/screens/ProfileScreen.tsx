import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { SectionCard } from '../components/SectionCard';
import { Header } from '../components';
import { TYPOGRAPHY, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

const ProfileScreen: React.FC = () => {
  const { themeMode, setThemeMode, colors } = useTheme();
  const [notifications, setNotifications] = useState({
    highOccupancy: true, favoriteLots: true, incidents: false,
  });
  const { logout } = useAuth();

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

  return (
    <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
      {/* Header */}
      <Header 
        title="Profile & Settings"
      />

      {/* Scrollable Content */}
      <SafeAreaView style={styles.scrollView}>
        <ScrollView contentContainerStyle={styles.content}>
        {/* Notification Settings */}
        <SectionCard title="Notifications">
          <View style={styles.settingsList}>
            <View style={styles.settingItem}>
              <View style={styles.settingText}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>High Occupancy Alerts</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Get notified when lots reach 80% capacity</Text>
              </View>
              <TouchableOpacity
                onPress={() => setNotifications(prev => ({ ...prev, highOccupancy: !prev.highOccupancy }))}
              >
                <ToggleSwitch value={notifications.highOccupancy} />
              </TouchableOpacity>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

            <View style={styles.settingItem}>
              <View style={styles.settingText}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>Favorite Lot Updates</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Receive updates on favorited parking lots</Text>
              </View>
              <TouchableOpacity
                onPress={() => setNotifications(prev => ({ ...prev, favoriteLots: !prev.favoriteLots }))}
              >
                <ToggleSwitch value={notifications.favoriteLots} />
              </TouchableOpacity>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.borderGray }]} />

            <View style={styles.settingItem}>
              <View style={styles.settingText}>
                <Text style={[styles.settingLabel, { color: colors.black }]}>Incident Alerts</Text>
                <Text style={[styles.settingDescription, { color: colors.gray }]}>Get notified about parking lot incidents</Text>
              </View>
              <TouchableOpacity
                onPress={() => setNotifications(prev => ({ ...prev, incidents: !prev.incidents }))}
              >
                <ToggleSwitch value={notifications.incidents} />
              </TouchableOpacity>
            </View>
          </View>
        </SectionCard>

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
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    marginLeft: SPACING.md,
  },
});

export default ProfileScreen;
