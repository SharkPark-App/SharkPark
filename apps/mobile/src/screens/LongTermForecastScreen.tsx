import React, { useState, useMemo, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components';
import { Text } from '../components/CustomText';
import { useTheme } from '../context/ThemeContext';
import { HourlyChart } from '../components/HourlyChart';
import { lotsApi } from '../services/api';
import { useLotsList } from '../hooks/useLotData';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { EventBanner } from '../components/EventBanner';
import { useEvents } from '../hooks/useEvents';

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

  const forecast = useMemo(
    () => (activeLot ? lotsApi.generateForecast(activeLot) : []),
    // TODO(long-term-forecast): when the real GET /lots/:id/predictions/long-term
    // call replaces this local heuristic, the wrapping hook MUST surface
    // `bgLocationRequired` (see useLotData) and this screen MUST early-return a
    // loading state + navigate to 'LocationPermission' — same pattern as
    // ShortTermForecastScreen — otherwise the screen will flash a partial UI
    // before the soft-ask appears. Also pass selectedDayIndex through.
    [activeLot, selectedDayIndex],
  );

  const selectedDayEvents = useMemo(() => {
    const selectedDate = days[selectedDayIndex];
    return lotEvents.filter(
      e => e.date.toDateString() === selectedDate.toDateString(),
    );
  }, [days, selectedDayIndex, lotEvents]);

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
            <ScrollView style={styles.lotDropdownScroll} nestedScrollEnabled>
              {sortedLots.map(lot => (
                <TouchableOpacity
                  key={lot.lot_id}
                  onPress={() => {
                    setSelectedLot(lot.lot_id);
                    AsyncStorage.setItem('selectedLot', lot.lot_id);
                    setLotPickerOpen(false);
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
              ))}
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
  lotDropdownItem: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  lotDropdownText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});

export default LongTermForecastScreen;
