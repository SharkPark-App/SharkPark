/**
 * Auth API Tests
 *
 * Verifies that authApi.verifyEmail and authApi.resendVerification
 * call the correct endpoints with the correct request bodies.
 */

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { authApi } from '../src/services/api/auth';

const mockFetch = jest.fn();
const origFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  jest.clearAllMocks();
});

afterAll(() => {
  globalThis.fetch = origFetch;
});

const successResponse = {
  ok: true,
  json: () => Promise.resolve({ success: true, data: { message: 'OK' } }),
};

describe('authApi.verifyEmail', () => {
  it('posts to /auth/verify-email with email and code', async () => {
    mockFetch.mockResolvedValueOnce(successResponse);

    await authApi.verifyEmail('test@student.csulb.edu', '123456');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/auth/verify-email');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      email: 'test@student.csulb.edu',
      code: '123456',
    });
  });

  it('throws ApiError on 400 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('Invalid code'),
    });

    await expect(authApi.verifyEmail('test@student.csulb.edu', '000000')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('authApi.resendVerification', () => {
  it('posts to /auth/resend-verification with email', async () => {
    mockFetch.mockResolvedValueOnce(successResponse);

    await authApi.resendVerification('test@student.csulb.edu');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/auth/resend-verification');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({
      email: 'test@student.csulb.edu',
    });
  });

  it('throws ApiError on 429 response (rate limited)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: () => Promise.resolve('Rate limited'),
    });

    await expect(authApi.resendVerification('test@student.csulb.edu')).rejects.toMatchObject({
      status: 429,
    });
  });
});
