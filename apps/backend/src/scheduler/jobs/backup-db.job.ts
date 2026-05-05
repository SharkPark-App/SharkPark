import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createGzip } from 'node:zlib';

import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'backup-db';

/**
 * Daily Postgres backup: streams `pg_dump --format=custom` from Neon through
 * gzip into Cloudflare R2 under `daily/YYYY-MM-DD.dump.gz`. Multipart upload
 * keeps memory bounded regardless of dump size.
 *
 * Required env (Fly secrets):
 *   DIRECT_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BACKUPS_BUCKET
 */
@Injectable()
export class BackupDbJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const dbUrl = process.env.DIRECT_URL;
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      const bucket = process.env.R2_BACKUPS_BUCKET;

      if (!dbUrl || !accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error(
          `${NAME}: missing one of DIRECT_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BACKUPS_BUCKET`,
        );
      }

      const today = new Date().toISOString().slice(0, 10);
      const key = `daily/${today}.dump.gz`;

      this.logger.log(`[cron:${NAME}] starting pg_dump → r2://${bucket}/${key}`);

      const dump = spawn(
        'pg_dump',
        [
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          '--compress=0',
          dbUrl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let dumpStderr = '';
      dump.stderr.on('data', (chunk: Buffer) => {
        dumpStderr += chunk.toString('utf8');
      });

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
        partSize: 8 * 1024 * 1024,
      });

      const dumpExit = new Promise<void>((resolve, reject) => {
        dump.on('error', reject);
        dump.on('exit', (code) => {
          if (code === 0) resolve();
          else
            reject(
              new Error(`pg_dump exited ${code}: ${dumpStderr.trim()}`),
            );
        });
      });

      const [, uploadResult] = await Promise.all([dumpExit, upload.done()]);

      this.logger.log(
        `[cron:${NAME}] uploaded ${key} (etag=${'ETag' in uploadResult ? uploadResult.ETag : 'n/a'})`,
      );
    });
  }
}
