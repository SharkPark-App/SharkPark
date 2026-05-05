/**
 * SharkPark Mobile App
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MainTabNavigator } from './src/navigation';
import { linkingConfig } from './src/navigation/linking';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen, OnboardingScreen, PermissionGateScreen } from './src/screens';
import { EnhancedGeofencingProvider } from './src/context/EnhancedGeofencingProvider';
import { useOnboarding } from './src/hooks/useOnboarding';
function AppContent() {
  const { isDark, colors } = useTheme();
  const { isAuthenticated, isGuest, isLoading: authLoading } = useAuth();
  const { isLoading: onboardingLoading, needsOnboarding, completeOnboarding, needsPermissionGate, completePermissionGate } = useOnboarding();

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
        <StatusBar
          barStyle="dark-content"
          backgroundColor={colors.white}
        />
        <OnboardingScreen onComplete={completeOnboarding} />
      </SafeAreaProvider>
    );
  }

  // One-time permission gate: shown immediately after onboarding completes.
  // Prompts for notification permission before the user reaches login.
  if (needsPermissionGate) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
        <PermissionGateScreen onDone={completePermissionGate} />
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
