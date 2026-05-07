import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { setImmediate } from 'node:timers';
import { gzipSync } from 'node:zlib';

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

import { VerifyLatestBackupJob } from './verify-latest-backup.job';

const REQUIRED_ENV = {
  R2_ACCOUNT_ID: 'acct',
  BACKUP_R2_ACCESS_KEY_ID: 'ak',
  BACKUP_R2_SECRET_ACCESS_KEY: 'sk',
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
    proc.stdin.resume();
    proc.emit('exit', exitCode);
  });
  return proc;
}

function makeRunner() {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<void>) => {
      await work();
    }),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

describe('VerifyLatestBackupJob', () => {
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

  it.each(Object.keys(REQUIRED_ENV))('throws when %s is missing', async (key) => {
    setEnv({ [key]: undefined });
    const job = new VerifyLatestBackupJob(makeRunner() as never, makeLogger());
    await expect(job.handle()).rejects.toThrow(/missing/);
  });

  it('throws when the bucket is empty', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [] });
    const job = new VerifyLatestBackupJob(makeRunner() as never, makeLogger());
    await expect(job.handle()).rejects.toThrow(/no objects under r2:/);
  });

  it('throws when the newest backup is older than the staleness threshold', async () => {
    const stale = new Date(Date.now() - 30 * 3600 * 1000);
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'daily/old.dump.gz', LastModified: stale, Size: 1 }],
    });
    const job = new VerifyLatestBackupJob(makeRunner() as never, makeLogger());
    await expect(job.handle()).rejects.toThrow(/is .* old \(>26h\)/);
  });

  it('downloads the newest backup and runs pg_restore --list', async () => {
    const fresh = new Date(Date.now() - 60 * 60 * 1000);
    mockSend
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'daily/older.dump.gz', LastModified: new Date(0), Size: 1 },
          { Key: 'daily/newer.dump.gz', LastModified: fresh, Size: 4096 },
        ],
      })
      .mockResolvedValueOnce({ Body: Readable.from([VALID_GZIP_CHUNK]) });

    mockSpawn.mockReturnValue(makePgRestore(0, 50));
    const job = new VerifyLatestBackupJob(makeRunner() as never, makeLogger());

    await job.handle();

    expect(MockGetCmd).toHaveBeenCalledWith(
      expect.objectContaining({ Key: 'daily/newer.dump.gz' }),
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'pg_restore',
      ['--list'],
      expect.any(Object),
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
    const job = new VerifyLatestBackupJob(makeRunner() as never, makeLogger());

    await expect(job.handle()).rejects.toThrow(/pg_restore --list exited 2/);
  });
});
