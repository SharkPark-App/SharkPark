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

import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from '../components/CustomText';
import { TYPOGRAPHY, SPACING, COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { locationService } from '../services/locationService';
import { registerContributorGrant } from '../services/api/contributor';
import { LOCATION_DATA_POINTS } from '../constants/permissions';
import type { MapStackParamList } from '../types/navigation';

type Nav = StackNavigationProp<MapStackParamList, 'LocationPermission'>;

// ── data-collection bullet points shown to users ──────────────────────────
// Sourced from constants/permissions.ts so OnboardingScreen and this screen
// never drift apart.
const DATA_POINTS = LOCATION_DATA_POINTS;

const LocationPermissionScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const [step, setStep] = useState<'explain' | 'when-in-use' | 'always' | 'done'>('explain');
  const [isRequesting, setIsRequesting] = useState(false);
  // Truth-of-record for what the OS actually grants us. We refresh this
  // after every prompt and on focus so the UI never drifts away from
  // Settings.app. Initialised lazily on mount.
  const [authStatus, setAuthStatus] = useState<
    'always' | 'whenInUse' | 'denied' | 'restricted' | 'notDetermined' | null
  >(null);

  // On mount: read current auth so the screen starts at the right step
  // (e.g. user already has WhenInUse from onboarding — don't re-prompt,
  // jump straight to the Always escalation).
  useEffect(() => {
    let cancelled = false;
    locationService.getAuthorizationStatus().then((s) => {
      if (cancelled) return;
      setAuthStatus(s);
      if (s === 'always') {
        setStep('done');
      } else if (s === 'whenInUse') {
        setStep('always');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      await locationService.requestPermissions();
      // Read the actual OS state — do NOT trust the request's boolean
      // return value as the source of truth (see getAuthorizationStatus
      // doc for why iOS may silently no-op the second prompt).
      const status = await locationService.getAuthorizationStatus();
      setAuthStatus(status);

      if (status === 'always' || status === 'whenInUse') {
        // Register the permission-grant grace pass with the backend so the
        // ContributorGuard accepts reads for the next 24h even before the
        // user has driven into a lot. Best-effort, swallows network errors.
        await registerContributorGrant({ force: true });
      }

      // Routing:
      //  - already Always   → skip stage 2, go straight to done
      //  - WhenInUse        → offer escalation to Always
      //  - denied/etc       → land on done with a Settings link
      if (status === 'always') {
        setStep('done');
      } else if (status === 'whenInUse') {
        setStep('always');
      } else {
        setStep('done');
      }
    } catch {
      setStep('done');
    } finally {
      setIsRequesting(false);
    }
  };

  // ── Stage 2: Escalate to Always (opt-in only) ─────────────────────────────
  // The OS dialog text is owned by `app.backgroundPermissionRationale` in
  // `createSDKConfig()` (Android) and the iOS Info.plist usage strings.
  //
  // iOS only allows ONE Always prompt per app install. If the user previously
  // declined, `requestPermission()` will silently return without showing a
  // dialog — we detect that here by re-reading the OS state and routing the
  // user to Settings.app instead of falsely claiming success.
  const requestAlways = async () => {
    setIsRequesting(true);
    try {
      const before = await locationService.getAuthorizationStatus();
      await locationService.requestPermissions();
      const after = await locationService.getAuthorizationStatus();
      setAuthStatus(after);

      if (after === 'always') {
        // Genuine escalation — refresh the grant so the backend knows.
        await registerContributorGrant({ force: true });
        setStep('done');
        return;
      }

      // No-op escalation: status didn't change OR iOS suppressed the
      // dialog. Tell the user the truth and offer to deep-link to
      // Settings, where they can flip the toggle themselves.
      if (before === after) {
        Alert.alert(
          'Background access still off',
          'iOS only shows the “Always Allow” prompt once. To enable background contributions, open Settings and choose “Always” for SharkPark’s location.',
          [
            { text: 'Not now', style: 'cancel', onPress: () => setStep('done') },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      // Some other change (e.g. user demoted to WhenInUse mid-flow) —
      // just exit cleanly without misrepresenting state.
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
          <Icon
            name={authStatus === 'always' || authStatus === 'whenInUse' ? 'checkmark-circle' : 'alert-circle'}
            size={72}
            color={authStatus === 'always' || authStatus === 'whenInUse' ? COLORS.primary : colors.gray}
          />
          <Text style={[styles.doneTitle, { color: colors.textPrimary }]}>
            {authStatus === 'always'
              ? "You're all set"
              : authStatus === 'whenInUse'
              ? 'Foreground access enabled'
              : 'Background access not granted'}
          </Text>
          <Text style={[styles.doneSubtitle, { color: colors.gray }]}>
            {authStatus === 'always'
              ? 'Live occupancy is unlocked for the next 24 hours. SharkPark can detect when you park or leave even when the app is closed — your phone handles the detection locally and only sends an anonymous "entered Lot G1"-style event. No GPS trails, no identity, nothing tying it back to you. You can change location permissions any time in your device settings.'
              : authStatus === 'whenInUse'
              ? 'Live occupancy is unlocked for the next 24 hours. To keep it flowing after that, just have SharkPark open (or running) the next time you park on campus — your phone handles the lot detection locally and only sends an anonymous "entered Lot G1"-style event. To enable automatic background contributions, choose "Always" for SharkPark in device settings.'
              : 'You can still browse the map, but live occupancy stays locked until you grant location access in device settings.'}
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
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>How background mode works</Text>
            <Text style={[styles.cardBody, { color: colors.gray }]}>
              Your phone uses the operating system's geofencing (not continuous GPS) to notice when you cross a lot's boundary. The detection runs entirely on-device — only the resulting anonymous entry/exit event is sent to our servers. Battery impact is minimal.
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
          SharkPark's real-time occupancy is crowdsourced. Your phone watches for campus parking lots <Text style={{ fontFamily: TYPOGRAPHY.fontFamily.semibold }}>locally on-device</Text> and, when you park or leave, sends a single anonymous event (just the lot ID and a timestamp) so other students can see live availability.
        </Text>
        <Text style={[styles.body, { color: colors.gray }]}>
          We never receive your GPS coordinates, your route, or anything that could identify you. The detection itself happens on your phone — our servers only ever see "someone parked in Lot G1".
        </Text>

        {/* What is / isn't collected */}
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.borderGray }]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>What leaves your phone</Text>
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
