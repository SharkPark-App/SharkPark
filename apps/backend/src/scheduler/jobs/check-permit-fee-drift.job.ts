import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

import {
  CSULB_PERMIT_FEES,
  EXPECTED_PERMIT_SOURCE_HASH_SHA256,
  computePermitSourceHash,
} from '../../lots/permit-fees';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'check-permit-fee-drift';
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'SharkPark-PermitFeeDriftCheck/1.0 (+https://sharkpark.app)';

/**
 * Weekly drift check for the CSULB permit-information page during July
 * and August (the window in which CSULB typically publishes the next
 * fiscal year's fee schedule).
 *
 * Fetches the page, normalises the body, and compares its SHA-256 against
 * `EXPECTED_PERMIT_SOURCE_HASH_SHA256` baked into `permit-fees.ts`. On a
 * mismatch we emit a Sentry warning with both hashes so an engineer can
 * diff the page and ship a PR updating the fee constants + baseline hash.
 *
 * A non-200 response throws — Sentry will raise this as the cron error
 * via the standard CronRunnerService wrapping.
 */
@Injectable()
export class CheckPermitFeeDriftJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const url = CSULB_PERMIT_FEES.source_url;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
          signal: controller.signal,
          redirect: 'follow',
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new Error(
          `${NAME}: GET ${url} returned ${response.status} ${response.statusText}`,
        );
      }

      const body = await response.text();
      const actualHash = computePermitSourceHash(body);

      if (actualHash === EXPECTED_PERMIT_SOURCE_HASH_SHA256) {
        this.logger.log(
          `[cron:${NAME}] OK — page hash matches baseline (${actualHash.slice(0, 12)}…)`,
        );
        return {
          status: 'unchanged' as const,
          hash: actualHash,
          body_length: body.length,
        };
      }

      this.logger.warn(
        `[cron:${NAME}] DRIFT — page hash changed from ${EXPECTED_PERMIT_SOURCE_HASH_SHA256.slice(0, 12)}… to ${actualHash.slice(0, 12)}…`,
      );

      Sentry.captureMessage(
        '[permit-fees] CSULB permit-information page changed — review and update CSULB_PERMIT_FEES + EXPECTED_PERMIT_SOURCE_HASH_SHA256',
        {
          level: 'warning',
          tags: { cron: NAME },
          extra: {
            source_url: url,
            expected_hash: EXPECTED_PERMIT_SOURCE_HASH_SHA256,
            actual_hash: actualHash,
            effective_through: CSULB_PERMIT_FEES.effective_through,
            body_length: body.length,
          },
        },
      );

      return {
        status: 'drift' as const,
        expected_hash: EXPECTED_PERMIT_SOURCE_HASH_SHA256,
        actual_hash: actualHash,
        body_length: body.length,
      };
    });
  }
}
