import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Modal,
  TouchableOpacity, ScrollView,
  StyleSheet, Pressable,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Text } from '../CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { SPACING, TYPOGRAPHY } from '../../constants/theme';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useLotsList } from '../../hooks/useLotData';
import { getOccupancyColorGradient, getReadableTextColor } from '../../utils/parkingUtils';
import { formatDistance } from '../../utils/geoHelpers';
import { useLocalizationSettings } from '../../hooks/useLocalizationSettings';
import { LockedOccupancyBadge } from '..';
import { lotsApi, LotRecommendation, BackgroundLocationRequiredError } from '../../services/api';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MapStackParamList } from '../../types/navigation';

interface RecommendationModalProps {
  isOpen: boolean;
  favoriteLotIds: string[];
  onClose: () => void;
  onSelectLot: (lotId: string, lotName: string) => void;
}

type Step = 'favorites' | 'loading' | 'alternatives';

/**
 * Combined Favorites & Recommendations modal.
 *
 * Step 1 ("favorites"): Shows the user's favorite lots.
 *   - Tap a row → navigate to that lot's forecast.
 *   - Tap the "Alts" icon → fetch alternatives for that lot.
 *
 * Step 2 ("alternatives"): Shows recommended lots for the selected source.
 *   - Tap a row → navigate to that lot's forecast.
 *   - Back arrow → return to favorites list.
 */
export function RecommendationModal({
  isOpen,
  favoriteLotIds,
  onClose,
  onSelectLot,
}: RecommendationModalProps) {
  const { colors, spacing, typography, isDark } = useTheme();
  // Re-render the recommendation list when the user changes their region in
  // Settings, so the "X mi away" / "X km away" labels flip immediately.
  useLocalizationSettings();
  const { lots, loading: lotsLoading } = useLotsList();
  const navigation = useNavigation<StackNavigationProp<MapStackParamList>>();
  const [step, setStep] = useState<Step>('favorites');
  const [sourceLotId, setSourceLotId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<LotRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Animated value: -1 = exiting left, 0 = centered, 1 = exiting right
  const slideAnim = useRef(new Animated.Value(0)).current;

  const styles = useMemo(() => getStyles(colors, spacing, typography, isDark), [colors, spacing, typography, isDark]);

  const favoriteLots = useMemo(() => {
    if (!favoriteLotIds || favoriteLotIds.length === 0) return [];
    return lots.filter(lot => favoriteLotIds.includes(lot.lot_id));
  }, [lots, favoriteLotIds]);

  const sourceLot = useMemo(() => {
    if (!sourceLotId) return null;
    return lots.find(l => l.lot_id === sourceLotId) ?? null;
  }, [lots, sourceLotId]);

  /** Slide content out, swap step, slide new content in. */
  const animateTransition = useCallback(
    (newStep: Step, direction: 'forward' | 'back', prepare?: () => void) => {
      const exitValue = direction === 'forward' ? -1 : 1;
      const enterValue = direction === 'forward' ? 1 : -1;

      Animated.timing(slideAnim, {
        toValue: exitValue,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        prepare?.();
        setStep(newStep);
        slideAnim.setValue(enterValue);
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }).start();
      });
    },
    [slideAnim],
  );

  const handleFindAlternatives = useCallback(async (lotId: string) => {
    setSourceLotId(lotId);
    setError(null);
    setStep('loading');

    // Start the exit animation immediately
    const exitValue = -1;
    const enterValue = 1;
    Animated.timing(slideAnim, {
      toValue: exitValue,
      duration: 180,
      useNativeDriver: true,
    }).start();

    try {
      const results = await lotsApi.getRecommendedLots(lotId);
      setRecommendations(results);
      setStep('alternatives');
    } catch (err) {
      if (err instanceof BackgroundLocationRequiredError) {
        // Reset modal state BEFORE closing + navigating so the next time the
        // user opens the favorites modal it doesn't reopen mid-loading-state
        // with a half-completed slide animation. Mirrors handleClose().
        slideAnim.setValue(0);
        setStep('favorites');
        setSourceLotId(null);
        setRecommendations([]);
        setError(null);
        onClose();
        navigation.navigate('LocationPermission', {});
        return;
      }
      setError('Could not load recommendations. Please try again.');
      setStep('alternatives');
    }

    // Slide the new content in
    slideAnim.setValue(enterValue);
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: true,
    }).start();
  }, [slideAnim, navigation, onClose]);

  const handleBack = () => {
    animateTransition('favorites', 'back', () => {
      setSourceLotId(null);
      setRecommendations([]);
      setError(null);
    });
  };

  const handleClose = () => {
    slideAnim.setValue(0);
    setStep('favorites');
    setSourceLotId(null);
    setRecommendations([]);
    setError(null);
    onClose();
  };

  const handleSelectLot = (lotId: string, lotName: string) => {
    handleClose();
    onSelectLot(lotId, lotName);
  };

  // ─── Favorites list ───
  const renderFavorites = () => {
    if (lotsLoading) {
      return (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

    if (favoriteLots.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="star-outline" size={40} color={colors.mediumGray} />
          <Text style={styles.emptyTitle}>No Favorite Lots</Text>
          <Text style={styles.emptySubtext}>
            Star a lot from its forecast page to see it here and get personalized recommendations.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {favoriteLots.map((lot) => {
          // Favorite-list lots come from `GET /lots` which redacts live data
          // for non-contributors. Render a neutral "locked" badge in that
          // case; recommendations themselves are contributor-gated so the
          // alternatives view below always has live data.
          const isLocked = lot.occupancy_rate == null;
          const pct = isLocked ? null : Math.round(lot.occupancy_rate! * 100);
          const color = isLocked ? colors.neutralPin : getOccupancyColorGradient(pct!);
          const badgeTextColor = isLocked ? colors.white : getReadableTextColor(color);
          return (
            <View key={lot.lot_id} style={styles.lotRow}>
              {/* Tap row → go to forecast */}
              <TouchableOpacity
                style={styles.infoContainer}
                onPress={() => handleSelectLot(lot.lot_id, lot.lot_name)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={isLocked ? `${lot.lot_name}, live occupancy locked` : `${lot.lot_name}, ${pct}% full`}
              >
                <View style={styles.lotHeader}>
                  <Text style={styles.lotName}>{lot.lot_name}</Text>
                  {isLocked ? (
                    <LockedOccupancyBadge
                      size="sm"
                      style={styles.pctBadgeLocked}
                      accessibilityLabel={`${lot.lot_name} live occupancy locked`}
                    />
                  ) : (
                    <View style={[styles.pctBadge, { backgroundColor: color }]}>
                      <Text style={[styles.pctBadgeText, { color: badgeTextColor }]}>{`${pct}%`}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.occupancyText}>
                  {isLocked
                    ? `${lot.capacity} total spots`
                    : `~${lot.estimated_occupancy ?? lot.current_occupancy ?? 0} / ${lot.capacity} spots taken`}
                </Text>
                {!isLocked && pct != null && (
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${pct}%`, backgroundColor: color },
                      ]}
                    />
                  </View>
                )}
              </TouchableOpacity>

              {/* Tap icon → find alternatives */}
              <TouchableOpacity
                style={styles.altButton}
                onPress={() => handleFindAlternatives(lot.lot_id)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={`Find alternatives to ${lot.lot_name}`}
              >
                <Icon name="swap-horizontal" size={20} color={isDark ? colors.primary : colors.secondary} />
                <Text style={styles.altButtonText}>Alts</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // ─── Loading state ───
  const renderLoading = () => (
    <View style={styles.loaderContainer}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>Finding alternatives…</Text>
    </View>
  );

  // ─── Alternatives list ───
  const renderAlternatives = () => {
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="alert-circle-outline" size={40} color={colors.error} />
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptySubtext}>{error}</Text>
        </View>
      );
    }

    if (recommendations.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="car-outline" size={40} color={colors.mediumGray} />
          <Text style={styles.emptyTitle}>No Alternatives Found</Text>
          <Text style={styles.emptySubtext}>
            All similar lots are currently full. Try again later.
          </Text>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {sourceLot && (
          <Text style={styles.stepHint}>
            Alternatives to {sourceLot.lot_name} ({Math.round((sourceLot.occupancy_rate ?? 0) * 100)}% full)
          </Text>
        )}
        {recommendations.map((rec) => {
          // The recommendations endpoint is contributor-gated, so live fields
          // are always present here. `?? 0` keeps the type checker happy
          // without changing runtime behavior on the success path.
          const pct = Math.round((rec.occupancy_rate ?? 0) * 100);
          const color = getOccupancyColorGradient(pct);
          const badgeTextColor = getReadableTextColor(color);
          return (
            <TouchableOpacity
              key={rec.lot_id}
              style={styles.lotRow}
              onPress={() => handleSelectLot(rec.lot_id, rec.lot_name)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${rec.lot_name}, ${pct}% full`}
            >
              <View style={styles.infoContainer}>
                <View style={styles.lotHeader}>
                  <Text style={styles.lotName}>{rec.lot_name}</Text>
                  <View style={[styles.pctBadge, { backgroundColor: color }]}>
                    <Text style={[styles.pctBadgeText, { color: badgeTextColor }]}>{pct}%</Text>
                  </View>
                </View>
                <Text style={styles.occupancyText}>
                  ~{rec.estimated_occupancy ?? rec.current_occupancy} / {rec.capacity} spots taken
                </Text>
                <Text style={styles.reasonText}>
                  {formatDistance(rec.distance_meters)} away · {rec.reason}
                </Text>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${pct}%`, backgroundColor: color },
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.arrow} accessible={false}>›</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  const title = step === 'favorites' ? 'My Lots' : 'Recommended Lots';

  return (
    <Modal visible={isOpen} transparent onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={handleClose} />

        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            {step === 'alternatives' && (
              <TouchableOpacity
                onPress={handleBack}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Go back to favorites"
              >
                <Icon name="arrow-back" size={20} color={colors.textPrimary} accessible={false} />
              </TouchableOpacity>
            )}
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.closeIcon} accessible={false}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Body — animated container with slide transition */}
          <Animated.View
            style={[
              styles.body,
              {
                opacity: slideAnim.interpolate({
                  inputRange: [-1, 0, 1],
                  outputRange: [0, 1, 0],
                }),
                transform: [{
                  translateX: slideAnim.interpolate({
                    inputRange: [-1, 0, 1],
                    outputRange: [-80, 0, 80],
                  }),
                }],
              },
            ]}
          >
            {step === 'favorites' && renderFavorites()}
            {step === 'loading' && renderLoading()}
            {step === 'alternatives' && renderAlternatives()}
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (
  colors: ThemeColors, 
  spacing: typeof SPACING, 
  typography: typeof TYPOGRAPHY,
  isDark: boolean
) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  backdropPress: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modal: {
    backgroundColor: colors.white,
    borderRadius: spacing.xl,
    width: '100%',
    maxWidth: 448,
    height: 480,
    overflow: 'hidden',
  },
  body: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderGray,
  },
  title: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: colors.textPrimary,
  },
  backButton: {
    padding: 6,
    marginRight: spacing.md,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIcon: {
    fontSize: 20,
    color: colors.mediumGray,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  stepHint: {
    fontSize: typography.fontSize.md,
    color: isDark? colors.darkGray : colors.mediumGray,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  lotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightGray,
    padding: spacing.xl,
    borderRadius: spacing.md,
    marginBottom: spacing.md,
  },
  infoContainer: {
    flex: 1,
  },
  lotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: 2,
  },
  lotName: {
    fontSize: 18,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: colors.textPrimary,
    flex: 1,
    flexShrink: 1,
  },
  pctBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    flexShrink: 0,
  },
  // Override LockedOccupancyBadge defaults so it lines up with the inline
  // numeric badge rather than the hero alignment used on the lot detail.
  pctBadgeLocked: {
    flexShrink: 0,
    marginBottom: 0,
    alignSelf: 'auto',
  },
  pctBadgeText: {
    fontSize: 12,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: colors.white,
  },
  occupancyText: {
    fontSize: 14,
    color: colors.mediumGray,
    marginVertical: 2,
  },
  reasonText: {
    fontSize: 13,
    color: isDark ? colors.primary : colors.secondary,
    marginBottom: 4,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: colors.borderGray,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
    width: '80%',
  },
  progressBarFill: {
    height: '100%',
  },
  altButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginLeft: spacing.md,
    borderRadius: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderGray,
  },
  altButtonText: {
    fontSize: 11,
    color: isDark ? colors.primary : colors.secondary,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginTop: 2,
  },
  arrow: {
    fontSize: 24,
    color: colors.mediumGray,
    marginLeft: spacing.md,
  },
  loaderContainer: {
    padding: 50,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.lg,
    fontSize: typography.fontSize.md,
    color: colors.mediumGray,
  },
  emptyContainer: {
    padding: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: colors.darkGray,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: typography.fontSize.md,
    color: colors.mediumGray,
    textAlign: 'center',
    lineHeight: 20,
  },
});
