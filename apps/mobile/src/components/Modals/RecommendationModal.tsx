import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, Modal,
  TouchableOpacity, ScrollView,
  StyleSheet, Pressable,
  ActivityIndicator,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { useLotsList } from '../../hooks/useLotData';
import { getOccupancyColor } from '../../utils/parkingUtils';
import { lotsApi, LotRecommendation } from '../../services/api';

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
  const { lots, loading: lotsLoading } = useLotsList();
  const [step, setStep] = useState<Step>('favorites');
  const [sourceLotId, setSourceLotId] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<LotRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Animated value: -1 = exiting left, 0 = centered, 1 = exiting right
  const slideAnim = useRef(new Animated.Value(0)).current;

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
    } catch {
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
  }, [slideAnim]);

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
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      );
    }

    if (favoriteLots.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="star-outline" size={40} color={COLORS.mediumGray} />
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
          const pct = Math.round(lot.occupancy_rate * 100);
          const color = getOccupancyColor(pct);
          return (
            <View key={lot.lot_id} style={styles.lotRow}>
              {/* Tap row → go to forecast */}
              <TouchableOpacity
                style={styles.infoContainer}
                onPress={() => handleSelectLot(lot.lot_id, lot.lot_name)}
                activeOpacity={0.7}
              >
                <View style={styles.lotHeader}>
                  <Text style={styles.lotName}>{lot.lot_name}</Text>
                  <View style={[styles.pctBadge, { backgroundColor: color }]}>
                    <Text style={styles.pctBadgeText}>{pct}%</Text>
                  </View>
                </View>
                <Text style={styles.occupancyText}>
                  ~{lot.estimated_occupancy ?? lot.current_occupancy} / {lot.capacity} spots taken
                </Text>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${pct}%`, backgroundColor: color },
                    ]}
                  />
                </View>
              </TouchableOpacity>

              {/* Tap icon → find alternatives */}
              <TouchableOpacity
                style={styles.altButton}
                onPress={() => handleFindAlternatives(lot.lot_id)}
                activeOpacity={0.6}
              >
                <Icon name="swap-horizontal" size={20} color={COLORS.secondary} />
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
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.loadingText}>Finding alternatives…</Text>
    </View>
  );

  // ─── Alternatives list ───
  const renderAlternatives = () => {
    if (error) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="alert-circle-outline" size={40} color={COLORS.error} />
          <Text style={styles.emptyTitle}>Something went wrong</Text>
          <Text style={styles.emptySubtext}>{error}</Text>
        </View>
      );
    }

    if (recommendations.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="car-outline" size={40} color={COLORS.mediumGray} />
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
            Alternatives to {sourceLot.lot_name} ({Math.round(sourceLot.occupancy_rate * 100)}% full)
          </Text>
        )}
        {recommendations.map((rec) => {
          const pct = Math.round(rec.occupancy_rate * 100);
          const color = getOccupancyColor(pct);
          return (
            <TouchableOpacity
              key={rec.lot_id}
              style={styles.lotRow}
              onPress={() => handleSelectLot(rec.lot_id, rec.lot_name)}
              activeOpacity={0.7}
            >
              <View style={styles.infoContainer}>
                <View style={styles.lotHeader}>
                  <Text style={styles.lotName}>{rec.lot_name}</Text>
                  <View style={[styles.pctBadge, { backgroundColor: color }]}>
                    <Text style={styles.pctBadgeText}>{pct}%</Text>
                  </View>
                </View>
                <Text style={styles.occupancyText}>
                  ~{rec.estimated_occupancy ?? rec.current_occupancy} / {rec.capacity} spots taken
                </Text>
                <Text style={styles.reasonText}>
                  {rec.reason}
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
              <Text style={styles.arrow}>›</Text>
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
              <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                <Icon name="arrow-back" size={20} color={COLORS.textPrimary} />
              </TouchableOpacity>
            )}
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <Text style={styles.closeIcon}>✕</Text>
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  backdropPress: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modal: {
    backgroundColor: COLORS.white,
    borderRadius: SPACING.xl,
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
    padding: SPACING.xl,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderGray,
  },
  title: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.textPrimary,
  },
  backButton: {
    padding: 6,
    marginRight: SPACING.md,
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
  },
  closeIcon: {
    fontSize: 20,
    color: COLORS.mediumGray,
  },
  scrollContent: {
    padding: SPACING.lg,
  },
  stepHint: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.mediumGray,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  lotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightGray,
    padding: SPACING.xl,
    borderRadius: SPACING.md,
    marginBottom: SPACING.md,
  },
  infoContainer: {
    flex: 1,
  },
  lotHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: 2,
  },
  lotName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    flex: 1,
    flexShrink: 1,
  },
  pctBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    flexShrink: 0,
  },
  pctBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.white,
  },
  occupancyText: {
    fontSize: 14,
    color: COLORS.mediumGray,
    marginVertical: 2,
  },
  reasonText: {
    fontSize: 13,
    color: COLORS.secondary,
    marginBottom: 4,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: COLORS.borderGray,
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
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    marginLeft: SPACING.md,
    borderRadius: SPACING.md,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.borderGray,
  },
  altButtonText: {
    fontSize: 11,
    color: COLORS.secondary,
    fontWeight: '600',
    marginTop: 2,
  },
  arrow: {
    fontSize: 24,
    color: COLORS.mediumGray,
    marginLeft: SPACING.md,
  },
  loaderContainer: {
    padding: 50,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SPACING.lg,
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.mediumGray,
  },
  emptyContainer: {
    padding: SPACING.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.darkGray,
    marginTop: SPACING.lg,
    marginBottom: SPACING.xs,
  },
  emptySubtext: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.mediumGray,
    textAlign: 'center',
    lineHeight: 20,
  },
});
