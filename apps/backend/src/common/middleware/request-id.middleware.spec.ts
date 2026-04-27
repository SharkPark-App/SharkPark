import type { Request, Response } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let setHeader: jest.Mock;
  let res: Response;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    setHeader = jest.fn();
    res = { setHeader } as unknown as Response;
    next = jest.fn();
  });

  const buildReq = (headers: Record<string, string | undefined>) =>
    ({ headers } as unknown as Request);

  it('uses cf-ray header when present', () => {
    const req = buildReq({ 'cf-ray': '8a1b2c3d4e5f6789-LAX' });
    middleware.use(req, res, next);

    expect((req as Request & { id: string }).id).toBe('8a1b2c3d4e5f6789-LAX');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', '8a1b2c3d4e5f6789-LAX');
    expect(next).toHaveBeenCalled();
  });

  it('falls back to x-request-id when cf-ray missing', () => {
    const req = buildReq({ 'x-request-id': 'caller-supplied-123' });
    middleware.use(req, res, next);

    expect((req as Request & { id: string }).id).toBe('caller-supplied-123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'caller-supplied-123');
  });

  it('cf-ray takes precedence over x-request-id', () => {
    const req = buildReq({
      'cf-ray': 'cf-id',
      'x-request-id': 'caller-id',
    });
    middleware.use(req, res, next);
    expect((req as Request & { id: string }).id).toBe('cf-id');
  });

  it('generates a uuid when no header present', () => {
    const req = buildReq({});
    middleware.use(req, res, next);

    const id = (req as Request & { id: string }).id;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });

  it('treats empty/whitespace header as missing', () => {
    const req = buildReq({ 'cf-ray': '   ' });
    middleware.use(req, res, next);

    const id = (req as Request & { id: string }).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
