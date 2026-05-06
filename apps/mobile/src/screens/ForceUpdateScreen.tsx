import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
  Image,
} from 'react-native';
import { ImageSourcePropType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../components/CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../assets/images/SharkParkV4.webp') as ImageSourcePropType;

/**
 * App Store / Play Store deep-link constants.
 * Replace the App Store ID once the app is published.
 */
const STORE_URLS = {
  ios: 'https://apps.apple.com/app/sharkpark/id0000000000', // TODO: replace with real App Store ID
  android: 'https://play.google.com/store/apps/details?id=app.sharkpark.mobile',
} as const;

/**
 * Blocking screen shown when the installed app version is below the server-
 * enforced minimum. The user cannot dismiss it — they must update the app.
 */
export const ForceUpdateScreen: React.FC = () => {
  const storeUrl = Platform.OS === 'ios' ? STORE_URLS.ios : STORE_URLS.android;
  const storeLabel = Platform.OS === 'ios' ? 'Update on App Store' : 'Update on Play Store';

  const handleUpdate = () => {
    void Linking.openURL(storeUrl);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.logoContainer}>
          <Image
            source={logo}
            style={styles.logoImage}
            resizeMode="contain"
            accessibilityLabel="SharkPark logo"
            accessibilityRole="image"
          />
        </View>

        <Text style={styles.title} accessibilityRole="header">Update Required</Text>

        <Text style={styles.body}>
          A newer version of SharkPark is required to continue. Please update
          the app to access the latest parking data and features.
        </Text>

        <TouchableOpacity
          style={styles.button}
          onPress={handleUpdate}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={storeLabel}
          accessibilityHint="Opens the store listing to download the latest version"
        >
          <Text style={styles.buttonText}>{storeLabel}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxxl,
    gap: SPACING.xl,
  },
  iconWrapper: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  logoImage: {
    width: 200,
    height: 120,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxxxl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    color: COLORS.gray,
    textAlign: 'center',
    lineHeight: 24,
  },
  button: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xxxl,
    borderRadius: SPACING.md,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.white,
  },
});
