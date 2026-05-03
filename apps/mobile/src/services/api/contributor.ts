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
import { useEffect, useState } from 'react';
import { apiService } from './base';
import { cacheService } from './cache';
import API_CONFIG from './config';

let inFlight: Promise<void> | null = null;
let lastGrantAt = 0;
// Refresh at most once per hour — the backend grant TTL is 24h so this is
// plenty of headroom while keeping cold-start traffic negligible.
const MIN_REFRESH_MS = 60 * 60 * 1000;

// ── Contributor-state pub/sub ───────────────────────────────────────────────────────────
// The single source of mobile-side truth for "is this device currently a
// contributor". Set by registerContributorGrant / revokeContributorGrant in
// response to OS permission changes (driven by EnhancedGeofencingProvider).
//
// Two consumers:
//   1. The lots API service (lots.ts) calls `getContributorStateSync()` on
//      every response and redacts contributor-gated fields when revoked.
//      This is the choke point that prevents stale colored data from
//      flickering onto the screen during the brief window between the
//      revoke POST being issued and the backend processing it.
//   2. Lot-data hooks (useLotData / useLotsList / useAllLotsData) subscribe
//      so they refetch immediately on state change rather than waiting
//      for the next poll tick.
export type ContributorState = 'granted' | 'revoked';
type Listener = (state: ContributorState) => void;
const listeners = new Set<Listener>();

// Initial value is 'granted' so callers don't false-redact during the
// brief window between app launch and the first OS provider event
// (the geofencing provider fires registerContributorGrant /
// revokeContributorGrant within the first few hundred ms of mount).
let currentState: ContributorState = 'granted';

export function getContributorStateSync(): ContributorState {
  return currentState;
}

export function subscribeContributorState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * React hook returning the current contributor state. Re-renders the
 * subscribing component on every state change.
 *
 * Use this in screens that gate UI on contributor status (locked badges,
 * map pin colors, forecast availability) so the lock decision tracks the
 * live OS permission state directly rather than waiting for the next
 * lot-data fetch to commit. Without this, a permission toggle leaves the
 * UI showing whatever the most recent fetch returned (locked or live)
 * until the next poll tick lands a fresh response — a confusing lag the
 * user perceives as "stuck".
 */
export function useContributorState(): ContributorState {
  const [state, setState] = useState<ContributorState>(currentState);
  useEffect(() => subscribeContributorState(setState), []);
  return state;
}

async function emitContributorState(state: ContributorState): Promise<void> {
  // Update the synchronous snapshot FIRST so that any response landing
  // mid-emit (e.g. an in-flight GET that resolves while listeners are
  // running their refetch logic) sees the new state when it hits the
  // redactor in lots.ts.
  currentState = state;
  // Bust contributor-gated cache entries before notifying subscribers so
  // their immediate refetch hits the network and writes a fresh response.
  // Cheap (one AsyncStorage scan) — safe to call on every state change.
  await cacheService.invalidatePrefix('lots:');
  if (__DEV__) console.log('[contributor] emit %s -> %d listener(s)', state, listeners.size);
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
  if (!opts.force && now - lastGrantAt < MIN_REFRESH_MS) {
    if (__DEV__) console.log('[contributor] grant deduped (last grant %dms ago, force=false)', now - lastGrantAt);
    return;
  }
  if (inFlight) {
    if (__DEV__) console.log('[contributor] grant joining in-flight promise (force=%s)', !!opts.force);
    return inFlight;
  }

  if (__DEV__) console.log('[contributor] grant POST starting (force=%s, listeners=%d)', !!opts.force, listeners.size);

  inFlight = (async () => {
    // Optimistic emit FIRST so hooks refetch IN PARALLEL with the POST
    // round-trip, not after it. Most grants are users re-granting after
    // a brief revoke within the server-side grant TTL (24h) or recent
    // occupancy-event window (30min) — server still considers them a
    // contributor and the GET returns colored data immediately. For
    // first-time grants where the optimistic GET returns redacted data,
    // the follow-up emit (after POST settles) triggers another refetch
    // that corrects the UI.
    //
    // Without this optimistic emit, the user toggles permission ON and
    // sees grey pins for the full POST + GET round-trip duration —
    // typically 500ms-2s on a real device. With it, the UI flips to
    // colored as fast as a single GET round-trip, which feels instant.
    await emitContributorState('granted');

    try {
      // 204 No Content — apiService.post returns a typed response but we
      // ignore the body.
      await apiService.post(API_CONFIG.ENDPOINTS.CONTRIBUTOR_GRANT, {});
      lastGrantAt = Date.now();
      if (__DEV__) console.log('[contributor] grant POST ok, emitting granted (definitive) to %d listener(s)', listeners.size);
      // Definitive emit: cache wipe + refetch with confirmed contributor
      // identity. For users where the optimistic refetch above returned
      // redacted data (first-time grant), this refetch corrects it.
      await emitContributorState('granted');
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
  // Reset local dedup so a subsequent re-grant isn't deduped against the
  // (now-invalidated) prior grant.
  lastGrantAt = 0;

  // Emit 'revoked' BEFORE the POST. The redactor in lots.ts now reads
  // currentState at response time, so any in-flight or new fetch will
  // be redacted to the locked shape regardless of what the backend
  // returns. This eliminates the GET-vs-POST race entirely — we don't
  // need a two-phase emit anymore because the API layer enforces the
  // revoked view locally.
  await emitContributorState('revoked');

  try {
    await apiService.post(API_CONFIG.ENDPOINTS.CONTRIBUTOR_REVOKE, {});
  } catch (err) {
    if (__DEV__) {
      console.warn('[contributor] revoke failed (server may still consider device a contributor until grant TTL expires):', err);
    }
  }
}

/**
 * Force every lot-data subscriber to drop their cache and refetch *right now*,
 * regardless of whether contributor eligibility actually flipped.
 *
 * Use this whenever the OS reports ANY change to location permissions
 * (Always→WhenInUse→Always, Full↔Reduced toggling, Settings round-trips,
 * AppState 'active' transitions where we suspect the user may have toggled).
 * The contributor grant/revoke pub-sub is gated on transitions through the
 * eligibility boundary (Always+Full ↔ anything else) which is correct for
 * server-side state, but iOS frequently emits ProviderChange events that
 * don't cross that boundary while still invalidating server-side responses
 * (e.g. server response shape changes when accuracy drops to Reduced even
 * if we were already non-contributor).
 *
 * This bypasses the eligibility-transition gate: it always invalidates the
 * `lots:` cache prefix and emits the current-best-guess state to subscribers
 * so every screen showing lot data refetches immediately.
 *
 * Cheap (one AsyncStorage scan + N synchronous listener calls) — safe to
 * call on every ProviderChange event.
 */
export async function refreshLotsForPermissionChange(state: ContributorState = 'revoked'): Promise<void> {
  if (__DEV__) console.log('[contributor] refreshLotsForPermissionChange(%s) — wiping lots: cache and notifying %d listener(s)', state, listeners.size);
  await emitContributorState(state);
}

/** Test-only reset hook. */
export function __resetContributorGrantStateForTests(): void {
  inFlight = null;
  lastGrantAt = 0;
  listeners.clear();
}
