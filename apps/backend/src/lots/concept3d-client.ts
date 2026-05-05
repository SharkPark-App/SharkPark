/**
 * Thin client for the public concept3d /locations endpoint.
 *
 * The CSULB campus map (https://map.csulb.edu → map.concept3d.com/?id=1314)
 * embeds its API key in the public JS bundle, so it is treated as a public
 * identifier here. Both the key and map id are env-overridable for other
 * campuses or for testing.
 */
import type { C3DLocation } from './lot-advisory-extractor';

const DEFAULT_API_KEY = '0001085cc708b9cef47080f064612ca5';
const DEFAULT_MAP_ID = 1314;
const ENDPOINT = 'https://api.concept3d.com/locations';

export interface FetchOptions {
  mapId?: number;
  apiKey?: string;
  signal?: AbortSignal;
}

export async function fetchConcept3dLocations(
  opts: FetchOptions = {},
): Promise<C3DLocation[]> {
  const apiKey = opts.apiKey ?? process.env.CONCEPT3D_API_KEY ?? DEFAULT_API_KEY;
  const mapId =
    opts.mapId ??
    (process.env.CONCEPT3D_MAP_ID ? Number(process.env.CONCEPT3D_MAP_ID) : DEFAULT_MAP_ID);

  const url = `${ENDPOINT}?map=${mapId}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(
      `concept3d /locations returned HTTP ${res.status} for map=${mapId}`,
    );
  }
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error(
      `concept3d /locations returned non-array body (typeof=${typeof body})`,
    );
  }
  return body as C3DLocation[];
}
