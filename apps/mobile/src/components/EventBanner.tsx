import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import type { Event } from '../types/ui';

interface EventBannerProps {
  events: Event[];
}

export function EventBanner({ events }: EventBannerProps) {
  if (events.length === 0) return null;

  return (
    <View style={styles.container}>
      {events.map(event => (
        <View
          key={event.id}
          style={styles.card}
          accessible={true}
          accessibilityRole="text"
          accessibilityLabel={[
            event.name,
            event.date.toLocaleTimeString('default', { hour: 'numeric', minute: '2-digit' }),
            event.location,
            event.description,
          ].filter(Boolean).join(', ')}
        >
          <View style={styles.icon} accessible={false} importantForAccessibility="no-hide-descendants">
            <Icon
              name="calendar-outline"
              size={TYPOGRAPHY.fontSize.xl}
              color={COLORS.textPrimary}
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
              <Text style={styles.description}>{event.description}</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  card: {
    backgroundColor: COLORS.warningLight,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warningBorder,
    borderRadius: SPACING.md,
    padding: SPACING.lg,
    flexDirection: 'row',
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
    color: COLORS.warningText,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  details: {
    fontSize: TYPOGRAPHY.fontSize.xxs2,
    color: COLORS.warningTextSecondary,
  },
  description: {
    fontSize: TYPOGRAPHY.fontSize.xxs2,
    color: COLORS.warningTextSecondary,    
  },
});
