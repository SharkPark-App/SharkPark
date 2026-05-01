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
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { Header, ReliabilityMeter } from '../components';
import { useTheme } from '../context/ThemeContext';
import { useLotData } from '../hooks/useLotData';
import { MapSelectModal } from '../components/Modals/MapSelectModal';
import { useReliability } from '../hooks/useReliability';
import useFavorites from '../hooks/useFavorites';
import { useAuth } from '../context/AuthContext';

import {getOccupancyColor} from '../utils/parkingUtils';
import {HourlyChart} from '../components/HourlyChart';
import { LotAmenities } from '../components/LotAmenities';
import { EventBanner } from '../components/EventBanner';
import { upcomingEvents } from '../data/mockEvents';
import { ReportModal } from '../components/Modals/ReportModal';
import { ReliabilityModal } from '../components/Modals/ReliabilityModal';
import type { MapStackScreenProps } from '../types/navigation';

// Favorite button component
const FavoriteButton: React.FC<{ isFavorite: boolean; onToggle: () => void }> = ({ isFavorite, onToggle }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={styles.favoriteButton}
      accessibilityRole="button"
      accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
      accessibilityState={{ selected: isFavorite }}
    >
      <Icon name={isFavorite ? "star" : "star-outline"} size={28} color={isFavorite ? colors.black : colors.darkGray} />
    </TouchableOpacity>
  );
};

// Navigation-aware component
export function ShortTermForecastScreen() {
  const navigation = useNavigation<MapStackScreenProps<'Short Term Forecast'>['navigation']>();
  const route = useRoute<MapStackScreenProps<'Short Term Forecast'>['route']>();
  const { lotId } = route.params || { lotId: 'G1' };
  const { colors } = useTheme();

  // Use the API hook instead of mock data
  const { lot, forecast, loading, error, refreshLot, bgLocationRequired, clearBgLocationRequired } = useLotData(lotId);
  const { reliability, loading: reliabilityLoading } = useReliability(lotId);

  // Route to soft-ask when the backend rejects with BG_LOCATION_REQUIRED.
  React.useEffect(() => {
    if (bgLocationRequired) {
      clearBgLocationRequired();
      navigation.navigate('LocationPermission', {});
    }
  }, [bgLocationRequired, clearBgLocationRequired, navigation]);

  const onBack = () => navigation.goBack();
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isReliabilityModalOpen, setIsReliabilityModalOpen] = useState(false);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);

  // For favorites
  const { addFavorite, removeFavorite, favoriteLots } = useFavorites();
  // Auth state drives the favorite-tap gate below: guests/unauthenticated
  // users are sent to the Profile tab to sign in instead of silently failing.
  const { isAuthenticated, isGuest } = useAuth();
  // If the lotId is present in favoriteLots, then the lot is a favorite
  const isFavorite = favoriteLots.some(fav => fav === lotId);

  // Show loading spinner while data is being fetched.
  //
  // We also early-return while `bgLocationRequired` is true so we never render
  // the partial screen (header + lot summary + empty forecast) before the
  // useEffect above has a chance to navigate to the soft-ask. The lot detail
  // endpoint isn't behind ContributorGuard, so `lot` resolves first and would
  // otherwise flash a broken UI for a frame.
  if (loading || bgLocationRequired) {
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

  const today = new Date().toDateString();
  const todayEvents = upcomingEvents.filter(e =>
    e.date.toDateString() === today &&
    (e.affectedLots.includes('all') || e.affectedLots.includes(lotId))
  );

  // Try to (un-)favorite a lot dependent on current isFavorite status.
  //
  // Favorites are persisted server-side keyed off the user account, so they
  // require a real sign-in. Guests/unauthenticated users get a two-button
  // Alert (Apple HIG pattern, mirrors what Apple News / Maps do for
  // personalization features that require an account) routing them to the
  // Profile tab where they can sign in or stay signed out.
  const toggleFavorite = async () => {
    if (!isAuthenticated || isGuest) {
      Alert.alert(
        'Sign in to save favorites',
        'Save your favorite lots to find them quickly. Sign in with your CSULB account to enable favorites.',
        [
          { text: 'Not Now', style: 'cancel' },
          {
            text: 'Sign In',
            onPress: () => navigation.getParent()?.navigate('Profile'),
          },
        ],
      );
      return;
    }

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
        <EventBanner events={todayEvents} />

        {/* Title Card w/ Lot Name and Occupancy */}
        <View style={[styles.lotHeaderCard, { backgroundColor: colors.white }]}>
          <Text style={[styles.lotName, { color: colors.textPrimary }]}>{lot.lot_name}</Text>
          {/* `occupancy_rate` is null for non-contributors. In practice the
              bgLocationRequired guard above redirects them away before this
              renders (the forecast endpoint 403s first), but if they manage
              to land here from a stale screen, we show a neutral "locked"
              badge instead of "NaN%". */}
          {lot.occupancy_rate != null ? (
            <View style={[styles.statusBadge, {backgroundColor: getOccupancyColor(Math.round(lot.occupancy_rate * 100))}]}>
              <Text style={styles.statusBadgeText}>{Math.round(lot.occupancy_rate * 100)}%</Text>
            </View>
          ) : (
            <View>
              <View style={[styles.statusBadge, {backgroundColor: colors.neutralPin}]}>
                <Text style={styles.statusBadgeText}>Locked</Text>
              </View>
              {/* Soft-ask CTA: a non-contributor can unlock live occupancy and
                  the today's-forecast chart by granting background location.
                  We route to the dedicated permission screen (which explains
                  what we collect, on-device storage, etc.) rather than
                  triggering the system prompt directly — required by Apple's
                  permission UX guidance and App Review 5.1.1. */}
              <TouchableOpacity
                onPress={() => navigation.navigate('LocationPermission', {})}
                style={{ marginTop: SPACING.md }}
                accessibilityRole="button"
                accessibilityLabel="Unlock live occupancy by granting background location"
              >
                <Text style={{
                  color: colors.primary,
                  fontFamily: TYPOGRAPHY.fontFamily.semibold,
                  textAlign: 'center',
                }}>
                  Unlock live occupancy
                </Text>
              </TouchableOpacity>
            </View>
          )}

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
        accessibilityRole="button"
        accessibilityLabel="Report an incident"
        importantForAccessibility="yes"
      >
        <MaterialIcon
          name="warning"
          size={TYPOGRAPHY.fontSize.xxxxl}
          color={COLORS.white}
          accessible={false}
        />
      </TouchableOpacity>

      {/* Navigate Button (bottom right, symmetric to report button) */}
      <TouchableOpacity
        style={styles.fabNavigate}
        onPress={() => setIsMapModalOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Navigate to lot"
        importantForAccessibility="yes"
      >
        <Icon name="navigate" size={TYPOGRAPHY.fontSize.xxl} color={COLORS.white} accessible={false} />
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

      <MapSelectModal 
        isVisible={isMapModalOpen} 
        onClose={() => setIsMapModalOpen(false)}
        lat={lot.center_lat} 
        lon={lot.center_lng} 
        title={lot.lot_name} 
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
    ...SHADOWS.card,
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
    ...SHADOWS.fab,
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
    ...SHADOWS.fab,
  },
  fabIcon: {
    fontSize: TYPOGRAPHY.fontSize.xxl,
    textAlign: 'center',
    lineHeight: TYPOGRAPHY.fontSize.xxl,
  },
});