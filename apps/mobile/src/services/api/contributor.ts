/**
 * Contributor reciprocity API helpers.
 *
 * The backend's ContributorGuard accepts a request when EITHER:
 *   - the device posted a real occupancy event in the last 30 minutes, OR
 *   - the device registered a permission grant in the last 24 hours.
 *
 * `registerContributorGrant()` covers the second case. Call it any time the
 * user transitions to "permissions granted" — most importantly on the first
 * grant inside LocationPermissionScreen, but also on app launch if the OS
 * already reports authorization (so users who granted yesterday don't get
 * stranded by a stale grant).
 */
import { apiService } from './base';
import API_CONFIG from './config';

let inFlight: Promise<void> | null = null;
let lastGrantAt = 0;
// Refresh at most once per hour — the backend grant TTL is 24h so this is
// plenty of headroom while keeping cold-start traffic negligible.
const MIN_REFRESH_MS = 60 * 60 * 1000;

/**
 * POST /contributor/grant. The x-device-id header is added automatically by
 * apiService. The body is intentionally empty — the device id IS the payload.
 *
 * Idempotent and dedup'd in-process: concurrent callers share the same
 * inflight promise, and back-to-back calls within MIN_REFRESH_MS no-op.
 *
 * Best-effort: failures are logged in dev but never thrown. The user's
 * permission grant is recorded locally by the OS; a transient network blip
 * shouldn't surface an error toast on the permission screen.
 */
export async function registerContributorGrant(opts: { force?: boolean } = {}): Promise<void> {
  const now = Date.now();
  if (!opts.force && now - lastGrantAt < MIN_REFRESH_MS) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // 204 No Content — apiService.post returns a typed response but we
      // ignore the body.
      await apiService.post(API_CONFIG.ENDPOINTS.CONTRIBUTOR_GRANT, {});
      lastGrantAt = Date.now();
    } catch (err) {
      if (__DEV__) {
        console.warn('[contributor] grant registration failed (will retry on next opportunity):', err);
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test-only reset hook. */
export function __resetContributorGrantStateForTests(): void {
  inFlight = null;
  lastGrantAt = 0;
}
