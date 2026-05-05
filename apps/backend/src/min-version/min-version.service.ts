import { Injectable, Logger } from '@nestjs/common';

/** Fallback when `MIN_SUPPORTED_APP_VERSION` is unset (e.g. local dev). */
const DEFAULT_MIN_SUPPORTED_VERSION = '1.0.0';

/** Strict semver `MAJOR.MINOR.PATCH` (digits only — matches the mobile `semverLt` parser). */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

@Injectable()
export class MinVersionService {
  private readonly logger = new Logger(MinVersionService.name);
  private readonly minSupportedVersion: string;

  constructor() {
    const raw = process.env.MIN_SUPPORTED_APP_VERSION?.trim();
    if (raw && SEMVER_RE.test(raw)) {
      this.minSupportedVersion = raw;
    } else {
      if (raw) {
        // Fail loud on a malformed override rather than silently ignoring it
        // and serving the default — that would defeat the whole point of the
        // env var on a release-day bump.
        throw new Error(
          `MIN_SUPPORTED_APP_VERSION must be MAJOR.MINOR.PATCH (got: ${JSON.stringify(raw)})`,
        );
      }
      this.minSupportedVersion = DEFAULT_MIN_SUPPORTED_VERSION;
      this.logger.warn(
        `MIN_SUPPORTED_APP_VERSION not set; defaulting to ${DEFAULT_MIN_SUPPORTED_VERSION}`,
      );
    }
  }

  getMinSupportedVersion(): string {
    return this.minSupportedVersion;
  }
}
