import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Image,
  Dimensions,
  TouchableOpacity,
  ImageSourcePropType,
} from 'react-native';
import { Text } from '../components/CustomText';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import { parkingLots as mockParkingLots } from '../data/mockParkingLots';
import { getOccupancyColor } from '../utils/parkingUtils';
import { ParkingLotUI } from '../types/ui';
import { Header } from '../components';
import { LotFilterModal } from '../components/Modals/FilterModal';
import { RecommendationModal } from '../components/Modals/RecommendationModal';
import { useLotsList } from '../hooks/useLotData';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS, MAP } from '../constants/theme';
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
  const isSingleWord = !lot.name.trim().includes(' ');
  
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
      accessibilityRole="button"
      accessibilityLabel={`${lot.name} parking lot, ${lot.occupancy} percent full`}
    >
      <Text
        style={[
          styles.lotText,
          { color: colors.white }
        ]}
        adjustsFontSizeToFit={true}
        numberOfLines={isSingleWord ? 1 : 3}
        accessible={false}
      >{lot.name}</Text>
    </TouchableOpacity>
  );
};

// Filter button component
const FilterButton: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <TouchableOpacity
    style={[styles.fab, styles.filterButton, { backgroundColor: COLORS.primary, shadowColor: COLORS.shadowDark }]}
    onPress={onPress}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityLabel="Filter parking lots"
  >
    <Icon name="filter" size={24} color={COLORS.white} accessible={false} />
  </TouchableOpacity>
);

// Navigate button component
const NavigateButton: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <TouchableOpacity
    style={[styles.fab, { backgroundColor: COLORS.secondary, shadowColor: COLORS.shadowDark }]}
    onPress={onPress}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityLabel="View favorites and recommendations"
  >
    <Icon name="navigate" size={TYPOGRAPHY.fontSize.xxl} color={COLORS.white} accessible={false} />
  </TouchableOpacity>
);

const MapScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<StackNavigationProp<MapStackParamList>>();
  const { favoriteLots, refreshFavorites } = useFavorites();
  const { lots: apiLots, bgLocationRequired } = useLotsList();

  // Navigate to the soft-ask screen when the backend returns BG_LOCATION_REQUIRED
  React.useEffect(() => {
    if (bgLocationRequired) {
      navigation.navigate('LocationPermission', {});
    }
  }, [bgLocationRequired, navigation]);

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [selectedLots, setSelectedLots] = useState<string[]>([]);
  const [isRecommendationModalOpen, setIsRecommendationModalOpen] = useState(false);

  // Merge live API occupancy data with mock position data
  // API provides real-time occupancy; mock data provides map x/y positions
  const parkingLots: ParkingLotUI[] = useMemo(() => {
    if (apiLots.length === 0) return mockParkingLots;
    return mockParkingLots.map(mockLot => {
      const apiLot = apiLots.find(a => a.lot_id === mockLot.id);
      if (!apiLot) return mockLot;
      return {
        ...mockLot,
        occupancy: Math.round(apiLot.occupancy_rate * 100),
      };
    });
  }, [apiLots]);
  
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

  const handleApplyFilter = (filteredLots: string[]) => {
    setSelectedLots(filteredLots);
    setIsFilterModalOpen(false);
    // Filter is visual-only — does NOT affect geofence registration.
    // Geofences are registered for all lots at startup based on user type (see geoHelpers).
  };

  // Redirect to Short-Term Forecast Screen of the lot selected within the navigation modal
  const handleLotNavigation = (id: string, name: string) => {
    navigation.navigate('Short Term Forecast', {
      lotId: id,
      lotName: name
    });
  };

  const openRecommendationModal = useCallback(() => {
    refreshFavorites();
    setIsRecommendationModalOpen(true);
  }, [refreshFavorites]);

  // Filter parking lots based on selected filter
  const filteredParkingLots = selectedLots.length > 0 
    ? parkingLots.filter(lot => selectedLots.includes(lot.id))
    : parkingLots;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundLight }]}>
      {/* Header */}
      <Header />

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
                accessible={false}
                importantForAccessibility="no"
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
      <FilterButton onPress={handleFilterPress} />

      {/* Navigate button FAB - bottom right */}
      <View style={styles.navigateButtonContainer}>
        <NavigateButton onPress={openRecommendationModal} />
      </View>

      {/* Filter Modal */}
      <LotFilterModal
        isOpen={isFilterModalOpen}
        onClose={handleFilterClose}
        selectedLots={selectedLots}
        onApplyFilter={handleApplyFilter}
      />

      {/* Combined Favorites & Recommendations Modal */}
      <RecommendationModal
        isOpen={isRecommendationModalOpen}
        favoriteLotIds={favoriteLots}
        onClose={() => setIsRecommendationModalOpen(false)}
        onSelectLot={(id, name) => handleLotNavigation(id, name)}
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
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    textAlign: 'center',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.fab,
  },
  filterButton: {
    position: 'absolute',
    bottom: SPACING.xxl,
    left: SPACING.xxl,
  },
  navigateButtonContainer: {
    position: 'absolute',
    bottom: SPACING.xxl,
    right: SPACING.xxl,
  },
});

export default MapScreen;