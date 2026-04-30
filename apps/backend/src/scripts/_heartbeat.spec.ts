import { heartbeatEnvKey, pingHeartbeat } from './_heartbeat';

describe('heartbeatEnvKey', () => {
  it('upper-snake-cases the job name', () => {
    expect(heartbeatEnvKey('snapshot')).toBe('BETTERSTACK_HEARTBEAT_SNAPSHOT');
    expect(heartbeatEnvKey('fetch-weather')).toBe(
      'BETTERSTACK_HEARTBEAT_FETCH_WEATHER',
    );
    expect(heartbeatEnvKey('verify-latest-backup')).toBe(
      'BETTERSTACK_HEARTBEAT_VERIFY_LATEST_BACKUP',
    );
  });
});

describe('pingHeartbeat', () => {
  const ENV_KEY = 'BETTERSTACK_HEARTBEAT_TEST_JOB';
  const URL = 'https://uptime.betterstack.com/api/v1/heartbeat/test-token';
  let originalFetch: typeof globalThis.fetch;
  let logger: { log: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    logger = { log: jest.fn(), warn: jest.fn() };
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env[ENV_KEY];
  });

  it('no-ops and logs when env var is unset', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await pingHeartbeat('test-job', logger);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat skipped'),
    );
  });

  it('GETs the heartbeat URL when env var is set', async () => {
    process.env[ENV_KEY] = URL;
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await pingHeartbeat('test-job', logger);

    expect(fetchMock).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat sent'),
    );
  });

  it('logs a warning but does not throw on non-2xx response', async () => {
    process.env[ENV_KEY] = URL;
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(pingHeartbeat('test-job', logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 500'),
    );
  });

  it('logs a warning but does not throw on network error', async () => {
    process.env[ENV_KEY] = URL;
    const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(pingHeartbeat('test-job', logger)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ECONNRESET'),
    );
  });

  it('works without a logger argument', async () => {
    process.env[ENV_KEY] = URL;
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await expect(pingHeartbeat('test-job')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });
});
