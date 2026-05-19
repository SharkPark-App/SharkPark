/**
 * Tests for the CSULB permit-fee drift cron. Mocks global `fetch` and
 * `Sentry.captureMessage` so this stays a pure unit test — only asserts
 * the job's contract: fetch → hash → compare → Sentry warning on drift,
 * throw on non-200, no-op on hash match.
 */
import * as Sentry from '@sentry/nestjs';

import {
  EXPECTED_PERMIT_SOURCE_HASH_SHA256,
  computePermitSourceHash,
} from '../../lots/permit-fees';

import { CheckPermitFeeDriftJob } from './check-permit-fee-drift.job';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
}));

// Mock the permit-fees module so we can control what
// `computePermitSourceHash` returns from the job's perspective, letting
// us exercise both the "unchanged" and "drift" branches deterministically.
jest.mock('../../lots/permit-fees', () => {
  const actual = jest.requireActual('../../lots/permit-fees');
  return {
    ...actual,
    computePermitSourceHash: jest.fn(actual.computePermitSourceHash),
  };
});

const mockedHash = computePermitSourceHash as jest.MockedFunction<
  typeof computePermitSourceHash
>;

type RunnerLike = {
  run: jest.Mock<Promise<unknown>, [string, () => Promise<unknown>]>;
};

function makeRunner(): RunnerLike {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<unknown>) => work()),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

function stubFetchReturning(body: string, ok = true, status = 200): void {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => body,
  }) as unknown as typeof fetch;
}

describe('CheckPermitFeeDriftJob', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    (Sentry.captureMessage as jest.Mock).mockReset();
    mockedHash.mockReset();
    // Default: pass through to the real implementation
    mockedHash.mockImplementation(
      jest.requireActual('../../lots/permit-fees').computePermitSourceHash,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('is a no-op when the page hash matches the baseline', async () => {
    stubFetchReturning('<html><body><p>anything</p></body></html>');
    mockedHash.mockReturnValue(EXPECTED_PERMIT_SOURCE_HASH_SHA256);

    const job = new CheckPermitFeeDriftJob(makeRunner() as never, makeLogger());
    await job.handle();

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('fires a Sentry warning when the page hash diverges from the baseline', async () => {
    stubFetchReturning('<html><body><p>changed</p></body></html>');
    mockedHash.mockReturnValue('a'.repeat(64));

    const job = new CheckPermitFeeDriftJob(makeRunner() as never, makeLogger());
    await job.handle();

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, opts] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(message).toMatch(/CSULB permit-information page changed/);
    expect(opts).toMatchObject({
      level: 'warning',
      tags: { cron: 'check-permit-fee-drift' },
      extra: expect.objectContaining({
        expected_hash: EXPECTED_PERMIT_SOURCE_HASH_SHA256,
        actual_hash: 'a'.repeat(64),
      }),
    });
  });

  it('throws when the source URL returns a non-2xx response', async () => {
    stubFetchReturning('', false, 503);

    const job = new CheckPermitFeeDriftJob(makeRunner() as never, makeLogger());

    await expect(job.handle()).rejects.toThrow(/503/);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('wraps execution in CronRunnerService with the correct name', async () => {
    stubFetchReturning('<html><body><p>x</p></body></html>');
    mockedHash.mockReturnValue(EXPECTED_PERMIT_SOURCE_HASH_SHA256);

    const runner = makeRunner();
    const job = new CheckPermitFeeDriftJob(runner as never, makeLogger());
    await job.handle();

    expect(runner.run).toHaveBeenCalledWith(
      'check-permit-fee-drift',
      expect.any(Function),
    );
  });
});

describe('computePermitSourceHash (real)', () => {
  // Bypass the module-level mock above by re-importing the real impl.
  const realHash = jest.requireActual('../../lots/permit-fees')
    .computePermitSourceHash as typeof computePermitSourceHash;

  it('is stable across whitespace reformatting', () => {
    const a = '<main><p>Daily: $15</p>   <p>Evening: $10</p></main>';
    const b = '<main>\n  <p>Daily:   $15</p>\n\n\n<p>Evening: $10</p>\n</main>';
    expect(realHash(a)).toBe(realHash(b));
  });

  it('ignores <script>, <style>, <svg>, and HTML comments', () => {
    const bare = '<main><p>Daily: $15</p></main>';
    const noisy = `<main>
      <script>analytics.push({cacheBuster: 'abc-${Date.now()}'});</script>
      <style>.x { color: red; }</style>
      <svg><circle r="1"/></svg>
      <!-- build id ${Math.random()} -->
      <p>Daily: $15</p>
    </main>`;
    expect(realHash(bare)).toBe(realHash(noisy));
  });

  it('changes when meaningful content changes', () => {
    const before = '<main><p>Daily: $15</p></main>';
    const after = '<main><p>Daily: $20</p></main>';
    expect(realHash(before)).not.toBe(realHash(after));
  });

  it('falls back to <body> when <main> is absent', () => {
    const noMain = '<html><body><p>Daily: $15</p></body></html>';
    expect(realHash(noMain)).toMatch(/^[0-9a-f]{64}$/);
  });
});
