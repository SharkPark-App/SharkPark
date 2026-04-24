import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { ThemeColors } from '../../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../../constants/theme';

/**
 * Stop Modal that appears upon stop selection.
 */
export interface RouteArrival {
  route: string;
  routeName: string;
  abbreviation: string;
  color: string;
  etaMinutes: number | null;
}

interface StopModalProps {
  isOpen: boolean;
  onClose: () => void;
  stopName: string;
  arrivals: RouteArrival[];
  colors: ThemeColors;
}

export const StopModal: React.FC<StopModalProps> = ({ 
  isOpen, 
  onClose, 
  stopName, 
  arrivals, 
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
                <TouchableOpacity onPress={onClose} style={styles.iconButton}>
                  <Icon name="close" size={28} color={colors.darkGray} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Divider Line */}
            <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

            {/* Arrivals List */}
            <View style={styles.arrivalsContainer}>
              {arrivals.length === 0 ? (
                <Text style={[styles.emptyText, { color: colors.darkGray }]}>No upcoming arrivals.</Text>
              ) : (
                arrivals.map((arrival, index) => (
                  <View key={`${arrival.route}-${index}`} style={styles.arrivalRow}>
                    
                    {/* Badge and Route Name */}
                    <View style={styles.routeInfo}>
                      <View style={[styles.routeBadge, { backgroundColor: arrival.color }]}>
                        <Text style={styles.badgeText}>{arrival.abbreviation}</Text>
                      </View>
                      <Text style={[styles.routeName, { color: colors.textPrimary }]}>
                        {arrival.routeName}
                      </Text>
                    </View>

                    {/* ETA */}
                    <Text style={[styles.etaText, { color: colors.textPrimary }]}>
                      {arrival.etaMinutes !== null ? `${arrival.etaMinutes} min` : 'no vehicles'}
                    </Text>
                  </View>
                ))
              )}
            </View>

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
  }
});