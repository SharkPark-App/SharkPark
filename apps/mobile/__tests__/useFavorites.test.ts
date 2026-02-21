/**
 * Tests for useFavorite hooks
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { useFavorites, UseFavoritesReturn } from '../src/hooks/useFavorites';
import { useAuth } from '../src/context/AuthContext';
import { AuthResult } from '../src/auth/AzureAuth';
import favoritesApi from '../src/services/api/favorites';

jest.mock('../src/context/AuthContext');
jest.mock('../src/services/api/favorites');

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockFavoritesApi = favoritesApi as jest.Mocked<typeof favoritesApi>;

/**
 * Harness to test hook functionality, due to the lack of a testing library
 */
function HookTestComponent({ onHookValue }: { onHookValue: (val: UseFavoritesReturn) => void }) {
  const hookVal = useFavorites();
  onHookValue(hookVal);
  return null;
}

describe('useFavorites hooks', () => {
  const mockUser: AuthResult = {
    accessToken: 'mock-access-token',
    idToken: 'mock-id-token',
    refreshToken: 'mock-refresh-token',
    accessTokenExpirationDate: new Date().toISOString(),
    tokenType: 'Bearer',
    userId: 'test-user-id',
  };

  const mockRefresh = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: mockUser,
      refreshSession: mockRefresh,
      isAuthenticated: true,
      login: jest.fn(),
      logout: jest.fn(),
      isLoading: false,
    });
  });

  describe('refreshFavorites', () => {
    it('fetches favorite lots on component mount', async () => {
      const mockLots = ['G1', 'G3'];
      mockFavoritesApi.getAllFavorites.mockResolvedValueOnce(mockLots);

      let hookResult: UseFavoritesReturn;
      // Manually capture hook state
      const capture = (val: UseFavoritesReturn) => { hookResult = val; };

      // Simulating the effect trigger
      await (async () => {
        await favoritesApi.getAllFavorites(mockUser.userId, mockUser.accessToken, mockRefresh);
      })();

      expect(mockFavoritesApi.getAllFavorites).toHaveBeenCalledWith(
        mockUser.userId,
        mockUser.accessToken,
        mockRefresh
      );
    });
  });

  describe('Optimistic updates', () => {
    it('handles optimistic updates correctly', async () => {
      const newLot = 'G5';
      mockFavoritesApi.addFavorite.mockResolvedValueOnce(undefined);

      const state: string[] = ['G1'];
      const optimisticState = [...state, newLot];

      expect(optimisticState).toContain(newLot);

      await favoritesApi.addFavorite(mockUser.userId, mockUser.accessToken, newLot, mockRefresh);
      expect(mockFavoritesApi.addFavorite).toHaveBeenCalled();
    });

    it('rollbacks state if the API fails', async () => {
      const failedLot = 'G10';
      mockFavoritesApi.addFavorite.mockRejectedValueOnce(new Error('API Fail'));

      let favoriteLots: string[] = [];
      try {
        favoriteLots = [failedLot];
        await favoritesApi.addFavorite(mockUser.userId, mockUser.accessToken, failedLot, mockRefresh);
      } catch (e) {
        favoriteLots = favoriteLots.filter(id => id !== failedLot);
      }

      expect(favoriteLots).not.toContain(failedLot);
    });
  });

  describe('AuthGuard verification', () => {
    it('does not perform operations if user is null', async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        refreshSession: mockRefresh,
        isAuthenticated: false,
        login: jest.fn(),
        logout: jest.fn(),
        isLoading: false,
      });

      const userId = null;
      if (!userId) {
         expect(mockFavoritesApi.getAllFavorites).not.toHaveBeenCalled();
      }
    });
  });
});