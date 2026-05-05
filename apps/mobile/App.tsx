/**
 * SharkPark Mobile App
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import DeviceInfo from 'react-native-device-info';
import { MainTabNavigator } from './src/navigation';
import { linkingConfig } from './src/navigation/linking';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen, OnboardingScreen, ForceUpdateScreen } from './src/screens';
import { EnhancedGeofencingProvider } from './src/context/EnhancedGeofencingProvider';
import { useOnboarding } from './src/hooks/useOnboarding';
import { fetchMinVersion } from './src/services/api/version';

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
        <StatusBar
          barStyle="dark-content"
          backgroundColor={colors.white}
        />
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
        <NavigationContainer theme={navigationTheme} linking={linkingConfig}>
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
