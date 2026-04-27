import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  Text,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import MapView, { Marker, Callout, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { getOccupancyColor } from '../utils/parkingUtils';
import { Header } from '../components';
import { LotFilterModal } from '../components/Modals/FilterModal';
import { RecommendationModal } from '../components/Modals/RecommendationModal';
import { useLotsList } from '../hooks/useLotData';
import { ParkingLotResponse } from '../services';
import { TYPOGRAPHY, SPACING } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import type { MapStackParamList } from '../types/navigation';
import useFavorites from '../hooks/useFavorites';
import { useTransitData } from '../hooks/useTransitData';
import { useStopETAs } from '../hooks/useStopETAs';
import { ShuttleMarker } from '../components/Map/ShuttleMarker';
import { StopModal } from '../components/Modals/StopModal';
import type { MapStop } from '../types/transit';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// eslint-disable-next-line @typescript-eslint/no-require-imports

// Interactive lot component
const InteractiveLot: React.FC<{
  lot: ParkingLotResponse;
  onPress: (lot: ParkingLotResponse) => void;
  colors: ThemeColors;
}> = ({ lot, onPress, colors }) => {
  const occupancyColor = getOccupancyColor(lot.occupancy_rate * 100);
  const isSingleWord = !lot.lot_name.trim().includes(' ');
  
  return (
    <Marker
      coordinate={{ latitude: lot.center_lat, longitude: lot.center_lng }}
      onPress={() => onPress(lot)}
      tracksViewChanges={false}
    >
      <View
        style={[
          styles.lotCircle,
          {
            backgroundColor: occupancyColor,
            borderColor: colors.white,
            shadowColor: colors.shadowDark,
          }
        ]}
      >
        <Text
          style={[styles.lotText, { color: colors.white }]}
          adjustsFontSizeToFit={true}
          numberOfLines={isSingleWord ? 1 : 3}
        >
          {lot.lot_name}
        </Text>
      </View>
    </Marker>
  );
};

// Filter button component
const FilterButton: React.FC<{ onPress: () => void; colors: ThemeColors }> = ({ onPress, colors }) => (
  <TouchableOpacity style={[styles.fab, styles.filterButton, { backgroundColor: colors.primary, shadowColor: colors.shadowDark }]} onPress={onPress} activeOpacity={0.8}>
    <Icon name="filter" size={TYPOGRAPHY.fontSize.xxl} color={colors.white} />
  </TouchableOpacity>
);

// Navigate button component
const NavigateButton: React.FC<{ onPress: () => void; colors: ThemeColors }> = ({ onPress, colors }) => (
  <TouchableOpacity style={[styles.fab, { backgroundColor: colors.secondary, shadowColor: colors.shadowDark }]} onPress={onPress} activeOpacity={0.8}>
    <Icon name="navigate" size={TYPOGRAPHY.fontSize.xxl} color={colors.white} />
  </TouchableOpacity>
);

const MapScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<StackNavigationProp<MapStackParamList>>();
  const { favoriteLots, refreshFavorites } = useFavorites();
  const { lots } = useLotsList();
  const { routes, stops, shuttles } = useTransitData();

  console.log('[MapScreen] Rendering with:', { 
    isRoutesArray: Array.isArray(routes), 
    isStopsArray: Array.isArray(stops), 
    isShuttlesArray: Array.isArray(shuttles) 
  });

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [selectedLots, setSelectedLots] = useState<string[]>([]);
  const [isRecommendationModalOpen, setIsRecommendationModalOpen] = useState(false);
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const { arrivals, isLoading: stopLoading } = useStopETAs(selectedStop?.id);

  const handleLotPress = (lot: ParkingLotResponse) => {
    // Navigate to ShortTermForecastScreen with lot data
    navigation.navigate('Short Term Forecast', {
      lotId: lot.lot_id,
      lotName: lot.lot_name
    });
  };

  const handleStopPress = (stop: MapStop) => {
    setSelectedStop(stop);
    setIsStopModalOpen(true);
  };

  const handleStopModalClose = () => {
    setIsStopModalOpen(false);
    setTimeout(() => setSelectedStop(null), 300);
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
    ? lots.filter(lot => selectedLots.includes(lot.lot_id))
    : lots;

  // Intial map display centered around CSULB
  const initialRegion = {
    latitude: 33.7828,
    longitude: -118.1151,
    latitudeDelta: 0.015,
    longitudeDelta: 0.015,
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundLight }]}>
      {/* Header */}
      <Header 
        title="Map View"
      />

      <View style={styles.mapContainer}>
        <MapView
          key={isDark ? 'dark-map' : 'light-map'} // Android (Google Maps) requires a forced re-render
          provider={PROVIDER_DEFAULT} // Apple Maps for iOS, Google Maps for Android
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={true}
          showsMyLocationButton={true}
          pitchEnabled={false}
          userInterfaceStyle={isDark ? 'dark' : 'light'}
        >
          {filteredParkingLots?.map((lot) => (
            <InteractiveLot
              key={lot.lot_id}
              lot={lot}
              onPress={handleLotPress}
              colors={colors}
            />
          ))}
          
          {/* Draw route paths */}
          {routes?.map((route) => (
            <Polyline
              key={route.id}
              coordinates={route.coordinates}
              strokeColor={route.color}
              strokeWidth={4}
              zIndex={1} 
            />
          ))}

          {/* Draw stops */}
          {stops?.map((stop) => (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              title={stop.name}
              pinColor={stop.color} 
              zIndex={2}
              stopPropagation={true}
              onPress={() => handleStopPress(stop)}
            >
              <Callout tooltip ={true} />
            </Marker>
          ))}

          {/* Draw live shuttles */}
          {shuttles?.map((shuttle) => (
            <ShuttleMarker 
              key={shuttle.id} 
              shuttle={shuttle} 
              colors={colors} 
            />
          ))}
        </MapView>
      </View>

      {/* Filter button - bottom left */}
      <FilterButton onPress={handleFilterPress} colors={colors} />

      {/* Navigate button FAB - bottom right */}
      <View style={styles.navigateButtonContainer}>
        <NavigateButton onPress={openRecommendationModal} colors={colors} />
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

      {/* Stop Arrivals Modal */}
      {selectedStop && (
      <StopModal
        isOpen={isStopModalOpen}
        onClose={handleStopModalClose}
        stopName={selectedStop.name}
        arrivals={arrivals}
        isLoading={stopLoading}
        colors={colors}
      />
    )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    overflow: 'hidden',
  },
  map: {
    width: screenWidth,
    height: screenHeight,
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
    fontSize: TYPOGRAPHY.fontSize.xxs,
    fontWeight: TYPOGRAPHY.fontWeight.bold,
    textAlign: 'center',
  },
  fab: {
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