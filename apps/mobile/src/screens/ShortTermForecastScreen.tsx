import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/CustomText';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { Header, ReliabilityRow, LockedOccupancyBadge, LockedForecastCard, UnlockCTAButton } from '../components';
import { useTheme } from '../context/ThemeContext';
import { useLotData } from '../hooks/useLotData';
import { useContributorState } from '../services/api/contributor';
import { MapSelectModal } from '../components/Modals/MapSelectModal';
import { useReliability } from '../hooks/useReliability';
import useFavorites from '../hooks/useFavorites';
import { useAuth } from '../context/AuthContext';

import {getOccupancyColorGradient, getReadableTextColor} from '../utils/parkingUtils';
import {HourlyChart} from '../components/HourlyChart';
import { LotAmenities } from '../components/LotAmenities';
import { EventBanner } from '../components/EventBanner';
import { useEvents } from '../hooks/useEvents';
import { ReportModal } from '../components/Modals/ReportModal';
import { ReliabilityModal } from '../components/Modals/ReliabilityModal';
import { reportsApi, ReportUnauthorizedError, ReportThrottledError } from '../services/api/reports';
import type { MapStackScreenProps } from '../types/navigation';

// Format a wall-clock timestamp into a short "X ago" relative string for the
// inline freshness label on the lot header card. We deliberately keep the
// granularity coarse (seconds < 1m, minutes < 1h, hours otherwise) so the
// label doesn't visibly tick every second and force re-renders.
function formatUpdatedAgo(ts: number | null): string {
  if (ts == null) return 'just now';
  const deltaMs = Date.now() - ts;
  if (deltaMs < 5_000) return 'just now';
  if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  return `${Math.floor(deltaMs / 3_600_000)}h ago`;
}

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
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  // Navigate FAB uses dark slate by default. On dark mode that slate disappears
  // into the surface, so swap to a lighter slate-blue with a darker glyph for
  // contrast against both the button and the underlying dark card stack.
  const navigateFabBg = isDark ? '#94a3b8' : COLORS.secondary;
  const navigateFabFg = isDark ? '#0f172a' : COLORS.white;

  // Use the API hook instead of mock data
  const { lot, forecast, loading, forecastLoading, refreshing: _refreshing, lastUpdatedAt, error, refreshLot, bgLocationRequired, clearBgLocationRequired } = useLotData(lotId);
  // `refreshing` is intentionally unused at the screen level: we no longer
  // surface a per-poll "Updating…" indicator because flashing a spinner on
  // every successful 60s tick made a working system look broken. The stale
  // chip below covers the only case where the user actually needs to know
  // refreshes have stalled (>2min since last successful commit).
  void _refreshing;
  const { reliability, loading: reliabilityLoading } = useReliability(lotId);
  const { events: lotEvents } = useEvents(lotId);

  // Live OS contributor state. Drives the lock UI directly so the badge /
  // forecast card flip the instant the user toggles permission — we don't
  // wait for the next poll tick to commit a fresh fetch before reflecting
  // the change. The fetched payload (`lot.occupancy_rate`) catches up
  // moments later via the contributor pub-sub triggering refreshLot.
  const contributorState = useContributorState();
  const isContributor = contributorState === 'granted';

  // Non-contributors see the redacted lot detail (neutral badge + Unlock
  // CTA). We deliberately do NOT auto-navigate to the permission screen —
  // the user already chose to tap into this lot, and a forced redirect
  // would feel like a permission-wall (App Review 5.1.1). Just clear the
  // flag so subsequent re-fetches don't loop.
  React.useEffect(() => {
    if (bgLocationRequired) {
      clearBgLocationRequired();
    }
  }, [bgLocationRequired, clearBgLocationRequired]);

  const onBack = () => navigation.goBack();
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isReliabilityModalOpen, setIsReliabilityModalOpen] = useState(false);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);

  const handleReportSubmit = async (report: import('../components/Modals/ReportModal').IncidentReport) => {
    if (isGuest || !isAuthenticated) {
      setIsReportModalOpen(false);
      Alert.alert('Sign in required', 'Please sign in to submit a report.');
      return;
    }
    if (!lot?.id) throw new Error('Lot data unavailable. Please try again.');
    try {
      await reportsApi.create({
        lotId: lot.id,
        type: report.type,
        message: report.message || undefined,
      });
      setIsReportModalOpen(false);
    } catch (err) {
      if (err instanceof ReportUnauthorizedError) {
        setIsReportModalOpen(false);
        Alert.alert('Sign in required', 'Please sign in to submit a report.');
        return;
      }
      if (err instanceof ReportThrottledError) {
        throw err; // ReportModal will surface the message
      }
      throw err;
    }
  };

  // For favorites
  const { addFavorite, removeFavorite, favoriteLots } = useFavorites();
  // Auth state drives the favorite-tap gate below: guests/unauthenticated
  // users are sent to the Profile tab to sign in instead of silently failing.
  const { isAuthenticated, isGuest } = useAuth();
  // If the lotId is present in favoriteLots, then the lot is a favorite
  const isFavorite = favoriteLots.some(fav => fav === lotId);

  // Drive a coarse re-render once per minute so the "Updated Xm ago" staleness
  // label can flip on after the lot data has been sitting unrefreshed. We only
  // show the label when the data is actually stale (>2min) — no point telling
  // the user "Updated 12s ago" when the screen polls every 60s anyway.
  const [, setRelTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setRelTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Threshold past which we surface a freshness label. Below this the label is
  // hidden entirely (the data is recent enough that calling it out is noise).
  const STALE_THRESHOLD_MS = 2 * 60_000;
  const isStale = lastUpdatedAt != null && Date.now() - lastUpdatedAt > STALE_THRESHOLD_MS;

  // Show the full-screen spinner ONLY on the very first load (when we have
  // no `lot` yet). Background refetches (poll tick, focus return, contributor
  // grant/revoke) keep the rendered content mounted and surface progress via
  // the inline "Updating..." / "Updated Xm ago" label below — unmounting the
  // whole screen on every poll feels broken and made permission changes feel
  // like a 30s lag because the screen flashed to spinner mid-transition.
  if (loading && !lot) {
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
  const todayEvents = lotEvents.filter(e => e.date.toDateString() === today);

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

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 80 + insets.bottom }]}
      >
        {/* Event Notifications */}
        <EventBanner events={todayEvents} />

        {/* Title Card w/ Lot Name and Occupancy */}
        <View style={[styles.lotHeaderCard, { backgroundColor: colors.white }]}>
          {/* Subtle data-quality footnote on the occupancy reading.
              Anchored to the top-right corner of the card as a small
              dot + muted label + chevron — reads as a footnote on the
              percentage below it ("this number is <quality>") rather
              than a separate section. Contributor-only (mirrors the
              live occupancy gating). */}
          {isContributor && !reliabilityLoading && reliability && (
            <View style={styles.reliabilityCorner}>
              <ReliabilityRow
                confidence={reliability.confidence}
                isColdStart={reliability.isColdStart}
                onPress={() => setIsReliabilityModalOpen(true)}
              />
            </View>
          )}
          <Text style={[styles.lotName, { color: colors.textPrimary }]}>{lot.lot_name}</Text>
          {/* Lock decision is driven by live OS permission state, not by
              whether the most recent fetch happened to return null. This
              way the badge flips instantly on a permission toggle even if
              the in-memory `lot` payload is still from the pre-toggle
              fetch — the next refetch fills in the live numbers a moment
              later. While contributor=granted but data is still loading
              (occupancy_rate not yet populated), we show a small spinner
              instead of either the locked chip or a misleading 0%. */}
          {!isContributor ? (
            <View style={styles.lockedGroup}>
              {/* Redacted live occupancy: shows a lock chip + smeared
                  placeholder — see LockedOccupancyBadge for the no-deps
                  blur-style approach. */}
              <LockedOccupancyBadge size="lg" />
              {/* Soft-ask CTA: a non-contributor can unlock live occupancy
                  by granting background location. We route to the dedicated
                  permission screen (which explains what we collect, on-device
                  storage, etc.) rather than triggering the system prompt
                  directly — required by Apple's permission UX guidance and
                  App Review 5.1.1. */}
              <UnlockCTAButton
                label="Unlock live occupancy"
                onPress={() => navigation.navigate('LocationPermission', {})}
                accessibilityLabel="Unlock live occupancy by granting background location"
              />
            </View>
          ) : lot.occupancy_rate != null ? (
            (() => {
              const pct = Math.round(lot.occupancy_rate * 100);
              const bg = getOccupancyColorGradient(pct);
              return (
                <View style={styles.occupancyGroup}>
                  <Text style={[styles.occupancyLabel, { color: colors.gray }]}>
                    Live Occupancy
                  </Text>
                  <View style={[styles.statusBadge, {backgroundColor: bg}]}>
                    <Text style={[styles.statusBadgeText, {color: getReadableTextColor(bg)}]}>{pct}%</Text>
                  </View>
                </View>
              );
            })()
          ) : (
            // Contributor-but-no-data (truly missing — e.g. lot has no
            // recent occupancy reports). The revoke→grant gap that used
            // to land here no longer happens because we stopped clobbering
            // in-memory state on revoke (see useLotData). Reserve the
            // badge slot height so the card doesn't shift.
            <View style={[styles.statusBadge, styles.statusBadgeEmpty]} />
          )}

          {/* Inline freshness indicator. Hidden while data is fresh (the
              60s poll keeps it current and a label would just be noise);
              shown only when the data has gone stale (>2min, e.g. after
              returning from background or if polling stalled). Tapping
              forces an immediate refresh.

              We deliberately don't show a spinner on every successful poll —
              flashing on a 60s cadence made a working system feel broken.
              The full-screen spinner above still covers the very first load.

              Absolutely positioned in the bottom-right of the card so
              toggling it on/off doesn't grow the card or leave a gap of
              reserved empty space when hidden. */}
          {isStale && (
            <TouchableOpacity
              onPress={refreshLot}
              accessibilityRole="button"
              accessibilityLabel={`Last updated ${formatUpdatedAgo(lastUpdatedAt)}. Tap to refresh.`}
              style={styles.updatedRow}
            >
              <Text style={[styles.updatedText, { color: colors.darkGray }]}>
                {`Updated ${formatUpdatedAgo(lastUpdatedAt)}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Chart — the forecast endpoint is contributor-gated, so for
            non-contributors `forecast` comes back empty and we render a
            locked placeholder card with its own Unlock CTA. The lock
            decision is keyed on live OS contributor state (not on the
            forecast array contents) so the card flips immediately on
            permission toggle, before the next refetch lands. */}
        {!isContributor ? (
          <LockedForecastCard
            onUnlockPress={() => navigation.navigate('LocationPermission', {})}
          />
        ) : forecastLoading && forecast.length === 0 ? (
          // First-load placeholder for the forecast chart. Mirrors the
          // occupancy-side first-load UX (full-screen spinner) so the user
          // sees an in-progress signal instead of an empty card. Subsequent
          // 15-min polls keep `forecastLoading` false, so this never flashes
          // on background refresh.
          <View style={[styles.forecastLoadingCard, { backgroundColor: colors.white }]}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.textPrimary }]}>
              Loading forecast…
            </Text>
          </View>
        ) : (
          <HourlyChart data={forecast}/>
        )}

        {/* Lot Amenities & Details */}
        <LotAmenities lot={lot} />
      </ScrollView>

      {/* Report Button */}
      <TouchableOpacity
        style={[styles.fab, { bottom: SPACING.xxl + insets.bottom }]}
        onPress={() => setIsReportModalOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Report an incident"
        importantForAccessibility="yes"
      >
        <Icon
          name="warning"
          size={TYPOGRAPHY.fontSize.xxxxl}
          color={COLORS.white}
          accessible={false}
        />
      </TouchableOpacity>

      {/* Navigate Button (bottom right, symmetric to report button) */}
      <TouchableOpacity
        style={[styles.fabNavigate, { backgroundColor: navigateFabBg, bottom: SPACING.xxl + insets.bottom }]}
        onPress={() => setIsMapModalOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Navigate to lot"
        importantForAccessibility="yes"
      >
        <Icon name="navigate" size={TYPOGRAPHY.fontSize.xxl} color={navigateFabFg} accessible={false} />
      </TouchableOpacity>

      {/* Incident Report Modal */}
      <ReportModal
        lotDisplayName={lot.lot_id}
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        onSubmit={handleReportSubmit}
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

  // Leave headroom at the bottom so the floating Report / Navigate FABs
  // don't overlap the last card while the user is reading it.
  scrollContent: {
    paddingBottom: 40,
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
    // Anchor for the absolutely-positioned reliability footnote in the
    // top-right corner so it doesn't disturb the centered layout.
    position: 'relative',
  },

  // Subtle data-quality footnote anchored to the card's top-right.
  // Pulled out of flow so toggling it on/off (cold-start, loading) has
  // zero impact on the centered occupancy hierarchy below it.
  reliabilityCorner: {
    position: 'absolute',
    top: SPACING.md,
    right: SPACING.md,
    zIndex: 1,
  },

  // Wraps the "Live Occupancy" caption + colored percentage badge so
  // they sit together as a single unit (caption hugs the badge instead
  // of inheriting the parent's `gap`).
  occupancyGroup: {
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },

  // Small caption above the occupancy badge so a first-time user
  // immediately understands what the percentage represents.
  occupancyLabel: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
  },

  // Empty/no-data variant — invisible chip that reserves layout height
  // so the card doesn't jump if a lot truly has no occupancy_rate.
  statusBadgeEmpty: {
    backgroundColor: 'transparent',
  },

  // Wraps the locked occupancy badge + Unlock CTA so they share consistent
  // vertical rhythm (and so the CTA stays visually grouped with what it
  // unlocks rather than floating into the reliability meter row below).
  lockedGroup: {
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm,  },

  // Inline freshness indicator under the reliability meter / locked group.
  // Tap target spans the whole row so the user can refresh on demand without
  // hunting for a tiny button.
  updatedRow: {
    position: 'absolute',
    right: SPACING.md,
    bottom: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.xs,
  },
  updatedText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  // (No reserved-height slot — the freshness label above is absolutely
  // positioned over the bottom-right of the lot header card so toggling it
  // on/off has zero impact on layout.)
  // First-load placeholder for the forecast chart card. Height matches
  // HourlyChart's rendered height (chart 200 + label paddings) so swapping
  // in the real chart doesn't shift the page.
  forecastLoadingCard: {
    height: 280,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  // (No reserved-height slot — the freshness label above is absolutely
  // positioned over the bottom-right of the lot header card so toggling it
  // on/off has zero impact on layout.)
  // (Reliability meter previously lived here as an inline reserved-height
  // slot; it's now an absolute pill in the top-right corner of the lot
  // header card so the centered occupancy column keeps its visual
  // hierarchy and the slot height no longer reserves dead space.)

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