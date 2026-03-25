import React from 'react';
import { View, Image, StyleSheet, ImageSourcePropType, TouchableOpacity } from 'react-native';
import { Text } from '../CustomText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, TYPOGRAPHY, SPACING } from '../../constants/theme';

interface HeaderProps {
  logo?: ImageSourcePropType; // Image source - can be require() or URI
  title?: string; // Optional title text to display instead of logo
  onBack?: () => void; // Optional back navigation function
  rightAction?: React.ReactNode; // Optional right-side action (e.g. favorite button)
}

const Header: React.FC<HeaderProps> = React.memo(
  ({ logo, title, onBack, rightAction }) => {
    const insets = useSafeAreaInsets();

    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: COLORS.primary }]}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Icon
              name="arrow-back-circle-outline"
              size={32}
              color={COLORS.black}
            />
          </TouchableOpacity>
        )}

        <View style={styles.centerContent}>
          {title ? (
          <Text style={[styles.titleText, { color: COLORS.textPrimary, paddingLeft: onBack ? 0 : SPACING.xxxl }]}>
              {title}
            </Text>
          ) : logo ? (
            <Image source={logo} style={styles.logo} resizeMode="contain" />
          ) : (
            <Text style={[styles.placeholderText, { color: COLORS.white }]}>
              🦈 SharkPark - Add logo.png to src/assets/images/
            </Text>
          )}
        </View>

        {/* Right action or placeholder to balance the back button */}
        {rightAction ?? (onBack && <View style={styles.placeholder} />)}
      </View>
    );
});

Header.displayName = 'Header';

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  },
  placeholderText: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    textAlign: 'center',
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  placeholder: {
    width: 44, // Match back button width for balance
    height: 44, // Match back button height for balance
  },
});

export default Header;
