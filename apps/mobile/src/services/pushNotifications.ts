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
import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import { registerPushToken } from './api/notifications';

export type PushMessage = FirebaseMessagingTypes.RemoteMessage;

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
 * Fetch the current FCM token, register it with the backend, and subscribe
 * to token-refresh events.  Returns an unsubscribe function — call it on
 * sign-out so stale listeners don't keep re-registering after logout.
 */
export async function initPushNotifications(): Promise<() => void> {
  try {
    const granted = await requestNotificationPermission();
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
  return messaging().onMessage(onMessage);
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
