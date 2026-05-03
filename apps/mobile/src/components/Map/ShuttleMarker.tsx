import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import Icon from 'react-native-vector-icons/Ionicons';
import { ThemeColors } from '../../context/ThemeContext';
import { TYPOGRAPHY } from '../../constants/theme';
import type { MapShuttle } from '../../types/transit';

interface ShuttleMarkerProps {
  shuttle: MapShuttle;
  colors: ThemeColors;
  onPress?: (shuttle: MapShuttle) => void;
}

export const ShuttleMarker: React.FC<ShuttleMarkerProps> = ({ shuttle, colors, onPress }) => {
  const heading = shuttle.heading || 0;
  // Color should be provided, but is not necessary to have if not
  const markerColor = shuttle.color || colors.white;

  return (
    <Marker
      coordinate={{ latitude: shuttle.latitude, longitude: shuttle.longitude }}
      zIndex={4}
      anchor={{ x: 0.5, y: 0.5 }}
      flat={true} // TODO: find fix for Apple MapKit
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Shuttle: ${shuttle.busName} on route ${shuttle.route}`}
      onPress={() => onPress?.(shuttle)}
      stopPropagation={true}
    >
      {/* Rotate full marker (circle & arrow) */}
      <View style={[styles.shuttleMarkerContainer, { transform: [{ rotate: `${heading}deg` }] }]}>

        {/* Directional nib pointing North relative to the container */}
        <View style={[styles.shuttleArrow, { borderBottomColor: markerColor }]} />

        {/* Main bus circle */}
        <View
          style={[
            styles.shuttleCircle,
            {
              backgroundColor: markerColor,
              borderColor: colors.white,
              shadowColor: colors.shadowDark
            }
          ]}
        >
          {/* Counter-rotate the text so it stays upright */}
          <Icon
            name="bus"
            size={TYPOGRAPHY.fontSize.xl}
            color={colors.white}
            style={{ transform: [{ rotate: `-${heading}deg` }] }}
          />
        </View>
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  shuttleMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 50, 
  },
  shuttleArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginBottom: -2, 
  },
  shuttleCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
});