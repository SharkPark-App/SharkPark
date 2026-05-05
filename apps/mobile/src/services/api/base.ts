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
 * Thrown when the backend rejects a request because the device is not a
 * fresh contributor (no valid x-device-id / no recent ContributorPing).
 *
 * Backend shape: HTTP 403 with body `{ code: 'BG_LOCATION_REQUIRED', ... }`.
 * The mobile UI is expected to catch this and prompt the user to enable
 * "Always Allow" background location to participate in the reciprocity
 * model. See docs/api-access-tiers.md.
 */
export class BackgroundLocationRequiredError extends ApiError {
  static readonly CODE = 'BG_LOCATION_REQUIRED';
  constructor(message: string, details?: unknown) {
    super(403, message, details);
    this.name = 'BackgroundLocationRequiredError';
  }
}

/**
 * Inspects a 403 response body for the BG_LOCATION_REQUIRED contract.
 * Returns the parsed JSON body if it matches, otherwise null.
 */
function parseBgLocationRequired(rawBody: string | null): Record<string, unknown> | null {
  if (!rawBody) return null;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { code?: unknown }).code === BackgroundLocationRequiredError.CODE
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — fall through.
  }
  return null;
}
const RETRY_CONFIG = {
  maxRetries: 2,
  baseDelay: 1000,
  maxDelay: 10000,
};

function isRetryable(error: unknown): boolean {
  if (error instanceof BackgroundLocationRequiredError) {
    // No point retrying — the device just isn't a contributor right now.
    return false;
  }
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
        const rawBody = await response.text().catch(() => null);

        if (response.status === 403) {
          const bgPayload = parseBgLocationRequired(rawBody);
          if (bgPayload) {
            throw new BackgroundLocationRequiredError(
              typeof bgPayload.message === 'string'
                ? bgPayload.message
                : 'Background location required to use this feature',
              bgPayload
            );
          }
        }

        throw new ApiError(
          response.status,
          `HTTP ${response.status}: ${response.statusText}`,
          rawBody
        );
      }

      // Handle 204 No Content (and any other empty-body 2xx) without
      // attempting to JSON.parse('') — which throws SyntaxError and
      // bubbles up as a fake "Network error". Endpoints like
      // /contributor/grant and /contributor/revoke are 204 by contract;
      // before this, every grant/revoke silently appeared to fail
      // client-side even though the server-side write succeeded, which
      // broke the contributor pub-sub (no 'granted' / 'revoked' emit →
      // lot hooks waited up to a full poll interval to see the change).
      if (response.status === 204 || response.headers?.get?.('content-length') === '0') {
        // Cast through unknown — callers of 204 endpoints (grant/revoke)
        // ignore the body and we don't want to force them to widen their
        // generic. The runtime shape is "no body".
        return undefined as unknown as ApiResponse<T>;
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

  async patch<T>(endpoint: string, body: unknown, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  async delete<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    return this.makeRequest<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiService = new ApiService();
export default apiService;
