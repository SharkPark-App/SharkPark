/**
 * Polygon Geofence Test Component
 * Demonstrates polygon vs circular geofence comparison for parking lots
 */
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { Text } from './CustomText';
import { ACCESSIBILITY_CONSTANTS, TEST_CONSTANTS, UI_CONSTANTS } from '../constants/geofencing';
import locationService from '../services/locationService';
import { GeofenceRegion } from '../types/location';
import { createTestPolygonGeofences, isPointInPolygon, calculatePolygonCenter, calculatePolygonArea } from '../utils/geofenceUtils';
import { SPACING, TYPOGRAPHY, SHADOWS } from '../constants/theme';

export const PolygonGeofenceTest: React.FC = () => {
  const [isTestingPolygons, setIsTestingPolygons] = useState(false);
  const [polygonGeofences, setPolygonGeofences] = useState<GeofenceRegion[]>([]);
  const [currentGeofenceResults, setCurrentGeofenceResults] = useState<string[]>([]);

  useEffect(() => {
    // Initialize polygon test geofences
    const testPolygons = createTestPolygonGeofences();
    setPolygonGeofences(testPolygons);
  }, []);

  const startPolygonTesting = async () => {
    if (polygonGeofences.length === 0) {
      Alert.alert('Error', 'No polygon geofences available for testing');
      return;
    }

    setIsTestingPolygons(true);
    setCurrentGeofenceResults([]);

    try {
      // Add polygon geofences to location service
      await locationService.addGeofenceRegions(polygonGeofences);

      // Set up geofence event listener
      const handleGeofenceEvent = (event: any) => {
        const timestamp = new Date().toLocaleTimeString();
        const result = `${timestamp}: ${event.eventType} ${event.regionId}`;
        setCurrentGeofenceResults(prev => [...prev, result]);

        Alert.alert(
          `Polygon Geofence ${event.eventType}`,
          `Event: ${event.eventType}\nRegion: ${event.regionId}\nTime: ${timestamp}`,
          [{ text: 'OK' }]
        );
      };

      locationService.setOnGeofenceEvent(handleGeofenceEvent);

      Alert.alert(
        'Polygon Geofence Testing Started',
        'Move around to test different polygon shapes:\n\n• Rectangular parking lot\n• L-shaped parking area\n• Irregular parking lot\n\nThese shapes represent realistic parking lot boundaries.',
        [{ text: 'Got it!' }]
      );

    } catch (error) {
      console.error('Failed to start polygon testing:', error);
      Alert.alert('Error', 'Failed to start polygon geofence testing');
      setIsTestingPolygons(false);
    }
  };

  const stopPolygonTesting = () => {
    setIsTestingPolygons(false);
    locationService.stopLocationTracking();
    Alert.alert('Testing Stopped', 'Polygon geofence testing has been stopped.');
  };

  const testPointInPolygon = (polygonIndex: number) => {
    if (polygonIndex >= polygonGeofences.length) return;

    const polygon = polygonGeofences[polygonIndex];
    if (polygon.geometry.type !== 'polygon' || !polygon.geometry.coordinates) return;

    const coordinates = polygon.geometry.coordinates;
    const center = calculatePolygonCenter(coordinates);
    const area = calculatePolygonArea(coordinates);

    // Test point inside polygon (center)
    const isInsideCenter = isPointInPolygon(center, coordinates);
    
    // Test point outside polygon (slightly offset)
    const outsidePoint = {
      latitude: center.latitude + 0.001, // About 111 meters north
      longitude: center.longitude + 0.001
    };
    const isInsideOffset = isPointInPolygon(outsidePoint, coordinates);

    Alert.alert(
      `Polygon Analysis: ${polygon.name}`,
      `Vertices: ${coordinates.length}\n` +
      `Area: ${Math.round(area)} sq meters\n` +
      `Center: ${center.latitude.toFixed(6)}, ${center.longitude.toFixed(6)}\n\n` +
      `Point-in-polygon tests:\n` +
      `• Center point: ${isInsideCenter ? 'INSIDE' : 'OUTSIDE'}\n` +
      `• Offset point: ${isInsideOffset ? 'INSIDE' : 'OUTSIDE'}`,
      [{ text: 'OK' }]
    );
  };

  const simulatePolygonEntry = (polygonId: string) => {
    locationService.triggerTestGeofenceEvent(polygonId, 'ENTER');
  };

  const simulatePolygonExit = (polygonId: string) => {
    locationService.triggerTestGeofenceEvent(polygonId, 'EXIT');
  };

  const compareWithCircular = () => {
    Alert.alert(
      'Polygon vs Circular Geofences',
      'Advantages of Polygon Geofences:\n\n' +
      'Exact parking lot boundaries\n' +
      'No overlap between adjacent lots\n' +
      'Handles irregular shapes (L-shaped, etc.)\n' +
      'Better accuracy for user experience\n' +
      'Matches real parking lot layouts\n\n' +
      'Circular geofences often overlap and don\'t match the actual lot boundaries, leading to false triggers.',
      [{ text: 'Understood' }]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Polygon Geofence Testing</Text>
      <Text style={styles.subtitle}>Test advanced polygon-based parking lot detection</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Testing Controls</Text>
        
        <TouchableOpacity
          style={[styles.button, isTestingPolygons ? styles.stopButton : styles.startButton]}
          onPress={isTestingPolygons ? stopPolygonTesting : startPolygonTesting}
          accessibilityLabel={isTestingPolygons ? 'Stop polygon testing' : 'Start polygon testing'}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>
            {isTestingPolygons ? 'Stop Polygon Testing' : 'Start Polygon Testing'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.infoButton}
          onPress={compareWithCircular}
          accessibilityLabel="Compare polygon vs circular geofences"
          accessibilityRole="button"
        >
          <Text style={styles.infoButtonText}>Why Polygons Are Better</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Available Polygon Geofences</Text>
        {polygonGeofences.map((geofence, index) => (
          <View key={geofence.id} style={styles.geofenceCard}>
            <Text style={styles.geofenceName}>{geofence.name}</Text>
            <Text style={styles.geofenceDetails}>
              ID: {geofence.id}{'\n'}
              Vertices: {geofence.geometry.coordinates?.length || 0}{'\n'}
              Type: {geofence.geometry.type}
            </Text>
            
            <View style={styles.geofenceActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => testPointInPolygon(index)}
                accessibilityLabel={`Analyze polygon ${geofence.name}`}
              >
                <Text style={styles.actionButtonText}>Analyze</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => simulatePolygonEntry(geofence.id)}
                accessibilityLabel={`Simulate entry to ${geofence.name}`}
              >
                <Text style={styles.actionButtonText}>Enter</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => simulatePolygonExit(geofence.id)}
                accessibilityLabel={`Simulate exit from ${geofence.name}`}
              >
                <Text style={styles.actionButtonText}>Exit</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {currentGeofenceResults.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Events</Text>
          <View style={styles.resultsContainer}>
            {currentGeofenceResults.slice(-10).map((result, index) => (
              <Text key={index} style={styles.resultText}>{result}</Text>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Polygon Shapes Explained</Text>
        <View style={styles.explanationCard}>
          <Text style={styles.explanationTitle}>🔲 Rectangular Parking Lot</Text>
          <Text style={styles.explanationText}>
            Most common shape for surface parking lots. 4 corners define exact boundaries.
          </Text>
        </View>
        
        <View style={styles.explanationCard}>
          <Text style={styles.explanationTitle}>📐 L-Shaped Parking Area</Text>
          <Text style={styles.explanationText}>
            Complex shape that wraps around buildings. 6 vertices create accurate coverage.
          </Text>
        </View>
        
        <View style={styles.explanationCard}>
          <Text style={styles.explanationTitle}>🔄 Irregular Parking Lot</Text>
          <Text style={styles.explanationText}>
            Real-world lots often have irregular shapes due to topography or buildings.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: SPACING.md,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: '#666',
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.md,
  },
  button: {
    padding: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    minHeight: 44, // Accessibility minimum
  },
  startButton: {
    backgroundColor: '#4CAF50',
  },
  stopButton: {
    backgroundColor: '#f44336',
  },
  infoButton: {
    backgroundColor: '#2196F3',
    padding: SPACING.md,
    borderRadius: 8,
    minHeight: 44, // Accessibility minimum
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  infoButtonText: {
    color: 'white',
    textAlign: 'center',
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  geofenceCard: {
    backgroundColor: 'white',
    padding: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    ...SHADOWS.card,
  },
  geofenceName: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.xs,
  },
  geofenceDetails: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: '#666',
    marginBottom: SPACING.md,
  },
  geofenceActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  actionButton: {
    backgroundColor: '#FF9800',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 6,
    minHeight: 44, // Accessibility minimum
    minWidth: 44, // Accessibility minimum
  },
  actionButtonText: {
    color: 'white',
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    textAlign: 'center',
  },
  resultsContainer: {
    backgroundColor: 'white',
    padding: SPACING.md,
    borderRadius: 8,
    maxHeight: 200,
  },
  resultText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    fontFamily: 'Courier',
    marginBottom: SPACING.xs,
    color: '#333',
  },
  explanationCard: {
    backgroundColor: 'white',
    padding: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  explanationTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.xs,
  },
  explanationText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: '#666',
    lineHeight: 20,
  },
});

export default PolygonGeofenceTest;
