/**
 * Tests for useFavorite hooks
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useFavorites } from '../src/hooks/useFavorites';
import { useAuth } from '../src/context/AuthContext';
import { AuthResult } from '../src/auth/AzureAuth';
import favoritesApi from '../src/services/api/favorites';

jest.mock('../src/context/AuthContext');
jest.mock('../src/services/api/favorites');

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockFavoritesApi = favoritesApi as jest.Mocked<typeof favoritesApi>;

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

      const { result } = renderHook(() => useFavorites());
      expect(result.current.isLoading).toBe(true);
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.favoriteLots).toEqual(mockLots);
      expect(mockFavoritesApi.getAllFavorites).toHaveBeenCalled();
    });
  });

  describe('addFavorite', () => {
    it('performs optimistic update and handles success', async () => {
      mockFavoritesApi.getAllFavorites.mockResolvedValueOnce([]);
      mockFavoritesApi.addFavorite.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useFavorites());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let addPromise: Promise<void>;
      act(() => {
        addPromise = result.current.addFavorite('G5');
      });

      expect(result.current.favoriteLots).toContain('G5');

      await act(async () => {
        await addPromise;
      });

      expect(result.current.favoriteLots).toContain('G5');
    });

    it('rolls back state if addFavorite API fails', async () => {
      mockFavoritesApi.getAllFavorites.mockResolvedValueOnce(['G1']);
      mockFavoritesApi.addFavorite.mockRejectedValueOnce(new Error('API Failure'));

      const { result } = renderHook(() => useFavorites());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        try {
          await result.current.addFavorite('G10');
        } catch {
          /* Expected throw */
        }
      });

      expect(result.current.favoriteLots).not.toContain('G10');
      expect(result.current.favoriteLots).toEqual(['G1']);
    });
  });

  describe('removeFavorite', () => {
    it('performs optimistic update and handles success', async () => {
      const initialLots = ['G1', 'G2'];
      mockFavoritesApi.getAllFavorites.mockResolvedValueOnce(initialLots);
      mockFavoritesApi.removeFavorite.mockResolvedValueOnce(undefined);

      const { result } = renderHook(() => useFavorites());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let removePromise: Promise<void>;
      act(() => {
        removePromise = result.current.removeFavorite('G1');
      });

      expect(result.current.favoriteLots).not.toContain('G1');
      expect(result.current.favoriteLots).toEqual(['G2']);

      await act(async () => {
        await removePromise;
      });
    });

    it('rolls back state if removeFavorite API fails', async () => {
      mockFavoritesApi.getAllFavorites.mockResolvedValueOnce(['G1']);
      mockFavoritesApi.removeFavorite.mockRejectedValueOnce(new Error('API Failure'));

      const { result } = renderHook(() => useFavorites());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        try {
          await result.current.removeFavorite('G1');
        } catch {
          /* Expected throw */
        }
      });

      expect(result.current.favoriteLots).toContain('G1');
      expect(result.current.error).toBeTruthy();
    });
  });

  describe('Authentication clear', () => {
    it('clears state and skips fetch if user logs out', async () => {
      mockFavoritesApi.getAllFavorites.mockResolvedValueOnce(['G1']);

      const { result, rerender } = renderHook(() => useFavorites());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      mockUseAuth.mockReturnValue({
        user: null,
        refreshSession: mockRefresh,
        isAuthenticated: false,
        isLoading: false,
        login: jest.fn(),
        logout: jest.fn(),
      });

      await act(async () => {
        rerender({});
      });

      expect(result.current.favoriteLots).toEqual([]);
      expect(mockFavoritesApi.getAllFavorites).toHaveBeenCalledTimes(1);
    });
  });
});