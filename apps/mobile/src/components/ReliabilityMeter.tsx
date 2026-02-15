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

export const ReliabilityMeter: React.FC<ReliabilityMeterProps> = ({
  confidence,
  score,
  isColdStart = false,
  size = 'medium',
  showScore = false,
  showLabel = false,
  onPress,
  style,
}) => {
  const color = CONFIDENCE_COLORS[confidence];
  const label = CONFIDENCE_LABELS[confidence];

  const containerStyle = [
    styles.container,
    styles[`container_${size}`],
    { backgroundColor: `${color}15`, borderColor: color },
    style,
  ];

  const textStyle = [styles.text, styles[`text_${size}`], { color }];

  const content = (
    <>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {showScore && score !== undefined && <Text style={textStyle}>{score}</Text>}
      <Text style={textStyle}>{showLabel ? label : confidence}</Text>
      {isColdStart && (
        <View style={styles.coldStartBadge}>
          <Text style={styles.coldStartText}>β</Text>
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={containerStyle}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityLabel={`Reliability: ${label}`}
        accessibilityHint="Tap to see reliability details"
        accessibilityRole="button"
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View style={containerStyle} accessibilityLabel={`Reliability: ${label}`}>
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  } as ViewStyle,
  container_small: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  } as ViewStyle,
  container_medium: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  } as ViewStyle,
  container_large: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  } as ViewStyle,
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  } as ViewStyle,
  dotOnly: {
    // Styles applied inline
  } as ViewStyle,
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
