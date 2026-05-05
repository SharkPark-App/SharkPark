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
import { MainTabNavigator } from './src/navigation';
import { linkingConfig } from './src/navigation/linking';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen, OnboardingScreen } from './src/screens';
import { EnhancedGeofencingProvider } from './src/context/EnhancedGeofencingProvider';
import { useOnboarding } from './src/hooks/useOnboarding';
import {
  subscribeForegroundMessages,
  subscribeNotificationOpenedApp,
  getInitialNotification,
} from './src/services/pushNotifications';
import type { RootTabParamList } from './src/types/navigation';

// Shared navigation ref so push handlers outside the component tree can
// trigger navigation (e.g. background/quit tap → lot screen).
export const navigationRef = createNavigationContainerRef<RootTabParamList>();

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

function AppContent() {
  const { isDark, colors } = useTheme();
  const { isAuthenticated, isGuest, isLoading: authLoading } = useAuth();
  const { isLoading: onboardingLoading, needsOnboarding, completeOnboarding } = useOnboarding();

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

    // Quit state: app was fully closed and user tapped to open it.
    getInitialNotification().then((message) => {
      if (message) {
        // Small delay so NavigationContainer has time to mount.
        setTimeout(
          () =>
            handleNotificationNavigation(
              message.data as Record<string, string> | undefined,
            ),
          500,
        );
      }
    });

    return () => {
      unsubFg();
      unsubBg();
    };
  }, []);

  // Wait for both auth + onboarding storage reads before rendering
  if (authLoading || onboardingLoading) {
    return null;
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
