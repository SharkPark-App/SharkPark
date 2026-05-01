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

// ── Contributor-state pub/sub ───────────────────────────────────────────────────────────
// Lots-list / lot-detail screens need to refetch the moment our contributor
// status flips, so locked badges / pin colors don't lag the OS truth by up
// to a full poll interval (30–60s). Hooks call `subscribeContributorState`
// in a useEffect; we fire 'granted' from registerContributorGrant() and
// 'revoked' from revokeContributorGrant().
export type ContributorState = 'granted' | 'revoked';
type Listener = (state: ContributorState) => void;
const listeners = new Set<Listener>();

export function subscribeContributorState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitContributorState(state: ContributorState): void {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      if (__DEV__) {
        console.warn('[contributor] listener threw:', err);
      }
    }
  }
}

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
      // Wake up subscribers (lot hooks) so they refetch with the new
      // contributor identity — don't make them wait for the next poll tick.
      emitContributorState('granted');
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

/**
 * POST /contributor/revoke. Tells the backend to immediately stop treating
 * this device as a contributor (clears `granted_at`, backdates
 * `last_seen_at`).
 *
 * Call this whenever the mobile client detects that background-location
 * permission has been revoked (Settings toggle, "Don't Allow" on a re-prompt,
 * SDK reports `Denied`/`Restricted`). Without it, the server will keep
 * serving live data for up to CONTRIBUTOR_GRANT_TTL_MS (24h) after revocation
 * because the server has no other way of knowing.
 *
 * Idempotent server-side. Best-effort client-side: failures are logged but
 * never thrown. Also resets the in-process grant dedup state so the next
 * legitimate grant call goes through.
 */
export async function revokeContributorGrant(): Promise<void> {
  // Always reset local dedup state so a subsequent re-grant isn't deduped
  // against the (now invalidated) prior grant.
  lastGrantAt = 0;

  // Wake up subscribers immediately — even before the network round-trip
  // completes — so the UI flips to neutral pins / locked badges without
  // waiting on the server. The next refetch will see the redacted payload.
  emitContributorState('revoked');

  try {
    await apiService.post(API_CONFIG.ENDPOINTS.CONTRIBUTOR_REVOKE, {});
  } catch (err) {
    if (__DEV__) {
      console.warn('[contributor] revoke failed (server may still consider device a contributor until grant TTL expires):', err);
    }
  }
}

/** Test-only reset hook. */
export function __resetContributorGrantStateForTests(): void {
  inFlight = null;
  lastGrantAt = 0;
  listeners.clear();
}
