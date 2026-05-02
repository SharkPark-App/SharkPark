import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Text } from './CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import type { Event } from '../types/ui';

interface EventBannerProps {
  events: Event[];
}

export function EventBanner({ events }: EventBannerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => getStyles(colors), [colors]);

  if (events.length === 0) return null;

  return (
    <View style={styles.container}>
      {events.map(event => (
        <TouchableOpacity
          key={event.id}
          testID="event-card"
          style={styles.card}
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
      ))}
    </View>
  );
}

const getStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    padding: SPACING.lg,
    gap: SPACING.md,
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
});
