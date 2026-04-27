import React, { useMemo } from 'react';
import { View, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../CustomText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { TYPOGRAPHY, SPACING } from '../../constants/theme';
import { useTheme, ThemeColors } from '../../context/ThemeContext';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO_LIGHT = require('../../assets/images/SharkParkV4.webp');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BRAND_LOGO_DARK = require('../../assets/images/SharkParkV4_white.webp');

interface HeaderProps {
  title?: string; // Optional title text to display instead of the brand logo
  onBack?: () => void; // Optional back navigation function
  rightAction?: React.ReactNode; // Optional right-side action (e.g. favorite button)
}

const Header: React.FC<HeaderProps> = React.memo(
  ({ title, onBack, rightAction }) => {
    const insets = useSafeAreaInsets();
    const { colors, isDark } = useTheme();
    const styles = useMemo(() => getStyles(colors), [colors]);
    const brandLogo = isDark ? BRAND_LOGO_DARK : BRAND_LOGO_LIGHT;

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Icon
              name="arrow-back-circle-outline"
              size={32}
              color={colors.black}
              accessible={false}
            />
          </TouchableOpacity>
        )}

        <View style={styles.centerContent}>
          {title ? (
          <Text style={[styles.titleText, !onBack && styles.titleTextStandalone]}>
              {title}
            </Text>
          ) : (
            <Image source={brandLogo} style={styles.logo} resizeMode="contain" accessible={false} importantForAccessibility="no" />
          )}
        </View>

        {/* Right action or placeholder to balance the back button */}
        {rightAction ?? (onBack && <View style={styles.placeholder} />)}
      </View>
    );
});

Header.displayName = 'Header';

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderGray,
  },
  backButton: {
    padding: SPACING.sm,
    width: 44, // Standard touch target size
    height: 44, // Standard touch target size
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100, // Match container height
  },
  logo: {
    height: 90, // Logo-specific dimensions
    width: 170, // Logo-specific dimensions
  },
  titleText: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    alignSelf: 'flex-start',
    color: colors.textPrimary,
  },
  titleTextStandalone: {
    paddingLeft: SPACING.xxxl,
  },
  placeholder: {
    width: 44, // Match back button width for balance
    height: 44, // Match back button height for balance
  },
});

export default Header;
