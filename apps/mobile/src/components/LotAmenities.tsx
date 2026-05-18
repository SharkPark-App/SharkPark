import React, { useMemo } from 'react';
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
import { haversineDistance, formatDistance } from '../utils/geoHelpers';
import { MapSelectModal } from './Modals/MapSelectModal';

interface LotAmenitiesProps {
  lot: ParkingLotResponse;
}

/* ─── helpers ─── */

/**
 * Severity → color/icon palette for the Advisories card. Keep this in sync
 * with the AdvisorySeverity enum on the backend (lot-advisory-extractor.ts).
 *
 * Returns a theme-aware palette: light mode uses pastel chip backgrounds
 * with deep accessible foregrounds; dark mode uses low-luminance translucent
 * tints with brighter foregrounds so the icon + title stay readable on the
 * dark card surface without the harsh "white pastel on near-black" look.
 */
function getAdvisoryPalette(
  isDark: boolean,
): Record<'INFO' | 'ADVISORY' | 'CLOSURE', { bg: string; fg: string; icon: string }> {
  if (isDark) {
    return {
      CLOSURE:  { bg: 'rgba(248, 113, 113, 0.18)', fg: '#fca5a5', icon: 'close-circle-outline' },
      ADVISORY: { bg: 'rgba(251, 146, 60, 0.18)',  fg: '#fdba74', icon: 'warning-outline' },
      INFO:     { bg: 'rgba(96, 165, 250, 0.18)',  fg: '#93c5fd', icon: 'information-circle-outline' },
    };
  }
  return {
    CLOSURE:  { bg: '#fee2e2', fg: '#b91c1c', icon: 'close-circle-outline' },
    ADVISORY: { bg: '#ffedd5', fg: '#c2410c', icon: 'warning-outline' },
    INFO:     { bg: '#dbeafe', fg: '#1d4ed8', icon: 'information-circle-outline' },
  };
}

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
  lotLat,
  lotLng,
}: {
  buildings: ParkingLotResponse['buildings'];
  lotLat: number;
  lotLng: number;
}) {
  const { colors } = useTheme();

  // When a user taps a building pill we hand off to the user's preferred
  // maps app via MapSelectModal — same UX as the lot navigation button.
  const [navTarget, setNavTarget] = React.useState<
    { name: string; lat: number; lng: number } | null
  >(null);

  // Bucket by category once. Each entry carries its name + pre-computed
  // straight-line distance from the lot's centerpoint (haversine, metres)
  // and the building's coordinates so the pill can launch turn-by-turn
  // directions. Distance formatting to mi/km happens at render time so it
  // honours the device's locale via formatDistance().
  const grouped = React.useMemo(() => {
    const map = new Map<
      BuildingCategory,
      Array<{ name: string; distanceM: number; lat: number; lng: number }>
    >();
    for (const b of buildings) {
      const distanceM = haversineDistance(lotLat, lotLng, b.center_lat, b.center_lng);
      const list = map.get(b.category) ?? [];
      list.push({ name: b.name, distanceM, lat: b.center_lat, lng: b.center_lng });
      map.set(b.category, list);
    }
    // Sort nearest-first within each category so the most useful buildings
    // surface at the top of each group.
    for (const list of map.values()) {
      list.sort((a, b) => a.distanceM - b.distanceM);
    }
    return map;
  }, [buildings, lotLat, lotLng]);

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
            const entries = grouped.get(key);
            if (!entries || entries.length === 0) return null;
            return (
              <View key={key} style={buildingStyles.group}>
                <View style={buildingStyles.groupHeader}>
                  <Icon name={icon} size={14} color={colors.gray} />
                  <Text style={[buildingStyles.groupLabel, { color: colors.gray }]}>
                    {label}
                  </Text>
                  <Text style={[buildingStyles.groupCount, { color: colors.gray }]}>
                    {entries.length}
                  </Text>
                </View>
                <View style={buildingStyles.pillRow}>
                  {entries.map(({ name, distanceM, lat, lng }) => (
                    <Pressable
                      key={name}
                      onPress={() => setNavTarget({ name, lat, lng })}
                      style={({ pressed }) => [
                        buildingStyles.pill,
                        {
                          backgroundColor: colors.lightGray,
                          borderColor: colors.borderGray,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Navigate to ${name}, ${formatDistance(distanceM)} from the lot`}
                    >
                      <Text
                        style={[buildingStyles.pillText, { color: colors.textPrimary }]}
                        numberOfLines={1}
                      >
                        {name}
                        <Text style={[buildingStyles.pillDistance, { color: colors.gray }]}>
                          {'  · '}{formatDistance(distanceM)}
                        </Text>
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}

      <MapSelectModal
        isVisible={navTarget !== null}
        onClose={() => setNavTarget(null)}
        lat={navTarget?.lat ?? 0}
        lon={navTarget?.lng ?? 0}
        title={navTarget?.name ?? ''}
      />
    </View>
  );
}

export function LotAmenities({ lot }: LotAmenitiesProps) {
  const { colors, isDark } = useTheme();
  const advisoryPalette = useMemo(() => getAdvisoryPalette(isDark), [isDark]);

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
          {lot.advisories.map((advisory, idx) => {
            const palette = advisoryPalette[advisory.severity];
            const isLast = idx === lot.advisories.length - 1;
            return (
              <View
                key={advisory.id}
                style={[
                  advisoryStyles.item,
                  !isLast && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.borderGray,
                  },
                ]}
                accessibilityRole="alert"
                accessibilityLabel={`${advisory.title}${
                  advisory.description ? `. ${advisory.description}` : ''
                }`}
              >
                <View style={[advisoryStyles.iconChip, { backgroundColor: palette.bg }]}>
                  <Icon name={palette.icon} size={20} color={palette.fg} />
                </View>
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
          <NearbyBuildings
            buildings={lot.buildings}
            lotLat={lot.center_lat}
            lotLng={lot.center_lng}
          />
        )}
      </View>

      {/* ── Permits ── */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Permits
        </Text>

        <AmenityRow
          icon="pricetag-outline"
          label="Permits"
          value={lot.permit_types.join(', ')}
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

        {/*
         * All special-space rows always render so the section's footprint is
         * stable lot-to-lot. Icon turns green when at least one space exists
         * (single accent for "amenity present"), grey otherwise — same
         * pattern already used for EV/Low-emission, now applied uniformly.
         */}
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
          value={
            lot.accessible_spaces > 0
              ? `${lot.accessible_spaces} space${lot.accessible_spaces !== 1 ? 's' : ''}`
              : 'None'
          }
          color={lot.accessible_spaces > 0 ? '#16a34a' : undefined}
        />
        <AmenityRow
          icon="bicycle-outline"
          label="Motorcycle"
          value={
            lot.motorcycle_spaces > 0
              ? `${lot.motorcycle_spaces} space${lot.motorcycle_spaces !== 1 ? 's' : ''}`
              : 'None'
          }
          color={lot.motorcycle_spaces > 0 ? '#16a34a' : undefined}
        />
        <AmenityRow
          icon="time-outline"
          label="Short-term"
          value={
            lot.short_term_parking_spaces > 0
              ? `${lot.short_term_parking_spaces} space${lot.short_term_parking_spaces !== 1 ? 's' : ''}`
              : 'None'
          }
          color={lot.short_term_parking_spaces > 0 ? '#16a34a' : undefined}
        />
        <AmenityRow
          icon="leaf-outline"
          label="Low-emission"
          value={
            lot.low_emission_spaces > 0
              ? `${lot.low_emission_spaces} space${lot.low_emission_spaces !== 1 ? 's' : ''}`
              : 'None'
          }
          color={lot.low_emission_spaces > 0 ? '#16a34a' : undefined}
        />
        <AmenityRow
          icon="card-outline"
          label="Pay stations"
          value={lot.pay_stations > 0 ? `${lot.pay_stations} on-site` : 'None'}
          color={lot.pay_stations > 0 ? '#16a34a' : undefined}
        />
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
          {/*
           * Covered/Open Air and Paved/Unpaved are mutually exclusive
           * states of a single attribute (a lot is exactly one of each),
           * so we render a single chip whose label/icon reflects the
           * actual state \u2014 unlike the independent safety amenities
           * above, where green-vs-grey reads "present vs absent".
           */}
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
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    lineHeight: 22,
  },
  description: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 19,
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
  pillDistance: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
});
