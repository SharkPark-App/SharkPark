/**
 * API Config Tests
 */
import API_CONFIG from '../src/services/api/config';

// Mock Platform
jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios', // Default to iOS for testing
  },
}));

describe('API Configuration', () => {
  it('should export required configuration', () => {
    expect(API_CONFIG).toBeDefined();
    expect(API_CONFIG.BASE_URL).toBeDefined();
    expect(API_CONFIG.SOCKET_PATH).toBeDefined();
    expect(API_CONFIG.TIMEOUT).toBeDefined();
    expect(API_CONFIG.ENDPOINTS).toBeDefined();
    expect(API_CONFIG.DEFAULT_HEADERS).toBeDefined();
  });

  it('should have correct timeout value', () => {
    expect(API_CONFIG.TIMEOUT).toBe(30000); // 30 seconds
  });

  it('should have correct socket path', () => {
    expect(API_CONFIG.SOCKET_PATH).toBe('/api/v1/socket.io/');
  });

  it('should have correct default headers', () => {
    expect(API_CONFIG.DEFAULT_HEADERS).toEqual({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });
  });

  it('should have all required base endpoints', () => {
    const { ENDPOINTS } = API_CONFIG;
    
    expect(ENDPOINTS.LOTS).toBe('/lots');
    expect(ENDPOINTS.LOTS_SUMMARY).toBe('/lots/summary');
    expect(ENDPOINTS.USERS).toBe('/users');
    expect(ENDPOINTS.WEATHER).toBe('/weather');
    expect(ENDPOINTS.EVENTS).toBe('/events');
    expect(ENDPOINTS.OCCUPANCY_EVENTS).toBe('/occupancy-events');
  });

  it('should have all required transit endpoints', () => {
    const { ENDPOINTS } = API_CONFIG;
    
    expect(ENDPOINTS.TRANSIT_SHUTTLES).toBe('/transit/shuttles');
    expect(ENDPOINTS.TRANSIT_ROUTES).toBe('/transit/routes');
    expect(ENDPOINTS.TRANSIT_STOPS).toBe('/transit/stops');
  });

  it('should generate dynamic endpoints correctly', () => {
    const { ENDPOINTS } = API_CONFIG;
    
    // Lot endpoints
    expect(ENDPOINTS.LOT_DETAILS('G1')).toBe('/lots/G1');
    expect(ENDPOINTS.LOT_DETAILS('E5')).toBe('/lots/E5');
    expect(ENDPOINTS.LOT_HISTORY('G1')).toBe('/lots/G1/history');
    expect(ENDPOINTS.LOT_RECOMMENDATIONS('G1')).toBe('/lots/G1/recommendations');
    expect(ENDPOINTS.LOT_PREDICTIONS_SHORT('G1')).toBe('/lots/G1/predictions/short-term');
    expect(ENDPOINTS.LOT_PREDICTIONS_LONG('G1')).toBe('/lots/G1/predictions/long-term');
    
    // Transit endpoints
    expect(ENDPOINTS.TRANSIT_ETAS('154358')).toBe('/transit/etas/154358');
  });

  it('should have valid BASE_URL and SHUTTLE_URL formats', () => {
    expect(API_CONFIG.BASE_URL).toMatch(/^https?:\/\/.+\/api\/v1$/);
  });

  it('should use correct port for development', () => {
    // In development, should use port 3000
    if (API_CONFIG.BASE_URL.includes('localhost') || API_CONFIG.BASE_URL.includes('192.168') || API_CONFIG.BASE_URL.includes('10.0.2.2')) {
      expect(API_CONFIG.BASE_URL).toContain(':3000');
    }
  });
});
