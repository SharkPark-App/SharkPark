/**
 * API Service Tests
 */
import { ApiError } from '../src/services/api/base';
import API_CONFIG from '../src/services/api/config';

describe('API Configuration', () => {
  it('should have correct base URL structure', () => {
    expect(API_CONFIG.BASE_URL).toContain('/api/v1');
    expect(API_CONFIG.TIMEOUT).toBe(30000);
    expect(API_CONFIG.DEFAULT_HEADERS['Content-Type']).toBe('application/json');
  });

  it('should have all required endpoints', () => {
    expect(API_CONFIG.ENDPOINTS.LOTS).toBe('/lots');
    expect(API_CONFIG.ENDPOINTS.LOT_DETAILS('G1')).toBe('/lots/G1');
    expect(API_CONFIG.ENDPOINTS.LOT_HISTORY('G1')).toBe('/lots/G1/history');
  });
});

describe('ApiError', () => {
  it('should create ApiError with correct properties', () => {
    const error = new ApiError(404, 'Not Found', { details: 'test' });

    expect(error.name).toBe('ApiError');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Not Found');
    expect(error.details).toEqual({ details: 'test' });
    expect(error instanceof Error).toBe(true);
  });

  it('should extend Error class properly', () => {
    const error = new ApiError(500, 'Server Error');
    
    expect(error.toString()).toContain('Server Error');
    expect(error.stack).toBeDefined();
  });
});
