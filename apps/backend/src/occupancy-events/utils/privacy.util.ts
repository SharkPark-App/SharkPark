import { createHash, randomBytes } from 'crypto';

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.DEVICE_HASH_SALT) {
  throw new Error('DEVICE_HASH_SALT environment variable is required in production');
}

// In development, generate a random salt per process instead of a predictable default
const DEVICE_HASH_SALT = process.env.DEVICE_HASH_SALT || `dev-${randomBytes(16).toString('hex')}`;

/** Hashes device ID with SHA-256 + salt for privacy-safe deduplication */
export function hashDeviceId(deviceId: string): string {
  if (!deviceId || typeof deviceId !== 'string') {
    throw new Error('Device ID must be a non-empty string');
  }
  
  return createHash('sha256')
    .update(`${DEVICE_HASH_SALT}:${deviceId}`)
    .digest('hex');
}

/** Generates unique event ID (timestamp + random suffix) */
export function generateEventId(): string {
  const timestamp = Date.now();
  const randomSuffix = randomBytes(5).toString('hex');
  return `${timestamp}-${randomSuffix}`;
}
