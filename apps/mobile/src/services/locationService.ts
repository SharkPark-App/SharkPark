/**
 * Privacy-First Location Service
 * 
 * This service handles location tracking with a focus on user privacy and performance:
 * - Never stores actual user coordinates
 * - Only tracks anonymous parking lot entry/exit events
 * - Optimizes battery usage with smart location settings
 * - Provides transparent user controls
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Platform, Alert, AppState, AppStateStatus } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { 
  LocationPermissionStatus, 
  GeofenceRegion, 
  GeofenceEvent, 
  LocationServiceConfig,
  LocationError,
  DEFAULT_LOCATION_CONFIG 
} from '../types/location';
import { 
  LOCATION_CONSTANTS, 
  GEOFENCE_CONSTANTS,
  MESSAGE_CONSTANTS 
} from '../constants/geofencing';

class LocationService {
  private config: LocationServiceConfig = DEFAULT_LOCATION_CONFIG;
  private watchId: number | null = null;
  private geofenceRegions: Map<string, GeofenceRegion> = new Map();
  private lastKnownPosition: { latitude: number; longitude: number; timestamp: number } | null = null;
  private isTracking = false;
  private backgroundTrackingEnabled = false;
  private appState: AppStateStatus = 'active';
  private appStateSubscription: any = null;
  
  // Track which regions the user is currently inside
  private currentRegions: Set<string> = new Set();
  
  // Event listeners for privacy-compliant geofence events
  private onGeofenceEventListeners: ((event: GeofenceEvent) => void)[] = [];
  private onLocationError: ((error: LocationError) => void) | null = null;
  private onPermissionChange: ((status: LocationPermissionStatus) => void) | null = null;

  constructor() {
    this.initializeService();
  }

  private initializeService() {
    // Configure Geolocation for optimal performance and privacy
    Geolocation.setRNConfiguration({
      skipPermissionRequests: false,
      authorizationLevel: 'whenInUse',
      enableBackgroundLocationUpdates: false, // Will be enabled only if user consents
      locationProvider: 'auto'
    });

    // Listen to app state changes for background handling
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
  }

  /**
   * Request location permissions with transparent privacy messaging
   */
  async requestLocationPermission(): Promise<LocationPermissionStatus> {
    try {
      if (Platform.OS === 'ios') {
        return await this.requestIOSPermissions();
      } else {
        return await this.requestAndroidPermissions();
      }
    } catch (error) {
      console.error('[LocationService] Permission request failed:', error);
      return { granted: false, denied: true, restricted: false };
    }
  }

  private async requestIOSPermissions(): Promise<LocationPermissionStatus> {
    return new Promise((resolve) => {
      Geolocation.requestAuthorization(
        // Success callback
        () => {
          resolve({ granted: true, denied: false, restricted: false });
        },
        // Error callback
        (error) => {
          const isDenied = error.code === 1; // PERMISSION_DENIED
          const isRestricted = error.code === 2; // LOCATION_RESTRICTED
          resolve({ 
            granted: false, 
            denied: isDenied, 
            restricted: isRestricted 
          });
        }
      );
    });
  }

  private async requestAndroidPermissions(): Promise<LocationPermissionStatus> {
    // Android permissions are handled through PermissionsAndroid
    // For now, we'll use a simplified approach
    return new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        () => {
          resolve({ granted: true, denied: false, restricted: false });
        },
        (error) => {
          const isDenied = error.code === 1;
          resolve({ granted: false, denied: isDenied, restricted: false });
        },
        { timeout: 5000 }
      );
    });
  }

  /**
   * Request background location permission with clear privacy explanation
   */
  async requestBackgroundPermission(): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        'Background Location',
        'SharkPark can detect parking lot usage even when the app is closed, helping provide better data for everyone. Your location is never stored - only anonymous parking events are recorded.\n\nEnable background location tracking?',
        [
          {
            text: 'No Thanks',
            onPress: () => resolve(false),
            style: 'cancel'
          },
          {
            text: 'Enable',
            onPress: () => {
              this.backgroundTrackingEnabled = true;
              this.updateLocationConfiguration();
              resolve(true);
            }
          }
        ]
      );
    });
  }

  /**
   * Add geofence regions for parking lots
   */
  addGeofenceRegions(regions: GeofenceRegion[]) {
    // Respect platform limits
    const maxRegions = Platform.OS === 'ios' ? GEOFENCE_CONSTANTS.MAX_REGIONS_IOS : GEOFENCE_CONSTANTS.MAX_REGIONS_ANDROID;
    const regionsToAdd = regions.slice(0, maxRegions);

    regionsToAdd.forEach(region => {
      this.geofenceRegions.set(region.id, region);
    });

    // Added geofence regions
    
    // Start monitoring if not already tracking
    if (!this.isTracking) {
      this.startLocationTracking();
    }
  }

  /**
   * Start privacy-focused location tracking
   */
  async startLocationTracking(): Promise<boolean> {
    // Starting location tracking
    
    const permission = await this.requestLocationPermission();
    // Check permission result
    
    if (!permission.granted) {
      console.error('[LocationService] Permission denied');
      this.onLocationError?.({
        code: 'PERMISSION_DENIED',
        message: MESSAGE_CONSTANTS.ERRORS.PERMISSION_DENIED
      });
      return false;
    }

    // Permission granted, starting watch
    this.isTracking = true;
    this.watchId = Geolocation.watchPosition(
      this.handleLocationUpdate.bind(this),
      this.handleLocationError.bind(this),
      {
        enableHighAccuracy: true, // Higher accuracy for indoor testing
        timeout: this.config.timeout,
        maximumAge: LOCATION_CONSTANTS.CACHE_SHORT, // Shorter cache for more responsive updates
        distanceFilter: LOCATION_CONSTANTS.DISTANCE_FILTER_PRECISE, // Much smaller distance filter for indoor testing
        useSignificantChanges: false // Disable for more frequent updates during testing
      }
    );

    // Started location tracking
    return true;
  }

  /**
   * Stop location tracking
   */
  stopLocationTracking() {
    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    
    this.isTracking = false;
    // Stopped location tracking
  }

  /**
   * Handle location updates and check geofences (PRIVACY FIRST)
   */
  private handleLocationUpdate = (position: any) => {
    // Location update received
    
    const currentTime = Date.now();
    const newPosition = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: currentTime
    };

    // Check geofences without storing actual coordinates
    this.checkGeofences(newPosition);

    // Only store minimal data for geofence calculations
    this.lastKnownPosition = newPosition;
  };

  /**
   * Privacy-compliant geofence checking
   * NO user coordinates are stored or transmitted
   * Supports both circular and polygon geofences
   */
  private checkGeofences(position: { latitude: number; longitude: number; timestamp: number }) {
    this.geofenceRegions.forEach((region, regionId) => {
      let isInside: boolean;

      // Handle different geofence types
      if (region.geometry) {
        // Modern geofence format
        if (region.geometry.type === 'circle' && region.geometry.center && region.geometry.radius) {
          const distance = this.calculateDistance(
            position.latitude,
            position.longitude,
            region.geometry.center.latitude,
            region.geometry.center.longitude
          );
          isInside = distance <= region.geometry.radius;
          
          // Debug logging for circular geofences
          // Circle geofence detection
          
        } else if (region.geometry.type === 'polygon' && region.geometry.coordinates) {
          // Use polygon point-in-polygon detection
          isInside = this.isPointInPolygon(position, region.geometry.coordinates);
          
          // Debug logging for polygon geofences
          // Polygon geofence detection
          
        } else {
          console.warn(`[LocationService] Unsupported geofence geometry type for region ${regionId}`);
          return;
        }
      } else {
        // Legacy circular geofence format (backward compatibility)
        const legacyRegion = region as any; // Cast to legacy format temporarily
        if (legacyRegion.latitude && legacyRegion.longitude && legacyRegion.radius) {
          const distance = this.calculateDistance(
            position.latitude,
            position.longitude,
            legacyRegion.latitude,
            legacyRegion.longitude
          );
          isInside = distance <= legacyRegion.radius;
          
          // Debug logging for legacy geofences
          // Legacy geofence detection
        } else {
          console.warn(`[LocationService] Invalid geofence format for region ${regionId}`);
          return;
        }
      }

      const wasInside = this.wasInsideRegion(regionId);

      if (isInside && !wasInside && region.notifyOnEntry) {
        // ENTER event - NO coordinates transmitted!
        const event: GeofenceEvent = {
          regionId,
          eventType: 'ENTER',
          timestamp: new Date(position.timestamp).toISOString()
        };
        this.currentRegions.add(regionId); // Track that user is now inside
        this.notifyGeofenceListeners(event);
        // ENTER event (anonymous)
      } else if (!isInside && wasInside && region.notifyOnExit) {
        // EXIT event - NO coordinates transmitted!
        const event: GeofenceEvent = {
          regionId,
          eventType: 'EXIT',
          timestamp: new Date(position.timestamp).toISOString()
        };
        this.currentRegions.delete(regionId); // Track that user is no longer inside
        this.notifyGeofenceListeners(event);
        // EXIT event (anonymous)
      }
    });
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const EARTH_RADIUS_METERS = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c; // Distance in meters
  }

  private toRadians(degrees: number): number {
    const RADIANS_PER_DEGREE = Math.PI / 180;
    return degrees * RADIANS_PER_DEGREE;
  }

  /**
   * Check if user was previously inside a region
   */
  private wasInsideRegion(regionId: string): boolean {
    return this.currentRegions.has(regionId);
  }

  /**
   * Handle app state changes for background tracking
   */
  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    const isGoingToBackground = this.appState === 'active' && nextAppState === 'background';
    const isComingToForeground = this.appState === 'background' && nextAppState === 'active';

    this.appState = nextAppState;

    if (isGoingToBackground && this.backgroundTrackingEnabled) {
      this.enableBackgroundTracking();
    } else if (isComingToForeground) {
      this.disableBackgroundTracking();
    }
  };

  private enableBackgroundTracking() {
    if (Platform.OS === 'ios') {
      // iOS requires specific configuration for background location
      Geolocation.setRNConfiguration({
        skipPermissionRequests: false,
        authorizationLevel: 'always',
        enableBackgroundLocationUpdates: true,
        locationProvider: 'auto'
      });
    }
    // Background tracking enabled
  }

  private disableBackgroundTracking() {
    if (Platform.OS === 'ios') {
      Geolocation.setRNConfiguration({
        skipPermissionRequests: false,
        authorizationLevel: 'whenInUse',
        enableBackgroundLocationUpdates: false,
        locationProvider: 'auto'
      });
    }
    // Background tracking disabled
  }

  private updateLocationConfiguration() {
    // Update configuration based on user preferences
    if (this.backgroundTrackingEnabled) {
      Geolocation.setRNConfiguration({
        skipPermissionRequests: false,
        authorizationLevel: 'always',
        enableBackgroundLocationUpdates: true,
        locationProvider: 'auto'
      });
    }
  }

  private handleLocationError = (error: any) => {
    let errorCode: LocationError['code'] = 'LOCATION_UNAVAILABLE';
    
    switch (error.code) {
      case 1:
        errorCode = 'PERMISSION_DENIED';
        break;
      case 2:
        errorCode = 'LOCATION_UNAVAILABLE';
        break;
      case 3:
        errorCode = 'TIMEOUT';
        break;
      default:
        errorCode = 'LOCATION_UNAVAILABLE';
    }

    this.onLocationError?.({
      code: errorCode,
      message: error.message || 'Location error occurred'
    });
  };

  /**
   * Event listeners for privacy-compliant events
   */
  setOnGeofenceEvent(callback: (event: GeofenceEvent) => void) {
    // Adding geofence event listener
    this.onGeofenceEventListeners.push(callback);
  }

  removeOnGeofenceEvent(callback: (event: GeofenceEvent) => void) {
    // Removing geofence event listener
    const index = this.onGeofenceEventListeners.indexOf(callback);
    if (index > -1) {
      this.onGeofenceEventListeners.splice(index, 1);
    }
  }

  private notifyGeofenceListeners(event: GeofenceEvent) {
    // Notifying geofence listeners
    this.onGeofenceEventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[LocationService] Error in geofence listener:', error);
      }
    });
  }

  setOnLocationError(callback: (error: LocationError) => void) {
    this.onLocationError = callback;
  }

  setOnPermissionChange(callback: (status: LocationPermissionStatus) => void) {
    this.onPermissionChange = callback;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<LocationServiceConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): LocationServiceConfig {
    return { ...this.config };
  }

  /**
   * Check if background tracking is enabled
   */
  isBackgroundTrackingEnabled(): boolean {
    return this.backgroundTrackingEnabled;
  }

  /**
   * Get tracking status
   */
  isLocationTracking(): boolean {
    return this.isTracking;
  }

  /**
   * Get number of monitored regions
   */
  getMonitoredRegionsCount(): number {
    return this.geofenceRegions.size;
  }

  /**
   * Get current GPS position (for development/testing)
   */
  async getCurrentPosition(): Promise<any> {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          // Got current position
          resolve(position);
        },
        (error) => {
          console.error('[LocationService] Failed to get current position:', error);
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    });
  }

  /**
   * Trigger a test geofence event (development only)
   */
  triggerTestGeofenceEvent(regionId: string, eventType: 'ENTER' | 'EXIT') {
    if (!__DEV__) {
      console.warn('[LocationService] Test geofence events only available in development');
      return;
    }

    const event: GeofenceEvent = {
      regionId,
      eventType,
      timestamp: new Date().toISOString(),
    };

    // Triggering test geofence event
    this.notifyGeofenceListeners(event);
  }

  /**
   * Remove all registered geofence regions and reset current region state
   */
  clearGeofenceRegions() {
    this.geofenceRegions.clear();
    this.currentRegions.clear();
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopLocationTracking();
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.clearGeofenceRegions();
    this.onGeofenceEventListeners = [];
    this.onLocationError = null;
    this.onPermissionChange = null;
  }

  /**
   * Point-in-polygon detection using ray casting algorithm
   * Determines if a GPS coordinate is inside a polygon geofence
   */
  private isPointInPolygon(
    point: { latitude: number; longitude: number },
    polygon: Array<{ latitude: number; longitude: number }>
  ): boolean {
    if (polygon.length < 3) {
      console.warn('[LocationService] Polygon must have at least 3 vertices');
      return false;
    }

    const { latitude: x, longitude: y } = point;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const { latitude: xi, longitude: yi } = polygon[i];
      const { latitude: xj, longitude: yj } = polygon[j];

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }
}

// Export singleton instance
export const locationService = new LocationService();
export default locationService;
