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
import { NavigationModal } from '../components/Modals/NavigationModal';
import { NavigationSpeedDial } from '../components/NavigationSpeedDial';
import { TYPOGRAPHY, SPACING, MAP } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import type { MapStackParamList } from '../types/navigation';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import useFavorites from '../hooks/useFavorites';

const { width: screenWidth } = Dimensions.get('window');

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
  const [isNavigationModalOpen, setIsNavigationModalOpen] = useState(false);
  const { refreshFavorites } = useFavorites();
  const [navigableLots, setNavigableLots] = useState<string[]>([]);
  const navigation = useNavigation<StackNavigationProp<MapStackParamList>>();
  
  // Shared values for map transformations (pan and zoom)
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  // Pinch focal point
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      // Calculate scaled map dimensions
      const scaledMapWidth = (screenWidth * MAP.SCALE_MULTIPLIER) * scale.value;
      const scaledMapHeight = (screenWidth * MAP.SCALE_MULTIPLIER) * scale.value;

      // Calculate maximum translation bounds 
      const maxTranslateX = Math.max(0, (scaledMapWidth - containerWidth.value) / 2);
      const maxTranslateY = Math.max(0, (scaledMapHeight - containerHeight.value) / 2);

      // Apply translation w/ clamping
      const newTranslateX = savedTranslateX.value + e.translationX;
      const newTranslateY = savedTranslateY.value + e.translationY;

      translateX.value = Math.max(-maxTranslateX, Math.min(maxTranslateX, newTranslateX));
      translateY.value = Math.max(-maxTranslateY, Math.min(maxTranslateY, newTranslateY));
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      // Focal point relative to the container's center
      focalX.value = e.focalX - containerWidth.value / 2;
      focalY.value = e.focalY - containerHeight.value / 2;
    })
    .onUpdate((e) => {
      const newScale = savedScale.value * e.scale;
      const clampedScale = Math.max(0.5, Math.min(newScale, 3));
      // Adjust translation based on focal point
      const scaleDiff = clampedScale / savedScale.value - 1;

      // Adjust translation to keep focal point stationary
      const newTranslateX = savedTranslateX.value - focalX.value * scaleDiff;
      const newTranslateY = savedTranslateY.value - focalY.value * scaleDiff;

      // Calculate scaled map dimensions with new scale
      const scaledMapWidth = (screenWidth * MAP.SCALE_MULTIPLIER) * clampedScale;
      const scaledMapHeight = (screenWidth * MAP.SCALE_MULTIPLIER) * clampedScale;

      // Calculate maximum translation bounds
      const maxTranslateX = Math.max(0, (scaledMapWidth - containerWidth.value) / 2);
      const maxTranslateY = Math.max(0, (scaledMapHeight - containerHeight.value) / 2);

      // Apply translation w/ clamping
      translateX.value = Math.max(-maxTranslateX, Math.min(maxTranslateX, newTranslateX));
      translateY.value = Math.max(-maxTranslateY, Math.min(maxTranslateY, newTranslateY));
      scale.value = clampedScale;
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
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

  const handleFilterClose = () => {
    setIsFilterModalOpen(false);
  };

  const handleNavigateClose = () => {
    setIsNavigationModalOpen(false);
  };

  const handleApplyFilter = (filteredLots: string[]) => {
    setSelectedLots(filteredLots);
    setIsFilterModalOpen(false);
  };

  const openNavigationModal = async (type: 'favorites' | 'recommended') => {
    if (type === 'favorites') {
      const favoriteLots = await refreshFavorites(); // Ensures that current instance of favoriteLots is up-to-date
      setNavigableLots(favoriteLots);
    } else {
      // TODO: Implement lot recommendation system; using all lots as a placeholder
      setNavigableLots(parkingLots.map(lot => lot.id));
    }
    setIsNavigationModalOpen(true);
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
        <GestureDetector gesture={composedGesture}>
          <Animated.View
            style={[styles.mapContainer, animatedStyle]}
            onLayout={(e) => {
              containerWidth.value = e.nativeEvent.layout.width;
              containerHeight.value = e.nativeEvent.layout.height;
            }}
          >
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
      </View>


      {/* Filter button - bottom left */}
      <FilterButton onPress={handleFilterPress} colors={colors} />

      {/* Navigation speed dial via Navigate button FAB - bottom right */}
      <NavigationSpeedDial
        onSelectRecommended={() => openNavigationModal('recommended')}
        onSelectFavorites={() => openNavigationModal('favorites')}
        renderTrigger={(isOpen, toggle) => (
          <NavigateButton
            onPress={toggle}
            colors={colors}
          />
        )}
      />

      {/* Filter Modal */}
      <LotFilterModal
        isOpen={isFilterModalOpen}
        onClose={handleFilterClose}
        selectedLots={selectedLots}
        onApplyFilter={handleApplyFilter}
      />

      {/* Navigation Modal */}
      <NavigationModal
        isOpen={isNavigationModalOpen}
        lotIdList={navigableLots}
        onClose={handleNavigateClose}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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