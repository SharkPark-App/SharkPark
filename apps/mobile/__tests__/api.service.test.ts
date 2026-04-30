/**
 * API Service Tests
 */
import { ApiError, BackgroundLocationRequiredError } from '../src/services/api/base';
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

describe('ApiService', () => {
  const mockFetch = jest.fn();
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    jest.clearAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = origFetch;
  });

  // Use a fresh import to get a real ApiService instance (not the mock)
  // We test via the exported singleton
  const { apiService } = jest.requireActual('../src/services/api/base') as typeof import('../src/services/api/base');

  it('should make a GET request with correct URL and headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 1 } }),
    });

    const result = await apiService.get('/test');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.success).toBe(true);
  });

  it('should make a POST request with JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await apiService.post('/test', { key: 'value' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
      }),
    );
  });

  it('should throw ApiError on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: () => Promise.resolve('not found'),
    });

    await expect(apiService.post('/fail', {})).rejects.toThrow('HTTP 404');
  });

  it('should throw ApiError with status 0 on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(apiService.post('/fail', {})).rejects.toMatchObject({ status: 0 });
  });

  it('should retry GET requests on server errors', async () => {
    // First call fails with 500, second succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: 'ok' }),
      });

    const result = await apiService.get('/retry-test');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.data).toBe('ok');
  });

  it('should make a PUT request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await apiService.put('/test', { update: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('should make a DELETE request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    await apiService.delete('/test');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  describe('BG_LOCATION_REQUIRED handling', () => {
    it('throws BackgroundLocationRequiredError when 403 body has the contract code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: 'BG_LOCATION_REQUIRED', message: 'enable bg location' }),
          ),
      });

      await expect(apiService.post('/gated', {})).rejects.toBeInstanceOf(
        BackgroundLocationRequiredError,
      );
    });

    it('preserves the parsed payload on details and exposes status 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () =>
          Promise.resolve(
            JSON.stringify({ code: 'BG_LOCATION_REQUIRED', message: 'nope', extra: 1 }),
          ),
      });

      try {
        await apiService.post('/gated', {});
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BackgroundLocationRequiredError);
        const e = err as BackgroundLocationRequiredError;
        expect(e.status).toBe(403);
        expect(e.message).toBe('nope');
        expect(e.details).toMatchObject({ code: 'BG_LOCATION_REQUIRED', extra: 1 });
      }
    });

    it('does not retry BackgroundLocationRequiredError on GET', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve(JSON.stringify({ code: 'BG_LOCATION_REQUIRED' })),
      });

      await expect(apiService.get('/gated')).rejects.toBeInstanceOf(
        BackgroundLocationRequiredError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to plain ApiError when 403 body is not the BG_LOCATION_REQUIRED contract', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve(JSON.stringify({ message: 'some other forbidden' })),
      });

      await expect(apiService.post('/gated', {})).rejects.toMatchObject({
        name: 'ApiError',
        status: 403,
      });
    });
  });
});
