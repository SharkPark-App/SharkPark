import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ImageSourcePropType, 
  ScrollView, 
  TouchableOpacity 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '../components';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { upcomingEvents } from '../data/mockEvents';
import { getOccupancyColor } from '../utils/parkingUtils';

const LongTermForecastScreen: React.FC = () => {
  const { colors } = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const logo = require('../assets/images/SharkParkV4.webp') as ImageSourcePropType;
  
  const [currentMonth, setCurrentMonth] = React.useState(new Date());
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(null);
  
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    return { year, month,
      daysInMonth: lastDay.getDate(),
      startingDayOfWeek: firstDay.getDay(),
    };
  };

  const { year, month, daysInMonth, startingDayOfWeek } =
    getDaysInMonth(currentMonth);
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  const previousMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    );
  };

  const isPastDate = (day: number) => {
    const today = new Date();
    const dateToCheck = new Date(year, month, day);
    today.setHours(0, 0, 0, 0);
    dateToCheck.setHours(0, 0, 0, 0);
    return dateToCheck < today;
  };
  
  const hasEvent = (day: number) => {
    return upcomingEvents.some(event => {
      const eventDate = event.date;
      return (
        eventDate.getDate() === day &&
        eventDate.getMonth() === month &&
        eventDate.getFullYear() === year
      );
    });
  };

  const getEventsForDate = (date: Date | null) => {
    if (!date) return [];
    return upcomingEvents
      .filter(event => {
        const eventDate = event.date;
        return (
          eventDate.getDate() === date.getDate() &&
          eventDate.getMonth() === date.getMonth() &&
          eventDate.getFullYear() === date.getFullYear()
        );
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  };
  
  // Mock function to generate general long-term forecast data
  const generateForecastForDate = (date: Date) => {
    const map = [25, 85, 88, 90, 87, 75, 30];
    return map[date.getDay()];
  };
  
  return (
    <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
      <Header 
        logo={logo}
      />
      
      <SafeAreaView style={styles.content}>
        <ScrollView>
          {/* Calendar */}
          <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}>
            {/* Calendar Header */}
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={previousMonth} style={styles.navButton}>
                <Text style={[styles.navIcon, { color: colors.mediumGray }]}>‹</Text>
              </TouchableOpacity>

              <Text style={[styles.monthTitle, { color: colors.textPrimary }]}>
                {monthNames[month]} {year}
              </Text>

              <TouchableOpacity onPress={nextMonth} style={styles.navButton}>
                <Text style={[styles.navIcon, { color: colors.mediumGray }]}>›</Text>
              </TouchableOpacity>
            </View>

            {/* Day Names */}
            <View style={styles.dayNamesRow}>
              {dayNames.map(day => (
                <Text key={day} style={[styles.dayName, { color: colors.gray }]}>{day}</Text>
              ))}
            </View>

            {/* Calendar Grid */}
            <View style={styles.calendarGrid}>
              {/* Empty date cells */}
              {Array.from({ length: startingDayOfWeek }).map((_, index) => 
                (<View key={`empty-${index}`} style={styles.dayCell} />
              ))}

              {/* Actual date cells */}
              {Array.from({ length: daysInMonth }).map((_, index) => {
                const day = index + 1;              
                const forecast = generateForecastForDate(new Date(year, month, day));

                const isSelected =
                  selectedDate?.getDate() === day &&
                  selectedDate?.getMonth() === month &&
                  selectedDate?.getFullYear() === year;

                const isPast = isPastDate(day);

                return (
                   <TouchableOpacity key={day}
                    onPress={() => setSelectedDate(new Date(year, month, day))}
                    style={[
                      styles.dayCell,
                      isToday(day) && { backgroundColor: colors.lightGray, borderRadius: SPACING.md },
                      isSelected && { borderWidth: 2, borderColor: colors.primary, borderRadius: SPACING.md },
                    ]}
                  >
                    <Text style={[
                      styles.dayText,
                      { color: colors.textPrimary },
                      isPast && { opacity: 0.3 }
                    ]}>{day}</Text>

                    {!isPast && (
                      <View style={[
                        styles.occupancyBar,
                        { backgroundColor: getOccupancyColor(forecast) }
                      ]}/>
                    )}

                    {/* Event indicator */}
                    {hasEvent(day) && <View style={[
                      styles.eventDot,
                      { backgroundColor: colors.error },
                      isPast && { opacity: 0.3 }
                    ]} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Selected Date Event Information */}
          {selectedDate && getEventsForDate(selectedDate).length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark, marginTop: SPACING.lg }]}>
              <Text style={[styles.cardTitle, { color: colors.textFull }]}>
                {selectedDate.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>

              {getEventsForDate(selectedDate).map((event, index) => (
                <View key={event.id}>
                  <View style={[styles.selectedEventCard, { borderLeftColor: colors.error }]}>
                    <View style={styles.titleImpactRow}>
                      <Text style={[styles.selectedEventName, { color: colors.textPrimary }]}>
                        {event.name}
                      </Text>

                      <View style={[
                        styles.impactBadge,
                        { backgroundColor: event.impact === 'high' ? colors.error : colors.warningBorder }
                      ]}>
                        <Text style={[styles.impactBadgeText, { color: colors.white }]}>
                          {event.impact.toUpperCase()} IMPACT
                        </Text>
                      </View>
                    </View>

                    <View style={styles.timeLocationRow}>
                      <Text style={[styles.selectedEventTime, { color: colors.gray }]}>
                        {event.date.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </Text>

                      <Text style={[styles.dividerText, { color: colors.gray }]}>•</Text>

                      <Text style={[styles.selectedEventLocation, { color: colors.gray }]}>
                        {event.location}
                      </Text>
                    </View>

                    <Text style={[styles.selectedEventDescription, { color: colors.darkGray }]}>
                      {event.description}
                    </Text>

                    {event.affectedLots && event.affectedLots.length > 0 && (
                      <View style={styles.affectedLotsContainer}>
                        <Text style={[styles.affectedLotsLabel, { color: colors.gray }]}>
                          Affected Lots:
                        </Text>
                        <Text style={[styles.affectedLotsText, { color: colors.textPrimary }]}>
                          {event.affectedLots.join(', ')}
                        </Text>
                      </View>
                    )}
                  </View>

                  {index < getEventsForDate(selectedDate).length - 1 && (
                    <View style={[styles.eventDivider, { backgroundColor: colors.borderGray }]} />
                  )}
                </View>
              ))}
            </View>
          )}

          {/* No Events Message */}
          {selectedDate && getEventsForDate(selectedDate).length === 0 && (
            <View style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark, marginTop: SPACING.lg }]}>
              <Text style={[styles.noEventsText, { color: colors.gray }]}>
                No events scheduled for this day.
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  // Card styles
  card: {
    borderRadius: SPACING.lg,
    padding: SPACING.xl,
    margin: SPACING.xxxl,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  cardTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    marginBottom: SPACING.lg,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.gray,
    marginHorizontal: SPACING.xxxl,
    marginVertical: SPACING.md,
  },
  // Event styles
  eventCard: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  eventName: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    marginBottom: SPACING.xs,
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventDate: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginLeft: SPACING.md,
  },
  eventDescription: {
    fontSize: TYPOGRAPHY.fontSize.xs,
  },
  // Calendar Styles
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  monthTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
  },
  navButton: {
    padding: SPACING.xl,
    margin: -SPACING.xl,
  },
  navIcon: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    paddingHorizontal: SPACING.md,
  },
  dayNamesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  dayName: {
    flex: 1,
    textAlign: 'center',
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
  },
  dayCell: {
    width: `${100 / 7}%`,
    height: 40,    
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xs,
  },
  dayText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  eventDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  occupancyBar: {
    width: 28,
    height: 6,
    borderRadius: 3,
    marginTop: SPACING.xs,
  },
  // Selected event styles
  selectedEventCard: {
    borderLeftWidth: 4,
    paddingLeft: SPACING.md,
    paddingVertical: SPACING.md,
  },
  titleImpactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs,
    gap: SPACING.md,
  },
  selectedEventName: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    flex: 1,
    flexWrap: 'wrap',
  },
  timeLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  selectedEventTime: {
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  dividerText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginHorizontal: SPACING.md,
  },
  selectedEventLocation: {
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  eventDivider: {
    height: 1,
    marginVertical: SPACING.md,
    marginLeft: SPACING.md,
  },
  timeImpactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  selectedEventDescription: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  affectedLotsContainer: {
    marginBottom: SPACING.md,
  },
  affectedLotsLabel: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    marginBottom: SPACING.xs,
  },
  affectedLotsText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  impactBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: SPACING.sm,
  },
  impactBadgeText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  noEventsText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
});

export default LongTermForecastScreen;
