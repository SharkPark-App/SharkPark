/**
 * Auth API — email verification endpoints.
 *
 * Backend routes expected:
 *   POST /auth/verify-email          { email, code } → 200 on success
 *   POST /auth/resend-verification   { email }       → 200 on success
 */

import { apiService, ApiResponse } from './base';
import API_CONFIG from './config';

export const authApi = {
  /**
   * Submit the 6-digit verification code for the given email address.
   * Throws ApiError on failure (4xx / 5xx).
   */
  verifyEmail: async (email: string, code: string): Promise<ApiResponse<unknown>> => {
    return apiService.post<unknown>(
      API_CONFIG.ENDPOINTS.AUTH_VERIFY_EMAIL,
      { email, code },
    );
  },

  /**
   * Request a new verification code for the given email address.
   * Throws ApiError on failure (4xx / 5xx).
   */
  resendVerification: async (email: string): Promise<ApiResponse<unknown>> => {
    return apiService.post<unknown>(
      API_CONFIG.ENDPOINTS.AUTH_RESEND_VERIFICATION,
      { email },
    );
  },
};

export default authApi;
