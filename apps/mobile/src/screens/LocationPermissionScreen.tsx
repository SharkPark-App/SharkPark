/**
 * LocationPermissionScreen
 *
 * Soft-ask screen shown when the backend returns 403 BG_LOCATION_REQUIRED.
 * Explains the contributor model and walks the user through a two-stage
 * permission prompt:
 *
 *   Stage 1 — WhenInUse: always requested; minimum needed to detect lots.
 *   Stage 2 — Always:   only escalated if the user explicitly opts into
 *                        auto-contributing (background events while app is closed).
 *
 * The screen is pushed onto the MapStack so the user can go back to the map
 * at any time without being blocked.
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from '../components/CustomText';
import { TYPOGRAPHY, SPACING, COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { locationService } from '../services/locationService';
import type { MapStackParamList } from '../types/navigation';

type Nav = StackNavigationProp<MapStackParamList, 'LocationPermission'>;

// ─── data-collection bullet points shown to users ──────────────────────────
const DATA_POINTS = [
  { icon: 'checkmark-circle-outline', text: 'When you enter or leave a campus parking lot' },
  { icon: 'checkmark-circle-outline', text: 'Which lot you parked in (anonymous lot ID only)' },
  { icon: 'close-circle-outline',     text: 'Your exact GPS coordinates — never stored' },
  { icon: 'close-circle-outline',     text: 'Your identity or personal information' },
];

const LocationPermissionScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const [step, setStep] = useState<'explain' | 'when-in-use' | 'always' | 'done'>('explain');
  const [isRequesting, setIsRequesting] = useState(false);

  // ── Stage 1: WhenInUse ────────────────────────────────────────────────────
  // The Transistor SDK only honors the FIRST `BackgroundGeolocation.ready()`
  // call per app lifecycle. The production config (Always auth, PersistMode.None,
  // headless mode, polygon geofences, etc.) is applied at app boot in
  // `locationService.initialize()` — we MUST NOT call `ready()` again here or
  // the prod config silently wins / our WhenInUse override is ignored.
  //
  // Instead, route through the shared service which wraps `requestPermission()`
  // and additionally requests `requestTemporaryFullAccuracy('ParkingDetection')`
  // on iOS 14+ when the user grants reduced accuracy.
  const requestWhenInUse = async () => {
    setIsRequesting(true);
    try {
      const granted = await locationService.requestPermissions();
      setStep(granted ? 'always' : 'done');
    } catch {
      setStep('done');
    } finally {
      setIsRequesting(false);
    }
  };

  // ── Stage 2: Escalate to Always (opt-in only) ─────────────────────────────
  // The OS dialog text is owned by `app.backgroundPermissionRationale` in
  // `createSDKConfig()` (Android) and the iOS Info.plist usage strings.
  const requestAlways = async () => {
    setIsRequesting(true);
    try {
      await locationService.requestPermissions();
      setStep('done');
    } catch {
      setStep('done');
    } finally {
      setIsRequesting(false);
    }
  };

  const skipAlways = () => setStep('done');

  const openSettings = () => Linking.openSettings();

  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.lightGray }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.doneContainer}>
          <Icon name="checkmark-circle" size={72} color={COLORS.primary} />
          <Text style={[styles.doneTitle, { color: colors.textPrimary }]}>
            You're all set
          </Text>
          <Text style={[styles.doneSubtitle, { color: colors.gray }]}>
            SharkPark will now show live occupancy data. You can change location permissions any time in your device settings.
          </Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: COLORS.primary }]}
            onPress={goBack}
          >
            <Text style={[styles.primaryButtonText, { color: colors.white }]}>Back to Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkButton} onPress={openSettings}>
            <Text style={[styles.linkText, { color: colors.gray }]}>Open device settings</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (step === 'always') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.lightGray }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Icon name="refresh-circle-outline" size={56} color={COLORS.primary} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            Auto-contribute in the background?
          </Text>
          <Text style={[styles.body, { color: colors.gray }]}>
            With <Text style={{ fontFamily: TYPOGRAPHY.fontFamily.semibold }}>Always Allow</Text>, SharkPark can automatically log when you park and leave — even when the app is closed. This keeps occupancy data accurate for everyone.
          </Text>
          <Text style={[styles.body, { color: colors.gray }]}>
            This is optional. If you skip, you can still browse live data as long as the app is open while you drive to campus.
          </Text>

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.borderGray }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Background collection</Text>
            <Text style={[styles.cardBody, { color: colors.gray }]}>
              Only lot-level entry/exit events are sent — no GPS tracks, no identity. Battery impact is minimal (OS-level geofencing, not continuous GPS).
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: COLORS.primary, opacity: isRequesting ? 0.6 : 1 }]}
            onPress={requestAlways}
            disabled={isRequesting}
          >
            <Text style={[styles.primaryButtonText, { color: colors.white }]}>
              {isRequesting ? 'Requesting…' : 'Allow background access'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={skipAlways}>
            <Text style={[styles.secondaryButtonText, { color: colors.gray }]}>
              No thanks — I'll open the app manually
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // step === 'explain' (default)
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.lightGray }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Icon name="location-outline" size={56} color={COLORS.primary} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          Live data needs your help
        </Text>
        <Text style={[styles.body, { color: colors.gray }]}>
          SharkPark's real-time occupancy is crowdsourced. To read live lot data, your device needs to contribute anonymous parking events — which requires location access.
        </Text>

        {/* What is / isn't collected */}
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.borderGray }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>What SharkPark collects</Text>
          {DATA_POINTS.map((point) => (
            <View key={point.text} style={styles.bulletRow}>
              <Icon
                name={point.icon}
                size={18}
                color={point.icon.startsWith('checkmark') ? '#10b981' : colors.gray}
                style={styles.bulletIcon}
              />
              <Text style={[styles.bulletText, { color: colors.gray }]}>{point.text}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: COLORS.primary, opacity: isRequesting ? 0.6 : 1 }]}
          onPress={requestWhenInUse}
          disabled={isRequesting}
        >
          <Text style={[styles.primaryButtonText, { color: colors.white }]}>
            {isRequesting ? 'Requesting…' : 'Enable location access'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={goBack}>
          <Text style={[styles.linkText, { color: colors.gray }]}>Maybe later</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  backButton: { padding: SPACING.sm },
  content: {
    paddingHorizontal: SPACING.xxxl,
    paddingBottom: SPACING.xxxl * 2,
    gap: SPACING.lg,
    alignItems: 'flex-start',
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    lineHeight: 32,
  },
  body: {
    fontSize: TYPOGRAPHY.fontSize.md,
    lineHeight: 22,
  },
  card: {
    width: '100%',
    borderRadius: SPACING.lg,
    borderWidth: 1,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  cardTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.xs,
  },
  cardBody: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.sm,
  },
  bulletIcon: { marginTop: 2 },
  bulletText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 20,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: SPACING.lg,
    borderRadius: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  primaryButtonText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  linkButton: {
    width: '100%',
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  linkText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    textDecorationLine: 'underline',
  },
  // Done state
  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxxl,
    gap: SPACING.lg,
  },
  doneTitle: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    textAlign: 'center',
  },
  doneSubtitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    textAlign: 'center',
    lineHeight: 22,
  },
});

export default LocationPermissionScreen;
