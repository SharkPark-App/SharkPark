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
 * Fetch the authenticated user's profile (including stored
 * `notification_preferences`). Maps to GET /api/v1/users/:userId where
 * userId = email. The backend wraps the user in `{ success, data }`.
 *
 * Returns null on auth failure or any network error so callers can fall
 * back to local defaults — preferences fetching should never break the UI.
 */
export async function getUserProfile(
  email: string,
): Promise<{ notification_preferences?: NotificationPreferences } | null> {
  const auth = await loadAuth();
  if (!auth?.idToken) return null;

  try {
    const res = await apiService.get<{
      notification_preferences?: NotificationPreferences;
    }>(`/users/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${auth.idToken}` },
    });
    return res?.data ?? null;
  } catch {
    return null;
  }
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

  await apiService.patch<void>(
    `/users/${encodeURIComponent(email)}/notifications`,
    preferences,
    {
      headers: {
        Authorization: `Bearer ${auth.idToken}`,
      },
    },
  );
}
