/**
 * Custom hook for managing lot data and API calls
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { lotsApi, ParkingLotResponse, OccupancyHistoryRecord, ApiError, BackgroundLocationRequiredError } from '../services/api';
import { subscribeContributorState } from '../services/api/contributor';

/** How often to re-fetch lot data (ms). Each data type has its own cadence so
 * a single screen tick doesn't synchronously refresh everything — occupancy +
 * reliability are bundled in the lot payload and refresh together at 60s,
 * while the short-term forecast (15-min bins) refreshes on its own loop
 * aligned with the bin width. Snappy refresh after a contributor grant /
 * revoke is handled separately by `subscribeContributorState`, so the
 * forecast loop doesn't need to be tighter than the bin cadence.
 */
const LOT_DETAIL_POLL_MS = 60_000;        // 60 seconds — occupancy + reliability
const FORECAST_POLL_MS   = 15 * 60_000;   // 15 minutes — matches forecast bin width
const LOTS_LIST_POLL_MS  = 30_000;        // 30 seconds

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
  /** True only on the very first forecast fetch (when `forecast` is still
   * empty and we haven't successfully landed a response yet). Use this to
   * gate a placeholder spinner inside the chart card. Subsequent 15-min
   * polls keep this false so the chart doesn't flash on every refresh. */
  forecastLoading: boolean;
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
  const [forecastLoading, setForecastLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bgLocationRequired, setBgLocationRequired] = useState(false);

  // Use a ref to know whether this is a first fetch (show full-screen spinner)
  // or a background refetch (just toggle the inline `refreshing` flag). Reading
  // a ref avoids the stale-closure problem we'd hit reading `lot` directly.
  const hasLoadedOnceRef = useRef(false);

  // Monotonic generation counters — one per fetcher — so a slow in-flight
  // fetch from a previous call doesn't commit on top of a newer one (e.g. a
  // revoke fires a fresh refetch while the prior fetch is still in flight).
  // Lot and forecast each have their own ref because they fire on independent
  // intervals, so the lot poll bumping a shared counter would needlessly
  // discard an in-flight forecast response and vice versa.
  const lotGenRef = useRef(0);
  const forecastGenRef = useRef(0);

  const refreshLot = useCallback(async () => {
    if (!lotId) return;

    const myGen = ++lotGenRef.current;
    const isLatest = () => lotGenRef.current === myGen;
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

      // Note: lotsApi.getLotDetails redacts + 403s client-side based on the
      // live OS contributor state (see lots.ts). This hook therefore doesn't
      // need its own commit-time redaction or cache bypass — a stale colored
      // cached entry served to a just-revoked user still comes back
      // null-shaped because the redactor runs after the cache read.
      const lotData = await lotsApi.getLotDetails(lotId);
      if (!isLatest()) return;
      setLot(lotData);
      // Mirror into the ref synchronously so the chained refreshForecast()
      // below can read the just-fetched lot — the useEffect that mirrors
      // `lot` into `lotRef` doesn't run until after this render commits.
      lotRef.current = lotData;
      setLastUpdatedAt(Date.now());
      hasLoadedOnceRef.current = true;
      // Chain the initial forecast fetch off the first successful lot
      // response so we never call `getForecast` with a placeholder lot.
      // Subsequent forecast refreshes are driven by the independent
      // forecast poll / AppState / contributor-state listeners and read
      // the latest lot from `lotRef`.
      if (!hasFetchedForecastOnceRef.current) {
        hasFetchedForecastOnceRef.current = true;
        void refreshForecastRef.current?.();
      }

    } catch (err) {
      if (!isLatest()) return;
      if (err instanceof BackgroundLocationRequiredError) {
        setBgLocationRequired(true);
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
      if (__DEV__) console.error('Error fetching lot data:', err);
    } finally {
      if (isLatest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [lotId]);

  // Independent forecast fetcher. Polled separately from `refreshLot` because
  // 15-min forecast bins don't need to be refetched every 60s — but the lot
  // payload (occupancy + reliability) does. Splitting the two also means the
  // forecast chart can keep showing the previous bin set while a slow lot
  // fetch is pending, instead of being held back by the bundled fetch.
  //
  // We mirror the latest lot into a ref so the forecast fetch can pass the
  // required lot_id + metadata_confidence to `lotsApi.getForecast` without
  // burning a second `getLotDetails` round-trip on every poll tick. The
  // *initial* forecast fetch is chained off the first successful lot fetch
  // (see refreshLot) so we never call `getForecast` with a placeholder.
  const lotRef = useRef<ParkingLotResponse | null>(null);
  useEffect(() => { lotRef.current = lot; }, [lot]);

  // Tracks whether refreshLot has chained the first forecast fetch yet, so
  // a re-mount or AppState resume doesn't double-fire the initial chain.
  const hasFetchedForecastOnceRef = useRef(false);

  const refreshForecast = useCallback(async () => {
    if (!lotId) return;
    const myGen = ++forecastGenRef.current;
    const isLatest = () => forecastGenRef.current === myGen;
    const lotData = lotRef.current;
    // No-op if we don't yet have a lot record. The first forecast fetch is
    // chained inside `refreshLot` once that resolves — prevents calling
    // `getForecast` with a fabricated metadata_confidence, which would
    // surface a misleading accuracy % in the chart for one tick.
    if (!lotData) return;
    try {
      const forecastData = await lotsApi.getForecast(lotData);
      if (!isLatest()) return;
      setForecast(forecastData);
      setForecastLoading(false);
    } catch (err) {
      if (!isLatest()) return;
      if (err instanceof BackgroundLocationRequiredError) {
        setForecast([]);
        // Permission-denied is a terminal first-load state — stop the spinner
        // so the LockedForecastCard renders immediately instead of hanging.
        setForecastLoading(false);
        return;
      }
      // Forecast errors are non-fatal — leave the previous bins in place
      // and let the next poll retry. Don't surface to the screen-level
      // error banner; that's reserved for lot-fetch failures.
      if (__DEV__) console.error('Error fetching forecast:', err);
      setForecastLoading(false);
    }
  }, [lotId]);

  // Mirror the latest refreshForecast into a ref so refreshLot (declared
  // above it) can chain the initial forecast fetch without participating
  // in its own dependency list — keeps the two callbacks independently
  // memoizable instead of one re-creating every time the other does.
  const refreshForecastRef = useRef<typeof refreshForecast | null>(null);
  useEffect(() => { refreshForecastRef.current = refreshForecast; }, [refreshForecast]);

  // Reset first-load tracking when the lotId changes so navigating from one
  // lot's detail to another shows the full-screen spinner (we have nothing
  // useful to render for the new lot yet) instead of the previous lot's
  // stale data with just an inline \"Updating...\" indicator.
  useEffect(() => {
    hasLoadedOnceRef.current = false;
    hasFetchedForecastOnceRef.current = false;
    setLot(null);
    setForecast([]);
    setHistory([]);
    setLastUpdatedAt(null);
    setForecastLoading(true);
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
      if (__DEV__) console.error('Error fetching lot history:', err);
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
      // Don't kick refreshForecast here — the first forecast fetch is
      // chained off refreshLot (so it has a real lot record). The poll
      // covers everything after that.

      const lotInterval = setInterval(refreshLot, LOT_DETAIL_POLL_MS);
      const forecastInterval = setInterval(refreshForecast, FORECAST_POLL_MS);

      return () => {
        clearInterval(lotInterval);
        clearInterval(forecastInterval);
      };
    }, [lotId, refreshLot, refreshForecast, refreshHistory]),
  );

  // Re-fetch when the app returns to the foreground. Both the lot and the
  // forecast refresh independently — backgrounded for >5min means both are
  // stale, and since they fire in parallel there's no extra latency.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        refreshLot();
        refreshForecast();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [refreshLot, refreshForecast]);

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
        // Bump both gen counters so any in-flight pre-revoke response is
        // discarded and can't overwrite the redacted state.
        lotGenRef.current++;
        forecastGenRef.current++;
        setForecast([]);
        setBgLocationRequired(true);
      }
      refreshLot();
      refreshForecast();
    });
  }, [refreshLot, refreshForecast]);

  return {
    lot,
    history,
    forecast,
    loading,
    forecastLoading,
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
      if (__DEV__) console.error('Error fetching lots:', err);
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
