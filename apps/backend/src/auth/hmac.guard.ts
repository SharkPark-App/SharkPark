import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Guard for device-originated occupancy events.
 * Validates requests using HMAC-SHA256 signature to prevent spoofing.
 *
 * Required headers:
 *   X-SharkPark-Signature: HMAC-SHA256 hex digest of the raw request body
 *   X-SharkPark-Timestamp: Unix timestamp (ms) — must be within 5 minutes
 *
 * The shared secret is configured via DEVICE_EVENT_SECRET env var.
 * In development (no secret set), the guard is permissive with a warning.
 */
@Injectable()
export class HmacGuard implements CanActivate {
  private readonly logger = new Logger(HmacGuard.name);
  private readonly secret: string;
  private readonly maxAgeMs = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly config: ConfigService) {
    this.secret = this.config.get<string>('DEVICE_EVENT_SECRET', '');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      this.logger.warn('DEVICE_EVENT_SECRET not set — HMAC validation disabled');
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Validate timestamp to prevent replay attacks
    const timestampHeader = request.headers['x-sharkpark-timestamp'] as string;
    if (!timestampHeader) {
      throw new UnauthorizedException('Missing X-SharkPark-Timestamp header');
    }

    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp) || Math.abs(Date.now() - timestamp) > this.maxAgeMs) {
      throw new UnauthorizedException('Request timestamp expired or invalid');
    }

    // Validate HMAC signature
    const signatureHeader = request.headers['x-sharkpark-signature'] as string;
    if (!signatureHeader) {
      throw new UnauthorizedException('Missing X-SharkPark-Signature header');
    }

    const body = JSON.stringify(request.body);
    const payload = `${timestampHeader}.${body}`;
    const expectedSignature = createHmac('sha256', this.secret)
      .update(payload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signatureHeader, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid HMAC signature');
    }

    return true;
  }
}
