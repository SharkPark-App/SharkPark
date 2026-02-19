/** ReliabilityMeter - Visual indicator for occupancy data confidence level */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle, TextStyle } from 'react-native';
import { ConfidenceLevel, CONFIDENCE_COLORS, CONFIDENCE_LABELS } from '../types/reliability';

export interface ReliabilityMeterProps {
  confidence: ConfidenceLevel;
  score?: number;
  isColdStart?: boolean;
  size?: 'small' | 'medium' | 'large';
  showScore?: boolean;
  showLabel?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

// Get user-friendly description based on confidence
const getConfidenceDescription = (confidence: ConfidenceLevel, isColdStart: boolean): string => {
  if (isColdStart) {
    return 'Limited Data';
  }
  switch (confidence) {
    case 'HIGH':
      return 'Reliable';
    case 'MEDIUM':
      return 'Moderate';
    case 'LOW':
      return 'Estimate';
    default:
      return 'Unknown';
  }
};

// Get icon based on confidence level
const getConfidenceIcon = (confidence: ConfidenceLevel): string => {
  switch (confidence) {
    case 'HIGH':
      return '✓';
    case 'MEDIUM':
      return '~';
    case 'LOW':
      return '?';
    default:
      return '•';
  }
};

export const ReliabilityMeter: React.FC<ReliabilityMeterProps> = ({
  confidence,
  isColdStart = false,
  size = 'medium',
  onPress,
  style,
}) => {
  const color = CONFIDENCE_COLORS[confidence];
  const description = getConfidenceDescription(confidence, isColdStart);
  const icon = getConfidenceIcon(confidence);

  const containerStyle = [
    styles.container,
    styles[`container_${size}`],
    { backgroundColor: `${color}15`, borderColor: color },
    style,
  ];

  const textStyle = [styles.text, styles[`text_${size}`], { color }];
  const iconStyle = [styles.icon, styles[`icon_${size}`], { color }];

  const content = (
    <>
      <Text style={iconStyle}>{icon}</Text>
      <Text style={textStyle}>{description}</Text>
      {onPress && <Text style={[styles.infoIcon, { color }]}>ⓘ</Text>}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={containerStyle}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityLabel={`Data reliability: ${description}`}
        accessibilityHint="Tap to see reliability details"
        accessibilityRole="button"
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={containerStyle} accessibilityLabel={`Data reliability: ${description}`}>
      {content}
    </View>
  );
};

/**
 * Compact reliability indicator (just a dot)
 */
export const ReliabilityDot: React.FC<{
  confidence: ConfidenceLevel;
  size?: number;
  style?: ViewStyle;
}> = ({ confidence, size = 8, style }) => {
  const color = CONFIDENCE_COLORS[confidence];

  return (
    <View
      style={[
        styles.dotOnly,
        { backgroundColor: color, width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
      accessibilityLabel={`Reliability: ${confidence}`}
    />
  );
};

/**
 * Reliability bar visualization (progress bar style)
 */
export const ReliabilityBar: React.FC<{
  score: number;
  confidence: ConfidenceLevel;
  showLabel?: boolean;
  style?: ViewStyle;
}> = ({ score, confidence, showLabel = false, style }) => {
  const color = CONFIDENCE_COLORS[confidence];
  const percentage = Math.min(100, Math.max(0, score));

  return (
    <View style={[styles.barContainer, style]}>
      {showLabel && (
        <Text style={[styles.barLabel, { color }]}>
          {CONFIDENCE_LABELS[confidence]}
        </Text>
      )}
      <View style={styles.barBackground}>
        <View
          style={[
            styles.barFill,
            { width: `${percentage}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={[styles.barScore, { color }]}>{score}%</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  } as ViewStyle,
  container_small: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  } as ViewStyle,
  container_medium: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 6,
  } as ViewStyle,
  container_large: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    gap: 8,
  } as ViewStyle,
  icon: {
    fontWeight: '700',
  } as TextStyle,
  icon_small: {
    fontSize: 10,
  } as TextStyle,
  icon_medium: {
    fontSize: 14,
  } as TextStyle,
  icon_large: {
    fontSize: 16,
  } as TextStyle,
  text: {
    fontWeight: '600',
  } as TextStyle,
  text_small: {
    fontSize: 10,
  } as TextStyle,
  text_medium: {
    fontSize: 12,
  } as TextStyle,
  text_large: {
    fontSize: 14,
  } as TextStyle,
  infoIcon: {
    fontSize: 12,
    marginLeft: 2,
    opacity: 0.8,
  } as TextStyle,
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  } as ViewStyle,
  dotOnly: {
    // Styles applied inline
  } as ViewStyle,
  coldStartBadge: {
    backgroundColor: '#9CA3AF',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 4,
  } as ViewStyle,
  coldStartText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#FFFFFF',
  } as TextStyle,
  barContainer: {
    width: '100%',
  } as ViewStyle,
  barBackground: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  } as ViewStyle,
  barFill: {
    height: '100%',
    borderRadius: 3,
  } as ViewStyle,
  barLabel: {
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 4,
  } as TextStyle,
  barScore: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'right',
  } as TextStyle,
});

export default ReliabilityMeter;
