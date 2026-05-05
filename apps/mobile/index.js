/**
 * @format
 */

// Hermes lacks a built-in `globalThis.crypto`. This polyfill installs
// `crypto.getRandomValues` before any other module loads, so anything that
// generates UUIDs (deviceCredentials, etc.) works on the JS engine.
// MUST stay above every other import.
import 'react-native-get-random-values';

// Sentry must be initialized before any other code runs so it can capture
// errors from module-load and the headless geofence task below.
import * as Sentry from '@sentry/react-native';
import { SENTRY_DSN_MOBILE, SENTRY_ENVIRONMENT } from '@env';

if (SENTRY_DSN_MOBILE) {
  Sentry.init({
    dsn: SENTRY_DSN_MOBILE,
    environment: SENTRY_ENVIRONMENT ?? (__DEV__ ? 'development' : 'production'),
    // Don't capture breadcrumbs for noisy console.log calls in dev.
    enableNativeCrashHandling: true,
    enableAutoSessionTracking: true,
    // Performance: keep low on free tier; tune later from real traffic.
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,
    // Strip user IP and other PII by default. We never send identifiable
    // location data to Sentry; only anonymous device-scoped breadcrumbs.
    sendDefaultPii: false,
    // App Store reviewer + cold-start path: don't block startup on Sentry.
    autoInitializeNativeSdk: true,
  });
}

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import BackgroundGeolocation from 'react-native-background-geolocation';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Register Android headless task for geofence events when app is terminated.
// This runs in a minimal JS context without React — only AsyncStorage is available.
BackgroundGeolocation.registerHeadlessTask(async (event) => {
  const { name, params } = event;

  switch (name) {
    case 'geofence': {
      // Queue geofence event for processing when app next launches.
      // Include activity + speed so the provider can correctly classify
      // headless EXIT events as vehicular (isVehicleExit needs them).
      const raw = await AsyncStorage.getItem('pending_geofence_events');
      const pending = raw ? JSON.parse(raw) : [];
      const loc = params.location;
      pending.push({
        regionId: params.identifier,
        eventType: params.action === 'ENTER' ? 'ENTER' : 'EXIT',
        timestamp: new Date().toISOString(),
        extras: params.extras || {},
        activity: loc?.activity
          ? { type: loc.activity.type, confidence: loc.activity.confidence }
          : undefined,
        speed: loc?.coords?.speed ?? undefined,
      });
      await AsyncStorage.setItem(
        'pending_geofence_events',
        JSON.stringify(pending),
      );
      break;
    }
    case 'terminate':
      // SDK continues geofence monitoring after app termination
      break;
  }
});

// Suppress InteractionManager deprecation warning from React Navigation
// TODO: Remove when React Navigation updates to use requestIdleCallback
if (__DEV__) {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0]?.includes?.('InteractionManager has been deprecated')) {
      return;
    }
    originalWarn.apply(console, args);
  };
}

// Register the main app component. Sentry.wrap enables automatic
// touch/navigation/perf instrumentation when the SDK is initialized.
AppRegistry.registerComponent(appName, () => Sentry.wrap(App));

// Ensure HMR client is properly registered for hot module replacement
if (__DEV__ && module.hot) {
  module.hot.accept();
}
