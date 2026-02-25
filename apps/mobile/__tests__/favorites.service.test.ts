/**
 * Favorite Service Tests
 */
import favoritesApi from '../src/services/api/favorites';
import { apiService } from '../src/services/api/base';

jest.mock('../src/services/api/base', () => {
  return {
    apiService: {
      get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
    },
    ApiError: class MockApiError {
      status: number;
      message: string;
      constructor(status: number, message: string) {
        this.status = status;
        this.message = message;
      }
    }
  };
});

const mockApiService = apiService as jest.Mocked<typeof apiService>;
const mockRefreshSession = jest.fn();

describe('FavoritesService', () => {
  const userId = 'test-user-id';
  const accessToken = 'mock-access-token';
  const lotId = 'G1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllFavorites', () => {
    it('fetches all favorites for a user', async () => {
      const mockData = { success: true, data: ['G1', 'G3', 'G4'] };
      mockApiService.get.mockResolvedValueOnce(mockData);

      const result = await favoritesApi.getAllFavorites(userId, accessToken, mockRefreshSession);

      expect(mockApiService.get).toHaveBeenCalledWith(
        expect.stringContaining(`/users/${encodeURIComponent(userId)}/favorites`),
        expect.objectContaining({
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      );
      expect(result).toEqual(['G1', 'G3', 'G4']);
    });
  });

  describe('addFavorite', () => {
    it('successfully adds a favorite lot', async () => {
      const mockResponse = { success: true, data: undefined };
      mockApiService.post.mockResolvedValueOnce(mockResponse);

      await favoritesApi.addFavorite(userId, accessToken, lotId, mockRefreshSession);

      expect(mockApiService.post).toHaveBeenCalledWith(
        expect.stringContaining(`/favorites/${lotId}`),
        {},
        expect.objectContaining({
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      );
    });
  });

  describe('removeFavorite', () => {
    it('successfully removes a favorite lot', async () => {
      const mockResponse = { success: true, data: undefined };
      mockApiService.delete.mockResolvedValueOnce(mockResponse);

      await favoritesApi.removeFavorite(userId, accessToken, lotId, mockRefreshSession);

      expect(mockApiService.delete).toHaveBeenCalledWith(
        expect.stringContaining(`/favorites/${lotId}`),
        expect.objectContaining({
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      );
    });
  });

  describe('requestWithRetry', () => {
    it('refreshes token and retries the request upon a 401 error', async () => {
      const unauthorizedError = { status: 401 };
      const newAuth = { accessToken: 'mock-refreshed-token', userId };
      const successResponse = { success: true, data: undefined };

      mockApiService.post.mockRejectedValueOnce(unauthorizedError);
      mockRefreshSession.mockResolvedValueOnce(newAuth);
      mockApiService.post.mockResolvedValueOnce(successResponse);

      await favoritesApi.addFavorite(userId, accessToken, lotId, mockRefreshSession);

      expect(mockRefreshSession).toHaveBeenCalledTimes(1);

      expect(mockApiService.post).toHaveBeenCalledTimes(2);
      expect(mockApiService.post).toHaveBeenLastCalledWith(
        expect.any(String),
        {},
        expect.objectContaining({
          headers: { 'Authorization': `Bearer ${newAuth.accessToken}` }
        })
      );
    });

    it('throws the original error if refreshSession returns null', async () => {
      const unauthorizedError = { status: 401 };

      mockApiService.get.mockRejectedValueOnce(unauthorizedError);
      mockRefreshSession.mockResolvedValueOnce(null);

      await expect(
        favoritesApi.getAllFavorites(userId, accessToken, mockRefreshSession)
      ).rejects.toMatchObject({ status: 401 });
    });
  });
});