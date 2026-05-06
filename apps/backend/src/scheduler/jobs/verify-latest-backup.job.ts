import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'verify-latest-backup';
const STALENESS_HOURS = 26;

/**
 * Weekly backup verification: lists `daily/`, picks the newest object, and
 * pipes it through `pg_restore --list` to confirm the dump header parses.
 * Throws (→ Sentry) on empty bucket, stale newest object, or restore failure.
 */
@Injectable()
export class VerifyLatestBackupJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      const bucket = process.env.R2_BACKUPS_BUCKET;

      if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
        throw new Error(
          `${NAME}: missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, or R2_BACKUPS_BUCKET`,
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
        throw new Error(`${NAME}: no objects under r2://${bucket}/daily/`);
      }

      const newest = objects.reduce((a, b) =>
        (a.LastModified?.getTime() ?? 0) > (b.LastModified?.getTime() ?? 0) ? a : b,
      );
      if (!newest.Key || !newest.LastModified) {
        throw new Error(`${NAME}: newest object missing Key or LastModified`);
      }

      const ageMs = Date.now() - newest.LastModified.getTime();
      const ageHours = ageMs / 3_600_000;
      if (ageHours > STALENESS_HOURS) {
        throw new Error(
          `${NAME}: newest backup ${newest.Key} is ${ageHours.toFixed(1)}h old (>${STALENESS_HOURS}h)`,
        );
      }

      this.logger.log(
        `[cron:${NAME}] newest=${newest.Key} size=${newest.Size}B age=${ageHours.toFixed(1)}h — running pg_restore --list`,
      );

      const obj = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: newest.Key }),
      );
      if (!obj.Body) {
        throw new Error(`${NAME}: empty body for ${newest.Key}`);
      }

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
              new Error(`pg_restore --list exited ${code}: ${restoreStderr.trim()}`),
            );
        });
      });

      this.logger.log(
        `[cron:${NAME}] OK — ${newest.Key} parsed cleanly (${listingLines} TOC entries)`,
      );
    });
  }
}
