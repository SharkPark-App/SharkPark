/**
 * Users API Service
 * Handles user-account operations against the backend.
 */

import { apiService } from './base';
import { loadAuth } from '../../auth/AzureAuth';

/**
 * Permanently deletes the authenticated user's account.
 * Maps to DELETE /api/v1/users/me (PR #100).
 *
 * The endpoint is protected by the Azure AD JWT middleware — the caller's
 * idToken must be forwarded as a Bearer token so the backend can resolve
 * req.user.email.
 *
 * After this resolves, callers should invoke logout() to clear local state.
 */
export async function deleteMyAccount(): Promise<void> {
  const auth = await loadAuth();
  if (!auth?.idToken) {
    throw new Error('No authenticated session found.');
  }

  await apiService.delete<void>('/users/me', {
    headers: {
      Authorization: `Bearer ${auth.idToken}`,
    },
  });
}
