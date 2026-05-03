import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from './CustomText';
import { useTheme } from '../context/ThemeContext';
import { SPACING, TYPOGRAPHY, SHADOWS } from '../constants/theme';

/**
 * UnlockCTAButton
 *
 * Pill-shaped primary CTA used for the soft-ask "unlock" affordances on
 * the lot detail / forecast screens. We deliberately route to the
 * dedicated permission screen (LocationPermission) rather than triggering
 * the system prompt directly, per Apple's permission UX guidance and
 * App Review 5.1.1.
 *
 * Visual treatment is consistent across both occupancy and forecast
 * unlock surfaces so the user learns the affordance once.
 */
type Variant = 'solid' | 'subtle';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export const UnlockCTAButton: React.FC<Props> = ({
  label,
  onPress,
  variant = 'solid',
  accessibilityLabel,
  style,
}) => {
  const { colors } = useTheme();
  const isSolid = variant === 'solid';

  // Subtle uses a tinted-on-white look to sit nicely on top of inline
  // cards (e.g. the locked forecast card already has a white surface).
  const bg = isSolid ? colors.primary : `${colors.primary}1A`; // 1A == ~10% alpha
  const fg = isSolid ? colors.white : colors.primary;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.button,
        { backgroundColor: bg },
        isSolid && SHADOWS.fab,
        style,
      ]}
    >
      <View style={styles.iconLeft}>
        <Icon name="lock-open" size={16} color={fg} />
      </View>
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
      <View style={styles.iconRight}>
        <Icon name="chevron-forward" size={16} color={fg} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: 999,
    minHeight: 44, // iOS HIG minimum touch target
  },
  iconLeft: {
    marginRight: SPACING.sm,
  },
  iconRight: {
    marginLeft: SPACING.sm,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    letterSpacing: 0.2,
  },
});

export default UnlockCTAButton;
