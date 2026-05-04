/**
 * Device Credentials
 *
 * Owns the opaque per-install device identifier and the HMAC signing key used
 * by the SharkPark API access-tier model. See docs/api-access-tiers.md.
 *
 * Why these live together:
 *   - `x-device-id` proves "this device is currently contributing" so
 *     ContributorGuard can grant access to live-occupancy and forecast reads.
 *   - HMAC headers (`X-SharkPark-Signature`, `X-SharkPark-Timestamp`) prove
 *     "this POST originated from the SharkPark app" for the occupancy-event
 *     ingest endpoint.
 *
 * Both share a single source of truth: one UUID per install, kept in
 * AsyncStorage, with a session-only fallback if AsyncStorage fails.
 *
 * Threat-model note: a HMAC secret embedded in any mobile bundle is
 * fundamentally weak — a motivated attacker can extract it via reverse
 * engineering. Its purpose here is to filter trivial replay/spam, not to
 * provide cryptographic authenticity. The backend HmacGuard runs in
 * permissive mode when DEVICE_EVENT_SECRET is unset (dev), and we mirror that
 * here: if no secret is bundled we omit the signature headers and let the
 * backend decide whether to accept the request.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { DEVICE_EVENT_SECRET } from '@env';

const DEVICE_ID_STORAGE_KEY = '@sharkpark_anonymous_device_id';

let cachedDeviceId: string | undefined;
let sessionFallbackDeviceId: string | undefined;

// react-native-dotenv inlines `@env` imports at babel-transform time, so the
// imported binding above is captured as a module-private constant. We wrap it
// in an indirection that tests can override via `__setEventSecretForTests`.
let eventSecret: string | undefined = DEVICE_EVENT_SECRET;

/**
 * Get the opaque device id for this install.
 * Generates and persists a UUID v4 on first call.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  let existing: string | null = null;
  try {
    existing = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    if (__DEV__) {
      console.warn('[deviceCredentials] AsyncStorage unavailable; using session-only device id');
    }
    if (!sessionFallbackDeviceId) sessionFallbackDeviceId = generateUuidV4();
    return sessionFallbackDeviceId;
  }

  if (existing) {
    cachedDeviceId = existing;
    return existing;
  }

  const fresh = generateUuidV4();
  try {
    await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
  } catch {
    // Persistence failed but we still have a usable id for this session.
  }
  cachedDeviceId = fresh;
  return fresh;
}

/**
 * Build the headers required by the access-tier model.
 *
 *   - `x-device-id` is added to every request (cheap, harmless on Public
 *     endpoints, required by ContributorGuard).
 *   - HMAC headers are added only when a body is present AND a signing
 *     secret is bundled. Backend currently only enforces HMAC on
 *     POST /occupancy-events; signing other POSTs is a no-op.
 */
export async function buildAuthHeaders(opts: {
  body?: string;
} = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'x-device-id': await getDeviceId(),
  };

  if (opts.body && eventSecret) {
    const timestamp = Date.now().toString();
    const signature = signPayload(`${timestamp}.${opts.body}`, eventSecret);
    headers['X-SharkPark-Timestamp'] = timestamp;
    headers['X-SharkPark-Signature'] = signature;
  }

  return headers;
}

/**
 * HMAC-SHA256(secret, payload) → lowercase hex.
 * Matches the format expected by apps/backend/src/auth/hmac.guard.ts.
 */
export function signPayload(payload: string, secret: string): string {
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(payload));
  return bytesToHex(mac);
}

/** Generate a RFC 4122 v4 UUID using crypto.getRandomValues (RN polyfilled). */
function generateUuidV4(): string {
  // Hermes does not provide globalThis.crypto by default. We rely on the
  // `react-native-get-random-values` polyfill imported at the top of
  // apps/mobile/index.js. If it's missing we fail loudly rather than
  // returning a non-cryptographic UUID.
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) {
    throw new Error(
      '[deviceCredentials] crypto.getRandomValues unavailable — ensure ' +
        "`import 'react-native-get-random-values';` is the first import in index.js",
    );
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Reset cached state. Test-only. */
export function __resetForTests(): void {
  cachedDeviceId = undefined;
  sessionFallbackDeviceId = undefined;
  eventSecret = DEVICE_EVENT_SECRET;
}

/** Override the event secret. Test-only. */
export function __setEventSecretForTests(secret: string | undefined): void {
  eventSecret = secret;
}
