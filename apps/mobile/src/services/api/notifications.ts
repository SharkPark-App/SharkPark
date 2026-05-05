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
