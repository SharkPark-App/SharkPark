import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, Linking, useWindowDimensions, View } from 'react-native';
import { Text } from './CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import type { Event } from '../types/ui';
import type { ViewabilityConfig, ViewToken } from 'react-native';

interface EventBannerProps {
  events: Event[];
}

const HORIZONTAL_PADDING = SPACING.lg;

const VIEWABILITY_CONFIG: ViewabilityConfig = {
  itemVisiblePercentThreshold: 50,
};

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
              event.date.toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' }),
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
              <Text style={styles.name}>{event.name}</Text>
              <Text style={styles.details}>
                {event.date.toLocaleTimeString('default', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}{' '}
                • {event.location}
              </Text>
              {event.description && (
                <Text style={styles.description} numberOfLines={2}>
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
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    ...SHADOWS.cardSubtle,
  },
  icon: {
    marginTop: 2,
    marginRight: 5,
  },
  content: {
    flex: 1,
    paddingRight: SPACING.md,
  },
  name: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: colors.warningText,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  details: {
    fontSize: TYPOGRAPHY.fontSize.xxs2,
    color: colors.warningTextSecondary,
  },
  description: {
    fontSize: TYPOGRAPHY.fontSize.xxs2,
    color: colors.warningTextSecondary,
    marginTop: 2,
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
