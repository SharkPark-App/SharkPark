/**
 * API Base Service
 * Provides common HTTP request functionality with error handling and retry logic.
 *
 * Every request is decorated with the device-credential headers required by
 * the backend access-tier model (see services/api/deviceCredentials.ts):
 *   - `x-device-id` on every request (ContributorGuard)
 *   - `X-SharkPark-Signature` + `X-SharkPark-Timestamp` on every POST/PUT
 *     with a body (HmacGuard, currently only enforced on POST /occupancy-events)
 */
import API_CONFIG from './config';
import { buildAuthHeaders } from './deviceCredentials';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  count?: number;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Thrown when the backend returns 403 { code: 'BG_LOCATION_REQUIRED' }.
 * The mobile app catches this to route to the soft-ask location permission
 * screen instead of showing a generic error toast.
 */
export class BgLocationRequiredError extends Error {
  public readonly code = 'BG_LOCATION_REQUIRED';
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'BgLocationRequiredError';
  }
}

const RETRY_CONFIG = {
  maxRetries: 2,
  baseDelay: 1000,
  maxDelay: 10000,
};

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  return true;
}

function getRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelay * Math.pow(2, attempt);
  const jitter = delay * 0.2 * Math.random();
  return Math.min(delay + jitter, RETRY_CONFIG.maxDelay);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ApiService {
  private baseURL: string;
  private timeout: number;
  private defaultHeaders: Record<string, string>;

  constructor() {
    this.baseURL = API_CONFIG.BASE_URL;
    this.timeout = API_CONFIG.TIMEOUT;
    this.defaultHeaders = API_CONFIG.DEFAULT_HEADERS;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    retryable = false
  ): Promise<ApiResponse<T>> {
    if (!retryable) {
      return this.attemptRequest<T>(endpoint, options);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await this.attemptRequest<T>(endpoint, options);
      } catch (error) {
        lastError = error;

        if (attempt < RETRY_CONFIG.maxRetries && isRetryable(error)) {
          const delay = getRetryDelay(attempt);
          console.warn(`API retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} for ${endpoint} in ${delay}ms`);
          await sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  private async attemptRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;

    const { signal, timerId } = this.createTimeoutSignal();

    // Body may already be a string (post/put serialise before calling makeRequest).
    const bodyForSigning = typeof options.body === 'string' ? options.body : undefined;
    const authHeaders = await buildAuthHeaders({ body: bodyForSigning });

    const requestOptions: RequestInit = {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...authHeaders,
        ...options.headers,
      },
      signal,
    };

    try {

      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        // Parse body once so we can inspect for structured error codes.
        const rawBody = await response.text().catch(() => '');

        // 403 BG_LOCATION_REQUIRED — backend ContributorGuard gate.
        // Throw a typed error so callers can route to the soft-ask screen
        // instead of showing a generic toast.
        if (response.status === 403) {
          try {
            const parsed = JSON.parse(rawBody) as { code?: string; message?: string };
            if (parsed.code === 'BG_LOCATION_REQUIRED') {
              throw new BgLocationRequiredError(
                parsed.message ?? 'Background location is required to access live data.'
              );
            }
          } catch (e) {
            if (e instanceof BgLocationRequiredError) throw e;
            // Body wasn't JSON — fall through to generic ApiError below.
          }
        }

        throw new ApiError(
          response.status,
          `HTTP ${response.status}: ${response.statusText}`,
          rawBody || null
        );
      }

      const data: ApiResponse<T> = await response.json();

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      // Handle network errors, timeouts, etc.
      console.error(`API Error: ${endpoint}`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new ApiError(0, `Network error: ${errorMessage}`);
    } finally {
      clearTimeout(timerId);
    }
  }

  private createTimeoutSignal(): { signal: AbortSignal; timerId: ReturnType<typeof setTimeout> } {
    const controller = new AbortController();
    const timerId = setTimeout(() => {
      controller.abort();
    }, this.timeout);
    return { signal: controller.signal, timerId };
  }

  async get<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, { ...options, method: 'GET' }, true);
  }

  async post<T>(endpoint: string, body: unknown, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async put<T>(endpoint: string, body: unknown, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async delete<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiService = new ApiService();
export default apiService;
