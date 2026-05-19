import React, { useState, useMemo, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { TextInput } from '../components/CustomTextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { Header } from '../components';
import { Text } from '../components/CustomText';
import { useTheme } from '../context/ThemeContext';
import { HourlyChart } from '../components/HourlyChart';
import { lotsApi } from '../services/api';
import { BackgroundLocationRequiredError } from '../services/api/base';
import { useLotsList } from '../hooks/useLotData';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { EventBanner } from '../components/EventBanner';
import { useEvents } from '../hooks/useEvents';
import { useLocalizationSettings } from '../hooks/useLocalizationSettings';
import { formatTemperature } from '../utils/geoHelpers';

const DEFAULT_LOT = 'G6';
const LOT_ORDER = ['G', 'E'];

/** Build an array of 7 dates starting from today */
function getNext7Days(): Date[] {
  const days: Date[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

/**
 * Pick a representative Ionicon for an OpenWeather-style `conditions`
 * string. Lowercased substring match keeps this robust against the
 * provider's title-cased variants ("Light rain", "Partly cloudy", etc.).
 */
function getWeatherIcon(conditions: string): { name: string; color: string } {
  const c = (conditions || '').toLowerCase();
  if (c.includes('thunder')) return { name: 'thunderstorm-outline', color: '#7c3aed' };
  if (c.includes('rain') || c.includes('drizzle')) return { name: 'rainy-outline', color: '#2563eb' };
  if (c.includes('snow')) return { name: 'snow-outline', color: '#0ea5e9' };
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return { name: 'cloudy-outline', color: '#64748b' };
  if (c.includes('cloud')) return { name: 'partly-sunny-outline', color: '#64748b' };
  if (c.includes('clear') || c.includes('sun')) return { name: 'sunny-outline', color: '#f59e0b' };
  return { name: 'partly-sunny-outline', color: '#64748b' };
}

/**
 * Horizontal strip of forecasted hourly weather for the selected day.
 * Mirrors the demand chart's time axis so students can visually correlate
 * "it'll be raining at 2 PM" with "the lot fills up earlier on rainy
 * mornings". Renders nothing when the backend hasn't produced a forecast
 * for this day yet (heuristic fallback path), so we don't show a misleading
 * empty band.
 */
function DayWeatherStrip({
  weather,
}: {
  weather: Array<{
    target_time: string;
    temperature_f: number;
    precipitation_probability: number;
    is_raining: boolean;
    wind_speed_mph: number;
    conditions: string;
  }>;
}) {
  const { colors } = useTheme();
  // Re-render the strip when the user changes their system temperature unit
  // so cell values flip between °F and °C without an app restart.
  useLocalizationSettings();
  if (!weather || weather.length === 0) return null;

  // Down-sample to every 3rd hour so the strip stays scannable on a phone
  // (24 entries would over-pack the row). Always include the first/last so
  // the day's bounds are preserved.
  const sampled = weather.filter((_, i) => i % 3 === 0);
  if (sampled.length > 0 && sampled[sampled.length - 1] !== weather[weather.length - 1]) {
    sampled.push(weather[weather.length - 1]);
  }

  return (
    <View
      style={[
        weatherStripStyles.card,
        { backgroundColor: colors.white, shadowColor: colors.shadowDark },
      ]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel="Hourly weather forecast for the selected day"
    >
      <Text
        style={[weatherStripStyles.title, { color: colors.textPrimary }]}
        accessibilityRole="header"
      >
        Weather forecast
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={weatherStripStyles.row}
      >
        {sampled.map((w) => {
          const dt = new Date(w.target_time);
          const hourLabel = dt.toLocaleTimeString([], {
            hour: 'numeric',
          });
          const { name: iconName, color: iconColor } = getWeatherIcon(w.conditions);
          const popPct = Math.round((w.precipitation_probability ?? 0) * 100);
          return (
            <View
              key={w.target_time}
              style={weatherStripStyles.cell}
              accessibilityLabel={`${hourLabel}, ${formatTemperature(w.temperature_f)}, ${w.conditions}, ${popPct} percent chance of precipitation`}
            >
              <Text style={[weatherStripStyles.hour, { color: colors.gray }]}>
                {hourLabel}
              </Text>
              <Icon name={iconName} size={22} color={iconColor} accessible={false} />
              <Text style={[weatherStripStyles.temp, { color: colors.textPrimary }]}>
                {formatTemperature(w.temperature_f, { withUnit: false })}
              </Text>
              {popPct >= 20 ? (
                <Text style={[weatherStripStyles.pop, { color: '#2563eb' }]}>
                  {popPct}%
                </Text>
              ) : (
                <Text style={[weatherStripStyles.pop, { color: 'transparent' }]}>
                  —
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const LongTermForecastScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const { lots } = useLotsList();
  const sortedLots = useMemo(
    () =>
      [...lots].sort((a, b) => {
        const idxA = LOT_ORDER.indexOf(a.lot_id[0]);
        const idxB = LOT_ORDER.indexOf(b.lot_id[0]);
        const groupA = idxA >= 0 ? idxA : LOT_ORDER.length;
        const groupB = idxB >= 0 ? idxB : LOT_ORDER.length;
        if (groupA !== groupB) return groupA - groupB;
        return a.lot_id.localeCompare(b.lot_id, undefined, { numeric: true });
      }),
    [lots],
  );

  const getLotDisplayName = (lotId: string) => {
    const lot = lots.find(l => l.lot_id === lotId);
    return lot?.display_name || lot?.lot_name || lotId;
  };

  const days = useMemo(() => getNext7Days(), []);

  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [selectedLot, setSelectedLot] = useState(DEFAULT_LOT);
  const [lotPickerOpen, setLotPickerOpen] = useState(false);
  const [lotSearchQuery, setLotSearchQuery] = useState('');

  // Filter the sorted lot list by the search query. We match against
  // lot_id, display_name, and lot_name so users can type either the
  // permit code ("G6") or the human label ("Pyramid").
  const filteredLots = useMemo(() => {
    const q = lotSearchQuery.trim().toLowerCase();
    if (!q) return sortedLots;
    return sortedLots.filter(l => {
      return (
        l.lot_id.toLowerCase().includes(q) ||
        (l.display_name?.toLowerCase().includes(q) ?? false) ||
        (l.lot_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [sortedLots, lotSearchQuery]);

  const { events: lotEvents } = useEvents(selectedLot);

  const hasEvent = (date: Date) =>
    lotEvents.some(e => e.date.toDateString() === date.toDateString());

  useEffect(() => {
    AsyncStorage.getItem('selectedLot').then(saved => {
      if (saved) setSelectedLot(saved);
    });
  }, []);

  const activeLot = useMemo(
    () => lots.find(l => l.lot_id === selectedLot),
    [lots, selectedLot],
  );

  // Multi-day long-term forecast fetched from the backend ML pipeline.
  // One entry per day with hourly bands + the slice of weather forecast
  // covering that day. Falls back to local heuristic (per-day copy of the
  // typical campus curve) if the network and cache both miss.
  type LongTermDay = Awaited<ReturnType<typeof lotsApi.getLongTermForecast>>[number];
  const [longTerm, setLongTerm] = useState<LongTermDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!activeLot) return;
    (async () => {
      try {
        const data = await lotsApi.getLongTermForecast(activeLot, { days: 7 });
        if (!cancelled) setLongTerm(data);
      } catch (err) {
        // BG-location revoked: render the local heuristic so the screen
        // doesn't go blank. The user is still routed through the soft-ask
        // flow elsewhere (lot detail / contributor state listener).
        if (err instanceof BackgroundLocationRequiredError) {
          if (!cancelled) {
            setLongTerm(
              days.map((d) => ({
                date: d.toISOString().split('T')[0],
                source: 'heuristic' as const,
                hourly: lotsApi.generateForecast(activeLot),
                weather: [],
              })),
            );
          }
          return;
        }
        if (!cancelled) setLongTerm([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeLot, days]);

  const forecast = useMemo(() => {
    if (longTerm.length > 0) {
      const day = longTerm[selectedDayIndex] ?? longTerm[0];
      return day?.hourly ?? [];
    }
    // Initial render before the fetch resolves: keep the legacy local
    // heuristic so the chart isn't empty.
    return activeLot ? lotsApi.generateForecast(activeLot) : [];
  }, [longTerm, selectedDayIndex, activeLot]);

  const selectedDayEvents = useMemo(() => {
    const selectedDate = days[selectedDayIndex];
    return lotEvents.filter(
      e => e.date.toDateString() === selectedDate.toDateString(),
    );
  }, [days, selectedDayIndex, lotEvents]);

  // Slice of the forecasted hourly weather covering the selected day, so
  // students can pair the demand curve with the expected high / low and
  // rain risk — the two strongest behavioral drivers we already feed into
  // the ML model. Empty array = backend hasn't populated forecasts yet OR
  // the fallback heuristic path is active; in that case the strip hides.
  const selectedDayWeather = useMemo(() => {
    return longTerm[selectedDayIndex]?.weather ?? [];
  }, [longTerm, selectedDayIndex]);

  return (
    <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
      <Header />
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xxl }}
      >
        {/* Lot Selection */}
        <View style={styles.lotPickerContainer}>
          <TouchableOpacity
            onPress={() => setLotPickerOpen(!lotPickerOpen)}
            style={[
              styles.lotPickerButton,
              { backgroundColor: colors.white, borderColor: colors.borderGray },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${getLotDisplayName(selectedLot).split('-')[0].trim()}, parking lot selector`}
            accessibilityState={{ expanded: lotPickerOpen }}
            accessibilityHint="Double tap to open lot selection"
          >
            <Text style={[styles.lotPickerText, { color: colors.black }]}>
              {getLotDisplayName(selectedLot).split('-')[0].trim()}
            </Text>
            <Text
              accessible={false}
              style={{ color: colors.gray, fontSize: TYPOGRAPHY.fontSize.sm }}
            >
              {lotPickerOpen ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>
        </View>
        
        {/* Dropdown */}
        {lotPickerOpen && (
          <View
            style={[
              styles.lotDropdown,
              { backgroundColor: colors.white, borderColor: colors.borderGray },
            ]}
          >
            <View
              style={[
                styles.lotSearchContainer,
                { borderBottomColor: colors.borderGray },
              ]}
            >
              <TextInput
                value={lotSearchQuery}
                onChangeText={setLotSearchQuery}
                placeholder="Search lots"
                placeholderTextColor={colors.gray}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="while-editing"
                style={[styles.lotSearchInput, { color: colors.black }]}
                accessibilityLabel="Search parking lots"
              />
            </View>
            <ScrollView
              style={styles.lotDropdownScroll}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {filteredLots.length === 0 ? (
                <View style={styles.lotDropdownEmpty}>
                  <Text style={[styles.lotDropdownText, { color: colors.gray }]}>
                    No lots match “{lotSearchQuery}”
                  </Text>
                </View>
              ) : (
                filteredLots.map(lot => (
                  <TouchableOpacity
                    key={lot.lot_id}
                    onPress={() => {
                      setSelectedLot(lot.lot_id);
                      AsyncStorage.setItem('selectedLot', lot.lot_id);
                      setLotPickerOpen(false);
                      setLotSearchQuery('');
                    }}
                    style={[
                      styles.lotDropdownItem,
                      lot.lot_id === selectedLot && {
                        backgroundColor: colors.lightGray,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={lot.display_name || lot.lot_name}
                    accessibilityState={{ selected: lot.lot_id === selectedLot }}
                  >
                    <Text
                      style={[
                        styles.lotDropdownText,
                        {
                          color:
                            lot.lot_id === selectedLot
                              ? colors.primary
                              : colors.black,
                        },
                      ]}
                    >
                      {lot.display_name || lot.lot_name}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        )}

        {/* Day Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayRow}
        >
          {days.map((date, i) => {
            const isSelected = i === selectedDayIndex;
            const label =
              i === 0
                ? 'Today'
                : date
                    .toLocaleString('default', { weekday: 'short' })
                    .toUpperCase();
            const month = date.toLocaleString('default', { month: 'long' });
            const dateNum = date.getDate();

            return (
              <TouchableOpacity
                key={i}
                onPress={() => setSelectedDayIndex(i)}
                style={[
                  styles.dayChip,
                  {
                    backgroundColor: isSelected ? colors.primary : colors.white,
                    borderColor: isSelected
                      ? colors.primary
                      : colors.borderGray,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${month} ${dateNum}${hasEvent(date) ? ', has event' : ''}`}
                accessibilityState={{ selected: isSelected }}
              >
                {hasEvent(date) && <View style={styles.eventDot} accessible={false} importantForAccessibility="no" />}
                
                <Text
                  style={[
                    styles.dayLabel,
                    { color: isSelected ? colors.white : colors.black },
                  ]}
                >
                  {label}
                </Text>

                <Text
                  style={[
                    styles.dayNumber,
                    { color: isSelected ? colors.white : colors.gray },
                  ]}
                >
                  {dateNum}
                </Text>

                <Text
                  style={[
                    styles.monthLabel,
                    { color: isSelected ? colors.white : colors.gray },
                  ]}
                >
                  {month}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={[styles.divider, { backgroundColor: colors.mediumLightGray }]} />
        <EventBanner events={selectedDayEvents} />
        <DayWeatherStrip weather={selectedDayWeather} />
        <HourlyChart data={forecast} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  // Day of Week Filter
  dayRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
    gap: SPACING.md,
  },
  dayChip: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: SPACING.lg,
    borderWidth: 1,
    ...SHADOWS.cardSubtle,
  },
  eventDot: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'red',
  },
  dayLabel: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  dayNumber: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginTop: -2,
  },
  monthLabel: {
    fontSize: TYPOGRAPHY.fontSize.xxs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginTop: -3,
  },
  divider: {
    height: 1,
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.sm,
  },
  // Parking Lot Filter
  lotPickerContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  lotPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    borderRadius: SPACING.lg,
    borderWidth: 1,
    ...SHADOWS.card,
  },
  lotPickerText: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textAlign: 'center' as const,
    paddingVertical: SPACING.sm,
    flex: 1,
  },
  // Dropdown styles
  lotDropdown: {
    marginHorizontal: SPACING.lg,
    borderRadius: SPACING.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  lotDropdownScroll: {
    maxHeight: 200,
  },
  lotSearchContainer: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
  },
  lotSearchInput: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    paddingVertical: SPACING.sm,
    minHeight: 44,
  },
  lotDropdownEmpty: {
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    alignItems: 'center',
  },
  lotDropdownItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  lotDropdownText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});

// Local stylesheet for `DayWeatherStrip` so the main `styles` block stays
// scoped to the screen-level layout primitives.
const weatherStripStyles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    borderRadius: 12,
    ...SHADOWS.card,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.xs,
  },
  cell: {
    alignItems: 'center',
    minWidth: 48,
    gap: SPACING.xs,
  },
  hour: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  temp: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  pop: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});

export default LongTermForecastScreen;
