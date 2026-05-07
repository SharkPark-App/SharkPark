import React from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { Text } from '../CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { ThemeColors } from '../../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../../constants/theme';
import type { MapShuttle } from '../../types/transit';

interface ShuttleModalProps {
  visible: boolean;
  onClose: () => void;
  shuttle: MapShuttle | null;
  colors: ThemeColors;
}

interface PassengerLoadInfo {
  text: string;
  percent: number;
}

/** Map raw passenger / capacity counts to a friendly load category. */
const getPassengerLoadInfo = (paxLoad: number, capacity: number): PassengerLoadInfo => {
  const percent = capacity > 0 ? Math.min(100, Math.round((paxLoad / capacity) * 100)) : 0;
  let text: string;
  if (percent >= 85) text = 'Very crowded';
  else if (percent >= 50) text = 'Crowded';
  else if (percent >= 20) text = 'Not too crowded';
  else if (percent > 0) text = 'Not crowded';
  else text = 'Empty';
  return { text, percent };
};

/**
 * Bottom-sheet style modal that appears when the user taps a live shuttle
 * marker. Apple MapKit auto-dismisses callouts whenever the marker
 * coordinate changes, so we surface shuttle details in a modal instead —
 * the modal subscribes to live shuttle data via the parent screen, so
 * passenger load / route info update in real time as the socket pushes.
 */
export const ShuttleModal: React.FC<ShuttleModalProps> = ({
  visible,
  onClose,
  shuttle,
  colors,
}) => {
  if (!shuttle) {
    return null;
  }

  const markerColor = shuttle.color || colors.primary;
  const { text: loadText, percent } = getPassengerLoadInfo(shuttle.paxLoad, shuttle.capacity);

  return (
    <Modal visible={visible} transparent={true} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
        accessible={false}
      >
        <TouchableWithoutFeedback>
          <View style={[styles.card, { backgroundColor: colors.backgroundLight, shadowColor: colors.shadowDark }]}>

            {/* Header: bus badge + name + close */}
            <View style={styles.header}>
              <View style={styles.titleContainer}>
                <View style={[styles.badge, { backgroundColor: markerColor }]} accessible={false}>
                  <Icon name="bus" size={TYPOGRAPHY.fontSize.lg} color={colors.white} />
                </View>
                <Text
                  style={[styles.busName, { color: colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {shuttle.busName}
                </Text>
              </View>

              <TouchableOpacity
                onPress={onClose}
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel="Close shuttle details"
              >
                <Icon name="close" size={28} color={colors.darkGray} accessible={false} />
              </TouchableOpacity>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

            {/* Body */}
            <View style={styles.body}>
              {/* Route */}
              <View style={styles.row}>
                <Icon name="navigate" size={TYPOGRAPHY.fontSize.md} color={colors.darkGray} accessible={false} />
                <Text style={[styles.rowText, { color: colors.textPrimary }]}>
                  {shuttle.route || 'Unknown'}
                </Text>
              </View>

              {/* Passenger load */}
              <View style={styles.row}>
                <Icon name="people" size={TYPOGRAPHY.fontSize.md} color={colors.darkGray} accessible={false} />
                <Text style={[styles.rowText, { color: colors.textPrimary }]}>
                  {shuttle.capacity > 0 ? `${loadText} (${percent}%)` : 'Unknown'}
                </Text>
              </View>

              {shuttle.capacity > 0 && (
                <Text style={[styles.subText, { color: colors.darkGray }]}>
                  {shuttle.paxLoad} / {shuttle.capacity} passengers
                </Text>
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
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
    gap: SPACING.sm,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  busName: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: 'bold',
    flexShrink: 1,
  },
  iconButton: {
    padding: 4,
  },
  divider: {
    height: 1,
    width: '100%',
    marginBottom: SPACING.md,
  },
  body: {
    gap: SPACING.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  rowText: {
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  subText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginTop: SPACING.xs,
  },
});
