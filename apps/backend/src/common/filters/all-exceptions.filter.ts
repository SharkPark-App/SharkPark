import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';

/**
 * Global exception filter that standardizes error responses across the API.
 * Logs all errors and includes stack traces in development mode.
 *
 * Sentry capture is gated to status >= 500 (or non-HttpException). Client
 * errors (4xx) are logged at warn level without a stack trace — they are
 * almost always either user input mistakes or internet scanners hitting
 * non-existent paths (`/elanpaymentsolutions`, `/wp-login.php`, etc.) and
 * reporting them to Sentry pollutes the issue feed and burns quota.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    // Some HttpExceptions (notably ContributorGuard's BG_LOCATION_REQUIRED
    // 403) carry a structured response with a `code` field that the mobile
    // client uses to drive UX. Surface it at the top level so callers don't
    // have to dig.
    let code: string | undefined;
    if (exception instanceof HttpException) {
      const raw = exception.getResponse();
      if (raw && typeof raw === 'object' && 'code' in raw) {
        const c = (raw as { code?: unknown }).code;
        if (typeof c === 'string') {
          code = c;
        }
      }
    }

    const errorResponse = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      ...(code ? { code } : {}),
      ...(process.env.NODE_ENV === 'development' && {
        error: exception instanceof Error ? exception.stack : exception,
      }),
    };

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} - ${status} - ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      Sentry.captureException(exception);
    } else {
      // 4xx: log without stack (client error, not a server bug) and don't
      // pollute Sentry with scanner noise / user input mistakes.
      this.logger.warn(
        `${request.method} ${request.url} - ${status} - ${message}`,
      );
    }

    response.status(status).json(errorResponse);
  }
}
