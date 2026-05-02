/**
 * Custom hook for managing lot data and API calls
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { lotsApi, ParkingLotResponse, OccupancyHistoryRecord, ApiError, BackgroundLocationRequiredError } from '../services/api';
import { subscribeContributorState } from '../services/api/contributor';

/** How often to re-fetch lot data (ms) */
const LOT_DETAIL_POLL_MS = 60_000;  // 60 seconds
const LOTS_LIST_POLL_MS  = 30_000;  // 30 seconds

interface UseLotDataReturn {
  lot: ParkingLotResponse | null;
  history: OccupancyHistoryRecord[];
  forecast: Array<{
    time: string;
    occupancy: number;
    lowerBound: number;
    upperBound: number;
    accuracy: number;
  }>;
  /** True only on the very first fetch (when `lot` is still null). Use this
   * to gate the full-screen spinner. Subsequent background refetches keep
   * `loading` false so the screen does NOT unmount its rendered content —
   * see `refreshing` for an indicator that's safe to show inline. */
  loading: boolean;
  /** True while a background refetch is in flight (poll tick, focus return,
   * AppState 'active', contributor state change). Use this for a small inline
   * indicator ("Updating...") instead of the full-screen spinner. */
  refreshing: boolean;
  /** Wall-clock timestamp (ms) of the last successful lot/forecast commit, or
   * null if we've never landed a fresh response. Drive an "Updated Xm ago"
   * label off this. */
  lastUpdatedAt: number | null;
  error: string | null;
  /** True when the backend rejected with BG_LOCATION_REQUIRED (403). */
  bgLocationRequired: boolean;
  /** Reset the bgLocationRequired flag (call after routing to the soft-ask screen). */
  clearBgLocationRequired: () => void;
  refreshLot: () => Promise<void>;
  refreshHistory: (date?: string) => Promise<void>;
}

export function useLotData(lotId: string): UseLotDataReturn {
  const [lot, setLot] = useState<ParkingLotResponse | null>(null);
  const [history, setHistory] = useState<OccupancyHistoryRecord[]>([]);
  const [forecast, setForecast] = useState<Array<{
    time: string;
    occupancy: number;
    lowerBound: number;
    upperBound: number;
    accuracy: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bgLocationRequired, setBgLocationRequired] = useState(false);

  // Use a ref to know whether this is a first fetch (show full-screen spinner)
  // or a background refetch (just toggle the inline `refreshing` flag). Reading
  // a ref avoids the stale-closure problem we'd hit reading `lot` directly.
  const hasLoadedOnceRef = useRef(false);

  // Monotonic generation counter so a slow in-flight fetch from a previous
  // call doesn't commit on top of a newer one (e.g. a revoke fires a fresh
  // refetch while the prior fetch is still in flight). Refs (not state)
  // so a bump doesn't re-render and a closure capture is always current.
  const refreshGenRef = useRef(0);

  const refreshLot = useCallback(async () => {
    if (!lotId) return;

    const myGen = ++refreshGenRef.current;
    const isLatest = () => refreshGenRef.current === myGen;
    const isFirstLoad = !hasLoadedOnceRef.current;

    try {
      // Only flip the full-screen `loading` flag on the very first fetch.
      // Background refetches (poll tick, focus return, contributor change)
      // use `refreshing` so the rendered content stays mounted — otherwise
      // every poll causes a screen-wide spinner flash, and a contributor
      // state change feels like a 30s lag because the screen unmounts then
      // re-renders with whatever the redactor returned.
      if (isFirstLoad) setLoading(true);
      else setRefreshing(true);
      setError(null);
      setBgLocationRequired(false);

      // Note: lotsApi.getLotDetails / getForecast redact + 403 client-side
      // based on the live OS contributor state (see lots.ts).  This hook
      // therefore doesn't need its own commit-time redaction or cache
      // bypass — a stale colored cached entry served to a just-revoked
      // user still comes back null-shaped because the redactor runs after
      // the cache read.
      const lotData = await lotsApi.getLotDetails(lotId);
      if (!isLatest()) return;
      setLot(lotData);

      const forecastData = await lotsApi.getForecast(lotData);
      if (!isLatest()) return;
      setForecast(forecastData);
      setLastUpdatedAt(Date.now());
      hasLoadedOnceRef.current = true;

    } catch (err) {
      if (!isLatest()) return;
      if (err instanceof BackgroundLocationRequiredError) {
        setBgLocationRequired(true);
        setForecast([]);
        // Locked is a valid "loaded" state — bump the timestamp so the
        // "Updated Xm ago" label reflects the redacted commit too, and
        // mark first-load complete so we never flash the spinner again
        // for this lotId.
        setLastUpdatedAt(Date.now());
        hasLoadedOnceRef.current = true;
        return;
      }
      const errorMessage = err instanceof ApiError
        ? `${err.message} (${err.status})`
        : 'Failed to fetch lot data';
      setError(errorMessage);
      console.error('Error fetching lot data:', err);
    } finally {
      if (isLatest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [lotId]);

  // Reset first-load tracking when the lotId changes so navigating from one
  // lot's detail to another shows the full-screen spinner (we have nothing
  // useful to render for the new lot yet) instead of the previous lot's
  // stale data with just an inline \"Updating...\" indicator.
  useEffect(() => {
    hasLoadedOnceRef.current = false;
    setLot(null);
    setForecast([]);
    setHistory([]);
    setLastUpdatedAt(null);
  }, [lotId]);

  const refreshHistory = useCallback(async (date?: string) => {
    if (!lotId) return;
    
    try {
      const historyData = await lotsApi.getLotHistory(lotId, {
        date,
        limit: 96, // 15-minute intervals for 24 hours
      });
      setHistory(historyData);
    } catch (err) {
      console.error('Error fetching lot history:', err);
      // Don't set error state for history as it's secondary data
    }
  }, [lotId]);

  // Fetch on focus + poll while focused. Using `useFocusEffect` (instead
  // of a plain `useEffect` on mount) ensures we re-pull whenever the
  // user returns to this screen — e.g. after coming back from the
  // LocationPermission soft-ask — without waiting up to a full poll
  // interval. Polling is also paused while the screen is blurred,
  // which is what we want for battery + bandwidth.
  useFocusEffect(
    useCallback(() => {
      if (!lotId) return;

      refreshLot();
      refreshHistory();

      const interval = setInterval(() => {
        refreshLot();
      }, LOT_DETAIL_POLL_MS);

      return () => clearInterval(interval);
    }, [lotId, refreshLot, refreshHistory]),
  );

  // Re-fetch when the app returns to the foreground
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        refreshLot();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshLot]);

  // Re-fetch the moment our contributor status changes (grant or revoke)
  // so the screen pulls fresh data without waiting for the next poll.
  //
  // We deliberately do NOT clobber in-memory occupancy fields on revoke.
  // The lock UI is keyed on live OS contributor state via
  // useContributorState (see ShortTermForecastScreen / MapScreen), which
  // hides colored data the instant permission flips off — so a stale
  // colored payload sitting in `lot` is never displayed. Bumping the gen
  // counter still discards any in-flight pre-revoke response so it can't
  // overwrite the next revoked response.
  //
  // The benefit on revoke→grant: the previous colored value is visible
  // immediately on grant (no null gap, no "loading" placeholder), and
  // the refetch updates it a moment later if anything changed.
  useEffect(() => {
    return subscribeContributorState((state) => {
      if (state === 'revoked') {
        refreshGenRef.current++;
        setForecast([]);
        setBgLocationRequired(true);
      }
      refreshLot();
    });
  }, [refreshLot]);

  return {
    lot,
    history,
    forecast,
    loading,
    refreshing,
    lastUpdatedAt,
    error,
    bgLocationRequired,
    clearBgLocationRequired: () => setBgLocationRequired(false),
    refreshLot,
    refreshHistory,
  };
}

interface UseLotsListReturn {
  lots: ParkingLotResponse[];
  loading: boolean;
  error: string | null;
  /** True when the backend rejected with BG_LOCATION_REQUIRED (403). */
  bgLocationRequired: boolean;
  /** Reset the bgLocationRequired flag (call after routing to the soft-ask screen). */
  clearBgLocationRequired: () => void;
  refreshLots: () => Promise<void>;
}

export function useLotsList(filters?: {
  type?: 'STUDENT' | 'EMPLOYEE';
  available_only?: boolean;
  min_available?: number;
}): UseLotsListReturn {
  const [lots, setLots] = useState<ParkingLotResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bgLocationRequired, setBgLocationRequired] = useState(false);

  // Stabilise the filters reference so that callers passing an inline object
  // literal don't cause the polling effect to reset on every render.
  const filtersRef = useRef(filters);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => { filtersRef.current = filters; }, [filtersKey]);

  // Monotonic generation counter so a slow in-flight fetch from a previous
  // refresh doesn't overwrite a newer one. Critical on permission toggles:
  // AppState 'active' + onProviderChange + the grant 2-phase emit can fire
  // multiple refreshes back-to-back, and the network can reorder them. Without
  // this guard, a stale colored response can land on top of a fresh redacted
  // one (or vice versa) and the UI stays wrong until the next poll tick.
  const refreshGenRef = useRef(0);

  const refreshLots = useCallback(async () => {
    const myGen = ++refreshGenRef.current;
    const isLatest = () => refreshGenRef.current === myGen;

    try {
      setLoading(true);
      setError(null);
      setBgLocationRequired(false);

      const lotsData = await lotsApi.getAllLots(filtersRef.current);
      if (!isLatest()) return;
      setLots(lotsData);

    } catch (err) {
      if (!isLatest()) return;
      if (err instanceof BackgroundLocationRequiredError) {
        setBgLocationRequired(true);
        return;
      }
      const errorMessage = err instanceof ApiError 
        ? `${err.message} (${err.status})`
        : 'Failed to fetch lots data';
      setError(errorMessage);
      console.error('Error fetching lots:', err);
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [filtersKey]);

  // Fetch on focus + poll while focused. See note in `useLotData` above:
  // this ensures the map / forecast screens immediately re-pull when the
  // user returns from the LocationPermission soft-ask (or any other
  // pushed screen) instead of showing stale neutral pins / locked badges
  // until the next poll tick.
  useFocusEffect(
    useCallback(() => {
      refreshLots();

      const interval = setInterval(() => {
        refreshLots();
      }, LOTS_LIST_POLL_MS);

      return () => clearInterval(interval);
    }, [refreshLots]),
  );

  // Re-fetch when the app returns to the foreground
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        refreshLots();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshLots]);

  // Re-fetch on contributor grant/revoke. We do NOT clobber in-memory
  // occupancy fields on revoke — the map's `isRedacted` decision is keyed
  // on live OS contributor state (MapScreen InteractiveLot uses
  // useContributorState), so pins flip to neutral the instant permission
  // flips off regardless of what's in `lots`. Keeping the colored payload
  // in memory means revoke→grant restores the previous color instantly
  // without a null/grey flash while the fresh fetch is in flight.
  // Bumping the gen counter still ensures a late-landing pre-revoke
  // response can't overwrite the next revoked-state fetch.
  useEffect(() => {
    return subscribeContributorState(() => {
      refreshGenRef.current++;
      refreshLots();
    });
  }, [refreshLots]);

  return {
    lots,
    loading,
    error,
    bgLocationRequired,
    clearBgLocationRequired: () => setBgLocationRequired(false),
    refreshLots,
  };
}
