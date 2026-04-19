import React, { createContext, useContext, useState, ReactNode, useMemo, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ThemeMode = 'light' | 'dark' | 'system';

// Create a flexible color type that can accommodate both light and dark themes
export type ThemeColors = {
  primary: string;
  secondary: string;
  white: string;
  black: string;
  gray: string;
  lightGray: string;
  darkGray: string;
  mediumGray: string;
  mediumLightGray: string;
  borderGray: string;
  toggleGray: string;
  warningLight: string;
  warningBorder: string;
  warningText: string;
  warningTextSecondary: string;
  error: string;
  errorLight: string;
  errorBorder: string;
  errorText: string;
  backgroundLight: string;
  yellowLight: string;
  shadowDark: string;
  textPrimary: string;
  textFull: string;
  borderLight: string;
};

// Extend existing colors with dark variants
const createThemeColors = (isDark: boolean): ThemeColors => {
  if (isDark) {
    return {
      // Primary colors (keep same)
      primary: COLORS.primary,
      secondary: COLORS.secondary,
      
      // Background colors for dark theme
      white: COLORS.darkGray, // Use existing dark gray instead of hardcoded
      lightGray: COLORS.black, // Use existing black instead of hardcoded
      backgroundLight: COLORS.black, // Use existing black
      
      // Text colors for dark theme  
      black: COLORS.lightGray, // Invert: use light gray for dark theme text
      textPrimary: COLORS.lightGray, // Use existing light gray
      textFull: COLORS.white, // Use existing white
      
      // Grays for dark theme
      gray: COLORS.toggleGray, // Use existing toggle gray
      darkGray: COLORS.lightGray, // Use existing light gray
      mediumGray: COLORS.gray, // Use existing gray
      mediumLightGray: COLORS.gray, // Use existing gray for dark theme
      borderGray: COLORS.mediumGray, // Use existing medium gray
      borderLight: COLORS.mediumGray, // Use existing medium gray
      toggleGray: COLORS.mediumGray, // Use existing medium gray
      
      // Warning colors for dark theme
      warningLight: '#451a03' as const, // Keep custom dark warning
      warningBorder: '#d97706' as const, // Keep custom dark warning
      warningText: '#fcd34d' as const, // Keep custom dark warning
      warningTextSecondary: '#f59e0b' as const, // Keep custom dark warning
      
      // Error colors for dark theme
      error: COLORS.error,
      errorLight: '#450a0a' as const, // Keep custom dark error
      errorBorder: '#7f1d1d' as const, // Keep custom dark error
      errorText: '#fca5a5' as const, // Keep custom dark error
      
      // Keep other colors
      yellowLight: '#451a03' as const, // Keep custom dark
      shadowDark: COLORS.shadowDark,
    };
  }
  
  // Return light theme using existing COLORS directly
  return {
    primary: COLORS.primary,
    secondary: COLORS.secondary,
    white: COLORS.white,
    black: COLORS.black,
    gray: COLORS.gray,
    lightGray: COLORS.lightGray,
    darkGray: COLORS.darkGray,
    mediumGray: COLORS.mediumGray,
    mediumLightGray: COLORS.mediumLightGray,
    borderGray: COLORS.borderGray,
    toggleGray: COLORS.toggleGray,
    warningLight: COLORS.warningLight,
    warningBorder: COLORS.warningBorder,
    warningText: COLORS.warningText,
    warningTextSecondary: COLORS.warningTextSecondary,
    error: COLORS.error,
    errorLight: COLORS.errorLight,
    errorBorder: COLORS.errorBorder,
    errorText: COLORS.errorText,
    backgroundLight: COLORS.backgroundLight,
    yellowLight: COLORS.yellowLight,
    shadowDark: COLORS.shadowDark,
    textPrimary: COLORS.textPrimary,
    textFull: COLORS.textFull,
    borderLight: COLORS.borderLight,
  };
};

interface ThemeContextType {
  themeMode: ThemeMode;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  colors: ThemeColors;
  spacing: typeof SPACING;
  typography: typeof TYPOGRAPHY;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'app_theme_mode';

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');

  useEffect(() => {
    const loadSavedTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
          setThemeMode(savedTheme);
        }
      } catch (error) {
        console.error('[ThemeContext] Failed to load theme from storage:', error);
      }
    };
    loadSavedTheme();
  }, []);

  const handleSetThemeMode = async (mode: ThemeMode) => {
    try {
      setThemeMode(mode);
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (error) {
      console.error('[ThemeContext] Failed to save theme to storage:', error);
    }
  };

  // Use built-in React Native hook for system theme detection
  const systemColorScheme = useColorScheme();
  const isSystemDark = systemColorScheme === 'dark';
  
  const isDark = themeMode === 'dark' || (themeMode === 'system' && isSystemDark);

  // Memoize colors to prevent unnecessary re-computations
  const colors = useMemo(() => createThemeColors(isDark), [isDark]);

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo((): ThemeContextType => ({
    themeMode,
    isDark,
    setThemeMode: handleSetThemeMode,
    colors,
    spacing: SPACING,
    typography: TYPOGRAPHY,
  }), [themeMode, isDark, colors]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
