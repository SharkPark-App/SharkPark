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
import { haversineDistance, formatDistance, formatTemperature, usesFahrenheit } from '../utils/geoHelpers';
import { getOccupancyColorGradient, getReadableTextColor } from '../utils/parkingUtils';
import { MapSelectModal } from './Modals/MapSelectModal';
import { useCurrentWeather } from '../hooks/useCurrentWeather';
import { useLocalizationSettings } from '../hooks/useLocalizationSettings';
import type { CurrentWeather } from '../services/api/weather';

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
  trailing,
}: {
  icon: string;
  label: string;
  value: string | number;
  color?: string;
  /** Optional inline element rendered after the value (e.g. a status chip). */
  trailing?: React.ReactNode;
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
      {trailing ? <View style={rowStyles.trailing}>{trailing}</View> : null}
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

/**
 * Maps a free-form `conditions` string (returned by the backend weather
 * service in whatever vocabulary the upstream provider uses) to an Ionicon
 * name + accent color. We keep this list intentionally small: anything we
 * don't recognise falls back to a neutral "partly cloudy" glyph so the card
 * still renders cleanly when the provider returns an unfamiliar label.
 */
function getWeatherIcon(conditions: string): { name: string; color: string } {
  const c = conditions.toLowerCase();
  if (c.includes('thunder') || c.includes('storm')) {
    return { name: 'thunderstorm-outline', color: '#7c3aed' };
  }
  if (c.includes('snow') || c.includes('sleet')) {
    return { name: 'snow-outline', color: '#0ea5e9' };
  }
  if (c.includes('rain') || c.includes('shower') || c.includes('drizzle')) {
    return { name: 'rainy-outline', color: '#2563eb' };
  }
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) {
    return { name: 'cloud-outline', color: '#64748b' };
  }
  if (c.includes('clear') || c.includes('sunny')) {
    return { name: 'sunny-outline', color: '#f59e0b' };
  }
  if (c.includes('cloud') || c.includes('overcast')) {
    return { name: 'partly-sunny-outline', color: '#64748b' };
  }
  return { name: 'partly-sunny-outline', color: '#64748b' };
}

/**
 * Compact current-weather strip at the top of the lot detail screen. We
 * surface it here (rather than as a separate screen) because rain / heat
 * directly affect parking demand and a quick glance saves a context switch
 * out of the app. Renders a subtle placeholder while loading so the layout
 * doesn't pop in once data arrives. Hides only when the request has
 * resolved with no data AND no error — i.e. backend explicitly returned
 * `null` — to avoid a permanent dead row.
 */
function CurrentWeatherCard({
  weather,
  loading,
}: {
  weather: CurrentWeather | null;
  loading: boolean;
}) {
  const { colors } = useTheme();
  if (!weather && !loading) return null;
  if (!weather) {
    return (
      <View
        style={[styles.card, weatherStyles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}
        accessible
        accessibilityRole="summary"
        accessibilityLabel="Loading current weather"
      >
        <View style={[weatherStyles.iconChip, { backgroundColor: colors.lightGray }]}>
          <Icon name="partly-sunny-outline" size={22} color={colors.gray} accessible={false} />
        </View>
        <View style={weatherStyles.body}>
          <Text style={[weatherStyles.conditions, { color: colors.gray }]} numberOfLines={1}>
            Loading current weather…
          </Text>
        </View>
      </View>
    );
  }
  const { name: iconName, color: iconColor } = getWeatherIcon(weather.conditions);
  // Backend always stores temperature in Fahrenheit; `formatTemperature`
  // converts to Celsius for non-Fahrenheit locales (same locale-detection
  // path that drives `formatDistance` for miles vs. kilometres).
  const tempLabel = formatTemperature(weather.temperature_f);
  const tempUnitWord = usesFahrenheit() ? 'Fahrenheit' : 'Celsius';
  const humidity = Math.round(weather.humidity_percent);
  return (
    <View
      style={[styles.card, weatherStyles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`Current weather: ${tempLabel.replace(/°[CF]/, '')} degrees ${tempUnitWord}, ${weather.conditions}, ${humidity}% humidity`}
    >
      <View style={[weatherStyles.iconChip, { backgroundColor: colors.lightGray }]}>
        <Icon name={iconName} size={22} color={iconColor} accessible={false} />
      </View>
      <View style={weatherStyles.body}>
        <Text style={[weatherStyles.temp, { color: colors.textPrimary }]}>
          {tempLabel}
        </Text>
        <Text style={[weatherStyles.conditions, { color: colors.gray }]} numberOfLines={1}>
          {weather.conditions} · {humidity}% humidity
        </Text>
      </View>
    </View>
  );
}

export function LotAmenities({ lot }: LotAmenitiesProps) {
  const { colors, isDark } = useTheme();
  // Subscribe to system locale / unit / temperature changes once at the top
  // of the lot-detail tree. Re-renders cascade to every child that calls
  // `formatDistance` (building rows) or `formatTemperature`
  // (`CurrentWeatherCard`), so a user toggling °F↔°C or region in Settings
  // sees the new units the instant they return to the app — no app restart.
  useLocalizationSettings();
  const advisoryPalette = useMemo(() => getAdvisoryPalette(isDark), [isDark]);
  // The weather hook never throws into the render tree; on failure the
  // widget simply renders nothing so a transient network blip can't crash
  // a lot detail view.
  const { weather, loading: weatherLoading } = useCurrentWeather();

  const weekdayHours = formatHours(lot.hours_weekday);
  const saturdayHours = formatHours(lot.hours_saturday);
  const sundayHours = formatHours(lot.hours_sunday);

  return (
    <View style={styles.container}>
      <CurrentWeatherCard weather={weather} loading={weatherLoading} />
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

      {/* ── Live Availability ──
       * Highest-priority decision card after advisories: tells the user
       * whether the lot has open spaces RIGHT NOW. Renders only when we
       * have an occupancy signal (smoothed estimate preferred, raw count
       * as fallback). When no signal is available the card is omitted so
       * a static "0 taken" can't mislead.
       *
       * Display strategy: a single headline row pairs the absolute count
       * (`~250 of 500 open`) with a colored fullness chip (`50% full`).
       * The chip carries the "how saturated" gradient at a glance while
       * the count answers the literal "can I park here" question — we
       * intentionally do NOT show two stacked rows since the percentage
       * is just a different framing of the same underlying signal. */}
      {(() => {
        const occupied = lot.estimated_occupancy ?? lot.current_occupancy;
        if (occupied == null) return null;
        const available = Math.max(0, lot.capacity - occupied);
        const pctFull = Math.min(
          100,
          Math.max(0, Math.round((occupied / lot.capacity) * 100)),
        );
        // Use the shared occupancy gradient so this chip matches the
        // pin colors on the map, the badge on the recommendation cards,
        // and the bars on the forecast chart — one visual language for
        // "how full" across every surface in the app. `getReadableTextColor`
        // flips between dark and light text so the percentage stays AA
        // against the gradient's mid-tones.
        const chipBg = getOccupancyColorGradient(pctFull);
        const chipFg = getReadableTextColor(chipBg);
        return (
          <View
            style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}
          >
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Live Availability
            </Text>
            <AmenityRow
              icon="people-outline"
              label="Open spaces"
              value={`~${available.toLocaleString()} of ${lot.capacity.toLocaleString()}`}
              // Icon stays neutral; the gradient-colored chip carries the
              // fullness signal. Tinting the icon with chipBg made low-contrast
              // mid-fill colors (yellow/light green) hard to see on white cards.
              trailing={
                <View
                  style={[liveStyles.fullnessChip, { backgroundColor: chipBg }]}
                  accessibilityLabel={`${pctFull} percent full`}
                >
                  <Text style={[liveStyles.fullnessChipText, { color: chipFg }]}>
                    {pctFull}% full
                  </Text>
                </View>
              }
            />
          </View>
        );
      })()}

      {/* ── Permits ──
       * Second gate after live availability: a lot with open spaces is
       * useless if your permit isn't accepted. */}
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

      {/* ── Hours ──
       * Third gate: even with a permit and open spaces, the lot may be
       * closed for the day. */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Hours
        </Text>

        <AmenityRow icon="calendar-outline" label="Weekdays" value={weekdayHours} />
        <AmenityRow icon="calendar-outline" label="Saturday" value={saturdayHours} />
        <AmenityRow icon="calendar-outline" label="Sunday" value={sundayHours} />
      </View>

      {/* ── Lot Details ──
       * Descriptive metadata. Demoted below the three decision gates
       * (availability/permits/hours) since this content rarely changes
       * a user's parking decision once those gates are satisfied.
       *
       * Note: `Capacity` is intentionally NOT shown here — the Live
       * Availability card already surfaces it as part of "~X of Y", and
       * a second standalone capacity row would just restate that figure
       * with less context. */}
      <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Lot Details
        </Text>

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
    // Center every child on the row's cross-axis so an inline chip (the
    // "% full" pill on Live Availability) lines up with the icon, label,
    // and value text instead of floating above them. Multi-line values
    // still center cleanly because the row's height tracks the tallest
    // child either way.
    alignItems: 'center',
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
  trailing: {
    marginLeft: SPACING.sm,
  },
});

const liveStyles = StyleSheet.create({
  // Compact saturation chip rendered inline with the "Open spaces" row.
  // Color is supplied at runtime from the same status band that tints the
  // count, so the chip + count read as a single status, not two competing
  // signals.
  fullnessChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 999,
    minHeight: 22,
    justifyContent: 'center',
  },
  fullnessChipText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
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
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: '100%',
    minHeight: 44,
    justifyContent: 'center',
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

const weatherStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    // Tighter than the standard amenity card — this is a glance-able strip,
    // not a full section, so the reduced padding keeps it visually subordinate
    // to the actual lot information block below.
    padding: SPACING.lg,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  temp: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  conditions: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginTop: 2,
  },
});
