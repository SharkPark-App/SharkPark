import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from './CustomText';
import { useTheme } from '../context/ThemeContext';
import { SPACING, TYPOGRAPHY, SHADOWS } from '../constants/theme';
import { UnlockCTAButton } from './UnlockCTAButton';

/**
 * LockedForecastCard
 *
 * Replacement for the HourlyChart shown to non-contributors. We render a
 * card that mirrors the hourly chart's visual rhythm — title, faux bars
 * at low opacity (the same "blurred" treatment used by
 * LockedOccupancyBadge) — with a centered "Unlock forecast" CTA. The
 * fake bars give the screen visual weight so the locked state doesn't
 * collapse into an empty stripe of whitespace.
 */
const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_HORIZONTAL_MARGIN = SPACING.lg;
const CARD_INNER_PADDING = SPACING.lg;
const BAR_COUNT = 12;
// Pseudo-random looking but deterministic heights so the placeholder
// reads like real data.
const FAKE_HEIGHTS = [0.45, 0.6, 0.5, 0.7, 0.85, 0.95, 0.8, 0.65, 0.55, 0.7, 0.5, 0.4];

interface Props {
  onUnlockPress: () => void;
}

export const LockedForecastCard: React.FC<Props> = ({ onUnlockPress }) => {
  const { colors } = useTheme();

  const barWidth = useMemo(() => {
    const usable = SCREEN_WIDTH - CARD_HORIZONTAL_MARGIN * 2 - CARD_INNER_PADDING * 2;
    // gap between bars
    const totalGap = (BAR_COUNT - 1) * SPACING.xs;
    return Math.max(8, (usable - totalGap) / BAR_COUNT);
  }, []);

  return (
    <View style={[styles.card, { backgroundColor: colors.white }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        Today's Forecast
      </Text>

      {/* Faux bar chart — opacity + neutral fill keeps it clearly
          non-data while still looking like a chart. */}
      <View style={styles.chartArea}>
        {FAKE_HEIGHTS.map((h, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              {
                width: barWidth,
                height: 110 * h,
                backgroundColor: colors.neutralPin,
              },
            ]}
          />
        ))}
      </View>

      <Text style={[styles.helper, { color: colors.mediumGray }]}>
        Forecasts use the same anonymous occupancy stream that powers live
        data. Contribute to unlock today's chart.
      </Text>

      <UnlockCTAButton
        label="Unlock forecast"
        onPress={onUnlockPress}
        variant="subtle"
        accessibilityLabel="Unlock today's forecast by granting background location"
        style={styles.cta}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: CARD_HORIZONTAL_MARGIN,
    marginTop: SPACING.lg,
    padding: CARD_INNER_PADDING,
    borderRadius: SPACING.lg,
    ...SHADOWS.card,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.md,
  },
  chartArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    opacity: 0.35,
    marginBottom: SPACING.md,
  },
  bar: {
    borderTopLeftRadius: SPACING.xs,
    borderTopRightRadius: SPACING.xs,
  },
  helper: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    textAlign: 'center',
    marginBottom: SPACING.lg,
    lineHeight: 18,
  },
  cta: {
    alignSelf: 'center',
  },
});

export default LockedForecastCard;
