import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Text } from '../components/CustomText';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants/theme';
import { Header, ReliabilityMeter } from '../components';
import { useTheme } from '../context/ThemeContext';
import { useLotData } from '../hooks/useLotData';
import { useReliability } from '../hooks/useReliability';
import useFavorites from '../hooks/useFavorites';

import {getOccupancyColor} from '../utils/parkingUtils';
import {HourlyChart} from '../components/HourlyChart';
import { LotAmenities } from '../components/LotAmenities';
import { ReportModal } from '../components/Modals/ReportModal';
import { ReliabilityModal } from '../components/Modals/ReliabilityModal';
import type { MapStackScreenProps } from '../types/navigation';

// Favorite button component
const FavoriteButton: React.FC<{ isFavorite: boolean; onToggle: () => void }> = ({ isFavorite, onToggle }) => (
  <TouchableOpacity onPress={onToggle} style={styles.favoriteButton}>
    <Icon name={isFavorite ? "star" : "star-outline"} size={28} color={isFavorite ? COLORS.black : COLORS.darkGray} />
  </TouchableOpacity>
);

// Navigation-aware component
export function ShortTermForecastScreen() {
  const navigation = useNavigation();
  const route = useRoute<MapStackScreenProps<'Short Term Forecast'>['route']>();
  const { lotId } = route.params || { lotId: 'G1' };
  const { colors } = useTheme();

  // Use the API hook instead of mock data
  const { lot, forecast, loading, error, refreshLot } = useLotData(lotId);
  const { reliability, loading: reliabilityLoading } = useReliability(lotId);

  const onBack = () => navigation.goBack();
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isReliabilityModalOpen, setIsReliabilityModalOpen] = useState(false);

  // For favorites
  const { addFavorite, removeFavorite, favoriteLots } = useFavorites();
  // If the lotId is present in favoriteLots, then the lot is a favorite
  const isFavorite = favoriteLots.some(fav => fav === lotId);

  // Show loading spinner while data is being fetched
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
        <Header title="Today's Forecast" onBack={onBack} />
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textPrimary }]}>
            Loading lot data...
          </Text>
        </View>
      </View>
    );
  }

  // Show error state
  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
        <Header title="Today's Forecast" onBack={onBack} />
        <View style={styles.centerContent}>
          <Icon name="alert-circle-outline" size={48} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>
            {error}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={refreshLot}
          >
            <Text style={[styles.retryButtonText, { color: colors.white }]}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show message if no lot data
  if (!lot) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: colors.lightGray }]}>
        <Header title="Short Term Forecast" onBack={onBack} />
        <Text style={[styles.errorText, { color: colors.textPrimary }]}>
          Lot not found
        </Text>
      </View>
    );
  }

  const getTodayEvents = () => {
    const events = [];

    events.push({
      name: 'Beach Volleyball Tournament',
      time: '14:00',
      location: 'Beach Courts',
      impact: 'Increased traffic in G-lots',
    });

    return events.sort((a, b) => a.time.localeCompare(b.time));
  };

  const todayEvents = getTodayEvents();

  // Try to (un-)favorite a lot dependent on current isFavorite status
  const toggleFavorite = async () => {
    try {
      isFavorite? await removeFavorite(lotId) : await addFavorite(lotId);
    } catch {
      Alert.alert(
        'Favorite Lots Error',
        'The favorite status of the lot could not be changed. Please try again.',
        [{ text: 'OK', style: 'cancel' }]
      );
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.lightGray }]}>
      {/* Top Banner & Favorite Button*/}
      <Header
        title="Today's Forecast"
        onBack={onBack}
        rightAction={
          <FavoriteButton isFavorite={isFavorite} onToggle={toggleFavorite} />
        }
      />

      <ScrollView style={styles.scrollView}>
        {/* Event Notifications */}
        {todayEvents.length > 0 && (
          <View style={styles.eventsContainer}>
            {todayEvents.map((event, index) => (
              <View key={index} style={styles.eventCard}>
                <View style={styles.eventIcon}>
                  <Icon
                    name="calendar-outline"
                    size={TYPOGRAPHY.fontSize.xl}
                    color={COLORS.textPrimary}
                  />
                </View>
                <View style={styles.eventContent}>
                  <Text style={styles.eventName}>{event.name}</Text>
                  <Text style={styles.eventDetails}>{event.time} • {event.location}</Text>
                  <Text style={styles.eventImpact}>{event.impact}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Title Card w/ Lot Name and Occupancy */}
        <View style={[styles.lotHeaderCard, { backgroundColor: colors.white }]}>
          <Text style={[styles.lotName, { color: colors.textPrimary }]}>{lot.lot_name}</Text>
          <View style={[styles.statusBadge, {backgroundColor: getOccupancyColor(Math.round(lot.occupancy_rate * 100))}]}>
<Text style={styles.statusBadgeText}>{Math.round(lot.occupancy_rate * 100)}%</Text>
          </View>

          {/* Reliability Meter */}
          {!reliabilityLoading && reliability && (
            <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
              <ReliabilityMeter
                confidence={reliability.confidence}
                isColdStart={reliability.isColdStart}
                size="medium"
                onPress={() => setIsReliabilityModalOpen(true)}
              />
            </View>
          )}
        </View>

        {/* Chart */}
        <HourlyChart data={forecast}/>

        {/* Lot Amenities & Details */}
        <LotAmenities lot={lot} />
      </ScrollView>

      {/* Report Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setIsReportModalOpen(true)}
        activeOpacity={0.8}
      >
        <MaterialIcon
          name="warning"
          size={TYPOGRAPHY.fontSize.xxxxl}
          color={COLORS.white}
        />
      </TouchableOpacity>

      {/* Navigate Button (bottom right, symmetric to report button) */}
      <TouchableOpacity
        style={styles.fabNavigate}
        onPress={() => { /* TODO: Add navigation logic here */ }}
        activeOpacity={0.8}
      >
        <Icon name="navigate" size={TYPOGRAPHY.fontSize.xxl} color={COLORS.white} />
      </TouchableOpacity>

      {/* Incident Report Modal */}
      <ReportModal
        lotId={lot.lot_id}
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmit={() => {}} // currently do nothing on submit
      />

      {/* Reliability Details Modal */}
      <ReliabilityModal
        isOpen={isReliabilityModalOpen}
        onClose={() => setIsReliabilityModalOpen(false)}
        reliability={reliability}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  scrollView: {
    flex: 1,
  },

  // Center content styles for loading/error states
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
    padding: SPACING.xl,
  },

  loadingText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    marginTop: SPACING.lg,
    textAlign: 'center',
  },

  errorText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    textAlign: 'center',
    marginTop: SPACING.lg,
  },

  retryButton: {
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
    borderRadius: SPACING.sm,
    marginTop: SPACING.lg,
  },

  retryButtonText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textAlign: 'center',
  },

  // Event Card
  eventsContainer: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },

  eventCard: {
    backgroundColor: COLORS.warningLight,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warningBorder,
    borderRadius: SPACING.md,
    padding: SPACING.lg,
    flexDirection: 'row',
    gap: SPACING.sm,
  },

  eventIcon: {
    marginTop: 2,
    marginRight: 5,
  },

  eventIconText: {
    fontSize: TYPOGRAPHY.fontSize.xl,
  },

  eventContent: {
    flex: 1,
  },

  eventName: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.warningText,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },

  eventDetails: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.warningTextSecondary,
    marginTop: SPACING.xs,
  },

  eventImpact: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.warningTextSecondary,
    marginTop: SPACING.xs,
  },

  favoriteButton: {
    width: SPACING.xxxxl,
    height: SPACING.xxxxl,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Title card + Status & Favorite Button
  lotHeaderCard: {
    borderRadius: SPACING.lg,
    padding: SPACING.xxxl,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    shadowColor: COLORS.shadowDark,
    shadowOffset: { width: 0, height: SPACING.xs },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: SPACING.sm,
    alignItems: 'center',
    gap: SPACING.sm,
  },

  lotName: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textAlign: 'center',
    alignSelf: 'stretch',
  },

  statusBadge: {
    alignSelf: 'center',
    minWidth: TYPOGRAPHY.fontSize.xl * 5,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: SPACING.sm,
    marginBottom: SPACING.md,
  },

  statusBadgeText: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    color: COLORS.white,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    textAlign: 'center',
  },

  // Report Button
  fab: {
    position: 'absolute',
    bottom: SPACING.xxl, // 30px equivalent
    left: SPACING.xxl,
    width: 56, // Standard FAB size
    height: 56, // Standard FAB size
    borderRadius: 28, // Half of width/height for circle
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: COLORS.shadowDark,
    shadowOffset: { width: 0, height: SPACING.xs },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  fabNavigate: {
    position: 'absolute',
    bottom: SPACING.xxl, // Same as report button
    right: SPACING.xxl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: COLORS.shadowDark,
    shadowOffset: { width: 0, height: SPACING.xs },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  fabIcon: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    textAlign: 'center',
    lineHeight: TYPOGRAPHY.fontSize.xxl,
  },
});