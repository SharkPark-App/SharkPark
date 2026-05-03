/**
 * Tests for src/services/api/contributor.ts
 *
 * Covers:
 *   - getContributorStateSync  — synchronous state snapshot
 *   - subscribeContributorState — pub/sub contract (add / remove listener)
 *   - registerContributorGrant  — dedup, in-flight sharing, POST, optimistic + definitive emit
 *   - revokeContributorGrant   — resets dedup state, emits revoked, POST
 *   - refreshLotsForPermissionChange — always emits, accepts custom state
 *   - __resetContributorGrantStateForTests — test helper works
 */

import { apiService } from '../src/services/api/base';
import { cacheService } from '../src/services/api/cache';
import { renderHook, act } from '@testing-library/react-native';

jest.mock('../src/services/api/base');
jest.mock('../src/services/api/cache');

const mockApiService = apiService as jest.Mocked<typeof apiService>;
const mockCacheService = cacheService as jest.Mocked<typeof cacheService>;

import {
  getContributorStateSync,
  subscribeContributorState,
  registerContributorGrant,
  revokeContributorGrant,
  refreshLotsForPermissionChange,
  __resetContributorGrantStateForTests,
  useContributorState,
} from '../src/services/api/contributor';

describe('contributor service', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    __resetContributorGrantStateForTests();
    // cacheService.invalidatePrefix is called by emitContributorState; resolve immediately
    mockCacheService.invalidatePrefix.mockResolvedValue(undefined);
    // __reset clears inFlight/lastGrantAt/listeners but not currentState.
    // Drive it back to 'granted' (the canonical initial value) so tests
    // that revokeContributorGrant in a prior case don't bleed state.
    await refreshLotsForPermissionChange('granted');
    // clear call counts AFTER the reset emit so mock counts start at 0
    jest.clearAllMocks();
    mockCacheService.invalidatePrefix.mockResolvedValue(undefined);
  });

  // ── getContributorStateSync ────────────────────────────────────────────────

  describe('getContributorStateSync', () => {
    it('returns the initial state "granted"', () => {
      expect(getContributorStateSync()).toBe('granted');
    });

    it('reflects state after revokeContributorGrant', async () => {
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await revokeContributorGrant();
      expect(getContributorStateSync()).toBe('revoked');
    });
  });

  // ── subscribeContributorState ──────────────────────────────────────────────

  describe('subscribeContributorState', () => {
    it('calls the listener when state is emitted via revokeContributorGrant', async () => {
      const listener = jest.fn();
      subscribeContributorState(listener);
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });

      await revokeContributorGrant();

      expect(listener).toHaveBeenCalledWith('revoked');
    });

    it('stops calling the listener after unsubscribe', async () => {
      const listener = jest.fn();
      const unsubscribe = subscribeContributorState(listener);
      unsubscribe();

      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await revokeContributorGrant();

      expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners all receive the event', async () => {
      const a = jest.fn();
      const b = jest.fn();
      subscribeContributorState(a);
      subscribeContributorState(b);

      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await revokeContributorGrant();

      expect(a).toHaveBeenCalledWith('revoked');
      expect(b).toHaveBeenCalledWith('revoked');
    });
  });

  // ── registerContributorGrant ───────────────────────────────────────────────

  describe('registerContributorGrant', () => {
    it('POSTs to the contributor grant endpoint', async () => {
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await registerContributorGrant();
      expect(mockApiService.post).toHaveBeenCalledTimes(1);
    });

    it('emits "granted" to listeners', async () => {
      const listener = jest.fn();
      subscribeContributorState(listener);
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });

      await registerContributorGrant();

      expect(listener).toHaveBeenCalledWith('granted');
    });

    it('dedupes back-to-back calls within MIN_REFRESH_MS', async () => {
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await registerContributorGrant();
      await registerContributorGrant(); // should no-op

      expect(mockApiService.post).toHaveBeenCalledTimes(1);
    });

    it('force=true bypasses the dedup window', async () => {
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await registerContributorGrant();
      await registerContributorGrant({ force: true }); // should bypass dedup

      expect(mockApiService.post).toHaveBeenCalledTimes(2);
    });

    it('is best-effort: does not throw on POST failure', async () => {
      mockApiService.post.mockRejectedValue(new Error('server down'));
      await expect(registerContributorGrant()).resolves.toBeUndefined();
    });

    it('state is still "granted" after a failed POST (optimistic emit succeeded)', async () => {
      mockApiService.post.mockRejectedValue(new Error('server down'));
      await registerContributorGrant();
      expect(getContributorStateSync()).toBe('granted');
    });
  });

  // ── revokeContributorGrant ────────────────────────────────────────────────

  describe('revokeContributorGrant', () => {
    it('emits "revoked" before the POST', async () => {
      const events: string[] = [];
      subscribeContributorState(s => events.push(s));
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });

      await revokeContributorGrant();

      expect(events[0]).toBe('revoked');
    });

    it('sets state to "revoked"', async () => {
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await revokeContributorGrant();
      expect(getContributorStateSync()).toBe('revoked');
    });

    it('is best-effort: does not throw on POST failure', async () => {
      mockApiService.post.mockRejectedValue(new Error('network error'));
      await expect(revokeContributorGrant()).resolves.toBeUndefined();
    });

    it('resets dedup so a subsequent grant goes through', async () => {
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      // First grant sets lastGrantAt
      await registerContributorGrant();
      // Revoke resets lastGrantAt to 0
      await revokeContributorGrant();
      // Second grant should POST (not deduped)
      await registerContributorGrant();

      // 3 POSTs total: grant + revoke + grant
      expect(mockApiService.post).toHaveBeenCalledTimes(3);
    });
  });

  // ── refreshLotsForPermissionChange ────────────────────────────────────────

  describe('refreshLotsForPermissionChange', () => {
    it('defaults to "revoked" and emits it', async () => {
      const listener = jest.fn();
      subscribeContributorState(listener);

      await refreshLotsForPermissionChange();

      expect(listener).toHaveBeenCalledWith('revoked');
      expect(getContributorStateSync()).toBe('revoked');
    });

    it('accepts an explicit state', async () => {
      const listener = jest.fn();
      subscribeContributorState(listener);

      await refreshLotsForPermissionChange('granted');

      expect(listener).toHaveBeenCalledWith('granted');
    });

    it('always invalidates the lots: cache prefix', async () => {
      await refreshLotsForPermissionChange();
      expect(mockCacheService.invalidatePrefix).toHaveBeenCalledWith('lots:');
    });
  });

  // ── useContributorState (hook) ────────────────────────────────────────────

  describe('useContributorState', () => {
    it('returns the current state synchronously on first render', () => {
      const { result } = renderHook(() => useContributorState());
      expect(result.current).toBe('granted');
    });

    it('re-renders with new state when contributor state changes', async () => {
      mockApiService.post.mockResolvedValue({ success: true, data: undefined });

      const { result } = renderHook(() => useContributorState());
      expect(result.current).toBe('granted');

      await act(async () => {
        await revokeContributorGrant();
      });

      expect(result.current).toBe('revoked');
    });
  });

  // ── emitContributorState: listener-throw safety ───────────────────────────

  describe('emitContributorState error handling', () => {
    it('continues notifying remaining listeners even if one throws', async () => {
      const throwingListener = jest.fn(() => { throw new Error('listener error'); });
      const goodListener = jest.fn();
      subscribeContributorState(throwingListener);
      subscribeContributorState(goodListener);

      mockApiService.post.mockResolvedValue({ success: true, data: undefined });
      await revokeContributorGrant();

      expect(throwingListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalledWith('revoked');
    });
  });

  // ── registerContributorGrant: in-flight dedup ─────────────────────────────

  describe('registerContributorGrant in-flight sharing', () => {
    it('concurrent callers join the same in-flight promise (POST called once)', async () => {
      let resolvePost!: () => void;
      mockApiService.post.mockReturnValueOnce(
        new Promise<{ success: boolean; data: undefined }>(res => { resolvePost = () => res({ success: true, data: undefined }); })
      );

      const p1 = registerContributorGrant();
      const p2 = registerContributorGrant({ force: true }); // joins in-flight
      resolvePost();
      await Promise.all([p1, p2]);

      expect(mockApiService.post).toHaveBeenCalledTimes(1);
    });
  });
});
