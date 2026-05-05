import React from 'react';
import { View, ScrollView, StyleSheet, Modal, TouchableOpacity, TouchableWithoutFeedback, ActivityIndicator } from 'react-native';
import { Text } from '../CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { ThemeColors } from '../../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../../constants/theme';
import { RouteArrival } from '../../types/transit';

/**
 * Stop Modal that appears upon stop selection.
 */

interface StopModalProps {
  isOpen: boolean;
  onClose: () => void;
  stopName: string;
  arrivals: RouteArrival[];
  isLoading: boolean;
  colors: ThemeColors;
}

export const StopModal: React.FC<StopModalProps> = ({ 
  isOpen, 
  onClose, 
  stopName, 
  arrivals,
  isLoading,
  colors,
}) => {
  return (
    <Modal visible={isOpen} transparent={true} animationType="fade" onRequestClose={onClose}>
      {/* Background */}
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableWithoutFeedback>
          <View style={[styles.card, { backgroundColor: colors.backgroundLight, shadowColor: colors.shadowDark }]}>
            
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.titleContainer}>
                {/* Node Icon */}
                <Icon name="git-commit-outline" size={24} color={colors.textPrimary} style={{ transform: [{ rotate: '90deg' }] }} />
                <Text style={[styles.stopName, { color: colors.textPrimary }]} numberOfLines={1}>
                  {stopName}
                </Text>
              </View>

              <View style={styles.headerActions}>
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.iconButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close stop details"
                >
                  <Icon name="close" size={28} color={colors.darkGray} accessible={false} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Divider Line */}
            <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

            {/* Arrivals List. Reserve a min-height on the container so the
                loading spinner / empty state / populated list don't cause the
                modal card to jump in size as state transitions. Loading and
                empty branches center their content vertically inside the
                reserved space. */}
            <ScrollView style={styles.arrivalsContainer} contentContainerStyle={styles.arrivalsContent}>
              {isLoading ? (
                <View style={styles.stateContainer}>
                  <ActivityIndicator
                    size="large"
                    color={colors.primary}
                    accessible={true}
                    accessibilityLabel="Loading arrival times"
                  />
                  <Text style={[styles.loadingText, { color: colors.darkGray }]} accessible={false}>
                    Fetching live ETAs...
                  </Text>
                </View>
              ) : arrivals.length === 0 ? (
                <View style={styles.stateContainer}>
                  <Text style={[styles.emptyText, { color: colors.darkGray }]}>No upcoming arrivals.</Text>
                </View>
              ) : (
                arrivals.map((arrival, index) => (
                  <View
                    key={`${arrival.routeId}-${index}`}
                    style={styles.arrivalRow}
                    accessible={true}
                    accessibilityLabel={`Route ${arrival.routeName}. ${arrival.etaMinutes !== null ? `Arriving in ${arrival.etaMinutes} minutes` : 'No vehicles currently active'}.`}
                  >
                    
                    {/* Badge and Route Name */}
                    <View style={styles.routeInfo}>
                      <View style={[styles.routeBadge, { backgroundColor: arrival.color }]} accessible={false}>
                        <Text style={styles.badgeText}>{arrival.abbreviation}</Text>
                      </View>
                      <Text style={[styles.routeName, { color: colors.textPrimary }]} accessible={false}>
                        {arrival.routeName}
                      </Text>
                    </View>

                    {/* ETA */}
                    <Text style={[styles.etaText, { color: colors.textPrimary }]} accessible={false}>
                      {arrival.etaMinutes !== null ? `${arrival.etaMinutes} min` : 'no vehicles'}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)', // Low opacity
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 12,
    padding: SPACING.lg,
    elevation: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: SPACING.xs,
  },
  stopName: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: 'bold',
    flexShrink: 1, 
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  iconButton: {
    padding: 4, // Increases touch target size safely
  },
  divider: {
    height: 1,
    width: '100%',
    marginBottom: SPACING.md,
  },
  arrivalsContainer: {
    maxHeight: 300,
  },
  arrivalsContent: {
    gap: SPACING.md,
  },
  arrivalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  routeBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: 'bold',
  },
  routeName: {
    fontSize: TYPOGRAPHY.fontSize.lg,
  },
  etaText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontWeight: 'bold',
  },
  emptyText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
  loadingContainer: {
    padding: SPACING.xl,
    alignItems: 'center',
  },
  // Centers loading spinner / empty-state text inside the reserved minHeight
  // of arrivalsContainer so transitions don't bounce the modal card.
  stateContainer: {
    flex: 1,
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.md,
  }
});