/**
 * Push Notifications Service
 *
 * Handles the full FCM lifecycle on the mobile side:
 *   1. Request OS notification permission (iOS only; Android 13+ handled separately)
 *   2. Fetch the FCM registration token
 *   3. Register the token with the SharkPark backend
 *   4. Listen for token refreshes and re-register automatically
 *
 * Usage: call `initPushNotifications()` once after a successful sign-in.
 * The returned cleanup function should be called on sign-out.
 *
 * Foreground message display and background tap handling are wired at the
 * App.tsx level (they depend on the navigation ref).
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { registerPushToken, unregisterPushToken } from './api/notifications';

export type PushMessage = FirebaseMessagingTypes.RemoteMessage;

type ForegroundMessageHandler = (message: PushMessage) => void;
const devForegroundHandlers = new Set<ForegroundMessageHandler>();

/**
 * Storage key written by `PermissionGateScreen` (see `useOnboarding`).
 * Its presence means the user has already been given an explicit chance to
 * grant or decline notifications during the onboarding flow — re-prompting
 * from `initPushNotifications` would surface a second OS dialog on Android
 * (or wear out the user on iOS for permission-related re-asks in future
 * SDK behavior changes), so we suppress when this flag is set and the OS
 * status is anything other than already-authorized.
 */
const PERMISSION_GATE_KEY = '@SharkPark:permissionGateShown';

/**
 * Request notification permission from the OS.
 * On iOS this shows the system prompt (shown at most once by the OS).
 * On Android 13+ the `POST_NOTIFICATIONS` permission is handled by the
 * Firebase SDK automatically when you call `requestPermission`.
 * Returns true if permission is granted or provisional.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const authStatus = await messaging().requestPermission();
  return (
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL
  );
}

/**
 * Read the OS notification authorization status WITHOUT prompting.
 * Returns true if currently AUTHORIZED or PROVISIONAL.
 */
async function hasNotificationPermission(): Promise<boolean> {
  const authStatus = await messaging().hasPermission();
  return (
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL
  );
}

/**
 * Fetch the current FCM token, register it with the backend, and subscribe
 * to token-refresh events.  Returns an unsubscribe function — call it on
 * sign-out so stale listeners don't keep re-registering after logout.
 */
export async function initPushNotifications(): Promise<() => void> {
  try {
    // Prefer the non-prompting status read so we don't surface a second OS
    // dialog when PermissionGateScreen has already asked.
    let granted = await hasNotificationPermission();

    if (!granted) {
      // Suppress the prompt if the user has already made an explicit choice
      // at the onboarding gate. Without this guard, an Android user who
      // tapped "Not now" would still see the OS dialog right after sign-in.
      const gateShown = await AsyncStorage.getItem(PERMISSION_GATE_KEY).catch(
        () => null,
      );
      if (gateShown !== null) {
        if (__DEV__) {
          console.warn(
            '[Push] Permission gate already shown; not re-prompting after sign-in',
          );
        }
        return () => {};
      }

      // Gate hasn't fired (e.g. returning user from before the gate shipped,
      // or AsyncStorage was wiped) — fall back to prompting now.
      granted = await requestNotificationPermission();
    }

    if (!granted) {
      if (__DEV__) console.warn('[Push] Notification permission denied');
      return () => {};
    }

    // On iOS, get an APNs token first; Firebase requires it before it can
    // issue an FCM token.  This is a no-op on Android.
    if (Platform.OS === 'ios') {
      await messaging().registerDeviceForRemoteMessages();
    }

    const token = await messaging().getToken();
    if (token) {
      await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
      if (__DEV__) console.log('[Push] Token registered:', token.slice(0, 20) + '…');
    }

    // Re-register whenever FCM rotates the token (e.g. after app reinstall
    // or when FCM invalidates old tokens server-side).
    const unsubscribeRefresh = messaging().onTokenRefresh(async (newToken) => {
      if (__DEV__) console.log('[Push] Token refreshed');
      await registerPushToken(newToken, Platform.OS === 'ios' ? 'ios' : 'android').catch(
        (e) => __DEV__ && console.warn('[Push] Token refresh registration failed:', e),
      );
    });

    return unsubscribeRefresh;
  } catch (e) {
    // Never crash the app over a push setup failure.
    if (__DEV__) console.warn('[Push] initPushNotifications failed:', e);
    return () => {};
  }
}

/**
 * Set up the foreground message handler.  Firebase does NOT auto-display
 * notifications when the app is in the foreground — callers should show an
 * in-app banner/alert themselves.
 *
 * Returns an unsubscribe function.
 */
export function subscribeForegroundMessages(
  onMessage: (message: PushMessage) => void,
): () => void {
  const unsubscribeFirebase = messaging().onMessage(onMessage);
  if (__DEV__) {
    devForegroundHandlers.add(onMessage);
  }
  return () => {
    unsubscribeFirebase();
    if (__DEV__) {
      devForegroundHandlers.delete(onMessage);
    }
  };
}

/**
 * Dev-only helper: inject a synthetic foreground push message so the app can
 * test notification UI and deep-link behavior without waiting for backend sends.
 */
export function simulateForegroundPushMessage(params: {
  title: string;
  body: string;
  data?: Record<string, string>;
}): void {
  if (!__DEV__) return;
  const message = {
    messageId: `dev-${Date.now()}`,
    notification: {
      title: params.title,
      body: params.body,
    },
    data: params.data,
  } as PushMessage;
  devForegroundHandlers.forEach((handler) => {
    try {
      handler(message);
    } catch (e) {
      if (__DEV__) console.warn('[Push] simulateForegroundPushMessage handler failed:', e);
    }
  });
}

/**
 * Get the initial notification that caused the app to open from a
 * quit/background state.  Returns null if the app was opened normally.
 * Call this once inside a React effect after navigation is ready.
 */
export async function getInitialNotification(): Promise<PushMessage | null> {
  return messaging().getInitialNotification();
}

/**
 * Register a handler for background/quit state notification taps.
 * The callback fires when the user taps a notification and the app comes
 * to the foreground from background (not quit — quit state is handled by
 * getInitialNotification).
 *
 * Returns an unsubscribe function.
 */
export function subscribeNotificationOpenedApp(
  onOpen: (message: PushMessage) => void,
): () => void {
  return messaging().onNotificationOpenedApp(onOpen);
}

/**
 * Unregister the device's current FCM token with the backend.
 *
 * Called from the auth context on sign-out so the previous user's account
 * doesn't keep accumulating push targets on this device. Best-effort: any
 * error is swallowed because we never want logout to fail because of a
 * notification cleanup hiccup. The backend will eventually GC orphaned
 * tokens via FCM `registration-token-not-registered` errors at send time
 * (see backend `NotificationsService.sendPush`).
 *
 * Must be called BEFORE the auth tokens are cleared from storage,
 * otherwise the request will be skipped (no bearer to attach).
 */
export async function unregisterCurrentPushToken(): Promise<void> {
  try {
    const token = await messaging().getToken();
    if (!token) return;
    await unregisterPushToken(token);
  } catch (e) {
    if (__DEV__) console.warn('[Push] unregisterCurrentPushToken failed:', e);
  }
}
