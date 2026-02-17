import React, { useMemo } from 'react';
import {
  View, Text, Modal,
  TouchableOpacity, ScrollView,
  StyleSheet, Pressable,
  ActivityIndicator
} from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { useLotsList } from '../../hooks/useLotData';
import { getOccupancyColor } from '../../utils/parkingUtils';

interface NavigationModalProps {
  isOpen: boolean;
  lotIdList: string[];
  onClose: () => void;
}

export function NavigationModal({ isOpen, lotIdList, onClose }: NavigationModalProps) {
  const { lots, loading } = useLotsList();

  const displayLots = useMemo(() => {
    if (!lotIdList) return [];
    return lots.filter(lot => lotIdList.includes(lot.lot_id));
  }, [lots, lotIdList]);

  const handleLotPress = (lotId: string) => {
    // TODO: open third-party map service (dependent: real-world lot coordinates)
    if (__DEV__) console.log(`[NavigationModal] ${lotId} selected for navigation`);
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={onClose} />

        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>Lot Navigation Selection</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : displayLots.length === 0 ? (
                /* Empty State View */
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyTitle}>No Favorites Yet</Text>
                  <Text style={styles.emptySubtext}>
                    Favorited lots will appear here for quick navigation.
                  </Text>
                </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {displayLots.map((lot) => (
                <TouchableOpacity
                  key={lot.lot_id}
                  style={styles.lotRow}
                  onPress={() => handleLotPress(lot.lot_id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.infoContainer}>
                    <Text style={styles.lotName}>{lot.lot_name}</Text>
                    <Text style={styles.occupancyText}>
                      ~{Math.round(lot.occupancy_rate * lot.capacity)} / {lot.capacity} spots taken
                    </Text>

                    {/* Visual Occupancy Bar */}
                    <View style={styles.progressBarBg}>
                      <View
                        style={[
                          styles.progressBarFill,
                          {width: `${Math.round(lot.occupancy_rate * 100)}%`},
                          {backgroundColor: getOccupancyColor(Math.round(lot.occupancy_rate * 100))}
                        ]}
                      />
                    </View>
                  </View>

                  <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
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
    maxHeight: '85%',
    overflow: 'hidden',
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
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.textPrimary,
  },
  scrollContent: {
    padding: SPACING.lg,
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
  lotName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  occupancyText: {
    fontSize: 14,
    color: COLORS.mediumGray,
    marginVertical: 4,
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
    backgroundColor: COLORS.primary,
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
  closeIcon: {
    fontSize: 20,
    color: COLORS.mediumGray,
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
  },
  emptyContainer: {
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.darkGray,
    marginBottom: SPACING.xs,
  },
  emptySubtext: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.mediumGray,
    textAlign: 'center',
    lineHeight: 20,
  },
});