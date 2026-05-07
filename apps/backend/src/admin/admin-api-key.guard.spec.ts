import {
  ExecutionContext,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { AdminApiKeyGuard } from './admin-api-key.guard';

function ctx(headerValue: string | undefined): ExecutionContext {
  const headers: Record<string, string> = {};
  if (headerValue !== undefined) headers['x-admin-api-key'] = headerValue;
  const req = {
    header: (name: string) =>
      headers[name.toLowerCase()] ?? headers[name] ?? undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AdminApiKeyGuard', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('throws ServiceUnavailable when ADMIN_API_KEY is unset', () => {
    delete process.env.ADMIN_API_KEY;
    const guard = new AdminApiKeyGuard();
    expect(() => guard.canActivate(ctx('anything'))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws ServiceUnavailable when ADMIN_API_KEY is too short (<16)', () => {
    process.env.ADMIN_API_KEY = 'short';
    const guard = new AdminApiKeyGuard();
    expect(() => guard.canActivate(ctx('short'))).toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws Unauthorized when header is missing', () => {
    process.env.ADMIN_API_KEY = 'a'.repeat(32);
    const guard = new AdminApiKeyGuard();
    expect(() => guard.canActivate(ctx(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when header length differs from secret', () => {
    process.env.ADMIN_API_KEY = 'a'.repeat(32);
    const guard = new AdminApiKeyGuard();
    expect(() => guard.canActivate(ctx('a'.repeat(31)))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws Unauthorized when header value mismatches', () => {
    process.env.ADMIN_API_KEY = 'a'.repeat(32);
    const guard = new AdminApiKeyGuard();
    expect(() => guard.canActivate(ctx('b'.repeat(32)))).toThrow(
      UnauthorizedException,
    );
  });

  it('returns true on exact match', () => {
    const secret = 'a'.repeat(32);
    process.env.ADMIN_API_KEY = secret;
    const guard = new AdminApiKeyGuard();
    expect(guard.canActivate(ctx(secret))).toBe(true);
  });
});
