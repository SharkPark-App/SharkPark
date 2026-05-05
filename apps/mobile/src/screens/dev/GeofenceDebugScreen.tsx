/**
 * GeofenceDebugScreen — dev-only viewer for parking-lot geofences.
 *
 * Renders every entry from `LOT_POLYGONS` as a `Polygon` overlay on top of
 * `MapView`, plus a small label marker at each polygon's centroid. Tap a
 * polygon to highlight it and surface its lot_id + vertex count.
 *
 * A "Show buildings" filter overlays campus building points (from
 * `CSULB_BUILDING_POINTS`) as small markers so we can sanity-check
 * lot ↔ building proximity directly on the map.
 *
 * Production builds never see this screen — it's gated behind `__DEV__` and
 * only registered with the Map stack when `__DEV__` is true (see
 * MainTabNavigator). Exporting it conditionally keeps the production bundle
 * free of debug imports.
 */

import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, ScrollView } from 'react-native';
import MapView, { Polygon, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Text } from '../../components/CustomText';
import { LOT_POLYGONS, type LatLng } from '../../data/lotPolygons';
import { CSULB_BUILDING_POINTS } from '../../data/buildingPoints';
import { CSULB_BUILDING_POLYGONS } from '../../data/buildingPolygons.generated';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const { width: screenW, height: screenH } = Dimensions.get('window');

// Approximate CSULB centroid (matches MapScreen's initial region anchor)
const CSULB_REGION = {
  latitude: 33.7838,
  longitude: -118.1141,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

function centroid(ring: LatLng[]): { latitude: number; longitude: number } {
  // Simple unweighted average — fine for short, near-rectangular rings.
  // Last vertex equals first in a closed ring; drop it before averaging.
  const pts = ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng
    ? ring.slice(0, -1)
    : ring;
  const sum = pts.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { latitude: sum.lat / pts.length, longitude: sum.lng / pts.length };
}

const GeofenceDebugScreen: React.FC = () => {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const [showLots, setShowLots] = useState(true);
  const [showBuildings, setShowBuildings] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);

  const entries = useMemo(() => Object.entries(LOT_POLYGONS), []);
  const buildingPolyByName = useMemo(
    () => new Map(CSULB_BUILDING_POLYGONS.map((b) => [b.name, b.polygon])),
    [],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.white }]}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={CSULB_REGION}
        mapType="hybrid"
      >
        {showLots && entries.map(([lotId, ring]) => {
          const isSelected = selected === lotId;
          const coords = ring.map((p) => ({ latitude: p.lat, longitude: p.lng }));
          const center = centroid(ring);
          return (
            <React.Fragment key={lotId}>
              <Polygon
                coordinates={coords}
                strokeColor={isSelected ? COLORS.warningBorder : COLORS.primary}
                strokeWidth={isSelected ? 3 : 1.5}
                fillColor={isSelected ? 'rgba(255,165,0,0.35)' : 'rgba(0,122,255,0.18)'}
                tappable
                onPress={() => setSelected(lotId)}
              />
              <Marker
                coordinate={center}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={() => setSelected(lotId)}
              >
                <View style={styles.label}>
                  <Text style={styles.labelText}>{lotId}</Text>
                </View>
              </Marker>
            </React.Fragment>
          );
        })}

        {showBuildings && CSULB_BUILDING_POLYGONS.map((b) => {
          const isSelected = selectedBuilding === b.name;
          return (
            <Polygon
              key={`bldpoly:${b.name}`}
              coordinates={b.polygon.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
              strokeColor={isSelected ? '#f59e0b' : '#7c3aed'}
              strokeWidth={isSelected ? 2.5 : 1.5}
              fillColor={isSelected ? 'rgba(245,158,11,0.30)' : 'rgba(124,58,237,0.20)'}
              tappable
              onPress={() => setSelectedBuilding(b.name)}
            />
          );
        })}

        {showBuildings && CSULB_BUILDING_POINTS.map((b) => {
          const isSelected = selectedBuilding === b.name;
          const tag = b.alternateNames[0] ?? b.name;
          const hasPolygon = buildingPolyByName.has(b.name);
          return (
            <Marker
              key={`bld:${b.name}`}
              coordinate={{ latitude: b.lat, longitude: b.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              onPress={() => setSelectedBuilding(b.name)}
            >
              <View
                style={[
                  styles.buildingPin,
                  hasPolygon && styles.buildingPinWithPolygon,
                  isSelected && styles.buildingPinSelected,
                ]}
              >
                <Text style={styles.buildingPinText}>{tag}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      <View style={[styles.panel, { backgroundColor: colors.white, borderTopColor: colors.borderGray }]}>
        <View style={styles.toggleRow}>
          <TouchableOpacity
            onPress={() => setShowLots((v) => !v)}
            style={[
              styles.toggle,
              {
                backgroundColor: showLots ? COLORS.primary : colors.lightGray,
                borderColor: colors.borderGray,
              },
            ]}
          >
            <Text style={[styles.toggleText, { color: showLots ? '#fff' : colors.textPrimary }]}>
              Lots ({entries.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowBuildings((v) => !v)}
            style={[
              styles.toggle,
              {
                backgroundColor: showBuildings ? '#7c3aed' : colors.lightGray,
                borderColor: colors.borderGray,
              },
            ]}
          >
            <Text style={[styles.toggleText, { color: showBuildings ? '#fff' : colors.textPrimary }]}>
              Buildings ({CSULB_BUILDING_POLYGONS.length}/{CSULB_BUILDING_POINTS.length})
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>
          Geofence Debug
        </Text>
        {selected ? (
          <Text style={[styles.panelDetail, { color: colors.textPrimary }]}>
            Lot: <Text style={styles.bold}>{selected}</Text> ({LOT_POLYGONS[selected].length} vertices)
          </Text>
        ) : null}
        {selectedBuilding ? (
          <Text style={[styles.panelDetail, { color: colors.textPrimary }]}>
            Building: <Text style={styles.bold}>{selectedBuilding}</Text>
            {buildingPolyByName.has(selectedBuilding)
              ? ` (${buildingPolyByName.get(selectedBuilding)!.length} vertices)`
              : ' (centroid only)'}
          </Text>
        ) : null}
        {!selected && !selectedBuilding ? (
          <Text style={[styles.panelDetail, { color: colors.gray }]}>
            Tap a polygon, lot label, or building pin to inspect.
          </Text>
        ) : null}

        <ScrollView horizontal style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          {showLots && entries.map(([lotId]) => (
            <TouchableOpacity
              key={lotId}
              onPress={() => setSelected(lotId)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected === lotId ? COLORS.warningBorder : colors.lightGray,
                  borderColor: colors.borderGray,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: colors.textPrimary }]}>{lotId}</Text>
            </TouchableOpacity>
          ))}
          {showBuildings && CSULB_BUILDING_POINTS.map((b) => {
            const tag = b.alternateNames[0] ?? b.name;
            return (
              <TouchableOpacity
                key={`chip:${b.name}`}
                onPress={() => setSelectedBuilding(b.name)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selectedBuilding === b.name ? '#a78bfa' : colors.lightGray,
                    borderColor: colors.borderGray,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: colors.textPrimary }]}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: screenW, height: screenH * 0.6 },
  label: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  labelText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  buildingPin: {
    backgroundColor: 'rgba(124,58,237,0.85)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#fff',
  },
  buildingPinWithPolygon: {
    // Slightly darker outline for buildings whose footprint polygon is rendered.
    borderColor: '#fde68a',
  },
  buildingPinSelected: {
    backgroundColor: '#f59e0b',
  },
  buildingPinText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  panel: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  toggle: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 16,
    borderWidth: 1,
  },
  toggleText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  panelTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    marginBottom: SPACING.xs,
  },
  panelDetail: {
    fontSize: TYPOGRAPHY.fontSize.md,
    marginBottom: SPACING.xs,
  },
  bold: { fontFamily: TYPOGRAPHY.fontFamily.bold },
  chipRow: { marginTop: SPACING.xs },
  chipRowContent: { gap: SPACING.xs, paddingBottom: SPACING.lg },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: SPACING.xs,
  },
  chipText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
});

export default GeofenceDebugScreen;
