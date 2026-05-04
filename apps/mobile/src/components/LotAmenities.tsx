import React from 'react';
import { View, StyleSheet, Pressable, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Text } from './CustomText';
import Icon from 'react-native-vector-icons/Ionicons';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import type { ParkingLotResponse, BuildingCategory } from '../services/api/lots';
import { formatTime } from '../utils/formatTime';

interface LotAmenitiesProps {
  lot: ParkingLotResponse;
}

/* ─── helpers ─── */

/**
 * Severity → color/icon palette for the Advisories card. Keep this in sync
 * with the AdvisorySeverity enum on the backend (lot-advisory-extractor.ts).
 */
const ADVISORY_PALETTE: Record<
  'INFO' | 'ADVISORY' | 'CLOSURE',
  { bg: string; fg: string; icon: string }
> = {
  CLOSURE:  { bg: '#fee2e2', fg: '#b91c1c', icon: 'close-circle-outline' },
  ADVISORY: { bg: '#ffedd5', fg: '#c2410c', icon: 'warning-outline' },
  INFO:     { bg: '#dbeafe', fg: '#1d4ed8', icon: 'information-circle-outline' },
};

/**
 * Format an hours field. Time-of-day strings are rendered through
 * `formatTime`, which honours the device's 12/24-hour preference.
 */
function formatHours(hours: { open: string; close: string } | string): string {
  if (typeof hours === 'string') return hours; // e.g. "CLOSED"
  return `${formatTime(hours.open)} – ${formatTime(hours.close)}`;
}

/**
 * Display order + label for grouped nearby buildings. Categories are rendered
 * in this order; empty groups are skipped (per design — no "Housing: none"
 * section when a lot has no nearby residence halls).
 */
const BUILDING_CATEGORY_GROUPS: ReadonlyArray<{
  key: BuildingCategory;
  label: string;
  icon: string;
}> = [
  { key: 'ACADEMIC',       label: 'Academic',                     icon: 'school-outline' },
  { key: 'ADMINISTRATIVE', label: 'Administrative',               icon: 'briefcase-outline' },
  { key: 'HOUSING',        label: 'Housing & Residence',          icon: 'home-outline' },
  { key: 'RETAIL',         label: 'Retail Stores',                icon: 'storefront-outline' },
  { key: 'ATHLETIC',       label: 'Athletic & Performance Venues', icon: 'football-outline' },
  { key: 'OUTDOOR',        label: 'Outdoor Spaces',               icon: 'leaf-outline' },
  { key: 'OTHER',          label: 'Other',                        icon: 'ellipsis-horizontal-outline' },
];

/** Collapse the building list by default once it exceeds this many entries. */
const BUILDING_COLLAPSE_THRESHOLD = 8;

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

/**
 * Renders the "Nearby buildings" block grouped by category. Categories with
 * no entries are omitted entirely. Within each category, building names are
 * sorted alphabetically for stable display.
 */
function NearbyBuildings({
  buildings,
}: {
  buildings: ParkingLotResponse['buildings'];
}) {
  const { colors } = useTheme();

  // Bucket by category once.
  const grouped = React.useMemo(() => {
    const map = new Map<BuildingCategory, string[]>();
    for (const b of buildings) {
      const list = map.get(b.category) ?? [];
      list.push(b.name);
      map.set(b.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.localeCompare(b));
    return map;
  }, [buildings]);

  const total = buildings.length;
  const [expanded, setExpanded] = React.useState(
    total > 0 && total <= BUILDING_COLLAPSE_THRESHOLD,
  );

  if (total === 0) return null;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(v => !v);
  };

  return (
    <View style={buildingStyles.wrapper}>
      <Pressable
        onPress={toggle}
        style={buildingStyles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Nearby buildings, ${total} total. ${expanded ? 'Tap to collapse.' : 'Tap to expand.'}`}
      >
        <Icon
          name="business-outline"
          size={18}
          color={colors.gray}
          style={buildingStyles.headerIcon}
        />
        <Text style={[buildingStyles.headerLabel, { color: colors.textPrimary }]}>
          Nearby buildings
        </Text>
        <View style={[buildingStyles.countBadge, { backgroundColor: colors.lightGray }]}>
          <Text style={[buildingStyles.countBadgeText, { color: colors.textPrimary }]}>
            {total}
          </Text>
        </View>
        <Icon
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.gray}
        />
      </Pressable>

      {expanded && (
        <View style={buildingStyles.groups}>
          {BUILDING_CATEGORY_GROUPS.map(({ key, label, icon }) => {
            const names = grouped.get(key);
            if (!names || names.length === 0) return null;
            return (
              <View key={key} style={buildingStyles.group}>
                <View style={buildingStyles.groupHeader}>
                  <Icon name={icon} size={14} color={colors.gray} />
                  <Text style={[buildingStyles.groupLabel, { color: colors.gray }]}>
                    {label}
                  </Text>
                  <Text style={[buildingStyles.groupCount, { color: colors.gray }]}>
                    {names.length}
                  </Text>
                </View>
                <View style={buildingStyles.pillRow}>
                  {names.map(name => (
                    <View
                      key={name}
                      style={[
                        buildingStyles.pill,
                        {
                          backgroundColor: colors.lightGray,
                          borderColor: colors.borderGray,
                        },
                      ]}
                    >
                      <Text
                        style={[buildingStyles.pillText, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {name}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function LotAmenities({ lot }: LotAmenitiesProps) {
  const { colors } = useTheme();

  const weekdayHours = formatHours(lot.hours_weekday);
  const saturdayHours = formatHours(lot.hours_saturday);
  const sundayHours = formatHours(lot.hours_sunday);

  return (
    <View style={styles.container}>
      {/* ── Advisories (only when active) ── */}
      {lot.advisories.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
          <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
            Advisories
          </Text>
          {lot.advisories.map(advisory => {
            const palette = ADVISORY_PALETTE[advisory.severity];
            return (
              <View
                key={advisory.id}
                style={[
                  advisoryStyles.row,
                  { backgroundColor: palette.bg, borderLeftColor: palette.fg },
                ]}
                accessibilityRole="alert"
              >
                <Icon
                  name={palette.icon}
                  size={20}
                  color={palette.fg}
                  style={advisoryStyles.icon}
                />
                <View style={advisoryStyles.body}>
                  <Text style={[advisoryStyles.title, { color: palette.fg }]}>
                    {advisory.title}
                  </Text>
                  {advisory.description ? (
                    <Text style={[advisoryStyles.description, { color: colors.textPrimary }]}>
                      {advisory.description}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}

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
        {lot.buildings.length > 0 && (
          <NearbyBuildings buildings={lot.buildings} />
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
        {lot.short_term_parking_spaces > 0 && (
          <AmenityRow
            icon="time-outline"
            label="Short-term"
            value={`${lot.short_term_parking_spaces} space${lot.short_term_parking_spaces !== 1 ? 's' : ''}`}
          />
        )}
        {lot.low_emission_spaces > 0 && (
          <AmenityRow
            icon="leaf-outline"
            label="Low-emission"
            value={`${lot.low_emission_spaces} space${lot.low_emission_spaces !== 1 ? 's' : ''}`}
            color="#16a34a"
          />
        )}
        {lot.pay_stations > 0 && (
          <AmenityRow
            icon="card-outline"
            label="Pay stations"
            value={`${lot.pay_stations} on-site`}
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
            icon="sunny-outline"
            label="Solar Canopy"
            available={lot.has_solar_canopy}
          />
          <AmenityChip
            icon="call-outline"
            label="Emergency Phone"
            available={lot.has_emergency_phone}
          />
          <AmenityChip
            icon={lot.is_covered ? 'shield-checkmark-outline' : 'sunny-outline'}
            label={lot.is_covered ? 'Covered Structure' : 'Open Air'}
            available
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

const advisoryStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: SPACING.sm,
    borderLeftWidth: 4,
    marginBottom: SPACING.sm,
  },
  icon: {
    marginRight: SPACING.md,
    marginTop: 2,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: 2,
  },
  description: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 18,
  },
});

const buildingStyles = StyleSheet.create({
  wrapper: {
    paddingVertical: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    width: 24,
    textAlign: 'center',
  },
  headerLabel: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginLeft: SPACING.md,
  },
  countBadge: {
    marginLeft: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: SPACING.md,
    minWidth: 22,
    alignItems: 'center',
  },
  countBadgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  groups: {
    marginTop: SPACING.md,
    marginLeft: 24 + SPACING.md, // align under the icon+label text
    gap: SPACING.md,
  },
  group: {
    gap: SPACING.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  groupLabel: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  groupCount: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  pill: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: '100%',
  },
  pillText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});
