jest.mock('../src/services/api/base', () => ({
  apiService: {
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../src/auth/AzureAuth', () => ({
  loadAuth: jest.fn(),
}));

import {
  registerPushToken,
  unregisterPushToken,
} from '../src/services/api/notifications';
import { apiService } from '../src/services/api/base';
import { loadAuth } from '../src/auth/AzureAuth';

const mockDelete = apiService.delete as jest.Mock;
const mockPost = apiService.post as jest.Mock;
const mockLoadAuth = loadAuth as jest.Mock;

describe('notifications API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerPushToken', () => {
    it('skips silently when there is no active session', async () => {
      mockLoadAuth.mockResolvedValueOnce(null);
      await registerPushToken('fcm-abc', 'ios');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('POSTs the token + platform with a bearer header', async () => {
      mockLoadAuth.mockResolvedValueOnce({ accessToken: 'AT-1' });
      mockPost.mockResolvedValueOnce(undefined);

      await registerPushToken('fcm-abc', 'android');

      expect(mockPost).toHaveBeenCalledWith(
        '/users/me/push-token',
        { token: 'fcm-abc', platform: 'android' },
        { headers: { Authorization: 'Bearer AT-1' } },
      );
    });
  });

  describe('unregisterPushToken', () => {
    it('skips silently when there is no active session', async () => {
      mockLoadAuth.mockResolvedValueOnce(null);
      await unregisterPushToken('fcm-abc');
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('DELETEs the push-token endpoint with a bearer header and JSON body', async () => {
      mockLoadAuth.mockResolvedValueOnce({ accessToken: 'AT-9' });
      mockDelete.mockResolvedValueOnce(undefined);

      await unregisterPushToken('fcm-xyz');

      expect(mockDelete).toHaveBeenCalledWith('/users/me/push-token', {
        headers: { Authorization: 'Bearer AT-9' },
        body: JSON.stringify({ token: 'fcm-xyz' }),
      });
    });

    it('propagates API errors so callers can decide how to handle them', async () => {
      mockLoadAuth.mockResolvedValueOnce({ accessToken: 'AT-1' });
      mockDelete.mockRejectedValueOnce(new Error('500 boom'));

      await expect(unregisterPushToken('fcm-xyz')).rejects.toThrow('500 boom');
    });
  });
});
