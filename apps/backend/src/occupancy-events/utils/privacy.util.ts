import { createHash } from 'crypto';

// In production, load from environment variables
const DEVICE_HASH_SALT = process.env.DEVICE_HASH_SALT || 'sharkpark-default-salt-2026';

/** Hashes device ID with SHA-256 + salt for privacy-safe deduplication */
export function hashDeviceId(deviceId: string): string {
  if (!deviceId || typeof deviceId !== 'string') {
    throw new Error('Device ID must be a non-empty string');
  }
  
  return createHash('sha256')
    .update(`${DEVICE_HASH_SALT}:${deviceId}`)
    .digest('hex');
}

/** Generates unique event ID (timestamp + random suffix) for DynamoDB sort key */
export function generateEventId(): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomSuffix}`;
}

/** Calculates Unix TTL timestamp for DynamoDB auto-deletion */
export function calculateTTL(daysFromNow: number = 90): number {
  return Math.floor(Date.now() / 1000) + (daysFromNow * 24 * 60 * 60);
}
