import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from './CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import type { ParkingLotResponse } from '../services/api/lots';

interface LotAmenitiesProps {
  lot: ParkingLotResponse;
}

/* ─── helpers ─── */

/** Format an hours field into a readable string */
function formatHours(hours: { open: string; close: string } | string): string {
  if (typeof hours === 'string') return hours; // e.g. "CLOSED"
  return `${hours.open} – ${hours.close}`;
}

/** Single icon + label row used throughout the component */
function AmenityRow({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: string | number;
  color?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={rowStyles.row}>
      <Icon
        name={icon}
        size={18}
        color={color ?? colors.gray}
        style={rowStyles.icon}
      />
      <Text style={[rowStyles.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
      <Text style={[rowStyles.value, { color: colors.gray }]}>{value}</Text>
    </View>
  );
}

/** Boolean amenity shown as a small badge / chip */
function AmenityChip({
  icon,
  label,
  available,
}: {
  icon: string;
  label: string;
  available: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        chipStyles.chip,
        {
          backgroundColor: available ? '#ecfdf5' : colors.lightGray,
          borderColor: available ? '#86efac' : colors.borderGray,
        },
      ]}
    >
      <Icon 
      name={icon} 
      size={14} 
      color={available ? '#16a34a' : colors.gray}
       />
      <Text
        style={[
          chipStyles.label,
          { color: available ? '#15803d' : colors.gray },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/* ─── main component ─── */

export function LotAmenities({ lot }: LotAmenitiesProps) {
  const { colors } = useTheme();

  const weekdayHours = formatHours(lot.hours_weekday);
  const saturdayHours = formatHours(lot.hours_saturday);
  const sundayHours = formatHours(lot.hours_sunday);

  return (
    <View style={styles.container}>
      {/* ── Lot Info ── */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Lot Information
        </Text>

        <AmenityRow
          icon="car-outline"
          label="Capacity"
          value={lot.capacity.toLocaleString()}
        />
        <AmenityRow
          icon="layers-outline"
          label="Type"
          value={lot.is_covered ? 'Structure' : 'Surface'}
        />
        {lot.levels != null && lot.levels > 0 && (
          <AmenityRow icon="albums-outline" label="Levels" value={lot.levels} />
        )}
        <AmenityRow
          icon="location-outline"
          label="Location"
          value={lot.location_description}
        />
        {lot.building_proximity.length > 0 && (
          <AmenityRow
            icon="business-outline"
            label="Near"
            value={lot.building_proximity.join(', ')}
          />
        )}
      </View>

      {/* ── Permits & Rates ── */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Permits & Rates
        </Text>

        <AmenityRow
          icon="pricetag-outline"
          label="Permits"
          value={lot.permit_types.join(', ')}
        />
        <AmenityRow
          icon="cash-outline"
          label="Daily Permit"
          value={
            lot.daily_permit_allowed
              ? lot.daily_rate != null && Number.isFinite(Number(lot.daily_rate))
                ? `$${Number(lot.daily_rate).toFixed(2)}`
                : 'Available'
              : 'Not Available'
          }
        />
      </View>

      {/* ── Hours ── */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Hours
        </Text>

        <AmenityRow icon="calendar-outline" label="Weekdays" value={weekdayHours} />
        <AmenityRow icon="calendar-outline" label="Saturday" value={saturdayHours} />
        <AmenityRow icon="calendar-outline" label="Sunday" value={sundayHours} />
      </View>

      {/* ── Spaces ── */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Special Spaces
        </Text>

        <AmenityRow
          icon="flash-outline"
          label="EV Charging"
          value={
            lot.ev_charging_stations > 0
              ? `${lot.ev_charging_stations} station${lot.ev_charging_stations !== 1 ? 's' : ''}`
              : 'None'
          }
          color={lot.ev_charging_stations > 0 ? '#16a34a' : undefined}
        />
        <AmenityRow
          icon="accessibility-outline"
          label="Accessible"
          value={`${lot.accessible_spaces} space${lot.accessible_spaces !== 1 ? 's' : ''}`}
        />
        {lot.motorcycle_spaces > 0 && (
          <AmenityRow
            icon="bicycle-outline"
            label="Motorcycle"
            value={`${lot.motorcycle_spaces} space${lot.motorcycle_spaces !== 1 ? 's' : ''}`}
          />
        )}
      </View>

      {/* ── Safety & Features (chips) ── */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Safety & Features
        </Text>

        <View style={chipStyles.container}>
          <AmenityChip
            icon="bulb-outline"
            label="Lighting"
            available={lot.has_lighting}
          />
          <AmenityChip
            icon="videocam-outline"
            label="Cameras"
            available={lot.has_cameras}
          />
          <AmenityChip
            icon="call-outline"
            label="Emergency Phone"
            available={lot.has_emergency_phone}
          />
          <AmenityChip
            icon="shield-checkmark-outline"
            label={lot.is_covered ? 'Covered' : 'Open Air'}
            available={lot.is_covered}
          />
          <AmenityChip
            icon="trail-sign-outline"
            label={lot.is_paved ? 'Paved' : 'Unpaved'}
            available={lot.is_paved}
          />
        </View>
      </View>
    </View>
  );
}

/* ─── styles ─── */

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxxl * 2, // extra room above FAB buttons
    gap: SPACING.lg,
  },
  card: {
    borderRadius: SPACING.lg,
    padding: SPACING.xl,
    ...SHADOWS.card,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.lg,
  },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACING.md,
  },
  icon: {
    width: 24,
    textAlign: 'center',
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginLeft: SPACING.md,
    flex: 1,
  },
  value: {
    fontSize: TYPOGRAPHY.fontSize.md,
    flexShrink: 1,
    textAlign: 'right',
    maxWidth: '55%' as unknown as number,
  },
});

const chipStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: SPACING.xl,
    borderWidth: 1,
  },
  label: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});
