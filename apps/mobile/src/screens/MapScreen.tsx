import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Dimensions,
  TouchableOpacity,
  Text,
  ImageSourcePropType,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import { parkingLots } from '../data/mockParkingLots';
import { getOccupancyColor } from '../utils/parkingUtils';
import { ParkingLotUI } from '../types/ui';
import { Header } from '../components';
import { LotFilterModal } from '../components/Modals/FilterModal';
import { TYPOGRAPHY, SPACING, MAP } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import type { MapStackParamList } from '../types/navigation';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const campusMapImage = require('../assets/images/CSULB_map_transparent_unlabeled.webp') as ImageSourcePropType;

// Interactive lot component
const InteractiveLot: React.FC<{
  lot: ParkingLotUI;
  onPress: (lot: ParkingLotUI) => void;
  colors: ThemeColors;
}> = ({ lot, onPress, colors }) => {
  const occupancyColor = getOccupancyColor(lot.occupancy);
  
  return (
    <TouchableOpacity
      style={[
        styles.lotCircle,
        {
          backgroundColor: occupancyColor,
          left: lot.position.x,
          top: lot.position.y,
          borderColor: colors.white,
          shadowColor: colors.shadowDark,
        }
      ]}
      onPress={() => onPress(lot)}
      activeOpacity={0.7}
    >
      <Text style={[styles.lotText, { color: colors.white }]}>{lot.name}</Text>
    </TouchableOpacity>
  );
};

// Filter button component
const FilterButton: React.FC<{ onPress: () => void; colors: ThemeColors }> = ({ onPress, colors }) => (
  <TouchableOpacity style={[styles.filterButton, { backgroundColor: colors.primary, shadowColor: colors.shadowDark }]} onPress={onPress} activeOpacity={0.8}>
    <Icon name="filter" size={24} color={colors.white} />
  </TouchableOpacity>
);

// Navigate button component
const NavigateButton: React.FC<{ onPress: () => void; colors: ThemeColors }> = ({ onPress, colors }) => (
  <TouchableOpacity style={[styles.navigateButton, { backgroundColor: colors.secondary, shadowColor: colors.shadowDark }]} onPress={onPress} activeOpacity={0.8}>
    <Icon name="navigate" size={TYPOGRAPHY.fontSize.xxl} color={colors.white} />
  </TouchableOpacity>
);

const MapScreen: React.FC = () => {
  const { colors } = useTheme();
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [selectedLots, setSelectedLots] = useState<string[]>([]);
  const navigation = useNavigation<StackNavigationProp<MapStackParamList>>();
  
  // Shared values for map transformations (pan and zoom)
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);

  const panGesture = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const newScale = savedScale.value * e.scale;
      scale.value = Math.max(0.5, Math.min(newScale, 3));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture);
  
  // Apply animated transformations to the map
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));


  const handleLotPress = (lot: ParkingLotUI) => {
    // Navigate to ShortTermForecastScreen with lot data
    navigation.navigate('Short Term Forecast', { 
      lotId: lot.id, 
      lotName: lot.name 
    });
  };

  const handleFilterPress = () => {
    setIsFilterModalOpen(true);
  };

  const handleNavigatePress = () => {
    // TODO: Add navigation logic here (e.g., open Google Maps to campus)
  };

  const handleFilterClose = () => {
    setIsFilterModalOpen(false);
  };

  const handleApplyFilter = (filteredLots: string[]) => {
    setSelectedLots(filteredLots);
    setIsFilterModalOpen(false);
  };

  // Filter parking lots based on selected filter
  const filteredParkingLots = selectedLots.length > 0 
    ? parkingLots.filter(lot => selectedLots.includes(lot.id))
    : parkingLots;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundLight }]}>
      {/* Header */}
      <Header 
        title="Map View"
      />

      <View style={{ flex: 1, overflow: 'hidden' }}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.mapContainer, animatedStyle]}>
              {/* Campus map background */}
              <View style={styles.mapImageContainer}>
                <Image
                  source={campusMapImage}
                  style={styles.mapImage}
                  resizeMode="contain"
                />

                {/* Interactive parking lot circles */}
                {filteredParkingLots.map((lot) => (
                  <InteractiveLot
                    key={lot.id}
                    lot={lot}
                    onPress={handleLotPress}
                    colors={colors}
                  />
                ))}
              </View>
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
      </View>


      {/* Filter button - bottom left */}
      <FilterButton onPress={handleFilterPress} colors={colors} />

      {/* Navigate button - bottom right */}
      <NavigateButton onPress={handleNavigatePress} colors={colors} />

      {/* Filter Modal */}
      <LotFilterModal
        isOpen={isFilterModalOpen}
        onClose={handleFilterClose}
        selectedLots={selectedLots}
        onApplyFilter={handleApplyFilter}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    position: 'absolute',
    width: screenWidth * 3,
    height: screenHeight * 3,
    left: -(screenWidth * 0.75),
    top: -(screenHeight * 0.25),
  },
  mapImageContainer: {
    position: 'relative',
  },
  mapImage: {
    width: screenWidth * MAP.SCALE_MULTIPLIER,
    height: screenWidth * MAP.SCALE_MULTIPLIER,
  },
  lotCircle: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: SPACING.xs,
    shadowOffset: {
      width: 0,
      height: SPACING.xs,
    },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  lotText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    textAlign: 'center',
  },
  filterButton: {
    position: 'absolute',
    bottom: SPACING.xxl,
    left: SPACING.xxl, // Top right position
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {
      width: 0,
      height: SPACING.sm,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  navigateButton: {
    position: 'absolute',
    bottom: SPACING.xxl, // Same as filter button
    right: SPACING.xxl, // Symmetric position on the right
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: {
      width: 0,
      height: SPACING.sm,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
});

export default MapScreen;