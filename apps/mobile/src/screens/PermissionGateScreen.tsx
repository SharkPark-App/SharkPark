/**
 * PermissionGateScreen
 *
 * Shown exactly once, immediately after the user finishes onboarding and
 * before they reach the login screen. Prompts for OS notification permission.
 *
 * Flow:
 *   intro      → user taps "Allow Notifications"
 *   requesting → OS permission dialog shown
 *   done       → result card shown, auto-advances to login after 1.4 s
 *
 * Tapping "Not now" skips the OS dialog and advances immediately.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from '../components/CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { requestNotificationPermission as requestFcmPermission } from '../services/pushNotifications';

// ─── permission helper ────────────────────────────────────────────────────────

async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    // Android < 13: notifications are granted at install time, so the OS
    // never prompts. Returning true keeps the UI consistent with reality.
    if (typeof Platform.Version === 'number' && Platform.Version < 33) {
      return true;
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  // iOS — delegate to Firebase Messaging (single source of truth, matches
  // the post-sign-in init path in services/pushNotifications.ts so the OS
  // dialog is only ever presented once).
  return requestFcmPermission();
}

// ─── types ────────────────────────────────────────────────────────────────────

interface PermissionGateScreenProps {
  onDone: () => void;
}

type Stage = 'intro' | 'requesting' | 'done';

// ─── component ───────────────────────────────────────────────────────────────

export function PermissionGateScreen({ onDone }: PermissionGateScreenProps) {
  const [stage, setStage] = useState<Stage>('intro');
  const [granted, setGranted] = useState<boolean | null>(null);
  const requesting = useRef(false);

  // Auto-advance 1.4 s after result is shown
  useEffect(() => {
    if (stage !== 'done') return;
    const timer = setTimeout(onDone, 1400);
    return () => clearTimeout(timer);
  }, [stage, onDone]);

  const handleAllow = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    setStage('requesting');
    try {
      const result = await requestNotificationPermission();
      setGranted(result);
    } catch {
      setGranted(false);
    } finally {
      requesting.current = false;
      setStage('done');
    }
  }, []);

  const iconName =
    stage === 'done'
      ? granted ? 'checkmark-circle' : 'notifications-off-outline'
      : 'notifications-outline';

  const iconColor = stage === 'done' && !granted ? COLORS.mediumGray : COLORS.primary;

  const title =
    stage === 'done'
      ? granted ? "You're all set!" : 'No problem'
      : 'Stay in the loop';

  const bodyText =
    stage === 'done'
      ? granted
        ? "We'll alert you when your favourite lots are filling up, clearing, or when a parking surge hits."
        : 'You can enable parking alerts anytime from Profile \u2192 Notifications.'
      : 'Allow notifications so SharkPark can alert you when your favourite lots are filling up, clearing, or when a parking surge is detected.';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconWrapper}>
          <Icon name={iconName} size={72} color={iconColor} />
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{bodyText}</Text>

        {stage === 'intro' && (
          <View style={styles.bulletList}>
            {BULLETS.map((item) => (
              <View key={item.text} style={styles.bulletRow}>
                <Icon name={item.icon} size={18} color={COLORS.primary} style={styles.bulletIcon} />
                <Text style={styles.bulletText}>{item.text}</Text>
              </View>
            ))}
          </View>
        )}

        {stage === 'intro' && (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              {Platform.OS === 'ios'
                ? 'You can change this anytime in Settings \u2192 Notifications \u2192 SharkPark.'
                : 'You can change this anytime in Settings \u2192 Apps \u2192 SharkPark \u2192 Notifications.'}
            </Text>
          </View>
        )}

        {stage === 'requesting' && (
          <ActivityIndicator size="large" color={COLORS.primary} style={styles.spinner} />
        )}
      </View>

      {stage === 'intro' && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.allowButton}
            onPress={handleAllow}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Allow notifications"
            accessibilityHint="Grants permission to receive parking alerts"
          >
            <Text style={styles.allowText}>Allow Notifications</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.skipButton}
            onPress={onDone}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Not now, skip notifications"
          >
            <Text style={styles.skipText}>Not now</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── data ─────────────────────────────────────────────────────────────────────

const BULLETS = [
  { icon: 'car-outline',         text: 'Favourite lot filling or clearing' },
  { icon: 'trending-up-outline', text: 'Parking surge alerts' },
  { icon: 'calendar-outline',    text: 'Campus event parking heads-ups' },
];

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.white },
  content:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xxxl },
  iconWrapper: { marginBottom: SPACING.xxl },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxxl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  body: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    color: COLORS.mediumGray,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: SPACING.xxl,
  },
  bulletList:  { width: '100%', gap: SPACING.sm, marginBottom: SPACING.xxl },
  bulletRow:   { flexDirection: 'row', alignItems: 'flex-start' },
  bulletIcon:  { marginRight: SPACING.sm, marginTop: 2 },
  bulletText:  { flex: 1, fontSize: TYPOGRAPHY.fontSize.sm, color: COLORS.darkGray, lineHeight: 20 },
  noteBox: {
    backgroundColor: COLORS.yellowLight,
    borderRadius: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
  },
  noteText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.warningText,
    textAlign: 'center',
    lineHeight: 18,
  },
  spinner: { marginTop: SPACING.xxl },
  footer: {
    paddingHorizontal: SPACING.xxxl,
    paddingBottom: SPACING.xxl,
    gap: SPACING.md,
  },
  allowButton: {
    backgroundColor: COLORS.primary,
    borderRadius: SPACING.md,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  allowText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.white,
  },
  skipButton:  { alignItems: 'center', paddingVertical: SPACING.sm },
  skipText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.mediumGray,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});
