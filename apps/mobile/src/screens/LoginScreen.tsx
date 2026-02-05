import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../constants/theme';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharkParkLogo = require('../assets/images/SharkParkV4.webp') as ImageSourcePropType;

interface LoginScreenProps {
  onEmailSubmit: (email: string) => void;
}

export function LoginScreen({ onEmailSubmit }: LoginScreenProps) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const validateEmail = (email: string) => {
    const csulbEmailRegex = /^[a-zA-Z0-9._%+-]+@(csulb\.edu|student\.csulb\.edu)$/;
    return csulbEmailRegex.test(email.toLowerCase());
  };

  const handleSendVerification = async () => {
    // Clear any previous error
    setErrorMessage('');

    if (!email.trim()) {
      setErrorMessage('Please enter your CSULB email address');
      return;
    }

    if (!validateEmail(email)) {
      setErrorMessage('Please use a valid CSULB email address (@csulb.edu or @student.csulb.edu)');
      return;
    }

    setIsLoading(true);
    try {
      // TODO: Implement email verification API call
      // Sending verification email
      
      // Simulate API call
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
      
      // Navigate to verification screen
      onEmailSubmit(email);
    } catch {
      setErrorMessage('Failed to send verification email. Please try again.');
    } finally {
      setIsLoading(false);
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

        {/* Email Input Section */}
        <View style={styles.inputSection}>
          <TextInput
            style={[
              styles.emailInput,
              {
                backgroundColor: colors.white,
                borderColor: errorMessage ? colors.error : colors.borderGray,
                color: colors.textPrimary,
              }
            ]}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              // Clear error when user starts typing
              if (errorMessage) setErrorMessage('');
            }}
            placeholder="your.email@csulb.edu"
            placeholderTextColor={colors.mediumGray}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            editable={!isLoading}
          />

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
            onPress={handleSendVerification}
            disabled={isLoading}
          >
            <Text style={[styles.sendButtonText, { color: colors.white }]}>
              {isLoading ? 'Sending...' : 'Send Verification'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Helper Text */}
        <View style={styles.helpSection}>
          <Text style={[styles.helpText, { color: colors.mediumGray }]}>
            Only CSULB email addresses are accepted
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
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },

  // Help Section
  helpSection: {
    alignItems: 'center',
  },
  helpText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    textAlign: 'center',
  },
});
