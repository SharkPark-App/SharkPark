import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../CustomText';
import { Callout } from 'react-native-maps';
import Icon from 'react-native-vector-icons/Ionicons';
import { ThemeColors } from '../../context/ThemeContext';
import { TYPOGRAPHY, SPACING } from '../../constants/theme';
import { MapShuttle } from '../../types/transit';

interface CustomCalloutProps {
  shuttle: MapShuttle;
  colors: ThemeColors;
}

// Get occupancy percentage
const getPassengerLoadInfo = (pax: number, cap: number) => {
  if (cap === 0) return { text: 'Unknown', percent: 0 };
  
  const percent = Math.round((pax / cap) * 100);
  let text = 'Empty';
  
  if (percent >= 85) text = 'Very crowded';
  else if (percent >= 50) text = 'Crowded';
  else if (percent >= 20) text = 'Not too crowded';
  
  return { text, percent };
};

export const CustomCallout: React.FC<CustomCalloutProps> = ({ shuttle, colors }) => {
  const { text: loadText, percent: loadPercent } = getPassengerLoadInfo(shuttle.paxLoad, shuttle.capacity);

  return (
    <Callout tooltip={true}>
      <View style={styles.calloutWrapper}>
        
        {/* Main Card */}
        <View
          style={[styles.card, { backgroundColor: colors.backgroundLight, shadowColor: colors.shadowDark }]}
          accessible={true}
          accessibilityLabel={`${shuttle.busName} on route ${shuttle.route}. Occupancy: ${loadText}, ${loadPercent} percent full.`}
        >
          
          {/* Bus ID and Close Icon */}
          <View style={styles.headerRow}>
            <View style={styles.iconTextGroup}>
              {/* Bus Icon in container */}
              <View style={[styles.iconBadge, { backgroundColor: colors.textPrimary }]}>
                <Icon name="bus" size={18} color={colors.backgroundLight} accessible={false} />
              </View>
              <Text style={[styles.shuttleNameText, { color: colors.textPrimary }]} accessible={false}>
                {shuttle.busName}
              </Text>
            </View>
            
            <Icon name="close" size={24} color={colors.darkGray} accessible={false} />
          </View>

          {/* Route Row */}
          <View style={styles.routeRow}>
            <View style={[styles.iconBadge, { backgroundColor: colors.borderLight }]}>
              <Icon name="navigate" size={18} color={colors.textPrimary} accessible={false} />
            </View>
            <Text style={[styles.routeText, { color: colors.textPrimary }]} accessible={false}>
              {' Route: '} {shuttle.route}
            </Text>
          </View>

          {/* Passenger Load Row */}
          <Text style={[styles.loadTextBold, { color: colors.textPrimary }]} accessible={false}>
            {loadText} ({loadPercent}%)
          </Text>

          <Text style={[styles.loadTextBase, { color: colors.darkGray }]} accessible={false}>
            {shuttle.paxLoad} / {shuttle.capacity} passengers
          </Text>

        </View>

        {/* Callout bubble arrow */}
        <View style={[styles.triangle, { borderTopColor: colors.backgroundLight }]} />
        
      </View>
    </Callout>
  );
};

const styles = StyleSheet.create({
  calloutWrapper: {
    alignItems: 'center',
    paddingBottom: SPACING.sm, 
  },
  card: {
    width: 260,
    borderRadius: 12,
    padding: SPACING.md,
    shadowOffset: { width: 0, height: 4 }, // Shadow for popup
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  iconTextGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.xs,
  },
  shuttleNameText: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontWeight: 'bold',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  routeText: {
    fontSize: TYPOGRAPHY.fontSize.md,
  },
  loadTextBase: {
    fontSize: TYPOGRAPHY.fontSize.sm,
  },
  loadTextBold: {
    fontWeight: 'bold',
  },
  triangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 12, // Point arrow downward
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1, // Blend arrow & callout together
  },
});