import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import { runCronJob } from './_bootstrap';

/**
 * Weekly backup verification: lists `daily/`, picks the newest object, and
 * pipes it through `pg_restore --list` to confirm the dump header parses.
 * Throws (→ Sentry) if:
 *   - bucket is empty
 *   - newest object is older than the staleness threshold
 *   - pg_restore --list exits non-zero
 *
 * This catches silent failures: token revoked, pg_dump truncated mid-stream,
 * cron not firing, etc.
 */
const STALENESS_HOURS = 26; // backup runs every 24h; 2h grace

void runCronJob('verify-latest-backup', [], async ({ logger }) => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BACKUPS_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'verify-latest-backup: missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, or R2_BACKUPS_BUCKET',
    );
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: 'daily/' }),
  );
  const objects = list.Contents ?? [];
  if (objects.length === 0) {
    throw new Error(`verify-latest-backup: no objects under r2://${bucket}/daily/`);
  }

  const newest = objects.reduce((a, b) =>
    (a.LastModified?.getTime() ?? 0) > (b.LastModified?.getTime() ?? 0) ? a : b,
  );
  if (!newest.Key || !newest.LastModified) {
    throw new Error('verify-latest-backup: newest object missing Key or LastModified');
  }

  const ageMs = Date.now() - newest.LastModified.getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours > STALENESS_HOURS) {
    throw new Error(
      `verify-latest-backup: newest backup ${newest.Key} is ${ageHours.toFixed(1)}h old (>${STALENESS_HOURS}h)`,
    );
  }

  logger.log(
    `[cron:verify-latest-backup] newest=${newest.Key} size=${newest.Size}B age=${ageHours.toFixed(1)}h — running pg_restore --list`,
  );

  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: newest.Key }));
  if (!obj.Body) {
    throw new Error(`verify-latest-backup: empty body for ${newest.Key}`);
  }

  // Stream object → gunzip → pg_restore --list (header parse only, no DB needed).
  const restore = spawn('pg_restore', ['--list'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let listingLines = 0;
  let restoreStderr = '';
  restore.stdout.on('data', (chunk: Buffer) => {
    listingLines += chunk.toString('utf8').split('\n').length - 1;
  });
  restore.stderr.on('data', (chunk: Buffer) => {
    restoreStderr += chunk.toString('utf8');
  });

  // R2 returns a Web ReadableStream in newer SDKs; coerce to Node Readable.
  const body = obj.Body as Readable | globalThis.ReadableStream<Uint8Array>;
  const nodeBody =
    body instanceof Readable
      ? body
      : (Readable.fromWeb(body as globalThis.ReadableStream<Uint8Array>) as Readable);
  nodeBody.pipe(createGunzip()).pipe(restore.stdin);

  await new Promise<void>((resolve, reject) => {
    restore.on('error', reject);
    restore.on('exit', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `pg_restore --list exited ${code}: ${restoreStderr.trim()}`,
          ),
        );
    });
  });

  logger.log(
    `[cron:verify-latest-backup] OK — ${newest.Key} parsed cleanly (${listingLines} TOC entries)`,
  );
});
