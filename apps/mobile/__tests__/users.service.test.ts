/**
 * Tests for src/services/api/users.ts
 *
 * Covers deleteMyAccount():
 *   - success path: calls DELETE /users/me with the Bearer token
 *   - no session: throws when loadAuth returns null
 *   - propagates apiService errors to the caller
 */

import { apiService } from '../src/services/api/base';

jest.mock('../src/services/api/base');
const mockApiService = apiService as jest.Mocked<typeof apiService>;

// loadAuth lives in src/auth and is imported by users.ts
jest.mock('../src/auth', () => ({
  loadAuth: jest.fn(),
}));
import { loadAuth } from '../src/auth';
const mockLoadAuth = loadAuth as jest.MockedFunction<typeof loadAuth>;

// Import after mocks are in place
import { deleteMyAccount } from '../src/services/api/users';

describe('users service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('deleteMyAccount', () => {
    it('calls DELETE /users/me with the correct Bearer token', async () => {
      mockLoadAuth.mockResolvedValueOnce({ idToken: 'test-id-token' } as Awaited<ReturnType<typeof loadAuth>>);
      mockApiService.delete.mockResolvedValueOnce({ success: true, data: undefined });

      await deleteMyAccount();

      expect(mockApiService.delete).toHaveBeenCalledWith('/users/me', {
        headers: { Authorization: 'Bearer test-id-token' },
      });
    });

    it('throws when there is no authenticated session', async () => {
      mockLoadAuth.mockResolvedValueOnce(null);

      await expect(deleteMyAccount()).rejects.toThrow('No authenticated session found.');
      expect(mockApiService.delete).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by apiService.delete', async () => {
      mockLoadAuth.mockResolvedValueOnce({ idToken: 'test-id-token' } as Awaited<ReturnType<typeof loadAuth>>);
      const networkError = new Error('Network failure');
      mockApiService.delete.mockRejectedValueOnce(networkError);

      await expect(deleteMyAccount()).rejects.toThrow('Network failure');
    });
  });
});
