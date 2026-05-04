import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, Linking, useWindowDimensions, View } from 'react-native';
import { Text } from './CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import type { Event } from '../types/ui';
import type { ViewabilityConfig, ViewToken } from 'react-native';
import { formatTimeRange } from '../utils/formatTime';

interface EventBannerProps {
  events: Event[];
}

const HORIZONTAL_PADDING = SPACING.lg;

const VIEWABILITY_CONFIG: ViewabilityConfig = {
  itemVisiblePercentThreshold: 50,
};

/**
 * Build a single accessibility label for the LIVE/FINAL row so VoiceOver
 * announces "Live, score 16 to 4" rather than reading the pill and the
 * digits as separate, ambiguous tokens.
 */
function sportsAccessibilityLabel(event: Event): string {
  const status = event.status === 'LIVE' ? 'Live' : 'Final';
  const home = event.homeScore;
  const away = event.awayScore;
  if (home == null && away == null) return status;
  const score = `score ${home ?? 'unknown'} to ${away ?? 'unknown'}`;
  if (event.status === 'FINAL' && event.resultStatus) {
    const result = event.resultStatus === 'W' ? 'win' : event.resultStatus === 'L' ? 'loss' : 'tie';
    return `${status}, ${score}, ${result}`;
  }
  return `${status}, ${score}`;
}

export function EventBanner({ events }: EventBannerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - HORIZONTAL_PADDING * 2;

  const [currentIndex, setCurrentIndex] = useState(0);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const viewabilityConfigCallbackPairs = useRef([
    { viewabilityConfig: VIEWABILITY_CONFIG, onViewableItemsChanged },
  ]);

  if (events.length === 0) return null;

  return (
    <View style={styles.outer}>
      <FlatList
        data={events}
        keyExtractor={item => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs.current}
        renderItem={({ item: event }) => (
          <TouchableOpacity
            testID="event-card"
            style={[styles.card, { width: cardWidth }]}
            accessible={true}
            accessibilityRole="link"
            accessibilityLabel={[
              event.name,
              formatTimeRange(event.date, event.endDate),
              event.location,
              event.description,
            ].filter(Boolean).join(', ')}
            accessibilityHint={event.url ? 'Opens event details in browser' : undefined}
            onPress={() => { if (event.url) Linking.openURL(event.url); }}
            disabled={!event.url}
          >
            <View style={styles.icon} accessible={false} importantForAccessibility="no-hide-descendants">
              <Icon
                name="calendar-outline"
                size={TYPOGRAPHY.fontSize.xl}
                color={colors.warningText}
              />
            </View>
            <View style={styles.content}>
              <Text style={styles.name} numberOfLines={2}>
                {event.name}
              </Text>
              {(event.status === 'LIVE' || event.status === 'FINAL') && (
                <View style={styles.sportsRow} accessible={true} accessibilityLabel={sportsAccessibilityLabel(event)}>
                  <View
                    style={[
                      styles.statusPill,
                      event.status === 'LIVE' ? styles.statusPillLive : styles.statusPillFinal,
                    ]}
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Text style={styles.statusPillText}>
                      {event.status === 'LIVE' ? 'LIVE' : 'FINAL'}
                    </Text>
                  </View>
                  {(event.homeScore != null || event.awayScore != null) && (
                    <Text style={styles.scoreText} importantForAccessibility="no-hide-descendants">
                      {`${event.homeScore ?? '–'}–${event.awayScore ?? '–'}`}
                      {event.status === 'FINAL' && event.resultStatus
                        ? ` (${event.resultStatus})`
                        : ''}
                    </Text>
                  )}
                </View>
              )}
              <View style={styles.metaRow} accessible={false} importantForAccessibility="no-hide-descendants">
                <Icon
                  name="time-outline"
                  size={TYPOGRAPHY.fontSize.sm}
                  color={colors.warningTextSecondary}
                  style={styles.metaIcon}
                />
                <Text style={styles.metaText}>
                  {formatTimeRange(event.date, event.endDate)}
                </Text>
              </View>
              <View style={styles.metaRow} accessible={false} importantForAccessibility="no-hide-descendants">
                <Icon
                  name="location-outline"
                  size={TYPOGRAPHY.fontSize.sm}
                  color={colors.warningTextSecondary}
                  style={styles.metaIcon}
                />
                <Text style={styles.metaText} numberOfLines={2} ellipsizeMode="tail">
                  {event.location}
                </Text>
              </View>
              {event.description && (
                <Text style={styles.description} numberOfLines={2} ellipsizeMode="tail">
                  {event.description}
                </Text>
              )}
            </View>
            {event.url && (
              <View style={styles.chevron} accessible={false} importantForAccessibility="no-hide-descendants">
                <Icon name="chevron-forward" size={TYPOGRAPHY.fontSize.md} color={colors.warningTextSecondary} />
              </View>
            )}
          </TouchableOpacity>
        )}
      />
      {events.length > 1 && (
        <View style={styles.dots}>
          {events.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === currentIndex ? styles.dotActive : styles.dotInactive]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  outer: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  card: {
    backgroundColor: colors.warningLight,
    borderLeftWidth: 4,
    borderLeftColor: colors.warningBorder,
    borderRadius: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACING.md,
    ...SHADOWS.cardSubtle,
  },
  icon: {
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  name: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: colors.warningText,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  metaIcon: {
    marginRight: SPACING.xs,
  },
  metaText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: colors.warningTextSecondary,
  },
  description: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: colors.warningTextSecondary,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },
  sportsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  statusPill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: SPACING.xs,
  },
  statusPillLive: {
    backgroundColor: colors.error,
  },
  statusPillFinal: {
    backgroundColor: colors.warningBorder,
  },
  statusPillText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    color: '#ffffff',
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    letterSpacing: 0.5,
  },
  scoreText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: colors.warningText,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  chevron: {
    alignSelf: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingTop: SPACING.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    backgroundColor: colors.warningText,
  },
  dotInactive: {
    backgroundColor: colors.warningBorder,
  },
});
