import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from './CustomText';
import { useTheme } from '../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../constants/theme';

/**
 * LockedOccupancyBadge
 *
 * A "redacted" replacement for the live occupancy badge shown to non-
 * contributors. Instead of a literal "Locked" wordmark, we render a
 * placeholder percentage with reduced opacity and wide letter-spacing
 * (a no-native-deps approximation of a frosted/blurred glyph) plus a
 * lock chip overlay so the locked state still reads at a glance.
 *
 * Two size presets:
 *   - "lg" matches the hero badge on ShortTermForecastScreen
 *   - "sm" matches the small inline pct badge on the favorites list
 *
 * No native blur dependency is added \u2014 this stays pure RN so it works in
 * both the iOS and Android builds without a native rebuild.
 */
type Size = 'sm' | 'lg';

interface Props {
  size?: Size;
  style?: StyleProp<ViewStyle>;
  /**
   * Optional accessibility label override. Defaults to a sensible
   * "live occupancy locked" copy that mirrors the existing taglines.
   */
  accessibilityLabel?: string;
}

export const LockedOccupancyBadge: React.FC<Props> = ({
  size = 'lg',
  style,
  accessibilityLabel = 'Live occupancy locked',
}) => {
  const { colors } = useTheme();
  const isLg = size === 'lg';

  const containerStyle: ViewStyle = {
    backgroundColor: colors.neutralPin,
    paddingHorizontal: isLg ? SPACING.md : SPACING.sm,
    paddingVertical: isLg ? SPACING.md : SPACING.xs,
    borderRadius: isLg ? SPACING.sm : SPACING.xs,
    minWidth: isLg ? TYPOGRAPHY.fontSize.xl * 5 : 64,
    alignSelf: isLg ? 'center' : 'auto',
  };

  const fontSize = isLg ? TYPOGRAPHY.fontSize.xl : TYPOGRAPHY.fontSize.md;
  const iconSize = isLg ? 16 : 12;

  return (
    <View
      style={[styles.container, containerStyle, style]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {/* Faux percentage \u2014 wide letter-spacing + low opacity gives a
          smeared/redacted feel without needing a native blur view. */}
      <Text
        style={[
          styles.placeholder,
          {
            fontSize,
            color: colors.white,
            letterSpacing: isLg ? 6 : 4,
          },
        ]}
        accessible={false}
      >
        ••%
      </Text>
      <View style={styles.iconWrap}>
        <Icon name="lock-closed" size={iconSize} color={colors.white} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  placeholder: {
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textAlign: 'center',
    opacity: 0.45,
  },
  iconWrap: {
    marginLeft: SPACING.sm,
    opacity: 0.95,
  },
});

export default LockedOccupancyBadge;
