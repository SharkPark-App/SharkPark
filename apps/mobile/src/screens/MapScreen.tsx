import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/CustomText';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import Icon from 'react-native-vector-icons/Ionicons';
import MapView, { Marker, Polygon, Polyline, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { getOccupancyColorGradient, getReadableTextColor } from '../utils/parkingUtils';
import { haversineDistance } from '../utils/geoHelpers';
import { Header } from '../components';
import { LotFilterModal } from '../components/Modals/FilterModal';
import { RecommendationModal } from '../components/Modals/RecommendationModal';
import { useLotsList } from '../hooks/useLotData';
import { useContributorState } from '../services/api/contributor';
import { ParkingLotResponse } from '../services';
import { COLORS, TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import { useEnhancedGeofencing } from '../context/EnhancedGeofencingProvider';
import type { MapStackParamList } from '../types/navigation';
import useFavorites from '../hooks/useFavorites';
import { useTransitData } from '../hooks/useTransitData';
import { useStopETAs } from '../hooks/useStopETAs';
import { ShuttleMarker } from '../components/Map/ShuttleMarker';
import { SegmentedCircle } from '../components/Map/SegmentedCircle';
import { StopModal } from '../components/Modals/StopModal';
import { ShuttleModal } from '../components/Modals/ShuttleModal';
import { MapSelectModal } from '../components/Modals/MapSelectModal';
import type { MapStop } from '../types/transit';
import { LOT_POLYGONS } from '../data/lotPolygons'
import { isPointInsidePolygon, polygonCentroid } from '../utils/lotGeometry';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CAMPUS_REGION = {
  latitude: 33.78195,
  longitude: -118.11486,
  latitudeDelta: 0.018,
  longitudeDelta: 0.018,
};
const CAMPUS_RECENTER_THRESHOLD_METERS = 1200;
const CAMPUS_VISUAL_CENTER_BIAS = 0.2;
const CAMPUS_VISUAL_HORIZONTAL_BIAS = 0.2;
const CAMPUS_EDGE_PADDING_TOP = 64;
const CAMPUS_EDGE_PADDING_TOP_WITH_PARKED = 100;
const CAMPUS_EDGE_PADDING_RIGHT = 50;
const CAMPUS_EDGE_PADDING_LEFT = 36;
const CAMPUS_EDGE_PADDING_BOTTOM_BASE = 290;

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.startsWith('#') ? hex : `#${hex}`;
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${clean}${a}`;
}

const PARKED_LOT_COLOR = '#2563EB';

// Interactive lot component
const InteractiveLot: React.FC<{
  lot: ParkingLotResponse;
  onPress: (lot: ParkingLotResponse) => void;
  colors: ThemeColors;
  isContributor: boolean;
  isParkedLot?: boolean;
}> = ({ lot, onPress, colors, isContributor, isParkedLot = false }) => {
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
  const parkedColor = PARKED_LOT_COLOR;
  // White text washes out on the green/yellow end of the gradient; flip
  // to dark text against light pin colors so the lot label stays legible
  // at every band. Redacted pins keep white over the neutral fill.
  const labelColor = isRedacted ? colors.white : getReadableTextColor(occupancyColor);
  const parkedLabelColor = colors.white;
  const isSingleWord = !lot.lot_name.trim().includes(' ');
  const a11yLabel = isRedacted
    ? `${lot.lot_name} parking lot, live occupancy locked. Grant background location to see live data.`
    : `${lot.lot_name} parking lot, ${pct} percent full`;

  const polygon = LOT_POLYGONS[lot.lot_id];

  if (polygon) {
    const coords = polygon.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    const computedCenter = polygonCentroid(polygon);
    const center = isPointInsidePolygon(computedCenter.latitude, computedCenter.longitude, polygon)
      ? computedCenter
      : { latitude: lot.center_lat, longitude: lot.center_lng };
    return (
      <React.Fragment>
        <Polygon
          coordinates={coords}
          strokeColor={isParkedLot ? parkedColor : occupancyColor}
          strokeWidth={isParkedLot ? 4 : 2}
          fillColor={hexWithAlpha(isParkedLot ? parkedColor : occupancyColor, isParkedLot ? 0.4 : 0.35)}
          tappable
          onPress={() => onPress(lot)}
          accessible={false}
        />
        <Marker
          coordinate={center}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={true}
          onPress={() => onPress(lot)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
        >
          <View
            style={[
              styles.lotLabel,
              { backgroundColor: isParkedLot ? parkedColor : occupancyColor, borderColor: colors.white },
            ]}
          >
            <Text
              style={[styles.lotText, { color: isParkedLot ? parkedLabelColor : labelColor }]}
              numberOfLines={isSingleWord ? 1 : 2}
              ellipsizeMode="tail"
              accessible={false}
            >
              {lot.lot_name}
            </Text>
          </View>
        </Marker>
      </React.Fragment>
    );
  }

  // Fallback: circle marker for lots not yet in LOT_POLYGONS
  return (
    <Marker
      coordinate={{ latitude: lot.center_lat, longitude: lot.center_lng }}
      onPress={() => onPress(lot)}
      tracksViewChanges={true}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View
        style={[
          styles.lotCircle,
          {
            backgroundColor: isParkedLot ? parkedColor : occupancyColor,
            borderColor: colors.white,
            shadowColor: colors.shadowDark,
          }
        ]}
        accessible={false}
      >
        <Text
          style={[styles.lotText, { color: isParkedLot ? parkedLabelColor : labelColor }]}
          numberOfLines={isSingleWord ? 1 : 3}
          ellipsizeMode="tail"
          accessible={false}
        >
          {lot.lot_name}
        </Text>
      </View>
    </Marker>
  );
};

// Filter button component
const FilterButton: React.FC<{ onPress: () => void; insetBottom?: number }> = ({ onPress, insetBottom = 0 }) => (
  <TouchableOpacity
    style={[styles.fab, styles.filterButton, { backgroundColor: COLORS.primary, shadowColor: COLORS.shadowDark, bottom: SPACING.xxl + insetBottom }]}
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
  const insets = useSafeAreaInsets();
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
  const { parkedLotId, lastParkedLocation, carpoolPassengerMode, carpoolPassengerCount } = useEnhancedGeofencing();

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
  const [hiddenRouteIds, setHiddenRouteIds] = useState<string[]>([]);
  // Gate map content rendering on AsyncStorage hydration so the persisted
  // filter snaps in before the user sees an unfiltered flash.
  const [filtersHydrated, setFiltersHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.multiGet(['filter:selectedLots', 'filter:hiddenRouteIds'])
      .then(([lots, routes]) => {
        // Parse each entry independently — a single corrupted key shouldn't
        // wipe the other persisted filter.
        if (lots[1]) {
          try {
            const parsed = JSON.parse(lots[1]);
            if (isMounted && Array.isArray(parsed)) setSelectedLots(parsed);
          } catch {
            // Corrupted entry — drop it so a subsequent setItem rewrites cleanly.
            AsyncStorage.removeItem('filter:selectedLots').catch(() => {});
          }
        }
        if (routes[1]) {
          try {
            const parsed = JSON.parse(routes[1]);
            if (isMounted && Array.isArray(parsed)) setHiddenRouteIds(parsed);
          } catch {
            AsyncStorage.removeItem('filter:hiddenRouteIds').catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setFiltersHydrated(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);
  const [isRecommendationModalOpen, setIsRecommendationModalOpen] = useState(false);
  const [selectedStop, setSelectedStop] = useState<MapStop | null>(null);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [selectedShuttleId, setSelectedShuttleId] = useState<string | null>(null);
  const [mapBearing, setMapBearing] = useState(0);
  const [isFindCarDirectionsOpen, setIsFindCarDirectionsOpen] = useState(false);
  const [isMapAwayFromCampus, setIsMapAwayFromCampus] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const mapRef = useRef<MapView>(null);
  const hasAppliedInitialCampusViewportRef = useRef(false);
  const lastAppliedCampusViewportKeyRef = useRef<string | null>(null);
  const { arrivals, isLoading: stopLoading } = useStopETAs(selectedStop?.id);

  // Re-derive the selected shuttle from the live `shuttles` array on every
  // render so the modal's content (paxLoad, route, etc.) reflects socket
  // updates in real time. If the shuttle drops out of the feed, the lookup
  // returns null and the modal hides itself.
  const selectedShuttle = selectedShuttleId
    ? shuttles?.find((s) => s.id === selectedShuttleId) ?? null
    : null;

  const parkedLot = useMemo(
    () => (parkedLotId ? lots.find((lot) => lot.lot_id === parkedLotId) ?? null : null),
    [lots, parkedLotId],
  );

  const campusFitCoordinates = useMemo(() => {
    const coords: Array<{ latitude: number; longitude: number }> = [];

    for (const lot of lots) {
      coords.push({ latitude: lot.center_lat, longitude: lot.center_lng });

      const polygon = LOT_POLYGONS[lot.lot_id];
      if (polygon && polygon.length > 0) {
        for (const point of polygon) {
          coords.push({ latitude: point.lat, longitude: point.lng });
        }
      }
    }

    return coords;
  }, [lots]);

  const campusReference = useMemo(() => {
    if (campusFitCoordinates.length === 0) return CAMPUS_REGION;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const point of campusFitCoordinates) {
      minLat = Math.min(minLat, point.latitude);
      maxLat = Math.max(maxLat, point.latitude);
      minLng = Math.min(minLng, point.longitude);
      maxLng = Math.max(maxLng, point.longitude);
    }

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.15, 0.012),
      longitudeDelta: Math.max((maxLng - minLng) * 1.15, 0.012),
    };
  }, [campusFitCoordinates]);

  const campusBiasedRegion = useMemo(
    () => ({
      ...campusReference,
      // Move camera slightly south so campus content sits higher on screen.
      latitude: campusReference.latitude - campusReference.latitudeDelta * CAMPUS_VISUAL_CENTER_BIAS,
      // Move camera slightly east so campus content sits less right-shifted.
      longitude: campusReference.longitude + campusReference.longitudeDelta * CAMPUS_VISUAL_HORIZONTAL_BIAS,
    }),
    [campusReference],
  );

  const parkedTarget = useMemo(() => {
    const parkedLotForFallback = parkedLotId
      ? lots.find((lot) => lot.lot_id === parkedLotId) ?? null
      : null;

    if (
      lastParkedLocation &&
      parkedLotForFallback &&
      lastParkedLocation.lotId === parkedLotForFallback.lot_id
    ) {
      const polygon = LOT_POLYGONS[parkedLotForFallback.lot_id];
      const insidePolygon = polygon && polygon.length >= 3
        ? isPointInsidePolygon(lastParkedLocation.latitude, lastParkedLocation.longitude, polygon)
        : true;
      const metersFromCenter = haversineDistance(
        lastParkedLocation.latitude,
        lastParkedLocation.longitude,
        parkedLotForFallback.center_lat,
        parkedLotForFallback.center_lng,
      );

      if (insidePolygon && metersFromCenter <= 250) {
        return {
          latitude: lastParkedLocation.latitude,
          longitude: lastParkedLocation.longitude,
          exact: true,
        };
      }
    }

    if (!parkedLotForFallback) return null;

    const fallbackPolygon = LOT_POLYGONS[parkedLotForFallback.lot_id];
    if (fallbackPolygon && fallbackPolygon.length >= 3) {
      const centroid = polygonCentroid(fallbackPolygon);
      if (isPointInsidePolygon(centroid.latitude, centroid.longitude, fallbackPolygon)) {
        return {
          latitude: centroid.latitude,
          longitude: centroid.longitude,
          exact: false,
        };
      }
    }

    return {
      latitude: parkedLotForFallback.center_lat,
      longitude: parkedLotForFallback.center_lng,
      exact: false,
    };
  }, [lastParkedLocation, parkedLotId, lots]);

  const handleFindMyCarPress = useCallback(() => {
    if (!parkedTarget || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: parkedTarget.latitude,
        longitude: parkedTarget.longitude,
        latitudeDelta: 0.004,
        longitudeDelta: 0.004,
      },
      600,
    );
  }, [parkedTarget]);

  const handleFindMyCarDirectionsPress = useCallback(() => {
    if (!parkedTarget) return;
    setIsFindCarDirectionsOpen(true);
  }, [parkedTarget]);

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
    AsyncStorage.setItem('filter:selectedLots', JSON.stringify(filteredLots)).catch(() => {});
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

  const handleRegionChangeComplete = useCallback(async (region: Region) => {
    if (!mapRef.current) return;

    const distanceFromCampus = haversineDistance(
      region.latitude,
      region.longitude,
      campusReference.latitude,
      campusReference.longitude,
    );
    setIsMapAwayFromCampus(distanceFromCampus > CAMPUS_RECENTER_THRESHOLD_METERS);

    const camera = await mapRef.current.getCamera();
    const next = camera.heading ?? 0;
    // Only push state if the bearing meaningfully changed — sub-1° deltas
    // re-render every ShuttleMarker (each runs the heading subtraction)
    // for no perceptible visual benefit. ~1° is the smallest rotation a
    // user can intentionally produce in a two-finger gesture.
    setMapBearing((prev) => {
      const delta = Math.abs(next - prev);
      const wrapped = Math.min(delta, 360 - delta);
      return wrapped >= 1 ? next : prev;
    });
  }, [campusReference.latitude, campusReference.longitude]);

  const campusEdgePaddingTop = parkedLot ? CAMPUS_EDGE_PADDING_TOP_WITH_PARKED : CAMPUS_EDGE_PADDING_TOP;
  const campusEdgePaddingBottom = CAMPUS_EDGE_PADDING_BOTTOM_BASE + insets.bottom;
  const campusViewportKey = `${campusEdgePaddingTop}:${CAMPUS_EDGE_PADDING_RIGHT}:${campusEdgePaddingBottom}:${CAMPUS_EDGE_PADDING_LEFT}:${campusFitCoordinates.length}`;

  const applyCampusViewport = useCallback((animated: boolean) => {
    if (!mapRef.current) return;

    if (campusFitCoordinates.length >= 2) {
      mapRef.current.fitToCoordinates(campusFitCoordinates, {
        edgePadding: {
          top: campusEdgePaddingTop,
          right: CAMPUS_EDGE_PADDING_RIGHT,
          bottom: campusEdgePaddingBottom,
          left: CAMPUS_EDGE_PADDING_LEFT,
        },
        animated,
      });
    } else {
      mapRef.current.animateToRegion(campusBiasedRegion, animated ? 700 : 0);
    }
  }, [campusBiasedRegion, campusEdgePaddingBottom, campusEdgePaddingTop, campusFitCoordinates]);

  const handleReturnToCampusPress = useCallback(() => {
    applyCampusViewport(true);

    setIsMapAwayFromCampus(false);
  }, [applyCampusViewport]);

  useEffect(() => {
    if (!isMapReady) return;
    if (campusFitCoordinates.length < 2) return;
    if (
      hasAppliedInitialCampusViewportRef.current &&
      lastAppliedCampusViewportKeyRef.current === campusViewportKey
    ) {
      return;
    }

    applyCampusViewport(false);
    hasAppliedInitialCampusViewportRef.current = true;
    lastAppliedCampusViewportKeyRef.current = campusViewportKey;
    setIsMapAwayFromCampus(false);
  }, [applyCampusViewport, campusFitCoordinates.length, campusViewportKey, isMapReady]);

  const openRecommendationModal = useCallback(() => {
    refreshFavorites();
    setIsRecommendationModalOpen(true);
  }, [refreshFavorites]);

  // Filter parking lots based on selected filter
  const filteredParkingLots = selectedLots.length > 0
    ? lots.filter(lot => selectedLots.includes(lot.lot_id))
    : lots;

  const filteredRoutes = hiddenRouteIds.length > 0
    ? routes?.filter(r => !hiddenRouteIds.includes(r.id))
    : routes;
  const filteredStops = hiddenRouteIds.length > 0
    ? stops?.filter(s => s.routeIds.some(id => !hiddenRouteIds.includes(id)))
    : stops;

  const routeColorMap = useMemo(
    () => new Map(routes?.map((r) => [r.id, r.color]) ?? []),
    [routes],
  );
  const filteredShuttles = hiddenRouteIds.length > 0
    ? shuttles?.filter(s => !hiddenRouteIds.includes(s.routeId))
    : shuttles;

  return (
    <View style={[styles.container, { backgroundColor: colors.backgroundLight }]}>
      {/* Header */}
      <Header />

      <View style={styles.mapContainer}>
        {parkedLot && (
          <TouchableOpacity
            style={[styles.findMyCarBanner, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}
            onPress={handleFindMyCarPress}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Find my car in ${parkedLot.lot_name}`}
          >
            <View style={[styles.findMyCarDot, { backgroundColor: PARKED_LOT_COLOR }]} />
            <View style={styles.findMyCarTextWrap}>
              <View style={styles.findMyCarHeaderRow}>
                <Text style={[styles.findMyCarTitle, { color: colors.textPrimary }]}>Find my car</Text>
                <View style={styles.parkedChip}>
                  <Text style={[styles.parkedChipText, { color: colors.white }]}>Parked</Text>
                </View>
              </View>
              <Text style={[styles.findMyCarSubtitle, { color: colors.gray }]}>Parked in {parkedLot.lot_name}</Text>
              {carpoolPassengerMode && (
                <Text style={[styles.findMyCarSubtitle, { color: colors.gray }]}>
                  Passenger mode active{carpoolPassengerCount > 0 ? ` · ${carpoolPassengerCount} riders marked` : ''}
                </Text>
              )}
            </View>
            <View style={styles.findMyCarActionRow}>
              <TouchableOpacity
                style={[styles.findMyCarActionButton, { borderColor: PARKED_LOT_COLOR }]}
                onPress={handleFindMyCarDirectionsPress}
                accessibilityRole="button"
                accessibilityLabel="Get directions to parked car"
              >
                <Icon name="navigate-outline" size={16} color={PARKED_LOT_COLOR} accessible={false} />
              </TouchableOpacity>
              <Icon name="locate-outline" size={18} color={PARKED_LOT_COLOR} accessible={false} />
            </View>
          </TouchableOpacity>
        )}

        {isMapAwayFromCampus && (
          <TouchableOpacity
            style={[
              styles.returnToCampusButton,
              {
                backgroundColor: colors.white,
                shadowColor: colors.shadowDark,
                top: parkedLot ? 92 : SPACING.md,
              },
            ]}
            onPress={handleReturnToCampusPress}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Return map to CSULB campus"
          >
            <Icon name="compass-outline" size={16} color={COLORS.primary} accessible={false} />
            <Text style={[styles.returnToCampusText, { color: colors.textPrimary }]}>Back to CSULB</Text>
          </TouchableOpacity>
        )}

        <MapView
          ref={mapRef}
          key={isDark ? 'dark-map' : 'light-map'} // Android (Google Maps) requires a forced re-render
          provider={PROVIDER_DEFAULT} // Apple Maps for iOS, Google Maps for Android
          style={styles.map}
          initialRegion={CAMPUS_REGION}
          showsUserLocation={true}
          showsMyLocationButton={true}
          pitchEnabled={false}
          moveOnMarkerPress={false}
          userInterfaceStyle={isDark ? 'dark' : 'light'}
          onMapReady={() => setIsMapReady(true)}
          onRegionChangeComplete={handleRegionChangeComplete}
        >
          {filtersHydrated && filteredParkingLots?.map((lot) => {
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
            const parkedKey = lot.lot_id === parkedLotId ? 'parked' : 'unparked';
            const contributorKey = isContributor ? 'contrib' : 'locked';
            return (
              <InteractiveLot
                key={`${lot.lot_id}:${contributorKey}:${parkedKey}:${visualKey}`}
                lot={lot}
                onPress={handleLotPress}
                colors={colors}
                isContributor={isContributor}
                isParkedLot={lot.lot_id === parkedLotId}
              />
            );
          })}

          {parkedTarget?.exact && (
            <Marker
              coordinate={{ latitude: parkedTarget.latitude, longitude: parkedTarget.longitude }}
              tracksViewChanges={false}
              zIndex={5}
              accessibilityRole="image"
              accessibilityLabel="Last parked car location"
            >
              <View style={[styles.parkedCarMarkerOuter, { borderColor: colors.white }]}>
                <Icon name="car-sport" size={14} color={colors.white} accessible={false} />
              </View>
            </Marker>
          )}
          
          {/* Draw route paths — static, no isFocused guard to avoid unmount on nav transitions */}
          {filtersHydrated && filteredRoutes?.map((route) => (
            <Polyline
              key={route.id}
              coordinates={route.coordinates}
              strokeColor={route.color}
              strokeWidth={4}
              zIndex={1}
            />
          ))}

          {/* Draw stops — static, no isFocused guard to avoid unmount on nav transitions */}
          {filtersHydrated && filteredStops?.map((stop) => (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              zIndex={2}
              stopPropagation={true}
              onPress={() => handleStopPress(stop)}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Shuttle stop: ${stop.name}`}
              tracksViewChanges={false}
            >
              <SegmentedCircle
                colors={stop.routeIds.map(id => routeColorMap.get(id) ?? stop.color)}
                borderColor={colors.white}
              />
            </Marker>
          ))}

          {/* Draw live shuttles */}
          {filtersHydrated && isFocused && filteredShuttles?.map((shuttle) => (
            <ShuttleMarker
              key={shuttle.id}
              shuttle={shuttle}
              colors={colors}
              mapBearing={mapBearing}
              onPress={(s) => setSelectedShuttleId(s.id)}
            />
          ))}
        </MapView>
      </View>

      {/* Filter button - bottom left */}
      <FilterButton onPress={handleFilterPress} insetBottom={insets.bottom} />

      {/* Navigate button FAB - bottom right */}
      <View style={[styles.navigateButtonContainer, { bottom: SPACING.xxl + insets.bottom }]}>
        <FavoritesButton onPress={openRecommendationModal} isDark={isDark} />
      </View>

      {/* Filter Modal */}
      <LotFilterModal
        isOpen={isFilterModalOpen}
        onClose={handleFilterClose}
        lots={lots ?? []}
        selectedLots={selectedLots}
        onApplyFilter={handleApplyFilter}
        routes={routes ?? []}
        hiddenRouteIds={hiddenRouteIds}
        onApplyTransitFilter={(ids) => {
          setHiddenRouteIds(ids);
          AsyncStorage.setItem('filter:hiddenRouteIds', JSON.stringify(ids)).catch(() => {});
        }}
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

      {parkedTarget && (
        <MapSelectModal
          isVisible={isFindCarDirectionsOpen}
          onClose={() => setIsFindCarDirectionsOpen(false)}
          lat={parkedTarget.latitude}
          lon={parkedTarget.longitude}
          title={parkedLot?.lot_name ?? 'Parked Car'}
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
  findMyCarBanner: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: SPACING.lg,
    ...SHADOWS.card,
  },
  findMyCarDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  findMyCarTextWrap: {
    flex: 1,
  },
  findMyCarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  findMyCarTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  parkedChip: {
    backgroundColor: PARKED_LOT_COLOR,
    borderRadius: 999,
    paddingHorizontal: SPACING.md,
    paddingVertical: 3,
  },
  parkedChipText: {
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  findMyCarSubtitle: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginTop: 2,
  },
  findMyCarActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  findMyCarActionButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
  },
  returnToCampusButton: {
    position: 'absolute',
    right: SPACING.md,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 999,
    ...SHADOWS.card,
  },
  returnToCampusText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  map: {
    width: screenWidth,
    height: screenHeight,
  },
  lotLabel: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    minWidth: 56,
    minHeight: 30,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 72,
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
    fontSize: TYPOGRAPHY.fontSize.xs,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    textAlign: 'center',
  },
  parkedCarMarkerOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: PARKED_LOT_COLOR,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
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