import React, { useState, useEffect } from 'react';
import { View, StyleSheet, useWindowDimensions, TouchableOpacity } from 'react-native';
import { Text } from './CustomText';
import { BarChart } from 'react-native-gifted-charts';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

interface HourData {
  time: string;
  occupancy: number;
  lowerBound?: number;
  upperBound?: number;
}

interface HourlyChartProps {
  data: HourData[];
  name?: string;
}

export function HourlyChart({data, name}: HourlyChartProps) {
  const { colors } = useTheme();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const chartHeight = Math.round(screenHeight * 0.2);

  // Calculate bar dimensions to fill the available container width
  const chartWidth = screenWidth - SPACING.lg * 2 - SPACING.md * 2 - 20; // 20 for internal padding
  const barCount = data.length || 1;
  const barSpacing = 3;
  const initialSpacing = 6;
  // gifted-charts uses yAxisEmptyLabelWidth (10px) when hideYAxisText is true
  const yAxisLabelWidth = 10;
  const barWidth = Math.floor((chartWidth - barSpacing * barCount - initialSpacing) / barCount);

  /** Extracts the hour from an ISO 8601 timestamp*/
  const parseHour = (time: string): number => {
    const date = new Date(time);
    return isNaN(date.getTime()) ? -1 : date.getHours();
  };

  /** Converts an ISO 8601 timestamp to a label (e.g. "5p", "12a") */
  const formatTime = (time: string): string => {
    const h = parseHour(time);
    if (h < 0) return '';
    if (h === 0) return '12a';
    if (h < 12) return `${h}a`;
    if (h === 12) return '12p';
    return `${h - 12}p`;
  };

  const currentHour = new Date().getHours(); // stays fresh via 15-min prediction refresh cycle
  const currentIndex = data.findIndex(
    item => parseHour(item.time) === currentHour,
  );

  const getStatusLabel = (occupancy: number) =>
    occupancy >= 95
      ? 'Full'
      : occupancy >= 75
        ? 'Nearly Full'
        : occupancy >= 50
          ? 'Filling'
          : 'Available';

  // Track the selected bar; defaults to current hour
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    currentIndex >= 0 ? currentIndex : null,
  );

  useEffect(() => {
    setSelectedIndex(currentIndex >= 0 ? currentIndex : null);
  }, [data, currentIndex]);

  const barData = data.map((item, index) => {
    const isCurrent = currentIndex >= 0 && index === currentIndex;
    const isSelected = selectedIndex === index;
    const showLabel = index % 2 === 0; // show every other label
    return {
      value: item.occupancy,
      frontColor: isCurrent
        ? colors.primary
        : isSelected
          ? colors.darkGray
          : colors.mediumLightGray,
      label: showLabel ? formatTime(item.time) : '',
      labelTextStyle: {
        fontSize: TYPOGRAPHY.fontSize.sm,
        color: isCurrent ? colors.primary : colors.black,
        fontFamily: isCurrent ? TYPOGRAPHY.fontFamily.bold : TYPOGRAPHY.fontFamily.regular,
      },
      onPress: () => setSelectedIndex(isSelected ? null : index),
      accessibilityLabel: `${formatTime(item.time)}, ${item.occupancy} percent, ${getStatusLabel(item.occupancy)}${isCurrent ? ', current hour' : ''}${isSelected ? ', selected' : ''}`,
      accessibilityHint: isSelected
        ? 'Double tap to deselect'
        : 'Double tap to view details',

      // Selected Bar Occupancy Label
      topLabelComponent: isSelected
        ? () => (
            <View style={[styles.barLabelContainer, { width: barWidth }]}>
              <Text style={[styles.barLabelText, { color: colors.black }]}>
                {item.occupancy}%
              </Text>
            </View>
          )
        : undefined,
    };
  });

  const selectedData = selectedIndex != null ? data[selectedIndex] : null;

  return (
    <View style={[
        styles.chartContainer,
        {
          backgroundColor: colors.white,
          shadowColor: colors.shadowDark
        }
      ]}>
      <Text style={[styles.chartTitle, { color: colors.textPrimary }]}>{name ?? 'Parking Occupancy Outlook'}</Text>

      {/* Status Tooltip*/}
      {selectedData && (
        <View
          style={[styles.tooltipContainer, { backgroundColor: colors.black }]}
          accessible={true}
          importantForAccessibility="yes"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Status: ${getStatusLabel(selectedData.occupancy)}${
            selectedData.lowerBound != null && selectedData.upperBound != null
              ? `. Expected occupancy: ${selectedData.lowerBound} to ${selectedData.upperBound} percent`
              : ''
          }`}
        >
          <Text style={[styles.tooltipText, { color: colors.white }]}>
            {'Status: '}
            {getStatusLabel(selectedData.occupancy)}
          </Text>

          {/* Confidence Interval*/}
          {selectedData.lowerBound != null &&
            selectedData.upperBound != null && (
              <Text style={[styles.tooltipSubText, { color: colors.white }]}>
                Expected Range: {selectedData.lowerBound}-
                {selectedData.upperBound}%
              </Text>
            )}
        </View>
      )}

      {/* Chart -- shows empty or bar chart */}
      <View style={styles.chartWrapper}>
        {data.length === 0 ? (
          <View
            style={[styles.emptyState, { height: chartHeight }]}
            accessible={true}
            accessibilityLabel="No forecast data available"
          >
            <Text style={[styles.emptyStateText, { color: colors.gray }]}>
              No forecast data available
            </Text>
          </View>
        ) : (
          <View style={{ position: 'relative' }}>
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden={true}>
              <BarChart
                data={barData}
                barWidth={barWidth}
                spacing={barSpacing}
                initialSpacing={initialSpacing}
                barBorderTopLeftRadius={4}
                barBorderTopRightRadius={4}
                noOfSections={4}
                height={chartHeight}
                maxValue={100}
                disableScroll
                xAxisLabelTextStyle={{
                  color: colors.gray,
                  fontSize: TYPOGRAPHY.fontSize.xs,
                }}
                hideYAxisText
                yAxisThickness={0}
                hideRules={false}
                rulesColor={colors.borderGray}
              />
            </View>
            {/* gifted-charts has no accessibility support — invisible TouchableOpacity overlays are absolutely
                positioned over each bar so screen readers interact with these instead of the chart internals */}
            <View style={[styles.barOverlayRow, { height: chartHeight, paddingLeft: yAxisLabelWidth + initialSpacing }]}>
              {data.map((item, index) => {
                const isCurrent = currentIndex >= 0 && index === currentIndex;
                const isSelected = selectedIndex === index;
                return (
                  <TouchableOpacity
                    key={item.time}
                    style={{ width: barWidth + barSpacing, height: chartHeight }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatTime(item.time)}, ${item.occupancy} percent, ${getStatusLabel(item.occupancy)}${isCurrent ? ', current hour' : ''}`}
                    accessibilityState={{ selected: isSelected }}
                    accessibilityHint={isSelected ? 'Double tap to deselect' : 'Double tap to view details'}
                    onPress={() => setSelectedIndex(isSelected ? null : index)}
                  />
                );
              })}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartContainer: {
    borderRadius: SPACING.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.lg,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    marginBottom: SPACING.xxxl,
    ...SHADOWS.card,
  },
  chartTitle: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  barOverlayRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
  },
  // Bar Chart
  barLabelContainer: {
    alignItems: 'center',
    overflow: 'visible',
  },
  barLabelText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    marginBottom: 2,
    minWidth: 32,
    textAlign: 'center',
  },
  // Tooltip
  tooltipContainer: {
    borderRadius: 6,
    paddingVertical: 8,
    marginTop: SPACING.sm,
    marginHorizontal: SPACING.md,
  },
  tooltipText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    textAlign: 'center',
  },
  tooltipSubText: {
    fontSize: TYPOGRAPHY.fontSize.xxs,
    textAlign: 'center',
  },
  // Add gap below tooltip
  chartWrapper: {
    marginTop: SPACING.sm,
  },
  // Empty Chart
  emptyState: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateText: {
    textAlign: 'center',
  },
});