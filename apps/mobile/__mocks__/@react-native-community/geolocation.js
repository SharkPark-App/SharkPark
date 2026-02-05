/**
 * Mock for @react-native-community/geolocation
 * This mock prevents native module linking errors during testing
 */

export default {
  getCurrentPosition: jest.fn((success, error, options) => {
    // Mock successful location response
    const mockPosition = {
      coords: {
        latitude: 33.7838,
        longitude: -118.1141,
        accuracy: 10,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        speed: 0,
      },
      timestamp: Date.now(),
    };
    
    if (success) {
      success(mockPosition);
    }
  }),
  
  watchPosition: jest.fn((success, error, options) => {
    // Mock successful location response
    const mockPosition = {
      coords: {
        latitude: 33.7838,
        longitude: -118.1141,
        accuracy: 10,
        altitude: 0,
        altitudeAccuracy: 0,
        heading: 0,
        speed: 0,
      },
      timestamp: Date.now(),
    };
    
    if (success) {
      success(mockPosition);
    }
    
    // Return a mock watch ID
    return 1;
  }),
  
  clearWatch: jest.fn(),
  
  stopObserving: jest.fn(),
  
  requestAuthorization: jest.fn(() => Promise.resolve('granted')),
  
  setRNConfiguration: jest.fn(),
};
