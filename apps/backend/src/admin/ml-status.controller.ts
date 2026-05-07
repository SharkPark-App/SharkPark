import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Public } from '../auth/public.decorator';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AdminPenetrationRateService } from './admin-penetration-rate.service';
import {
  renderMlDashboard,
  type DashboardData,
} from './ml-dashboard.renderer';
import { MlStatusService, type MlStatusResponse } from './ml-status.service';

/**
 * Resolves the directory holding ML artifacts (synthetic overlay PNG,
 * etc). Operators set `ML_ARTIFACTS_DIR` in fly.toml; falls back to a
 * dev-friendly path inside the repo so `pnpm dev` works without env
 * config.
 *
 * SECURITY: this directory is the ONLY filesystem location the
 * `synthetic-overlay.png` route may read from — see the explicit basename
 * check there. Path traversal is not possible because the route does not
 * accept any user-controlled path component.
 */
function artifactsDir(): string {
  const fromEnv = process.env.ML_ARTIFACTS_DIR;
  if (fromEnv && fromEnv.length > 0) return resolve(fromEnv);
  // Default: <cwd>/public/ml-artifacts. Backend is started from
  // apps/backend/, so this lands at apps/backend/public/ml-artifacts.
  return resolve(process.cwd(), 'public', 'ml-artifacts');
}

const SYNTHETIC_OVERLAY_BASENAME = 'synthetic_overlay.png';

/**
 * GET /admin/ml-status
 *
 * Operator-facing snapshot of the ML cron pipeline.
 *
 * Three response shapes:
 *   - `GET /admin/ml-status` → JSON `MlStatusResponse` (back-compat
 *     with `ml-ci`).
 *   - `GET /admin/ml-status/dashboard` → human dashboard (HTML).
 *   - `GET /admin/ml-status/synthetic-overlay.png` → the PNG written
 *     by `services/ml/scripts/validate_synthetic_v2.py`, if present.
 *
 * Query params on the JSON form:
 *   ?windowHours=H   1..168 (default 24)   — rollup window
 *   ?limit=N         1..200 (default 50)   — recent-runs slice
 *
 * Authentication: x-admin-api-key header validated by AdminApiKeyGuard.
 * Marked @Public() to bypass the global AzureAdGuard (operators don't have
 * Azure AD identities); the AdminApiKeyGuard is what actually protects the
 * route.
 */
@Public()
@Controller('admin/ml-status')
@UseGuards(AdminApiKeyGuard)
export class MlStatusController {
  constructor(
    private readonly service: MlStatusService,
    private readonly penetrationService: AdminPenetrationRateService,
  ) {}

  @Get()
  async get(
    @Query('windowHours') windowHoursRaw?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<MlStatusResponse> {
    const windowHours = parsePositiveInt(windowHoursRaw, 24, 1, 168);
    const recentLimit = parsePositiveInt(limitRaw, 50, 1, 200);
    return this.service.getStatus({ windowHours, recentLimit });
  }

  /**
   * Server-rendered HTML dashboard. CSP narrowed to inline-only:
   * one inline `<style>` block, no `<script>`, only same-origin
   * images (the synthetic overlay PNG).
   */
  @Get('dashboard')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header(
    'content-security-policy',
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  )
  @Header('x-content-type-options', 'nosniff')
  async dashboard(
    @Query('windowHours') windowHoursRaw?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<string> {
    const windowHours = parsePositiveInt(windowHoursRaw, 24, 1, 168);
    const recentLimit = parsePositiveInt(limitRaw, 50, 1, 200);
    const [status, maeHistory, modelVersions, ewmaLots] = await Promise.all([
      this.service.getStatus({ windowHours, recentLimit }),
      this.service.getShortTermMaeHistory(14),
      this.service.getLatestModelVersions(),
      this.penetrationService.listAllLots(),
    ]);
    const overlayMtime = describeOverlay();
    const data: DashboardData = {
      status,
      maeHistory,
      modelVersions,
      ewmaLots,
      syntheticOverlayAvailable: overlayMtime !== null,
      syntheticOverlayGeneratedAt: overlayMtime,
    };
    return renderMlDashboard(data);
  }

  /**
   * Streams the synthetic-vs-real overlay PNG. Path is hardcoded to a
   * single basename inside `artifactsDir()` — no user input touches the
   * resolved filesystem path.
   */
  @Get('synthetic-overlay.png')
  @Header('cache-control', 'no-store')
  syntheticOverlay(@Res() res: Response): void {
    const file = join(artifactsDir(), SYNTHETIC_OVERLAY_BASENAME);
    let stat;
    try {
      stat = statSync(file);
    } catch {
      throw new NotFoundException(
        `Synthetic overlay not generated yet. Run "python -m scripts.validate_synthetic_v2" from services/ml/.`,
      );
    }
    if (!stat.isFile()) {
      throw new NotFoundException('Synthetic overlay artifact is not a file.');
    }
    res.setHeader('content-type', 'image/png');
    res.setHeader('content-length', String(stat.size));
    createReadStream(file).pipe(res);
  }
}

function describeOverlay(): string | null {
  try {
    const stat = statSync(join(artifactsDir(), SYNTHETIC_OVERLAY_BASENAME));
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new BadRequestException(
      `Expected integer between ${min} and ${max}, got "${raw}".`,
    );
  }
  return n;
}
