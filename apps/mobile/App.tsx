/**
 * SharkPark Mobile App
 * @format
 */

import React, { useEffect } from 'react';
import { StatusBar, Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import DeviceInfo from 'react-native-device-info';
import { MainTabNavigator } from './src/navigation';
import { linkingConfig } from './src/navigation/linking';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen, OnboardingScreen, ForceUpdateScreen } from './src/screens';
import { EnhancedGeofencingProvider } from './src/context/EnhancedGeofencingProvider';
import { useOnboarding } from './src/hooks/useOnboarding';
import {
  subscribeForegroundMessages,
  subscribeNotificationOpenedApp,
  getInitialNotification,
} from './src/services/pushNotifications';
import { fetchMinVersion } from './src/services/api/version';
import type { RootTabParamList } from './src/types/navigation';

// Shared navigation ref so push handlers outside the component tree can
// trigger navigation (e.g. background/quit tap → lot screen).
export const navigationRef = createNavigationContainerRef<RootTabParamList>();

// If the app was launched from a quit-state notification we may receive the
// payload before <NavigationContainer> has finished mounting. Park it here
// and replay it from the container's onReady callback, which is the
// canonical hook for "navigation is now safe to call".
let pendingInitialNotificationData: Record<string, string> | undefined;

/**
 * Navigate to the relevant screen based on the notification data payload.
 * Called both from the background-open handler and the quit-state handler.
 */
function handleNotificationNavigation(data?: Record<string, string>) {
  if (!navigationRef.isReady() || !data) return;

  const { type, lotId } = data;

  if (
    (type === 'favorites_filling' ||
      type === 'favorites_clearing' ||
      type === 'surge') &&
    lotId
  ) {
    // Navigate into the Map tab → Short Term Forecast for the relevant lot.
    navigationRef.navigate('Map', {
      screen: 'Short Term Forecast',
      params: { lotId, lotName: '' },
    });
  }
  // 'events' type — no lot, navigate to events screen when it exists.
}

/**
 * Compares two semver strings.
 * Returns true if `a` is strictly less than `b`.
 * Handles major.minor.patch — pre-release tags are ignored.
 */
function semverLt(a: string, b: string): boolean {
  const parse = (s: string) => {
    const parts = s.split('.').map(n => parseInt(n, 10));
    return [0, 1, 2].map(i => (Number.isFinite(parts[i]) ? parts[i] : 0));
  };
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj < bMaj;
  if (aMin !== bMin) return aMin < bMin;
  return aPatch < bPatch;
}

function useForceUpdate() {
  const [updateRequired, setUpdateRequired] = React.useState(false);
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { minSupportedVersion } = await fetchMinVersion();
        const currentVersion = DeviceInfo.getVersion();
        if (!cancelled && semverLt(currentVersion, minSupportedVersion)) {
          setUpdateRequired(true);
        }
      } catch (err) {
        // Network failure on version check — fail open so users on flaky
        // connections are not incorrectly blocked.
        if (__DEV__) {
          console.warn('[ForceUpdate] version check failed, failing open:', err);
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    };
    void check();
    return () => { cancelled = true; };
  }, []);

  return { updateRequired, checked };
}

function AppContent() {
  const { isDark, colors } = useTheme();
  const { isAuthenticated, isGuest, isLoading: authLoading } = useAuth();
  const { isLoading: onboardingLoading, needsOnboarding, completeOnboarding } = useOnboarding();
  const { updateRequired, checked: versionChecked } = useForceUpdate();

  if (__DEV__) {
    console.log(
      '[AppContent] Render - isAuthenticated:',
      isAuthenticated,
      'isGuest:',
      isGuest,
      'isLoading:',
      authLoading,
    );
  }

  // Create custom navigation theme based on our theme colors
  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.lightGray,
      card: colors.white,
      text: colors.textPrimary,
      border: colors.borderGray,
    },
  };

  // ── Push notification handlers ────────────────────────────────────────
  // Foreground messages show an Alert; background/quit taps navigate to
  // the relevant lot screen via the shared navigationRef.
  useEffect(() => {
    const unsubFg = subscribeForegroundMessages((message) => {
      const { title, body } = message.notification ?? {};
      if (title || body) {
        Alert.alert(title ?? 'SharkPark', body ?? '', [
          { text: 'Dismiss', style: 'cancel' },
          {
            text: 'View',
            onPress: () =>
              handleNotificationNavigation(
                message.data as Record<string, string> | undefined,
              ),
          },
        ]);
      }
    });

    // Background state: app was backgrounded and user tapped the notification.
    const unsubBg = subscribeNotificationOpenedApp((message) => {
      handleNotificationNavigation(message.data as Record<string, string> | undefined);
    });

    // Quit state: app was fully closed and user tapped to open it. We can't
    // navigate yet — NavigationContainer probably hasn't mounted. Stash the
    // payload and let onReady replay it once the navigator is up.
    getInitialNotification().then((message) => {
      if (message?.data) {
        pendingInitialNotificationData = message.data as Record<string, string>;
        // If the navigator happens to already be ready (e.g. fast-refresh in
        // dev), drain immediately rather than waiting for the next mount.
        if (navigationRef.isReady()) {
          const data = pendingInitialNotificationData;
          pendingInitialNotificationData = undefined;
          handleNotificationNavigation(data);
        }
      }
    });

    return () => {
      unsubFg();
      unsubBg();
    };
  }, []);

  // Wait for auth, onboarding, and version check before rendering
  if (authLoading || onboardingLoading || !versionChecked) {
    return null;
  }

  // Block outdated builds from accessing the app.
  // Wrapped in SafeAreaProvider so the screen's <SafeAreaView> resolves insets,
  // and StatusBar matches the white background.
  if (updateRequired) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
        <ForceUpdateScreen />
      </SafeAreaProvider>
    );
  }

  // First-launch onboarding (shown before login).
  // IMPORTANT: rendered OUTSIDE <EnhancedGeofencingProvider> so the iOS
  // location permission sheet does not fire while the user is still on the
  // first slide. The provider only mounts after onboarding completes.
  if (needsOnboarding) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
        <OnboardingScreen onComplete={completeOnboarding} />
      </SafeAreaProvider>
    );
  }

  // login flow handled via auth context
  if (!isAuthenticated && !isGuest) {
    return (
      <SafeAreaProvider>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={colors.primary}
        />
        <EnhancedGeofencingProvider>
          <LoginScreen />
        </EnhancedGeofencingProvider>
      </SafeAreaProvider>
    );
  }

  // show main app once authenticated
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.primary}
      />
      <EnhancedGeofencingProvider>
        <NavigationContainer
          ref={navigationRef}
          theme={navigationTheme}
          linking={linkingConfig}
          onReady={() => {
            // Drain any quit-state notification payload that arrived before
            // the navigator mounted. Replaces the previous setTimeout(500)
            // race-prone hack.
            if (pendingInitialNotificationData) {
              const data = pendingInitialNotificationData;
              pendingInitialNotificationData = undefined;
              handleNotificationNavigation(data);
            }
          }}
        >
          <MainTabNavigator />
        </NavigationContainer>
      </EnhancedGeofencingProvider>
    </SafeAreaProvider>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default App;
