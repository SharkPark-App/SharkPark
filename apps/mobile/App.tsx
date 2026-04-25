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
import { LoginScreen, OnboardingScreen } from './src/screens';
import { EnhancedGeofencingProvider } from './src/context/EnhancedGeofencingProvider';
import { useOnboarding } from './src/hooks/useOnboarding';
function AppContent() {
  const { isDark, colors } = useTheme();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isLoading: onboardingLoading, needsOnboarding, completeOnboarding } = useOnboarding();

  if (__DEV__) {
    console.log('[AppContent] Render - isAuthenticated:', isAuthenticated, 'isLoading:', authLoading);
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

  // First-launch onboarding (shown before login)
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
  if (!isAuthenticated) {
    return (
      <SafeAreaProvider>
        <StatusBar 
          barStyle={isDark ? 'light-content' : 'dark-content'} 
          backgroundColor={colors.primary}
        />
        <LoginScreen />
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
      <NavigationContainer theme={navigationTheme} linking={linkingConfig}>
        <MainTabNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <EnhancedGeofencingProvider>
            <AppContent />
          </EnhancedGeofencingProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default App;
