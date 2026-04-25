import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createGzip } from 'node:zlib';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { runCronJob } from './_bootstrap';

/**
 * Daily Postgres backup: streams `pg_dump --format=custom` from Neon through
 * gzip and into Cloudflare R2 (S3-compatible) under `daily/YYYY-MM-DD.dump.gz`.
 *
 * Uses `lib-storage`'s multipart upload so memory stays bounded regardless of
 * dump size — fits in the 512MB cron VM.
 *
 * Required env (set as Fly secrets):
 *   DIRECT_URL                  Neon direct (non-pooled) URL for pg_dump
 *   R2_ACCOUNT_ID               Cloudflare account id
 *   R2_ACCESS_KEY_ID            R2 token access key
 *   R2_SECRET_ACCESS_KEY        R2 token secret
 *   R2_BACKUPS_BUCKET           Bucket name (e.g. sharkpark-backups)
 */
void runCronJob('backup-db', async ({ logger }) => {
  const dbUrl = process.env.DIRECT_URL;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BACKUPS_BUCKET;

  if (!dbUrl || !accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'backup-db: missing one of DIRECT_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUPS_BUCKET',
    );
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const key = `daily/${today}.dump.gz`;

  logger.log(`[cron:backup-db] starting pg_dump → r2://${bucket}/${key}`);

  // pg_dump --format=custom emits a binary archive that pg_restore can read
  // selectively (--list, --table, etc). More flexible than plain SQL.
  const dump = spawn(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--compress=0', // we gzip the stream ourselves
      dbUrl,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Capture stderr for diagnostics; pg_dump emits informational messages here.
  let dumpStderr = '';
  dump.stderr.on('data', (chunk: Buffer) => {
    dumpStderr += chunk.toString('utf8');
  });

  // Tee the dump through gzip into a PassThrough so the SDK has a Readable.
  const gzip = createGzip({ level: 6 });
  const body = new PassThrough();
  dump.stdout.pipe(gzip).pipe(body);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
      ContentEncoding: 'gzip',
    },
    queueSize: 2,
    partSize: 8 * 1024 * 1024, // 8 MiB parts
  });

  // Wait for both pg_dump exit and the upload to finish.
  const dumpExit = new Promise<void>((resolve, reject) => {
    dump.on('error', reject);
    dump.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited ${code}: ${dumpStderr.trim()}`));
    });
  });

  const [, uploadResult] = await Promise.all([dumpExit, upload.done()]);

  logger.log(
    `[cron:backup-db] uploaded ${key} (etag=${'ETag' in uploadResult ? uploadResult.ETag : 'n/a'})`,
  );
});
