import { Platform } from 'react-native';

/**
 * API Configuration for SharkPark Mobile App
 * Handles environment-specific API endpoints and configuration
 */

// Get the correct localhost IP based on platform and environment
const getApiBaseUrl = () => {
  if (!__DEV__) {
    return 'https://api.sharkpark.csulb.edu/api/v1'; // Production
  }
  
  // Development - different IPs for different platforms
  if (Platform.OS === 'android') {
    // Android emulator needs special IP to reach host machine
    return 'http://10.0.2.2:3000/api/v1';
  } else {
    // iOS Development:
    // - Simulator: localhost works fine
    // - Physical Device: Update the IP below to your machine's local IP
    // 
    // To get your local IP: 
    // 1. Run `ifconfig | grep "inet " | grep -v 127.0.0.1` in terminal
    // 2. Or check System Preferences > Network > WiFi > Advanced > TCP/IP
    // 3. Replace 'localhost' below with your actual IP (e.g., '192.168.1.45')
    //
    // NOTE: This IP may change when switching networks (WiFi, etc.)
    return 'http://localhost:3000/api/v1'; // Change to your IP for physical iOS devices
  }
};

export const API_CONFIG = {
  // Base URL for the backend API
  BASE_URL: getApiBaseUrl(),

  // Request timeout in milliseconds (increased for debugging)
  TIMEOUT: 30000,

  // API endpoints
  ENDPOINTS: {
    LOTS: '/lots',
    LOTS_SUMMARY: '/lots/summary',
    LOT_DETAILS: (id: string) => `/lots/${id}`,
    LOT_HISTORY: (id: string) => `/lots/${id}/history`,
    USERS: '/users',
    WEATHER: '/weather',
    EVENTS: '/events',
  },

  // Default headers for all requests
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
};

export default API_CONFIG;
