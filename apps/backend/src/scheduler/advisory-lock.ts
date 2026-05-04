import { createHash } from 'node:crypto';
import type pg from 'pg';

/**
 * Derive a deterministic, signed 64-bit integer from a job name for use as a
 * Postgres advisory-lock key. Same name → same key forever; different names
 * yield different keys with cryptographic collision resistance.
 */
export function lockKey(jobName: string): bigint {
  const digest = createHash('sha256').update(jobName).digest();
  return digest.readBigInt64BE(0);
}

/**
 * Run `work` while holding a Postgres session-level advisory lock keyed by
 * `jobName`. If the lock is already held by another process (e.g. another
 * cron Machine during a rolling deploy), we exit without running — this is
 * the desired behaviour, not an error.
 *
 * Returns `{ acquired: true, result }` when the work ran, or
 * `{ acquired: false }` when the lock was busy.
 */
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  jobName: string,
  work: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const key = lockKey(jobName).toString();
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [key],
    );
    if (!rows[0]?.acquired) {
      return { acquired: false };
    }
    try {
      const result = await work();
      return { acquired: true, result };
    } finally {
      // Best-effort unlock; swallow errors so a failed unlock doesn't mask
      // the job's own outcome. The lock is also auto-released when the
      // session ends (pool teardown closes connections).
      await client
        .query('SELECT pg_advisory_unlock($1::bigint)', [key])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
