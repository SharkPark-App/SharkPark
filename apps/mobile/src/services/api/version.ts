/**
 * Version API Service
 *
 * Calls GET /min-version to retrieve the minimum supported app version.
 * Used on launch to gate users into a force-update screen when they are
 * running a version that is below the server-enforced minimum.
 */
import { apiService } from './base';

export interface MinVersionResponse {
  /** Semver string, e.g. "1.2.0" */
  minSupportedVersion: string;
}

/**
 * Fetches the minimum supported app version from the backend.
 * Throws on network error or non-2xx status (handled by apiService).
 */
export async function fetchMinVersion(): Promise<MinVersionResponse> {
  const response = await apiService.get<MinVersionResponse>('/min-version');
  return response.data;
}
