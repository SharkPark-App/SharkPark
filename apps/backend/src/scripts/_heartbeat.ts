/**
 * Better Stack heartbeat ping helper for cron scripts.
 *
 * Each cron has a unique heartbeat URL stored in a Fly secret named
 * `BETTERSTACK_HEARTBEAT_<JOB_NAME_UPPER_SNAKE>`. We resolve the URL by
 * job name, fire a GET, and silently no-op if the env var is unset (so
 * local dev / tests don't try to ping production monitors).
 *
 * Errors during ping are logged as warnings but never re-thrown — a
 * failed heartbeat must NOT mask a successful cron run.
 */

import type { Logger as PinoLogger } from 'nestjs-pino';

const HEARTBEAT_TIMEOUT_MS = 5_000;

/** Convert a kebab-case job name to UPPER_SNAKE_CASE for env var lookup. */
export function heartbeatEnvKey(jobName: string): string {
  return `BETTERSTACK_HEARTBEAT_${jobName.replace(/-/g, '_').toUpperCase()}`;
}

/**
 * Ping the Better Stack heartbeat URL for the given cron job, if configured.
 * Resolves on success, configured-but-failed, or unconfigured — never throws.
 */
export async function pingHeartbeat(
  jobName: string,
  logger?: Pick<PinoLogger, 'log' | 'warn'>,
): Promise<void> {
  const envKey = heartbeatEnvKey(jobName);
  const url = process.env[envKey];
  if (!url) {
    logger?.log?.(`[cron:${jobName}] heartbeat skipped — ${envKey} not set`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      logger?.warn?.(
        `[cron:${jobName}] heartbeat returned HTTP ${res.status}`,
      );
      return;
    }
    logger?.log?.(`[cron:${jobName}] heartbeat sent`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn?.(`[cron:${jobName}] heartbeat failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}
