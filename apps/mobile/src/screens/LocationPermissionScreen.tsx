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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import BackgroundGeolocation from 'react-native-background-geolocation';
import { Text } from '../components/CustomText';
import { TYPOGRAPHY, SPACING, COLORS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { locationService } from '../services/locationService';
import { registerContributorGrant, revokeContributorGrant } from '../services/api/contributor';
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
  const [step, setStep] = useState<'explain' | 'when-in-use' | 'always' | 'precise' | 'done'>('explain');
  const [isRequesting, setIsRequesting] = useState(false);
  // Truth-of-record for what the OS actually grants us. We refresh this
  // after every prompt and on focus so the UI never drifts away from
  // Settings.app. Initialised lazily on mount.
  const [authStatus, setAuthStatus] = useState<
    'always' | 'whenInUse' | 'denied' | 'restricted' | 'notDetermined' | null
  >(null);
  // iOS 14+ Precise Location toggle. Required for contributor tier:
  // Reduced fuzzes coords to ~hectares and breaks lot enter/exit
  // detection. Tracked alongside authStatus so the screen can route
  // Always+Reduced users to a dedicated 'precise' step instead of
  // claiming they're done.
  const [accuracy, setAccuracy] = useState<'full' | 'reduced' | null>(null);
  // Once the user has tapped any CTA we leave the 'explain' step behind
  // forever — even if iOS reports denied/notDetermined later (e.g. they
  // toggled location off in Settings), we want to land them on 'done'
  // with a "not granted" message rather than back at the marketing copy.
  // Tracked as state (not a ref) so the unified step-derivation effect
  // re-runs the moment the user engages — even if (authStatus, accuracy)
  // don't change as a result of the prompt.
  const [hasInteracted, setHasInteracted] = useState(false);

  // Compute the right step for a given OS state. Single source of truth
  // shared by mount, the OS-state effect, and the post-prompt handlers.
  //   denied / restricted / notDetermined → fallback (caller decides)
  //   whenInUse                            → 'always'
  //   always + reduced                     → 'precise'
  //   always + full                        → 'done'
  const stepForState = useCallback(
    (
      s: typeof authStatus,
      a: typeof accuracy,
      fallback: typeof step = 'explain',
    ): typeof step => {
      if (s === 'always') return a === 'full' ? 'done' : 'precise';
      if (s === 'whenInUse') return 'always';
      return fallback;
    },
    [],
  );

  // ── OS-state listening ────────────────────────────────────────────────────
  // Three sources update (authStatus, accuracy):
  //   1. Mount probe (initial read).
  //   2. SDK push: BackgroundGeolocation.onProviderChange — fires the
  //      moment iOS notifies the SDK of a Settings change, before
  //      AppState 'active' even resolves. This is the authoritative
  //      source; AppState polling races it and can read stale values.
  //   3. AppState 'active' + useFocusEffect — backstops for SDK quirks
  //      (and for the very first foreground after launch).
  //
  // Step is then derived from (authStatus, accuracy) in a SINGLE effect
  // below, so every code path agrees on the funnel without duplicating
  // routing logic.

  // Mount probe.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      locationService.getAuthorizationStatus(),
      locationService.getAccuracyAuthorization(),
    ]).then(([s, a]) => {
      if (cancelled) return;
      setAuthStatus(s);
      setAccuracy(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Push listener: SDK fires this whenever iOS reports a permission /
  // accuracy change — including the round-trip from Settings.app. This
  // is what catches the "user grants Always but leaves Precise off"
  // case reliably; AppState 'active' alone races getProviderState's
  // cached read and sometimes returns the pre-toggle state.
  useEffect(() => {
    const unsubscribe = locationService.onProviderChange((event) => {
      const isAlways =
        event.status === BackgroundGeolocation.AuthorizationStatus.Always;
      const isWhenInUse =
        event.status === BackgroundGeolocation.AuthorizationStatus.WhenInUse;
      const isDenied =
        event.status === BackgroundGeolocation.AuthorizationStatus.Denied;
      const isRestricted =
        event.status === BackgroundGeolocation.AuthorizationStatus.Restricted;

      setAuthStatus(
        isAlways
          ? 'always'
          : isWhenInUse
          ? 'whenInUse'
          : isDenied
          ? 'denied'
          : isRestricted
          ? 'restricted'
          : 'notDetermined',
      );
      setAccuracy(
        event.accuracyAuthorization ===
          BackgroundGeolocation.AccuracyAuthorization.Reduced
          ? 'reduced'
          : 'full',
      );
    });
    return unsubscribe;
  }, []);

  // Backstop poll: re-read on focus and on background → foreground in
  // case the SDK missed an event (rare, but happens if the app is
  // killed and relaunched mid-Settings-edit).
  const refreshFromOS = useCallback(async () => {
    const [s, a] = await Promise.all([
      locationService.getAuthorizationStatus(),
      locationService.getAccuracyAuthorization(),
    ]);
    setAuthStatus(s);
    setAccuracy(a);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshFromOS();
    }, [refreshFromOS]),
  );

  useEffect(() => {
    const appState = { current: AppState.currentState };
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        void refreshFromOS();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshFromOS]);

  // ── Derive step + sync contributor grant from (authStatus, accuracy) ──
  // Single effect, single source of truth. Runs whenever either axis
  // changes — including SDK push events, AppState transitions, and the
  // post-prompt setAuthStatus calls inside requestWhenInUse/requestAlways.
  //
  // Funnel rule: once the user has tapped a CTA (hasInteracted=true),
  // never bounce them back to 'explain' — denied/notDetermined route to
  // 'done' so the screen surfaces "not granted" copy + a Settings link
  // instead of the marketing intro.
  const lastSyncedKey = useRef<string | null>(null);
  useEffect(() => {
    if (authStatus === null || accuracy === null) return; // waiting on mount probe

    setStep((prev) => {
      const fallback: typeof step = hasInteracted ? 'done' : 'explain';
      const next = stepForState(authStatus, accuracy, fallback);
      // Don't bounce back to 'explain' once they've engaged.
      if (next === 'explain' && hasInteracted) return 'done';
      // Preserve in-flight 'when-in-use' / 'always' steps if the OS state
      // hasn't actually moved past them yet (e.g. mount probe finishes
      // mid-request and would otherwise yank the user back).
      if (prev === 'when-in-use' && next === 'explain') return prev;
      return next;
    });

    // Contributor pub-sub: fire only on real transitions, not on every
    // re-read. Skip the very first observation (we don't know if the
    // OS state just changed or has been like this since launch — the
    // EnhancedGeofencingProvider handles app-launch grant separately).
    const key = `${authStatus}|${accuracy}`;
    if (lastSyncedKey.current !== null && lastSyncedKey.current !== key) {
      if (authStatus === 'always' && accuracy === 'full') {
        void registerContributorGrant({ force: true });
      } else {
        void revokeContributorGrant();
      }
    }
    lastSyncedKey.current = key;
  }, [authStatus, accuracy, hasInteracted, stepForState]);

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
  //
  // Note: we no longer set `step` here — the unified effect on
  // (authStatus, accuracy) derives it. We just fan out the OS truth and
  // the contributor grant; routing is centralized.
  const requestWhenInUse = async () => {
    setIsRequesting(true);
    setHasInteracted(true);
    try {
      await locationService.requestPermissions();
      // Read the actual OS state — do NOT trust the request's boolean
      // return value as the source of truth (see getAuthorizationStatus
      // doc for why iOS may silently no-op the second prompt).
      const [status, acc] = await Promise.all([
        locationService.getAuthorizationStatus(),
        locationService.getAccuracyAuthorization(),
      ]);
      setAuthStatus(status);
      setAccuracy(acc);

      if (status === 'always' && acc === 'full') {
        // Register the permission-grant grace pass with the backend so the
        // ContributorGuard accepts reads for the next 24h even before the
        // user has driven into a lot. Best-effort, swallows network errors.
        //
        // WhenInUse intentionally does NOT register a grant. WhenInUse
        // can't fire BG geofence events, so the user can't actually
        // contribute back — unlocking live reads here would be a
        // free-rider escape hatch around the reciprocity gate. We let
        // them through to the Stage 2 escalation prompt instead.
        //
        // Always + Reduced is also withheld: Reduced fuzzes coords to
        // ~hectares which makes lot geofence events unreliable. We route
        // those users to the dedicated 'precise' step.
        await registerContributorGrant({ force: true });
      }

      // Explicit synchronous step transition for user actions. The
      // unified effect will also derive this on the next render, but
      // setting it inline keeps the test renderer + UX feedback snappy
      // (avoids a frame where step lags behind the OS read).
      setStep(stepForState(status, acc, 'done'));
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
  //
  // Like requestWhenInUse, step routing is delegated to the unified
  // (authStatus, accuracy) effect; we only handle the no-op case here
  // because that's the one transition the OS doesn't tell us about.
  const requestAlways = async () => {
    setIsRequesting(true);
    setHasInteracted(true);
    try {
      const before = await locationService.getAuthorizationStatus();
      await locationService.requestPermissions();
      const [after, acc] = await Promise.all([
        locationService.getAuthorizationStatus(),
        locationService.getAccuracyAuthorization(),
      ]);
      setAuthStatus(after);
      setAccuracy(acc);

      if (after === 'always' && acc === 'full') {
        // Genuine escalation with precise accuracy — refresh the grant
        // so the backend knows.
        await registerContributorGrant({ force: true });
        setStep('done');
        return;
      }

      if (after === 'always' && acc === 'reduced') {
        // User granted Always but the temporary-full-accuracy prompt was
        // dismissed (or iOS suppressed it). Don't register a grant — the
        // 'precise' step deep-links to Settings.
        setStep('precise');
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

  const skipAlways = () => {
    setHasInteracted(true);
    setStep('done');
  };

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
            name={authStatus === 'always' && accuracy === 'full' ? 'checkmark-circle' : 'alert-circle'}
            size={72}
            color={authStatus === 'always' && accuracy === 'full' ? COLORS.primary : colors.gray}
          />
          <Text style={[styles.doneTitle, { color: colors.textPrimary }]}>
            {authStatus === 'always' && accuracy === 'full'
              ? "You're all set"
              : authStatus === 'always' && accuracy === 'reduced'
              ? 'Almost there — Precise Location is off'
              : authStatus === 'whenInUse'
              ? 'Almost there — background access still needed'
              : 'Background access not granted'}
          </Text>
          <Text style={[styles.doneSubtitle, { color: colors.gray }]}>
            {authStatus === 'always' && accuracy === 'full'
              ? 'Live occupancy is unlocked for the next 24 hours. SharkPark can detect when you park or leave even when the app is closed — your phone handles the detection locally and only sends an anonymous "entered Lot G1"-style event. No GPS trails, no identity, nothing tying it back to you. You can change location permissions any time in your device settings.'
              : authStatus === 'always' && accuracy === 'reduced'
              ? 'You granted background access, but iOS is set to Reduced Accuracy. Live data stays locked until you turn on Precise Location in device settings — without it, your phone can\u2019t reliably tell which lot you parked in.'
              : authStatus === 'whenInUse'
              ? 'Live occupancy and forecasts stay locked until you choose "Always Allow". While Using the App lets us see your location when SharkPark is open, but it can\u2019t detect lot entries/exits in the background \u2014 which is what powers the crowdsourced live data. Open device settings and switch SharkPark\u2019s location to "Always" to unlock.'
              : 'You can still browse the map, but live occupancy stays locked until you grant "Always Allow" location access in device settings.'}
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

  if (step === 'precise') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.lightGray }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <Icon name="arrow-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Icon name="locate-outline" size={56} color={COLORS.primary} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            One more thing — turn on Precise Location
          </Text>
          <Text style={[styles.body, { color: colors.gray }]}>
            You granted background access, but iOS is set to{' '}
            <Text style={{ fontFamily: TYPOGRAPHY.fontFamily.semibold }}>Reduced Accuracy</Text>.
            That fuzzes your location to roughly the size of a city block — too coarse for SharkPark to tell which lot you actually parked in.
          </Text>
          <Text style={[styles.body, { color: colors.gray }]}>
            Without Precise Location, your phone can't reliably trigger the lot enter/exit events that power live occupancy. Live data and forecasts stay locked until it's on.
          </Text>

          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.borderGray }]}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>How to enable</Text>
            <Text style={[styles.cardBody, { color: colors.gray }]}>
              Open Settings → SharkPark → Location, then turn on{' '}
              <Text style={{ fontFamily: TYPOGRAPHY.fontFamily.semibold }}>Precise Location</Text>. Come back to the app and we'll unlock live data automatically.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: COLORS.primary }]}
            onPress={openSettings}
          >
            <Text style={[styles.primaryButtonText, { color: colors.white }]}>Open Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep('done')}>
            <Text style={[styles.secondaryButtonText, { color: colors.gray }]}>
              Not now — keep live data locked
            </Text>
          </TouchableOpacity>
        </ScrollView>
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
