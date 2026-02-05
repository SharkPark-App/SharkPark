import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../constants/theme';

interface VerificationScreenProps {
  email: string;
  onBack: () => void;
  onVerificationSuccess: () => void;
}

export function VerificationScreen({ email, onBack, onVerificationSuccess }: VerificationScreenProps) {
  const { colors } = useTheme();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const handleCodeChange = (text: string, index: number) => {
    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);

    // Auto-advance to next input
    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-verify when all digits are entered
    if (newCode.every(digit => digit !== '') && text) {
      handleVerifyCode(newCode.join(''));
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyCode = async (verificationCode?: string) => {
    const codeToVerify = verificationCode || code.join('');
    
    if (codeToVerify.length !== 6) {
      Alert.alert('Error', 'Please enter the complete 6-digit code');
      return;
    }

    setIsLoading(true);
    try {
      // TODO: Implement verification API call
      
      // Simulate API call
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));
      
      // For demo purposes, accept any 6-digit code
      onVerificationSuccess();
    } catch {
      Alert.alert('Error', 'Invalid verification code. Please try again.');
      // Clear the code inputs
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0) return;

    try {
      // TODO: Implement resend API call
      
      // Simulate API call
      await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
      
      Alert.alert('Success', 'Verification code resent!');
      
      // Start 60-second timer
      setResendTimer(60);
      const timer = setInterval(() => {
        setResendTimer(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      Alert.alert('Error', 'Failed to resend code. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.lightGray }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.emailIcon}>✉️</Text>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Check Email</Text>
          <Text style={[styles.subtitle, { color: colors.mediumGray }]}>
            We sent a 6-digit code to
          </Text>
          <Text style={[styles.emailText, { color: colors.textPrimary }]}>{email}</Text>
        </View>

        {/* Code Input Section */}
        <View style={styles.codeSection}>
          <View style={styles.codeInputContainer}>
            {code.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => { inputRefs.current[index] = ref; }}
                style={[
                  styles.codeInput,
                  {
                    backgroundColor: colors.white,
                    borderColor: digit ? colors.primary : colors.borderGray,
                    color: colors.textPrimary,
                  }
                ]}
                value={digit}
                onChangeText={(text) => handleCodeChange(text.slice(-1), index)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, index)}
                keyboardType="number-pad"
                maxLength={1}
                autoFocus={index === 0}
                editable={!isLoading}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[
              styles.verifyButton,
              { 
                backgroundColor: colors.primary,
                opacity: isLoading ? 0.6 : 1,
              }
            ]}
            onPress={() => handleVerifyCode()}
            disabled={isLoading}
          >
            <Text style={[styles.verifyButtonText, { color: colors.white }]}>
              {isLoading ? 'Verifying...' : 'Verify Code'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Actions Section */}
        <View style={styles.actionsSection}>
          <TouchableOpacity
            onPress={handleResendCode}
            disabled={resendTimer > 0}
            style={styles.resendButton}
          >
            <Text style={[
              styles.resendText,
              { color: resendTimer > 0 ? colors.mediumGray : colors.primary }
            ]}>
              {resendTimer > 0 ? `Resend in ${resendTimer}s` : "Didn't get it? Resend Code"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Text style={[styles.backText, { color: colors.mediumGray }]}>
              ← Back to Email
            </Text>
          </TouchableOpacity>
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

  // Header Section
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xxxl * 2,
  },
  emailIcon: {
    fontSize: 60,
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxxl,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    marginBottom: SPACING.sm,
  },
  subtitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    marginBottom: SPACING.xs,
  },
  emailText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
  },

  // Code Input Section
  codeSection: {
    marginBottom: SPACING.xxxl,
  },
  codeInputContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  codeInput: {
    width: 45,
    height: 50,
    borderWidth: 2,
    borderRadius: SPACING.sm,
    textAlign: 'center',
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
  verifyButton: {
    paddingVertical: SPACING.lg,
    borderRadius: SPACING.md,
    alignItems: 'center',
  },
  verifyButtonText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },

  // Actions Section
  actionsSection: {
    alignItems: 'center',
    gap: SPACING.lg,
  },
  resendButton: {
    paddingVertical: SPACING.sm,
  },
  resendText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
  },
  backButton: {
    paddingVertical: SPACING.sm,
  },
  backText: {
    fontSize: TYPOGRAPHY.fontSize.md,
  },
});
