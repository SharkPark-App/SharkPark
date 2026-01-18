/**
 * SharkPark Mobile App
 * @format
 */

import React, { useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { MainTabNavigator } from './src/navigation';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { SimpleGeofencingProvider } from './src/context/SimpleGeofencingProvider';
import { LoginFlow } from './src/screens';

function AppContent() {
  const { isDark, colors } = useTheme();
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  // Show login flow if not authenticated
  if (!isAuthenticated) {
    return (
      <SafeAreaProvider>
        <StatusBar 
          barStyle={isDark ? 'light-content' : 'dark-content'} 
          backgroundColor={colors.primary}
        />
        <LoginFlow onLoginSuccess={handleLoginSuccess} />
      </SafeAreaProvider>
    );
  }

  // Show main app if authenticated
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
      <SimpleGeofencingProvider>
        <AppContent />
      </SimpleGeofencingProvider>
    </ThemeProvider>
  );
}

export default App;
