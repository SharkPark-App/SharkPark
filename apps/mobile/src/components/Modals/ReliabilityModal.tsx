import React, { useEffect, useRef, useMemo } from 'react';
import {
  View, Modal, TouchableOpacity,
  StyleSheet, Animated, Dimensions,
} from 'react-native';
import { Text } from '../CustomText';
import Icon from 'react-native-vector-icons/Ionicons';
import { ReliabilityBar } from '../ReliabilityMeter';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { SPACING, TYPOGRAPHY } from '../../constants/theme';
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
    userReports: 'User Reports',
  };
  return names[key] || key;
}

function getFactorColor(normalizedValue: number): string {
  if (normalizedValue >= 0.7) return CONFIDENCE_COLORS.HIGH;
  if (normalizedValue >= 0.4) return CONFIDENCE_COLORS.MEDIUM;
  return CONFIDENCE_COLORS.LOW;
}

export function ReliabilityModal({ isOpen, onClose, reliability }: ReliabilityModalProps) {
  const { colors, spacing, typography } = useTheme();
  const slideAnim = useRef(new Animated.Value(Dimensions.get('window').height)).current;

  const styles = useMemo(() => getStyles(colors, spacing, typography), [colors, spacing, typography]);

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
              <TouchableOpacity
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Icon name="close" size={24} color={colors.textPrimary} accessible={false} />
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
                      <Icon name="information-circle" size={16} color={colors.warningBorder} />
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
                    <View
                      key={key}
                      style={styles.factorRow}
                      accessible={true}
                      accessibilityLabel={`${formatFactorName(key)}: ${Math.round(factor.normalizedValue * 100)}%`}
                    >
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

const getStyles = (
  colors: ThemeColors, 
  spacing: typeof SPACING, 
  typography: typeof TYPOGRAPHY
) => StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: spacing.xl,
    borderTopRightRadius: spacing.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl + spacing.xl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  scoreSection: {
    marginBottom: spacing.xl,
  },
  coldStartWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.warningLight,
    borderRadius: spacing.sm,
  },
  coldStartWarningText: {
    fontSize: typography.fontSize.sm,
    color: colors.warningText,
    flex: 1,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.md,
  },
  factorsList: {
    gap: spacing.md,
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
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  factorWeight: {
    fontSize: typography.fontSize.xs,
  },
  factorScore: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
    fontSize: typography.fontSize.xs,
    width: 32,
    textAlign: 'right',
  },
  explanationBox: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: spacing.md,
  },
  explanationText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    textAlign: 'center',
  },
});
