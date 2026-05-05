import { Test, TestingModule } from '@nestjs/testing';
import { MinVersionController } from './min-version.controller';
import { MinVersionService } from './min-version.service';

describe('MinVersionController', () => {
  const ORIGINAL_ENV = process.env.MIN_SUPPORTED_APP_VERSION;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.MIN_SUPPORTED_APP_VERSION;
    } else {
      process.env.MIN_SUPPORTED_APP_VERSION = ORIGINAL_ENV;
    }
  });

  async function build(): Promise<MinVersionController> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MinVersionController],
      providers: [MinVersionService],
    }).compile();
    return moduleRef.get(MinVersionController);
  }

  it('returns the default version (1.0.0) when MIN_SUPPORTED_APP_VERSION is unset', async () => {
    delete process.env.MIN_SUPPORTED_APP_VERSION;
    const controller = await build();

    expect(controller.getMinVersion()).toEqual({
      success: true,
      data: { minSupportedVersion: '1.0.0' },
    });
  });

  it('returns the env-overridden version when MIN_SUPPORTED_APP_VERSION is set', async () => {
    process.env.MIN_SUPPORTED_APP_VERSION = '1.4.2';
    const controller = await build();

    expect(controller.getMinVersion()).toEqual({
      success: true,
      data: { minSupportedVersion: '1.4.2' },
    });
  });

  it('throws on a malformed MIN_SUPPORTED_APP_VERSION override (fails loud)', async () => {
    process.env.MIN_SUPPORTED_APP_VERSION = 'v1.2'; // not MAJOR.MINOR.PATCH
    await expect(build()).rejects.toThrow(/MIN_SUPPORTED_APP_VERSION/);
  });
});
