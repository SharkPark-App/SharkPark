/**
 * Users API Service
 * Handles user-account operations against the backend.
 */

import { apiService } from './base';
import { loadAuth } from '../../auth';

export interface NotificationPreferences {
  favorites_filling?: boolean;
  favorites_clearing?: boolean;
  surge_alerts?: boolean;
  event_alerts?: boolean;
}

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

/**
 * Update notification preferences for the authenticated user.
 * Maps to PATCH /api/v1/users/:userId/notifications where userId = email.
 * The caller must supply the user's email (available from useAuth().user via
 * decoding idToken, or passed in directly from AuthContext).
 */
export async function updateNotificationPreferences(
  email: string,
  preferences: NotificationPreferences,
): Promise<void> {
  const auth = await loadAuth();
  if (!auth?.idToken) {
    throw new Error('No authenticated session found.');
  }

  await apiService.put<void>(
    `/users/${encodeURIComponent(email)}/notifications`,
    preferences,
    {
      headers: {
        Authorization: `Bearer ${auth.idToken}`,
      },
    },
  );
}
