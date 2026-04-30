import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { Text } from '../components/CustomText';
import { useTheme } from '../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharkParkLogo = require('../assets/images/SharkParkV4.webp') as ImageSourcePropType;

export const LoginScreen = () => {
  const { colors } = useTheme();
  const [errorMessage, setErrorMessage] = useState('');
  const { login, isLoading, continueAsGuest } = useAuth();

    const handleLogin = async () => {
      // clear any current error messages
      setErrorMessage('');

      try {
        await login();
      } catch {
        setErrorMessage('Failed to login. Please ensure you are using a CSULB account.');
      }
    };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.lightGray }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        {/* SharkPark Logo */}
        <View style={styles.logoContainer}>
          <Image
            source={sharkParkLogo}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        {/* Microsoft SSO Section */}
        <View style={styles.inputSection}>

          {/* Error Message */}
          {errorMessage ? (
            <Text style={[styles.errorText, { color: colors.error }]}>
              {errorMessage}
            </Text>
          ) : null}

          <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor: colors.primary,
                  opacity: isLoading ? 0.6 : 1,
                }
              ]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              <Text style={[styles.sendButtonText, { color: colors.white }]}>
                {isLoading ? 'Authenticating...' : 'Login with CSULB SSO'}
              </Text>
            </TouchableOpacity>
        </View>

        {/* Helper Text */}
        <View style={styles.helpSection}>
          <Text style={[styles.helpText, { color: colors.mediumGray }]}>
            Only CSULB email addresses are accepted
          </Text>
        </View>

        {/* Guest access */}
        <View style={styles.guestSection}>
          <TouchableOpacity
            style={styles.guestButton}
            onPress={continueAsGuest}
            accessibilityRole="button"
            accessibilityLabel="Continue without account"
          >
            <Text style={[styles.guestButtonText, { color: colors.mediumGray }]}>
              Continue without account
            </Text>
          </TouchableOpacity>
          <Text style={[styles.guestSubText, { color: colors.mediumGray }]}>
            Browse the map — sign in to report and save favorites
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxxl,
  },

  // Logo Section
  logoContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xxxl * 2, // 64px spacing
  },
  logoImage: {
    width: 200,
    height: 120,
  },

  // Input Section
  inputSection: {
    marginBottom: SPACING.xxxl,
  },
  emailInput: {
    borderWidth: 1,
    borderRadius: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.lg,
    fontSize: TYPOGRAPHY.fontSize.lg,
    marginBottom: SPACING.lg,
  },
  errorText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginBottom: SPACING.md,
    marginTop: -SPACING.md, // Negative margin to reduce space after input
  },
  sendButton: {
    paddingVertical: SPACING.lg,
    borderRadius: SPACING.md,
    alignItems: 'center',
  },
  sendButtonText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },

  // Help Section
  helpSection: {
    alignItems: 'center',
  },
  helpText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    textAlign: 'center',
  },

  // Guest Section
  guestSection: {
    alignItems: 'center',
    marginTop: SPACING.xxxl,
  },
  guestButton: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  guestButtonText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    textDecorationLine: 'underline',
  },
  guestSubText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
});