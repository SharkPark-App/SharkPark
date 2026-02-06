/**
 * SharkPark Mobile App
 * @format
 */

import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { MainTabNavigator } from './src/navigation';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext'
import { LoginScreen } from './src/screens';
import { SimpleGeofencingProvider } from './src/context/SimpleGeofencingProvider';
function AppContent() {
  const { isDark, colors } = useTheme();
  const { isAuthenticated, isLoading } = useAuth();

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
  console.warn('🔥 APP.TSX: About to render SimpleGeofencingProvider');
  return (
    <ThemeProvider>
      <AuthProvider>
         <AppContent />
      </AuthProvider>

      <SimpleGeofencingProvider>
        <AppContent />
      </SimpleGeofencingProvider>
    </ThemeProvider>
  );
}

export default App;
