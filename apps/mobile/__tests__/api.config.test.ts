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
    expect(API_CONFIG.TIMEOUT).toBeDefined();
    expect(API_CONFIG.ENDPOINTS).toBeDefined();
    expect(API_CONFIG.DEFAULT_HEADERS).toBeDefined();
  });

  it('should have correct timeout value', () => {
    expect(API_CONFIG.TIMEOUT).toBe(30000); // 30 seconds
  });

  it('should have correct default headers', () => {
    expect(API_CONFIG.DEFAULT_HEADERS).toEqual({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    });
  });

  it('should have all required endpoints', () => {
    const { ENDPOINTS } = API_CONFIG;
    
    expect(ENDPOINTS.LOTS).toBe('/lots');
    expect(ENDPOINTS.LOTS_SUMMARY).toBe('/lots/summary');
    expect(ENDPOINTS.USERS).toBe('/users');
    expect(ENDPOINTS.WEATHER).toBe('/weather');
    expect(ENDPOINTS.EVENTS).toBe('/events');
  });

  it('should generate dynamic endpoints correctly', () => {
    const { ENDPOINTS } = API_CONFIG;
    
    expect(ENDPOINTS.LOT_DETAILS('G1')).toBe('/lots/G1');
    expect(ENDPOINTS.LOT_DETAILS('E5')).toBe('/lots/E5');
    expect(ENDPOINTS.LOT_HISTORY('G1')).toBe('/lots/G1/history');
  });

  it('should have valid BASE_URL format', () => {
    expect(API_CONFIG.BASE_URL).toMatch(/^https?:\/\/.+\/api\/v1$/);
  });

  it('should use correct port for development', () => {
    // In development, should use port 3000
    if (API_CONFIG.BASE_URL.includes('localhost') || API_CONFIG.BASE_URL.includes('192.168') || API_CONFIG.BASE_URL.includes('10.0.2.2')) {
      expect(API_CONFIG.BASE_URL).toContain(':3000');
    }
  });
});
