/**
 * Hook for accessing & managing user's favorite lots
 *   Responsible for retrieving & managing a local copy of the user's favorites list
 *   A valid userId & accessToken are required
 */
import { useState, useEffect, useCallback } from 'react';
import favoritesApi from '../services/api/favorites';
import { ApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';

export interface UseFavoritesReturn {
  favoriteLots: string[];
  isLoading: boolean;
  error: string | null;
  addFavorite: (lotId: string) => Promise<void>;
  removeFavorite: (lotId: string) => Promise<void>;
  refreshFavorites: () => Promise<string[]>;
}

export const useFavorites = (): UseFavoritesReturn => {
  const { user, refreshSession } = useAuth();
  const [favoriteLots, setFavoriteLots] = useState<string[]>([]);
  const [isLoading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.userId;
  const accessToken = user?.accessToken;

  useEffect(() => {
    refreshFavorites();
  }, [userId, accessToken]);

  // Add the lot to the user's favorites list & return a copy
  const refreshFavorites = useCallback(async (): Promise<string[]> => {
    if (!userId || !accessToken) return [];

    try {
      setLoading(true);
      setError(null);
      const favorites = await favoritesApi.getAllFavorites(userId, accessToken, refreshSession);
      setFavoriteLots(favorites);
      return favorites;
    } catch (error) {
      const errorMessage = error instanceof ApiError
        ? `${error.message} (${error.status})`
        : `[useFavorites] Retrieving favorites failed for ${userId}`;
      setError(errorMessage);
    } finally {
      setLoading(false);
    } return [];
  }, [userId, accessToken]);

  // Add the lot to the user's favorites list
  const addFavorite = useCallback(async (lotId: string): Promise<void> => {
    if (!userId || !accessToken) return;

    // Optimistic local update
    setFavoriteLots((prev) => [...prev, lotId]);

    try {
      setError(null);
      await favoritesApi.addFavorite(userId, accessToken, lotId, refreshSession);
    } catch (error) {
      // Rollback on failure
      setFavoriteLots((prev) => prev.filter(fav => fav !== lotId));

      const errorMessage = error instanceof ApiError
        ? `${error.message} (${error.status})`
        : `[useFavorites] Failed to favorite lot ${lotId} for ${userId}`;
      setError(errorMessage);
      throw error;
    }
  }, [userId, accessToken]);

  // Remove the lot from the user's favorites list
  const removeFavorite = useCallback(async (lotId: string): Promise<void> => {
    if (!userId || !accessToken) return;

    // Optimistic local update
    const previousFavorites = [...favoriteLots];
    setFavoriteLots((prev) => prev.filter(fav => fav !== lotId));

    try {
      setError(null);
      await favoritesApi.removeFavorite(userId, accessToken, lotId, refreshSession);
    } catch (error) {
      // Rollback on failure
      setFavoriteLots(previousFavorites);

      const errorMessage = error instanceof ApiError
        ? `${error.message} (${error.status})`
        : `[useFavorites] Failed to unfavorite lot ${lotId} for ${userId}`;
      setError(errorMessage);
      throw error;
    }
  }, [favoriteLots, userId, accessToken]);

  return { favoriteLots, isLoading, error, addFavorite, removeFavorite, refreshFavorites};
};

export default useFavorites;