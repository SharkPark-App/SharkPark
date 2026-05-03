jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AllExceptionsFilter } from './all-exceptions.filter';

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

function makeHost(
  url = '/api/v1/lots',
  method = 'GET',
): { host: ArgumentsHost; res: MockResponse } {
  const res: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const req = { url, method };
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    (Sentry.captureException as jest.Mock).mockClear();
  });

  it('returns the HttpException status + message in the response body', () => {
    const { host, res } = makeHost('/api/v1/lots/missing');
    const exc = new BadRequestException('lot id required');

    filter.catch(exc, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      success: false,
      statusCode: 400,
      message: 'lot id required',
      method: 'GET',
      path: '/api/v1/lots/missing',
    });
    expect(typeof body.timestamp).toBe('string');
  });

  it('captures 500-class errors to Sentry', () => {
    const { host } = makeHost();
    const exc = new HttpException('boom', HttpStatus.INTERNAL_SERVER_ERROR);

    filter.catch(exc, host);

    expect(Sentry.captureException).toHaveBeenCalledWith(exc);
  });

  it('does NOT capture 4xx errors to Sentry (scanner/user-input noise)', () => {
    const { host } = makeHost('/elanpaymentsolutions');
    const exc = new HttpException('Not Found', HttpStatus.NOT_FOUND);

    filter.catch(exc, host);

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('does not capture 401/403 to Sentry', () => {
    const { host } = makeHost();
    filter.catch(new HttpException('nope', HttpStatus.UNAUTHORIZED), host);
    filter.catch(new ForbiddenException('nope'), host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('treats unknown (non-HttpException) errors as 500 and reports to Sentry', () => {
    const { host, res } = makeHost();
    const exc = new Error('unexpected');

    filter.catch(exc, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(exc);
  });

  it('surfaces a structured `code` field from HttpException response payloads', () => {
    const { host, res } = makeHost();
    const exc = new ForbiddenException({
      message: 'background location required',
      code: 'BG_LOCATION_REQUIRED',
    });

    filter.catch(exc, host);

    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('BG_LOCATION_REQUIRED');
  });

  it('omits `code` when the response payload has no code field', () => {
    const { host, res } = makeHost();
    filter.catch(new BadRequestException('plain'), host);
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('code');
  });

  it('includes `error` (stack) only in development', () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const { host, res } = makeHost();
      filter.catch(new Error('boom'), host);
      expect(res.json.mock.calls[0][0]).toHaveProperty('error');
    } finally {
      process.env.NODE_ENV = original;
    }

    process.env.NODE_ENV = 'production';
    try {
      const { host, res } = makeHost();
      filter.catch(new Error('boom'), host);
      expect(res.json.mock.calls[0][0]).not.toHaveProperty('error');
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
