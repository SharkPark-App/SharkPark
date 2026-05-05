/**
 * Notifications API Service
 *
 * Wraps POST /users/me/push-token — registers or refreshes a device FCM
 * token server-side so the backend cron scripts can fan-out push messages.
 * The endpoint upserts on `token` uniqueness, so calling this after every
 * sign-in and on token refresh is safe and idempotent.
 */
import { apiService } from './base';
import { loadAuth } from '../../auth/AzureAuth';

/**
 * Register (or refresh) the device push token for the currently signed-in
 * user.  Silently no-ops if there is no active session so call sites don't
 * need to guard against the guest/unauthenticated case themselves.
 */
export async function registerPushToken(
  token: string,
  platform: 'ios' | 'android',
): Promise<void> {
  const auth = await loadAuth();
  if (!auth?.accessToken) return; // guest or unauthenticated — skip

  await apiService.post<void>(
    '/users/me/push-token',
    { token, platform },
    {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
  );
}

/**
 * Unregister a device push token on logout. Scoped server-side to the
 * authenticated user so this call cannot evict another user's device.
 *
 * Best-effort: failures are caught by the caller and never block logout —
 * if the request fails the row is left orphaned and will be cleaned up on
 * the next FCM `messaging/registration-token-not-registered` send error
 * (see `NotificationsService.sendPush`).
 */
export async function unregisterPushToken(token: string): Promise<void> {
  const auth = await loadAuth();
  if (!auth?.accessToken) return;

  await apiService.delete<void>('/users/me/push-token', {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({ token }),
  });
}
