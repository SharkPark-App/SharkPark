import { lockKey, withAdvisoryLock } from './_advisory-lock';

interface FakeClient {
  query: jest.Mock;
  release: jest.Mock;
}

function makeClient(): FakeClient {
  return {
    query: jest.fn(),
    release: jest.fn(),
  };
}

function makePool(client: FakeClient) {
  return {
    connect: jest.fn().mockResolvedValue(client),
  };
}

describe('lockKey', () => {
  it('is deterministic for the same name', () => {
    expect(lockKey('snapshot')).toBe(lockKey('snapshot'));
  });

  it('produces different keys for different names', () => {
    expect(lockKey('snapshot')).not.toBe(lockKey('cleanup-device-states'));
    expect(lockKey('cleanup-device-states')).not.toBe(lockKey('fetch-weather'));
  });

  it('returns a bigint within int64 range', () => {
    const k = lockKey('snapshot');
    expect(typeof k).toBe('bigint');
    expect(k).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(k).toBeLessThan(2n ** 63n);
  });
});

describe('withAdvisoryLock', () => {
  it('runs the work and releases the lock when acquired', async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ acquired: true }] }) // pg_try_advisory_lock
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }); // unlock
    const pool = makePool(client);
    const work = jest.fn().mockResolvedValue('result-value');

    const outcome = await withAdvisoryLock(pool as never, 'job-a', work);

    expect(outcome).toEqual({ acquired: true, result: 'result-value' });
    expect(work).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [lockKey('job-a').toString()],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1::bigint)',
      [lockKey('job-a').toString()],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('skips the work and does not unlock when lock is busy', async () => {
    const client = makeClient();
    client.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const pool = makePool(client);
    const work = jest.fn();

    const outcome = await withAdvisoryLock(pool as never, 'job-b', work);

    expect(outcome).toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    // Only the lock-attempt query, no unlock call.
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases the lock and the client even when work throws', async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });
    const pool = makePool(client);
    const boom = new Error('work blew up');
    const work = jest.fn().mockRejectedValue(boom);

    await expect(withAdvisoryLock(pool as never, 'job-c', work)).rejects.toThrow(
      'work blew up',
    );

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock($1::bigint)',
      [lockKey('job-c').toString()],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('still releases the client if unlock itself fails', async () => {
    const client = makeClient();
    client.query
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockRejectedValueOnce(new Error('unlock failed'));
    const pool = makePool(client);
    const work = jest.fn().mockResolvedValue('ok');

    const outcome = await withAdvisoryLock(pool as never, 'job-d', work);

    expect(outcome).toEqual({ acquired: true, result: 'ok' });
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
