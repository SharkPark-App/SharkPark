/**
 * Robust JSON GET helper for outbound scraper requests.
 *
 * Adds three production-grade behaviours absent from raw `fetch()`:
 *  1. Mandatory descriptive `User-Agent` (so third-party APIs can identify
 *     us; some throttle or block default Node UAs).
 *  2. `AbortSignal.timeout(...)` per attempt — Node's fetch will otherwise
 *     hang indefinitely on slow/dead endpoints until the cron's wall-clock
 *     deadline.
 *  3. Exponential backoff retry on transient failures (5xx, 429, 408, 425,
 *     network errors, timeouts). Other 4xx responses fail immediately.
 *
 * Designed for cron-driven scrapers where blocking briefly is acceptable
 * but silent hangs are not.
 */

export interface FetchJsonOptions {
  /** Required descriptive UA, e.g. `SharkPark/1.0 (ops@sharkpark.app)`. */
  userAgent: string;
  /** Per-attempt timeout in milliseconds. Default: 20s. */
  timeoutMs?: number;
  /** Total attempts including the first. Default: 3. */
  maxAttempts?: number;
  /** Initial backoff in milliseconds; doubles each retry. Default: 500. */
  initialBackoffMs?: number;
  /** Optional `Accept` override; defaults to `application/json`. */
  accept?: string;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Marker error used internally to signal "do not retry, propagate as-is".
 */
class NonRetryableHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableHttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJsonWithRetry<T>(
  url: string,
  opts: FetchJsonOptions,
): Promise<T> {
  const {
    userAgent,
    timeoutMs = 20_000,
    maxAttempts = 3,
    initialBackoffMs = 500,
    accept = 'application/json',
  } = opts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          Accept: accept,
        },
        signal: controller.signal,
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (RETRYABLE_STATUS.has(response.status)) {
        // Retryable; loop again after backoff.
        lastError = new Error(
          `HTTP ${response.status} ${response.statusText} (attempt ${attempt}/${maxAttempts}) for ${url}`,
        );
      } else {
        throw new NonRetryableHttpError(
          `HTTP ${response.status} ${response.statusText} for ${url}`,
        );
      }
    } catch (err) {
      if (err instanceof NonRetryableHttpError) throw err;
      // Network error or AbortController timeout — both retryable.
      lastError = err;
    } finally {
      clearTimeout(timer);
    }

    if (attempt >= maxAttempts) break;
    // Exponential backoff: 500ms → 1s → 2s → ...
    await sleep(initialBackoffMs * 2 ** (attempt - 1));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`fetchJsonWithRetry: exhausted ${maxAttempts} attempts for ${url}`);
}
