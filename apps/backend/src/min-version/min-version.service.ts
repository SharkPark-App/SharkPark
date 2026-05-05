import { Injectable, Logger } from '@nestjs/common';

/** Fallback when no min-version env var is set (e.g. local dev). */
const DEFAULT_MIN_SUPPORTED_VERSION = '1.0.0';

/** Strict semver `MAJOR.MINOR.PATCH` (digits only — matches the mobile `semverLt` parser). */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Platforms we recognise on the `x-platform` header. Anything else (including
 * a missing header, a typo, or an old client that pre-dates the header) falls
 * back to the global floor.
 */
export type SupportedPlatform = 'ios' | 'android';

const GLOBAL_ENV = 'MIN_SUPPORTED_APP_VERSION';
const PLATFORM_ENV: Record<SupportedPlatform, string> = {
  ios: 'MIN_SUPPORTED_APP_VERSION_IOS',
  android: 'MIN_SUPPORTED_APP_VERSION_ANDROID',
};

/**
 * Reads, validates, and returns the value of an env var holding a min-version.
 * Returns `undefined` when the var is unset/empty. Throws on a non-empty value
 * that isn't strict `MAJOR.MINOR.PATCH` — silently falling back on a typo
 * during a release-day bump is exactly the failure mode the env var exists
 * to prevent.
 */
function readVersionEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (!SEMVER_RE.test(raw)) {
    throw new Error(
      `${name} must be MAJOR.MINOR.PATCH (got: ${JSON.stringify(raw)})`,
    );
  }
  return raw;
}

@Injectable()
export class MinVersionService {
  private readonly logger = new Logger(MinVersionService.name);
  private readonly globalMin: string;
  private readonly perPlatformMin: Partial<Record<SupportedPlatform, string>>;

  constructor() {
    const global = readVersionEnv(GLOBAL_ENV);
    if (global) {
      this.globalMin = global;
    } else {
      this.globalMin = DEFAULT_MIN_SUPPORTED_VERSION;
      this.logger.warn(
        `${GLOBAL_ENV} not set; defaulting to ${DEFAULT_MIN_SUPPORTED_VERSION}`,
      );
    }

    this.perPlatformMin = {
      ios: readVersionEnv(PLATFORM_ENV.ios),
      android: readVersionEnv(PLATFORM_ENV.android),
    };

    for (const platform of ['ios', 'android'] as const) {
      const v = this.perPlatformMin[platform];
      if (v) {
        this.logger.log(
          `${PLATFORM_ENV[platform]} override active: ${platform} floor = ${v} (global = ${this.globalMin})`,
        );
      }
    }
  }

  /**
   * Resolve the min supported version for a given platform.
   *
   * Resolution order:
   *   1. Platform-specific override (`MIN_SUPPORTED_APP_VERSION_IOS` / `_ANDROID`)
   *   2. Global override (`MIN_SUPPORTED_APP_VERSION`)
   *   3. `DEFAULT_MIN_SUPPORTED_VERSION` ('1.0.0')
   *
   * `platform` is the value of the `x-platform` request header. Unknown values
   * (including `undefined`, `'web'`, or a typo) intentionally fall through to
   * the global floor — old clients that don't send the header must keep
   * working, and the global floor is always the safe lower-bound.
   */
  getMinSupportedVersion(platform?: string): string {
    const normalised = platform?.toLowerCase();
    if (normalised === 'ios' || normalised === 'android') {
      const override = this.perPlatformMin[normalised];
      if (override) return override;
    }
    return this.globalMin;
  }
}
