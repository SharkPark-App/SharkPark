import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { setImmediate } from 'node:timers';
import { gzipSync } from 'node:zlib';

jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

// A tiny but VALID gzip payload — empty Readables crash the gunzip pipeline
// with Z_BUF_ERROR before pg_restore's exit handler can resolve.
const VALID_GZIP_CHUNK = gzipSync(Buffer.from('PGDMP-fake-toc'));

const mockSend = jest.fn();
const MockS3Ctor = jest.fn().mockImplementation(() => ({ send: mockSend }));
const MockListCmd = jest.fn().mockImplementation((input) => ({ __cmd: 'list', input }));
const MockGetCmd = jest.fn().mockImplementation((input) => ({ __cmd: 'get', input }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: MockS3Ctor,
  ListObjectsV2Command: MockListCmd,
  GetObjectCommand: MockGetCmd,
}));

const mockSpawn = jest.fn();
jest.mock('node:child_process', () => ({ spawn: mockSpawn }));

import { runCronJob } from './_bootstrap';
import './verify-latest-backup';

type WorkFn = (ctx: { logger: { log: jest.Mock } }) => Promise<void>;

const REQUIRED_ENV = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'ak',
  R2_SECRET_ACCESS_KEY: 'sk',
  R2_BACKUPS_BUCKET: 'bucket',
};

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function makePgRestore(exitCode = 0, listingLines = 100) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    stdin: PassThrough;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  setImmediate(() => {
    if (listingLines > 0) {
      (proc.stdout as PassThrough).write('a\n'.repeat(listingLines));
    }
    (proc.stdout as PassThrough).end();
    // Drain stdin so the upstream pipe doesn't hang
    proc.stdin.resume();
    proc.emit('exit', exitCode);
  });
  return proc;
}

describe('verify-latest-backup cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];
  const work = call[2] as WorkFn;
  const original = { ...process.env };

  beforeEach(() => {
    mockSpawn.mockReset();
    mockSend.mockReset();
    MockS3Ctor.mockClear();
    MockListCmd.mockClear();
    MockGetCmd.mockClear();
    setEnv(REQUIRED_ENV);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('registers as verify-latest-backup with no extra feature modules', () => {
    expect(call[0]).toBe('verify-latest-backup');
    expect(call[1]).toEqual([]);
  });

  it.each(Object.keys(REQUIRED_ENV))('throws when %s is missing', async (key) => {
    setEnv({ [key]: undefined });
    await expect(work({ logger: { log: jest.fn() } })).rejects.toThrow(/missing/);
  });

  it('throws when the bucket is empty', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [] });
    await expect(work({ logger: { log: jest.fn() } })).rejects.toThrow(
      /no objects under r2:/,
    );
  });

  it('throws when the newest backup is older than the staleness threshold', async () => {
    const stale = new Date(Date.now() - 30 * 3600 * 1000); // 30h ago, > 26h
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'daily/old.dump.gz', LastModified: stale, Size: 1 }],
    });
    await expect(work({ logger: { log: jest.fn() } })).rejects.toThrow(
      /is .* old \(>26h\)/,
    );
  });

  it('downloads the newest backup and runs pg_restore --list', async () => {
    const fresh = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    mockSend
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'daily/older.dump.gz', LastModified: new Date(0), Size: 1 },
          { Key: 'daily/newer.dump.gz', LastModified: fresh, Size: 4096 },
        ],
      })
      .mockResolvedValueOnce({ Body: Readable.from([VALID_GZIP_CHUNK]) });

    mockSpawn.mockReturnValue(makePgRestore(0, 50));
    const logger = { log: jest.fn() };

    await work({ logger });

    expect(MockGetCmd).toHaveBeenCalledWith(
      expect.objectContaining({ Key: 'daily/newer.dump.gz' }),
    );
    expect(mockSpawn).toHaveBeenCalledWith('pg_restore', ['--list'], expect.any(Object));
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('OK — daily/newer.dump.gz parsed cleanly'),
    );
  });

  it('throws when pg_restore --list exits non-zero', async () => {
    const fresh = new Date(Date.now() - 60 * 60 * 1000);
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: 'daily/x.dump.gz', LastModified: fresh, Size: 1 }],
      })
      .mockResolvedValueOnce({ Body: Readable.from([VALID_GZIP_CHUNK]) });
    mockSpawn.mockReturnValue(makePgRestore(2, 0));

    await expect(work({ logger: { log: jest.fn() } })).rejects.toThrow(
      /pg_restore --list exited 2/,
    );
  });
});
