import React, { useEffect, useRef } from 'react';
import {
  View, Text, Modal, TouchableOpacity,
  StyleSheet, Animated, Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, TYPOGRAPHY, SPACING } from '../../constants/theme';
import { ReliabilityBar } from '../ReliabilityMeter';
import { useTheme } from '../../context/ThemeContext';
import { CONFIDENCE_COLORS, CONFIDENCE_LABELS } from '../../types/reliability';
import type { ReliabilityScore } from '../../types/reliability';

interface ReliabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  reliability: ReliabilityScore | null;
}

function formatFactorName(key: string): string {
  const names: Record<string, string> = {
    penetrationRate: 'App Usage',
    dataFreshness: 'Data Freshness',
    eventFrequency: 'Event Frequency',
    sampleSize: 'Sample Size',
    historicalAccuracy: 'Historical Accuracy',
  };
  return names[key] || key;
}

function getFactorColor(normalizedValue: number): string {
  if (normalizedValue >= 0.7) return CONFIDENCE_COLORS.HIGH;
  if (normalizedValue >= 0.4) return CONFIDENCE_COLORS.MEDIUM;
  return CONFIDENCE_COLORS.LOW;
}

export function ReliabilityModal({ isOpen, onClose, reliability }: ReliabilityModalProps) {
  const { colors } = useTheme();
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      slideAnim.setValue(Dimensions.get('window').height);
    }
  }, [isOpen, slideAnim]);

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: Dimensions.get('window').height,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  return (
    <Modal
      visible={isOpen}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={handleClose}
      >
        <Animated.View
          style={[
            styles.modalContent,
            {
              backgroundColor: colors.white,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <TouchableOpacity activeOpacity={1}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                Data Reliability
              </Text>
              <TouchableOpacity onPress={handleClose}>
                <Icon name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {reliability && (
              <>
                {/* Overall Score */}
                <View style={styles.scoreSection}>
                  <ReliabilityBar
                    score={reliability.score}
                    confidence={reliability.confidence}
                    showLabel
                  />
                  {reliability.isColdStart && (
                    <View style={styles.coldStartWarning}>
                      <Icon name="information-circle" size={16} color={COLORS.warningBorder} />
                      <Text style={styles.coldStartWarningText}>
                        Limited data available - accuracy may vary
                      </Text>
                    </View>
                  )}
                </View>

                {/* Factor Breakdown */}
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                  Confidence Factors
                </Text>
                <View style={styles.factorsList}>
                  {Object.entries(reliability.factors).map(([key, factor]) => (
                    <View key={key} style={styles.factorRow}>
                      <View style={styles.factorInfo}>
                        <Text style={[styles.factorName, { color: colors.textPrimary }]}>
                          {formatFactorName(key)}
                        </Text>
                        <Text style={[styles.factorWeight, { color: colors.gray }]}>
                          Weight: {Math.round(factor.weight * 100)}%
                        </Text>
                      </View>
                      <View style={styles.factorScore}>
                        <View style={styles.factorBarBg}>
                          <View
                            style={[
                              styles.factorBarFill,
                              {
                                width: `${Math.round(factor.normalizedValue * 100)}%`,
                                backgroundColor: getFactorColor(factor.normalizedValue),
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.factorValue, { color: colors.gray }]}>
                          {Math.round(factor.normalizedValue * 100)}%
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Explanation */}
                <View style={[styles.explanationBox, { backgroundColor: `${CONFIDENCE_COLORS[reliability.confidence]}15` }]}>
                  <Text style={[styles.explanationText, { color: CONFIDENCE_COLORS[reliability.confidence] }]}>
                    {reliability.explanation || CONFIDENCE_LABELS[reliability.confidence]}
                  </Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: SPACING.xl,
    borderTopRightRadius: SPACING.xl,
    padding: SPACING.xl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
  },
  scoreSection: {
    marginBottom: SPACING.xl,
  },
  coldStartWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.warningLight,
    borderRadius: SPACING.sm,
  },
  coldStartWarningText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.warningText,
    flex: 1,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    marginBottom: SPACING.md,
  },
  factorsList: {
    gap: SPACING.md,
  },
  factorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  factorInfo: {
    flex: 1,
  },
  factorName: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
  },
  factorWeight: {
    fontSize: TYPOGRAPHY.fontSize.xs,
  },
  factorScore: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  factorBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  factorBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  factorValue: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    width: 32,
    textAlign: 'right',
  },
  explanationBox: {
    marginTop: SPACING.xl,
    padding: SPACING.lg,
    borderRadius: SPACING.md,
  },
  explanationText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontWeight: TYPOGRAPHY.fontWeight.medium,
    textAlign: 'center',
  },
});
