import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Attaches a stable request id to every request so logs and error reports can
 * be correlated across services and the Cloudflare edge.
 *
 * Precedence:
 *   1. `cf-ray`        (Cloudflare-assigned, set when proxied)
 *   2. `x-request-id`  (caller-supplied)
 *   3. randomUUID()
 *
 * The id is also echoed back in the `x-request-id` response header.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming =
      (req.headers['cf-ray'] as string | undefined) ??
      (req.headers['x-request-id'] as string | undefined);
    const id = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader('x-request-id', id);
    next();
  }
}
