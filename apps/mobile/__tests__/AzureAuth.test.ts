import { authorize, refresh, logout } from 'react-native-app-auth';
import * as Keychain from 'react-native-keychain';
import {
  loginWithAzure,
  logoutFromAzure,
  saveAuth,
  clearAuth,
  loadAuth,
  AuthResult,
} from '../src/auth/AzureAuth';

// Mock react-native-app-auth
jest.mock('react-native-app-auth', () => ({
  authorize: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
}));

// Mock react-native-keychain
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(),
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

// Mock jwt-decode
jest.mock('jwt-decode', () => ({
  jwtDecode: jest.fn(() => ({
    preferred_username: 'test@student.csulb.edu',
    email: 'test@student.csulb.edu',
    given_name: 'Test',
    family_name: 'User',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
}));

// Mock fetch for backend sync
(globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve('{}'),
  } as Response),
);

describe('AzureAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loginWithAzure', () => {
    const mockAuthResult = {
      accessToken: 'mock-access-token',
      idToken: 'mock-id-token',
      refreshToken: 'mock-refresh-token',
      accessTokenExpirationDate: new Date(Date.now() + 3600000).toISOString(),
      tokenType: 'Bearer',
      userId: 'test-user-id',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
    };

    it('should successfully login and return auth result', async () => {
      (authorize as jest.Mock).mockResolvedValue(mockAuthResult);

      const result = await loginWithAzure();

      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: '9aea0ab1-4502-4868-a31b-0a8f333cec9c',
          scopes: ['openid', 'profile', 'email', 'offline_access'],
          usePKCE: true,
          useNonce: true,
        }),
      );
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.idToken).toBe('mock-id-token');
      expect(result.refreshToken).toBe('mock-refresh-token');
    });

    it('should throw error when no ID token is received', async () => {
      (authorize as jest.Mock).mockResolvedValue({
        ...mockAuthResult,
        idToken: null,
      });

      await expect(loginWithAzure()).rejects.toThrow('No ID token received from Azure AD');
    });

    it('should call backend sync after successful login', async () => {
      (authorize as jest.Mock).mockResolvedValue(mockAuthResult);

      await loginWithAzure();

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/users/'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAuthResult.idToken}`,
          }),
        }),
      );
    });

    it('should throw error when authorize fails', async () => {
      const error = new Error('User cancelled');
      (authorize as jest.Mock).mockRejectedValue(error);

      await expect(loginWithAzure()).rejects.toThrow('User cancelled');
    });
  });

  describe('logoutFromAzure', () => {
    it('should logout successfully with valid idToken', async () => {
      (logout as jest.Mock).mockResolvedValue(undefined);
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      await logoutFromAzure('mock-id-token');

      expect(logout).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: '9aea0ab1-4502-4868-a31b-0a8f333cec9c',
          serviceConfiguration: expect.objectContaining({
            endSessionEndpoint: expect.stringContaining('logout'),
          }),
        }),
        expect.objectContaining({
          idToken: 'mock-id-token',
        }),
      );
      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });

    it('should clear local auth even when no idToken provided', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      await logoutFromAzure();

      expect(logout).not.toHaveBeenCalled();
      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });

    it('should handle Azure error -3 gracefully (expected browser dismiss)', async () => {
      const error = new Error('error -3');
      (logout as jest.Mock).mockRejectedValue(error);
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      // Should not throw - error -3 is expected
      await logoutFromAzure('mock-id-token');

      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });

    it('should re-throw when user explicitly cancels', async () => {
      const error = new Error('User cancelled');
      (logout as jest.Mock).mockRejectedValue(error);

      await expect(logoutFromAzure('mock-id-token')).rejects.toThrow('User cancelled');
    });
  });

  describe('saveAuth', () => {
    it('should save auth state to keychain', async () => {
      const authState: AuthResult = {
        accessToken: 'test-access-token',
        idToken: 'test-id-token',
        refreshToken: 'test-refresh-token',
        accessTokenExpirationDate: new Date().toISOString(),
        tokenType: 'Bearer',
        userId: 'test-user-id',
      };

      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      await saveAuth(authState);

      expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
        'azure_auth',
        JSON.stringify(authState),
      );
    });
  });

  describe('clearAuth', () => {
    it('should reset keychain password', async () => {
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      await clearAuth();

      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });
  });

  describe('loadAuth', () => {
    it('should return null when no credentials stored', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);

      const result = await loadAuth();

      expect(result).toBeNull();
    });

    it('should return stored auth when token is still valid', async () => {
      const validAuthState: AuthResult = {
        accessToken: 'valid-access-token',
        idToken: 'valid-id-token',
        refreshToken: 'valid-refresh-token',
        // Token expires in 1 hour
        accessTokenExpirationDate: new Date(Date.now() + 3600000).toISOString(),
        tokenType: 'Bearer',
        userId: 'test-user-id',
      };

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify(validAuthState),
      });

      const result = await loadAuth();

      expect(result).toEqual(validAuthState);
    });

    it('should refresh token when expired but refresh token exists', async () => {
      const expiredAuthState: AuthResult = {
        accessToken: 'expired-access-token',
        idToken: 'expired-id-token',
        refreshToken: 'valid-refresh-token',
        // Token expired 1 hour ago
        accessTokenExpirationDate: new Date(Date.now() - 3600000).toISOString(),
        tokenType: 'Bearer',
        userId: 'test-user-id',
      };

      const refreshedResult = {
        accessToken: 'new-access-token',
        idToken: 'new-id-token',
        refreshToken: 'new-refresh-token',
        accessTokenExpirationDate: new Date(Date.now() + 3600000).toISOString(),
        tokenType: 'Bearer',
        userId: 'test-user-id',
      };

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify(expiredAuthState),
      });
      (refresh as jest.Mock).mockResolvedValue(refreshedResult);
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await loadAuth();

      expect(refresh).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: '9aea0ab1-4502-4868-a31b-0a8f333cec9c',
        }),
        expect.objectContaining({
          refreshToken: 'valid-refresh-token',
        }),
      );
      expect(result?.accessToken).toBe('new-access-token');
      expect(Keychain.setGenericPassword).toHaveBeenCalled();
    });

    it('should return null and clear auth when refresh fails', async () => {
      const expiredAuthState: AuthResult = {
        accessToken: 'expired-access-token',
        idToken: 'expired-id-token',
        refreshToken: 'invalid-refresh-token',
        accessTokenExpirationDate: new Date(Date.now() - 3600000).toISOString(),
        tokenType: 'Bearer',
        userId: 'test-user-id',
      };

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify(expiredAuthState),
      });
      (refresh as jest.Mock).mockRejectedValue(new Error('Refresh failed'));
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await loadAuth();

      expect(result).toBeNull();
      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });

    it('should return null when token expired and no refresh token', async () => {
      const expiredAuthState: AuthResult = {
        accessToken: 'expired-access-token',
        idToken: 'expired-id-token',
        refreshToken: undefined,
        accessTokenExpirationDate: new Date(Date.now() - 3600000).toISOString(),
        tokenType: 'Bearer',
        userId: 'test-user-id',
      };

      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: JSON.stringify(expiredAuthState),
      });
      (Keychain.resetGenericPassword as jest.Mock).mockResolvedValue(true);

      const result = await loadAuth();

      expect(result).toBeNull();
      expect(Keychain.resetGenericPassword).toHaveBeenCalled();
    });
  });
});
