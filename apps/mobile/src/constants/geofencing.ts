/**
 * Geofencing Constants
 * All configurable values for location tracking and geofencing
 */

// Location accuracy and distance settings
export const LOCATION_CONSTANTS = {
  // Distance filters (in meters)
  DISTANCE_FILTER_PRECISE: 5, // High precision for testing
  DISTANCE_FILTER_NORMAL: 50, // Battery-efficient for production
  DISTANCE_FILTER_MINIMAL: 100, // Maximum battery saving
  
  // Accuracy settings (in meters)
  ACCURACY_HIGH: 10, // High accuracy for testing
  ACCURACY_NORMAL: 100, // Good for parking lot detection
  ACCURACY_LOW: 500, // Minimal accuracy
  
  // Timeouts (in milliseconds)
  TIMEOUT_SHORT: 10000, // 10 seconds
  TIMEOUT_NORMAL: 15000, // 15 seconds
  TIMEOUT_LONG: 30000, // 30 seconds
  
  // Cache settings (in milliseconds)
  CACHE_SHORT: 60000, // 1 minute
  CACHE_NORMAL: 300000, // 5 minutes
  CACHE_LONG: 600000, // 10 minutes
} as const;

// Geofence radius settings
export const GEOFENCE_CONSTANTS = {
  // Radius sizes (in meters)
  RADIUS_SMALL: 25, // Small parking areas
  RADIUS_MEDIUM: 50, // Standard parking lots
  RADIUS_LARGE: 100, // Large parking structures
  RADIUS_TEST: 8, // Testing/development radius
  
  // Platform limits
  MAX_REGIONS_IOS: 20,
  MAX_REGIONS_ANDROID: 100,
  
  // Performance thresholds
  REGIONS_WARNING_THRESHOLD: 15, // Warn when approaching iOS limit
  REGIONS_CRITICAL_THRESHOLD: 18, // Critical warning near iOS limit
} as const;

// Test coordinates and settings
export const TEST_CONSTANTS = {
  // CSULB campus coordinates
  CSULB_CENTER: {
    latitude: 33.7838,
    longitude: -118.1089,
  },
  
  // Test geofence settings
  TEST_RADIUS: GEOFENCE_CONSTANTS.RADIUS_TEST,
  TEST_LOT_ID: 'G1',
  TEST_LOT_NAME: 'Lot G1 (Test Zone)',
  
  // Test polygon coordinates for realistic parking lot shapes
  TEST_RECTANGULAR_LOT: [
    { latitude: 26.3732, longitude: -80.1006 }, // SW corner
    { latitude: 26.3740, longitude: -80.1006 }, // NW corner
    { latitude: 26.3740, longitude: -80.0998 }, // NE corner  
    { latitude: 26.3732, longitude: -80.0998 }, // SE corner
  ],
  
  TEST_L_SHAPED_LOT: [
    { latitude: 26.3745, longitude: -80.1010 },
    { latitude: 26.3755, longitude: -80.1010 },
    { latitude: 26.3755, longitude: -80.1005 },
    { latitude: 26.3750, longitude: -80.1005 },
    { latitude: 26.3750, longitude: -80.1000 },
    { latitude: 26.3745, longitude: -80.1000 },
  ],
} as const;

// UI timing constants
export const UI_CONSTANTS = {
  // Animation durations (in milliseconds)
  ANIMATION_FAST: 200,
  ANIMATION_NORMAL: 300,
  ANIMATION_SLOW: 500,
  
  // Debounce timings (in milliseconds)
  DEBOUNCE_SEARCH: 300,
  DEBOUNCE_LOCATION: 1000,
  DEBOUNCE_API_CALL: 500,
  
  // Test delays (in milliseconds)
  TEST_ASYNC_WAIT: 50,
  TEST_ASYNC_WAIT_LONG: 100,
} as const;

// Privacy and compliance constants
export const PRIVACY_CONSTANTS = {
  // Data retention
  LOG_RETENTION_DAYS: 7, // Keep debug logs for 7 days
  EVENT_RETENTION_DAYS: 30, // Keep anonymous events for 30 days
  
  // Geographic precision limits
  COORDINATE_PRECISION_DIGITS: 6, // Enough for meter-level accuracy
  
  // Anonymous event limits
  MAX_EVENTS_PER_HOUR: 100, // Rate limiting for abuse prevention
  MAX_EVENTS_PER_DAY: 1000,
} as const;

// Accessibility constants
export const ACCESSIBILITY_CONSTANTS = {
  // Touch target sizes (iOS HIG and Android guidelines)
  MINIMUM_TOUCH_TARGET: 44, // iOS minimum
  RECOMMENDED_TOUCH_TARGET: 48, // Android recommendation
  
  // Label types for screen readers
  LABELS: {
    LOCATION_BUTTON: 'Enable location tracking',
    GEOFENCE_STATUS: 'Geofencing status',
    CURRENT_LOT: 'Currently parked in lot',
    PERMISSION_STATUS: 'Location permission status',
    MONITORED_LOTS: 'Number of monitored parking lots',
    TEST_BUTTON: 'Trigger test geofence event',
    LOT_SELECTOR: 'Select parking lot for testing',
    EVENT_TYPE_SELECTOR: 'Select geofence event type',
  },
  
  // Hints for complex interactions
  HINTS: {
    LOCATION_BUTTON: 'Double tap to request location permissions and start tracking',
    TEST_CONTROLS: 'Use these controls to simulate geofence events during development',
    LOT_SELECTION: 'Choose a parking lot to simulate entry or exit events',
  },
} as const;

// Error messages and user feedback
export const MESSAGE_CONSTANTS = {
  ERRORS: {
    PERMISSION_DENIED: 'Location permission is required for parking lot detection',
    LOCATION_UNAVAILABLE: 'Location services are currently unavailable',
    TIMEOUT: 'Location request timed out. Please check your GPS signal',
    NETWORK_ERROR: 'Network error. Please check your internet connection',
    DATABASE_ERROR: 'Failed to update parking data. Please try again',
  },
  
  SUCCESS: {
    TRACKING_STARTED: 'Location tracking started successfully',
    GEOFENCE_INITIALIZED: 'Parking lot detection is now active',
    EVENT_RECORDED: 'Parking event recorded successfully',
  },
  
  INFO: {
    PRIVACY_NOTICE: 'Your location is never stored - only anonymous parking events are recorded',
    BATTERY_OPTIMIZATION: 'Location tracking is optimized for battery efficiency',
    BACKGROUND_TRACKING: 'Background tracking helps detect parking lot usage even when the app is closed',
  },
} as const;
