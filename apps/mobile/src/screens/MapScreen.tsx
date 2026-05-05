import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { Text } from '../components/CustomText';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { getOccupancyColorGradient, getReadableTextColor } from '../utils/parkingUtils';
import { Header } from '../components';
import { LotFilterModal } from '../components/Modals/FilterModal';
import { RecommendationModal } from '../components/Modals/RecommendationModal';
import { useLotsList } from '../hooks/useLotData';
import { useContributorState } from '../services/api/contributor';
import { ParkingLotResponse } from '../services';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import type { MapStackParamList } from '../types/navigation';
import useFavorites from '../hooks/useFavorites';
import { useTransitData } from '../hooks/useTransitData';
import { useStopETAs } from '../hooks/useStopETAs';
import { ShuttleMarker } from '../components/Map/ShuttleMarker';
import { StopModal } from '../components/Modals/StopModal';
import { ShuttleModal } from '../components/Modals/ShuttleModal';
import type { MapStop } from '../types/transit';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Interactive lot component
const InteractiveLot: React.FC<{
  lot: ParkingLotResponse;
  onPress: (lot: ParkingLotResponse) => void;
  colors: ThemeColors;
  isContributor: boolean;
}> = ({ lot, onPress, colors, isContributor }) => {
  // Pin lock state is driven by live OS contributor permission, not by
  // whether the most recent fetch returned null fields. The redactor in
  // lots.ts will eventually null out non-contributor data, but until that
  // refetch lands the in-memory `lot` may still hold colored values from
  // before the user revoked (or null values from before they granted).
  // Keying on contributor state directly makes the pin flip the instant
  // OS permission changes — no perceived lag waiting for the next poll.
  const liveOccupancy =
    lot.occupancy_rate ?? lot.estimated_occupancy ?? lot.current_occupancy;
  const isRedacted = !isContributor || liveOccupancy === null;
  const pct = isRedacted
    ? null
    : Math.round(
        (lot.occupancy_rate ?? liveOccupancy / Math.max(lot.capacity, 1)) * 100,
      );
  const occupancyColor = isRedacted ? colors.neutralPin : getOccupancyColorGradient(pct!);
  // White text washes out on the green/yellow end of the gradient; flip
  // to dark text against light pin colors so the lot label stays legible
  // at every band. Redacted pins keep white over the neutral fill.
  const labelColor = isRedacted ? colors.white : getReadableTextColor(occupancyColor);
  const isSingleWord = !lot.lot_name.trim().includes(' ');

  return (
    <Marker
      coordinate={{ latitude: lot.center_lat, longitude: lot.center_lng }}
      onPress={() => onPress(lot)}
      // Must stay true so iOS re-snapshots the marker bitmap when the
      // pin's color flips (live\u2194redacted on contributor grant/revoke,
      // or band change on poll). With ~30 lots the perf cost is
      // negligible; tracksViewChanges={false} silently caches the very
      // first render and never updates, which is the bug the user hit
      // where pins stayed neutral after granting Always.
      tracksViewChanges={true}
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
        accessibilityRole="button"
        accessibilityLabel={
          isRedacted
            ? `${lot.lot_name} parking lot, live occupancy locked. Grant background location to see live data.`
            : `${lot.lot_name} parking lot, ${pct} percent full.`
        }
      >
        <Text
          style={[styles.lotText, { color: labelColor }]}
          adjustsFontSizeToFit={true}
          numberOfLines={isSingleWord ? 1 : 3}
          accessible={false}
        >
          {lot.lot_name}
        </Text>
      </View>
    </Marker>
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

// Favorites button component (opens favorites + recommendations sheet).
// In dark mode the default slate (COLORS.secondary = #374151) blends into
// the dark surface, so lift to slate-300 with a slate-900 glyph to keep the
// CTA legible. Star glyph signals favorites at a glance.
const FavoritesButton: React.FC<{ onPress: () => void; isDark: boolean }> = ({ onPress, isDark }) => {
  const bg = isDark ? '#94a3b8' : COLORS.secondary;
  const fg = isDark ? '#0f172a' : COLORS.white;
  return (
    <TouchableOpacity
      style={[styles.fab, { backgroundColor: bg, shadowColor: COLORS.shadowDark }]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel="View favorites and recommendations"
    >
      <Icon name="star" size={TYPOGRAPHY.fontSize.xxl} color={fg} accessible={false} />
    </TouchableOpacity>
  );
};

const MapScreen: React.FC = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<StackNavigationProp<MapStackParamList>>();
  const isFocused = useIsFocused();
  const { favoriteLots, refreshFavorites } = useFavorites();
  const { lots, bgLocationRequired, clearBgLocationRequired } = useLotsList();
  const { routes, stops, shuttles } = useTransitData();

  // Live OS contributor state. Drives pin color/lock decisions so a
  // permission toggle flips the map immediately rather than waiting for
  // the next 30s poll tick. The lot-data redactor catches up via the
  // contributor pub-sub triggering an immediate refetch in useLotsList.
  const contributorState = useContributorState();
  const isContributor = contributorState === 'granted';

  // Apple App Review 5.1.1: never push the user into the permission screen
  // automatically. The redacted UI (neutral pins + per-lot "Unlock live
  // occupancy" CTA) is the user-controlled path. We still clear the flag so
  // a stale `true` doesn't loop subsequent fetches into a no-op.
  React.useEffect(() => {
    if (bgLocationRequired && isFocused) {
      clearBgLocationRequired();
    }
  }, [bgLocationRequired, isFocused, clearBgLocationRequired]);

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [selectedLots, setSelectedLots] = useState<string[]>([]);
  const [isRecommendationModalOpen, setIsRecommendationModalOpen] = useState(false);
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [selectedShuttleId, setSelectedShuttleId] = useState<string | null>(null);
  const { arrivals, isLoading: stopLoading } = useStopETAs(selectedStop?.id);

  // Re-derive the selected shuttle from the live `shuttles` array on every
  // render so the modal's content (paxLoad, route, etc.) reflects socket
  // updates in real time. If the shuttle drops out of the feed, the lookup
  // returns null and the modal hides itself.
  const selectedShuttle = selectedShuttleId
    ? shuttles?.find((s) => s.id === selectedShuttleId) ?? null
    : null;

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
      <Header />

      <View style={styles.mapContainer}>
        <MapView
          key={isDark ? 'dark-map' : 'light-map'} // Android (Google Maps) requires a forced re-render
          provider={PROVIDER_DEFAULT} // Apple Maps for iOS, Google Maps for Android
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={true}
          showsMyLocationButton={true}
          pitchEnabled={false}
          moveOnMarkerPress={false}
          userInterfaceStyle={isDark ? 'dark' : 'light'}
        >
          {filteredParkingLots?.map((lot) => {
            // Force remount of the Marker whenever the visual state changes
            // (live → redacted on contributor revoke, color band change on
            // poll, or null → number on grant). Apple Maps' Marker caches
            // its bitmap snapshot on first render and doesn't reliably
            // re-snapshot when child View props change, even with
            // tracksViewChanges={true}. Encoding the relevant state in
            // the key is the only approach that consistently flips the
            // pin color in real time on iOS. Cheap at ~30 markers.
            const liveOcc =
              lot.occupancy_rate ?? lot.estimated_occupancy ?? lot.current_occupancy;
            // Bucket the gradient key to nearest 5% so we don't churn the
            // iOS bitmap on every single-percent occupancy nudge from the
            // 30s poll — the human eye won't catch a sub-5% hue shift.
            const visualKey =
              !isContributor || liveOcc === null
                ? 'redacted'
                : Math.round(
                    (lot.occupancy_rate ?? liveOcc / Math.max(lot.capacity, 1)) * 20,
                  ) * 5;
            return (
              <InteractiveLot
                key={`${lot.lot_id}:${visualKey}`}
                lot={lot}
                onPress={handleLotPress}
                colors={colors}
                isContributor={isContributor}
              />
            );
          })}
          
          {/* Draw route paths */}
          {isFocused && routes?.map((route) => (
            <Polyline
              key={route.id}
              coordinates={route.coordinates}
              strokeColor={route.color}
              strokeWidth={4}
              zIndex={1} 
            />
          ))}

          {/* Draw stops */}
          {isFocused && stops?.map((stop) => (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              zIndex={2}
              stopPropagation={true}
              onPress={() => handleStopPress(stop)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Shuttle stop: ${stop.name}`}
              tracksViewChanges={false} // Locks the snapshot so MapKit doesn't constantly re-render
            >
              {/* Custom Stop Circle */}
              <View
                style={[
                  styles.stopCircle,
                  {
                    backgroundColor: stop.color,
                    // dynamically apply a gray border for dark mode, white for light mode
                    borderColor: colors.white, 
                  }
                ]}
              />
            </Marker>
          ))}

          {/* Draw live shuttles */}
          {isFocused && shuttles?.map((shuttle) => (
            <ShuttleMarker
              key={shuttle.id}
              shuttle={shuttle}
              colors={colors}
              onPress={(s) => setSelectedShuttleId(s.id)}
            />
          ))}
        </MapView>
      </View>

      {/* Filter button - bottom left */}
      <FilterButton onPress={handleFilterPress} />

      {/* Navigate button FAB - bottom right */}
      <View style={styles.navigateButtonContainer}>
        <FavoritesButton onPress={openRecommendationModal} isDark={isDark} />
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

      {/* Live Shuttle Details Modal */}
      <ShuttleModal
        visible={!!selectedShuttle}
        onClose={() => setSelectedShuttleId(null)}
        shuttle={selectedShuttle}
        colors={colors}
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
    overflow: 'hidden',
  },
  map: {
    width: screenWidth,
    height: screenHeight,
  },
  lotCircle: {
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
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    textAlign: 'center',
  },
  stopCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
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