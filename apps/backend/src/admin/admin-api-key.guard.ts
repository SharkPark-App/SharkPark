import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Guard for `/admin/*` operational endpoints.
 *
 * Protocol:
 *   - Header `x-admin-api-key: <token>` must equal the `ADMIN_API_KEY` env var.
 *   - Comparison uses `timingSafeEqual` to avoid leaking the token via
 *     side-channel timing.
 *
 * Failure modes:
 *   - `ADMIN_API_KEY` unset on the running process → 503. We deliberately do
 *     NOT default to "open" or "always-deny silently" so the operator
 *     immediately sees a misconfiguration and can set the secret. (Per
 *     project convention: required secrets must fail loudly, never
 *     silently bypass behaviour.)
 *   - Header missing or mismatched → 401.
 *
 * This is purposely minimal — the admin surface holds operational
 * status data only (run history, model versions); it is NOT a user-data
 * surface. If we ever expose mutating endpoints under /admin we should
 * upgrade to a per-operator credential + audit log.
 */
@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(AdminApiKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected || expected.length < 16) {
      // Refuse to authenticate against a missing/weak secret. 503 because
      // the SERVER is misconfigured — the client request is fine.
      this.logger.error(
        'ADMIN_API_KEY is not set or is shorter than 16 characters; refusing all admin requests.',
      );
      throw new ServiceUnavailableException(
        'Admin API is not configured on this instance.',
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.header('x-admin-api-key');
    if (typeof presented !== 'string' || presented.length === 0) {
      throw new UnauthorizedException('Missing x-admin-api-key header.');
    }

    // timingSafeEqual requires equal-length buffers. Pad both sides to the
    // longer of the two so we always run the comparison; bail before any
    // string concatenation reveals a length match in timing.
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      throw new UnauthorizedException('Invalid x-admin-api-key.');
    }
    if (!timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid x-admin-api-key.');
    }
    return true;
  }
}
