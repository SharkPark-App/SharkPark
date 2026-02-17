/**
 * Service for accessing user favorite-related endpoints (adding, removing, & retrieval)
 *   A valid accessToken is required - an automatic refresh will be attempted the current is expired
 */
import { apiService, ApiError } from './base';
import API_CONFIG from './config';
import { AuthResult } from '../../auth/AzureAuth';

class FavoritesApiService {
  /**
   * Helper for attempting to refresh tokens & automatically recalling an endpoint in the event of a 401 (unauthorized) error
   * If a new token is generated, it is passed to the subsequent api call
   */
  private async requestWithRetry<T>(
    apiCall: (token: string) => Promise<T>,
    accessToken: string,
    refreshSession: () => Promise<AuthResult | null>
  ): Promise<T> {
    try {
      return await apiCall(accessToken);
    } catch (error) {
      if ((error as ApiError).status == 401) {
        if (__DEV__) console.log('Token expired. Attempting to reload authentication.');

        const newAuth = await refreshSession();
        if (newAuth?.accessToken)
          return await apiCall(newAuth?.accessToken);
      }
      // If re-authentication wasn't successful
      if (__DEV__) console.error('Failed to retry the endpoint:', error);
      throw error;
    }
  }

  // Retrieves and returns a list of the user's favorite lots as lotId strings
  async getAllFavorites(
    userId: string,
    accessToken: string,
    refreshSession: () => Promise<AuthResult | null>
  ): Promise<string[]> {
    const id = encodeURIComponent(userId);
    const endpoint = `${API_CONFIG.ENDPOINTS.USERS}/${id}/favorites`;
    const favoriteLots = await this.requestWithRetry((token) => apiService.get<string[]>(endpoint, {
      headers: {'Authorization': `Bearer ${token}`}
    }), accessToken, refreshSession);
    return favoriteLots.data;
  }

  // Adds the specified lot to the users favorites list
  async addFavorite(
    userId: string,
    accessToken: string,
    lotId: string,
    refreshSession: () => Promise<AuthResult | null>
  ): Promise<void> {
    const id = encodeURIComponent(userId);
    const endpoint = `${API_CONFIG.ENDPOINTS.USERS}/${id}/favorites/${lotId}`;
    const response = await this.requestWithRetry((token) => apiService.post<void>(endpoint, {}, {
      headers: {'Authorization': `Bearer ${token}`}
    }), accessToken, refreshSession);
    return response.data;
  }

  // Removes the specified lot from the users favorites list
  async removeFavorite(
    userId: string,
    accessToken: string,
    lotId: string,
    refreshSession: () => Promise<AuthResult | null>
  ): Promise<void> {
    const id = encodeURIComponent(userId);
    const endpoint = `${API_CONFIG.ENDPOINTS.USERS}/${id}/favorites/${lotId}`;
    const response = await this.requestWithRetry((token) => apiService.delete<void>(endpoint, {
      headers: {'Authorization': `Bearer ${token}`}
    }), accessToken, refreshSession);
    return response.data;
  }
}

// Export singleton instance
export const favoritesApi = new FavoritesApiService();
export default favoritesApi;