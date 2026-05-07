jest.mock('../src/services/api/base', () => ({
  apiService: {
    post: jest.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    details?: unknown;

    constructor(status: number, message: string, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
      this.name = 'ApiError';
    }
  },
}));

jest.mock('../src/auth', () => ({
  loadAuth: jest.fn(),
}));

import { ApiError, apiService } from '../src/services/api/base';
import { loadAuth } from '../src/auth';
import {
  reportsApi,
  ReportThrottledError,
  ReportUnauthorizedError,
} from '../src/services/api/reports';

const mockPost = apiService.post as jest.Mock;
const mockLoadAuth = loadAuth as jest.Mock;

describe('reportsApi.create', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fast-fails as unauthorized when no idToken is present', async () => {
    mockLoadAuth.mockResolvedValueOnce(null);

    await expect(
      reportsApi.create({ lotId: 'lot-1', type: 'blockage', message: 'blocked' }),
    ).rejects.toBeInstanceOf(ReportUnauthorizedError);

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('attaches Bearer token and returns unwrapped response data', async () => {
    mockLoadAuth.mockResolvedValueOnce({ idToken: 'id-token-123' });
    mockPost.mockResolvedValueOnce({
      data: { id: 'rpt-1', created_at: '2026-05-07T00:00:00.000Z' },
    });

    const result = await reportsApi.create({
      lotId: 'lot-1',
      type: 'crash',
      message: 'fender bender',
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/reports',
      { lotId: 'lot-1', type: 'crash', message: 'fender bender' },
      { headers: { Authorization: 'Bearer id-token-123' } },
    );
    expect(result).toEqual({ id: 'rpt-1', created_at: '2026-05-07T00:00:00.000Z' });
  });

  it('maps ApiError 401 into ReportUnauthorizedError', async () => {
    mockLoadAuth.mockResolvedValueOnce({ idToken: 'id-token-123' });
    mockPost.mockRejectedValueOnce(new ApiError(401, 'unauthorized'));

    await expect(
      reportsApi.create({ lotId: 'lot-1', type: 'other' }),
    ).rejects.toBeInstanceOf(ReportUnauthorizedError);
  });

  it('maps ApiError 429 into ReportThrottledError', async () => {
    mockLoadAuth.mockResolvedValueOnce({ idToken: 'id-token-123' });
    mockPost.mockRejectedValueOnce(new ApiError(429, 'rate limited'));

    await expect(
      reportsApi.create({ lotId: 'lot-1', type: 'other' }),
    ).rejects.toBeInstanceOf(ReportThrottledError);
  });
});
