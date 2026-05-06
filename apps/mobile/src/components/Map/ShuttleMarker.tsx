import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Marker, AnimatedRegion } from 'react-native-maps';
import type { LatLng } from 'react-native-maps';
import Icon from 'react-native-vector-icons/Ionicons';
import { ThemeColors } from '../../context/ThemeContext';
import { TYPOGRAPHY } from '../../constants/theme';
import type { MapShuttle } from '../../types/transit';

// Matches the PassioGO GPS update cadence so the marker appears to glide
// continuously rather than jump. If updates arrive faster, the tween is
// interrupted and restarted from wherever the marker currently sits.
const MOVE_DURATION_MS = 8500;

interface ShuttleMarkerProps {
  shuttle: MapShuttle;
  colors: ThemeColors;
  mapBearing?: number;
  onPress?: (shuttle: MapShuttle) => void;
}

export const ShuttleMarker: React.FC<ShuttleMarkerProps> = ({ shuttle, colors, mapBearing = 0, onPress }) => {
  const heading = shuttle.heading || 0;
  const effectiveHeading = ((heading - mapBearing) + 360) % 360;
  const markerColor = shuttle.color || colors.white;

  // AnimatedRegion holds the marker's displayed coordinate. It is initialised
  // once with the shuttle's first known position (via useRef) and then tweened
  // to each new position as props change — the native layer interpolates the
  // frames between GPS updates.
  const coordinate = useRef(
    new AnimatedRegion({
      latitude: shuttle.latitude,
      longitude: shuttle.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    })
  ).current;

  useEffect(() => {
    // `toValue` is required by the AnimatedRegion.timing TS signature but
    // ignored at runtime when explicit lat/lng/latitudeDelta/longitudeDelta
    // are passed (the native side interpolates each axis individually).
    // Don't "clean up" by removing it — TS will reject the call.
    coordinate.timing({
      toValue: 0,
      latitude: shuttle.latitude,
      longitude: shuttle.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
      duration: MOVE_DURATION_MS,
      useNativeDriver: false,
    }).start();
  }, [shuttle.latitude, shuttle.longitude, coordinate]);

  return (
    <Marker.Animated
      coordinate={coordinate as unknown as LatLng}
      zIndex={4}
      anchor={{ x: 0.5, y: 0.5 }}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Shuttle: ${shuttle.busName} on route ${shuttle.route}`}
      onPress={() => onPress?.(shuttle)}
      stopPropagation={true}
    >
      {/* Rotate full marker (circle & arrow) */}
      <View style={[styles.shuttleMarkerContainer, { transform: [{ rotate: `${effectiveHeading}deg` }] }]}>

        {/* Directional nib pointing North relative to the container */}
        <View style={[styles.shuttleArrow, { borderBottomColor: markerColor }]} />

        {/* Main bus circle */}
        <View
          style={[
            styles.shuttleCircle,
            {
              backgroundColor: markerColor,
              borderColor: colors.white,
              shadowColor: colors.shadowDark,
            }
          ]}
        >
          {/* Counter-rotate the icon so it stays upright */}
          <Icon
            name="bus"
            size={TYPOGRAPHY.fontSize.xl}
            color={colors.white}
            style={{ transform: [{ rotate: `-${effectiveHeading}deg` }] }}
          />
        </View>
      </View>
    </Marker.Animated>
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
