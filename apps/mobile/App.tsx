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
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext'
import { LoginScreen } from './src/screens';
import { SimpleGeofencingProvider } from './src/context/SimpleGeofencingProvider';
function AppContent() {
  const { isDark, colors } = useTheme();
  const { isAuthenticated, isLoading } = useAuth();

  if (__DEV__) {
    console.log('[AppContent] Render - isAuthenticated:', isAuthenticated, 'isLoading:', isLoading);
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

  if (isLoading) {
    // prevent login screen from prematurely rendering if already logged in
    return null;
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
      <NavigationContainer theme={navigationTheme}>
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
          <SimpleGeofencingProvider>
            <AppContent />
          </SimpleGeofencingProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export default App;
