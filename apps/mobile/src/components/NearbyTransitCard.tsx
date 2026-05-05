import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from './CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import type { ThemeColors } from '../context/ThemeContext';
import type { NearbyStopWithArrivals } from '../hooks/useNearbyStopETAs';
import { groupArrivals, formatEtas } from '../utils/transitProximity';

interface NearbyTransitCardProps {
  nearbyStops: NearbyStopWithArrivals[];
  colors: ThemeColors;
}

export const NearbyTransitCard: React.FC<NearbyTransitCardProps> = ({ nearbyStops, colors }) => {
  if (nearbyStops.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
      <View style={styles.header}>
        <Icon name="bus" size={TYPOGRAPHY.fontSize.lg} color={colors.textPrimary} accessible={false} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Nearby Shuttle Stops</Text>
      </View>

      {nearbyStops.map(({ stop, arrivals, isLoading }) => (
        <View key={stop.id}>
          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

          <View style={styles.stopRow}>
            <Icon
              name="git-commit-outline"
              size={16}
              color={colors.darkGray}
              style={{ transform: [{ rotate: '90deg' }] }}
              accessible={false}
            />
            <Text style={[styles.stopName, { color: colors.textPrimary }]}>{stop.name}</Text>
          </View>

          {isLoading ? (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.spinner}
              accessible={true}
              accessibilityLabel="Loading arrival times"
            />
          ) : arrivals.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.darkGray }]}>     No upcoming arrivals</Text>
          ) : (
            groupArrivals(arrivals).map((arrival) => (
              <View
                key={arrival.routeId}
                style={styles.arrivalRow}
                accessible={true}
                accessibilityLabel={`Route ${arrival.routeName}. ${formatEtas(arrival.etas)}.`}
              >
                <View style={styles.routeInfo}>
                  <View style={[styles.badge, { backgroundColor: arrival.color }]} accessible={false}>
                    <Text style={styles.badgeText}>{arrival.abbreviation}</Text>
                  </View>
                  <Text style={[styles.routeName, { color: colors.textPrimary }]} accessible={false}>
                    {arrival.routeName}
                  </Text>
                </View>
                <Text style={[styles.etaText, { color: colors.textPrimary }]} accessible={false}>
                  {formatEtas(arrival.etas)}
                </Text>
              </View>
            ))
          )}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: SPACING.lg,
    padding: SPACING.lg,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    ...SHADOWS.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  divider: {
    height: 1,
    marginVertical: SPACING.md,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  stopName: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  spinner: {
    alignSelf: 'flex-start',
    marginBottom: SPACING.sm,
  },
  emptyText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontStyle: 'italic',
    marginBottom: SPACING.sm,
  },
  arrivalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  routeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: 'bold',
  },
  routeName: {
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  etaText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: 'bold',
  },
});
