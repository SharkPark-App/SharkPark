/**
 * Offline Cache Service
 * Provides stale-while-revalidate caching for API responses using AsyncStorage.
 * Enables offline-first access to previously fetched lot data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NetInfo } from './network';

const CACHE_PREFIX = '@sharkpark_cache:';
const CACHE_INDEX_KEY = '@sharkpark_cache_index';

/** Default cache TTL: 5 minutes for fresh data */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Maximum stale age: 24 hours — beyond this, cache is discarded */
const MAX_STALE_AGE_MS = 24 * 60 * 60 * 1000;

/** Maximum number of cached entries to prevent storage bloat */
const MAX_CACHE_ENTRIES = 100;

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  ttl: number;
}

interface CacheOptions {
  /** Time-to-live in milliseconds before data is considered stale */
  ttl?: number;
  /** If true, never serve stale data — return null instead */
  strictFreshness?: boolean;
  /**
   * If true, skip the cache READ entirely and always hit the fetcher.
   * The result is still WRITTEN to cache so subsequent offline reads
   * have something to fall back on.
   *
   * Used by hooks that absolutely must see current server truth on
   * every call (e.g. the lot detail screen, where the response shape
   * depends on contributor status — a 30-second-stale cache hit can
   * mean showing colored occupancy + forecast to a user who just
   * revoked location permission).
   */
  forceRefresh?: boolean;
}

class CacheService {
  /**
   * Get a value from cache.
   * Returns the cached data if fresh, stale data if offline/allowed, or null if missing/expired.
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<{ data: T; isStale: boolean } | null> {
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;

      const entry: CacheEntry<T> = JSON.parse(raw);
      const age = Date.now() - entry.cachedAt;

      // Discard if beyond maximum stale age
      if (age > MAX_STALE_AGE_MS) {
        await this.remove(key);
        return null;
      }

      const isFresh = age < (options.ttl ?? entry.ttl);

      if (!isFresh && options.strictFreshness) {
        return null;
      }

      return { data: entry.data, isStale: !isFresh };
    } catch (error) {
      console.warn(`[Cache] Failed to read key "${key}":`, error);
      return null;
    }
  }

  /**
   * Store a value in cache with TTL.
   */
  async set<T>(key: string, data: T, options: CacheOptions = {}): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        cachedAt: Date.now(),
        ttl: options.ttl ?? DEFAULT_TTL_MS,
      };

      await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
      await this.updateIndex(key);
    } catch (error) {
      console.warn(`[Cache] Failed to write key "${key}":`, error);
    }
  }

  /**
   * Remove a specific cache entry.
   */
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(CACHE_PREFIX + key);
    } catch {
      // Silently ignore removal errors
    }
  }

  /**
   * Remove every cached entry whose key starts with the given prefix.
   *
   * Used by the contributor pub-sub: when the device transitions
   * granted ↔ revoked, every contributor-gated response under `lots:` is
   * stale by definition (the server's redaction layer will return a
   * different shape on the next request). Without this invalidation, the
   * subscribers' refetch hits the in-memory cache and silently returns the
   * pre-flip response — so the map pins / forecast UI keep showing the
   * old state until the TTL expires (60s for `lots:all`, 30s for
   * `lots:detail:*`, 5min for `lots:forecast:*`).
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const fullPrefix = CACHE_PREFIX + prefix;
      const matching = keys.filter((k) => k.startsWith(fullPrefix));
      if (matching.length > 0) {
        await AsyncStorage.multiRemove(matching);
      }
      // Also prune the index so eviction bookkeeping stays accurate.
      const rawIndex = await AsyncStorage.getItem(CACHE_INDEX_KEY);
      if (rawIndex) {
        const index: string[] = JSON.parse(rawIndex);
        const filtered = index.filter((k) => !k.startsWith(prefix));
        if (filtered.length !== index.length) {
          await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(filtered));
        }
      }
    } catch (error) {
      console.warn(`[Cache] Failed to invalidate prefix "${prefix}":`, error);
    }
  }

  /**
   * Clear all cached data.
   */
  async clear(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(k => k.startsWith(CACHE_PREFIX));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
      await AsyncStorage.removeItem(CACHE_INDEX_KEY);
    } catch (error) {
      console.warn('[Cache] Failed to clear cache:', error);
    }
  }

  /**
   * Stale-while-revalidate pattern.
   * 1. Return cached data immediately if available (even if stale)
   * 2. Fetch fresh data in the background if stale or missing
   * 3. If offline, return cached data or null
   *
   * @param key - Cache key
   * @param fetcher - Async function to fetch fresh data
   * @param options - Cache options
   * @returns Object with data, source ('cache' | 'network'), and isStale flag
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {},
  ): Promise<{ data: T; source: 'cache' | 'network'; isStale: boolean }> {
    // forceRefresh: skip the cache READ but still WRITE the result so the
    // entry stays warm for offline fallback. Used by callers (e.g. lot
    // detail hook) that must reflect server truth on every fetch.
    const cached = options.forceRefresh ? null : await this.get<T>(key, options);
    const isOnline = await NetInfo.isConnected();

    // If cached and fresh, return immediately (forceRefresh skips this branch
    // because `cached` is null above).
    if (cached && !cached.isStale) {
      return { data: cached.data, source: 'cache', isStale: false };
    }

    // If online, try fetching fresh data
    if (isOnline) {
      try {
        const freshData = await fetcher();
        await this.set(key, freshData, options);
        return { data: freshData, source: 'network', isStale: false };
      } catch (error) {
        // Network error — fall back to stale cache if available. Even on
        // forceRefresh we honor a still-readable stale entry here so an
        // offline focus-refetch doesn't blow up the screen; the caller
        // can detect this via `isStale`.
        const fallback = options.forceRefresh ? await this.get<T>(key, {}) : cached;
        if (fallback) {
          console.warn(`[Cache] Network fetch failed for "${key}", serving stale data`);
          return { data: fallback.data, source: 'cache', isStale: true };
        }
        throw error;
      }
    }

    // Offline: return stale cache if available (re-read on forceRefresh
    // since `cached` was deliberately skipped above).
    const offlineFallback = options.forceRefresh ? await this.get<T>(key, {}) : cached;
    if (offlineFallback) {
      return { data: offlineFallback.data, source: 'cache', isStale: true };
    }

    // No cache, no network
    throw new Error(`No cached data available for "${key}" and device is offline`);
  }

  /**
   * Maintain an index of cache keys and evict oldest when over limit.
   */
  private async updateIndex(key: string): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(CACHE_INDEX_KEY);
      const index: string[] = raw ? JSON.parse(raw) : [];

      // Remove existing entry and add to end (most recent)
      const filtered = index.filter(k => k !== key);
      filtered.push(key);

      // Evict oldest entries if over limit
      while (filtered.length > MAX_CACHE_ENTRIES) {
        const evicted = filtered.shift();
        if (evicted) {
          await AsyncStorage.removeItem(CACHE_PREFIX + evicted);
        }
      }

      await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(filtered));
    } catch {
      // Non-critical — eviction failure shouldn't block caching
    }
  }
}

export const cacheService = new CacheService();
export default cacheService;
