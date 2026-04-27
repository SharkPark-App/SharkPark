import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { Request, Response } from 'express';

/**
 * Global exception filter that standardizes error responses across the API.
 * Logs all errors and includes stack traces in development mode.
 *
 * `@SentryExceptionCaptured()` reports unhandled exceptions to Sentry while
 * still allowing this filter to control the HTTP response shape.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  @SentryExceptionCaptured()
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

    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json(errorResponse);
  }
}
