import { Test, TestingModule } from '@nestjs/testing';
import { MinVersionController } from './min-version.controller';
import { MinVersionService } from './min-version.service';

describe('MinVersionController', () => {
  const ENV_VARS = [
    'MIN_SUPPORTED_APP_VERSION',
    'MIN_SUPPORTED_APP_VERSION_IOS',
    'MIN_SUPPORTED_APP_VERSION_ANDROID',
  ] as const;
  const ORIGINAL: Partial<Record<(typeof ENV_VARS)[number], string>> = {};
  for (const k of ENV_VARS) ORIGINAL[k] = process.env[k];

  beforeEach(() => {
    for (const k of ENV_VARS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_VARS) {
      if (ORIGINAL[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = ORIGINAL[k];
      }
    }
  });

  async function build(): Promise<MinVersionController> {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MinVersionController],
      providers: [MinVersionService],
    }).compile();
    return moduleRef.get(MinVersionController);
  }

  describe('global floor', () => {
    it('returns the default version (1.0.0) when no env vars are set', async () => {
      const controller = await build();

      expect(controller.getMinVersion()).toEqual({
        success: true,
        data: { minSupportedVersion: '1.0.0' },
      });
    });

    it('returns the global override when MIN_SUPPORTED_APP_VERSION is set', async () => {
      process.env.MIN_SUPPORTED_APP_VERSION = '1.4.2';
      const controller = await build();

      expect(controller.getMinVersion('ios')).toEqual({
        success: true,
        data: { minSupportedVersion: '1.4.2' },
      });
      expect(controller.getMinVersion('android')).toEqual({
        success: true,
        data: { minSupportedVersion: '1.4.2' },
      });
    });

    it('throws on a malformed MIN_SUPPORTED_APP_VERSION override (fails loud)', async () => {
      process.env.MIN_SUPPORTED_APP_VERSION = 'v1.2'; // not MAJOR.MINOR.PATCH
      await expect(build()).rejects.toThrow(/MIN_SUPPORTED_APP_VERSION/);
    });
  });

  describe('per-platform floors', () => {
    it('returns the iOS-specific floor when x-platform: ios', async () => {
      process.env.MIN_SUPPORTED_APP_VERSION = '1.0.0';
      process.env.MIN_SUPPORTED_APP_VERSION_IOS = '1.2.0';
      process.env.MIN_SUPPORTED_APP_VERSION_ANDROID = '1.1.0';
      const controller = await build();

      expect(controller.getMinVersion('ios').data.minSupportedVersion).toBe('1.2.0');
    });

    it('returns the Android-specific floor when x-platform: android', async () => {
      process.env.MIN_SUPPORTED_APP_VERSION = '1.0.0';
      process.env.MIN_SUPPORTED_APP_VERSION_IOS = '1.2.0';
      process.env.MIN_SUPPORTED_APP_VERSION_ANDROID = '1.1.0';
      const controller = await build();

      expect(controller.getMinVersion('android').data.minSupportedVersion).toBe('1.1.0');
    });

    it('normalises x-platform case (IOS / Android)', async () => {
      process.env.MIN_SUPPORTED_APP_VERSION_IOS = '1.2.0';
      const controller = await build();

      expect(controller.getMinVersion('IOS').data.minSupportedVersion).toBe('1.2.0');
      expect(controller.getMinVersion('Android').data.minSupportedVersion).toBe('1.0.0');
    });

    it('falls back to global when only one platform-specific override is set', async () => {
      process.env.MIN_SUPPORTED_APP_VERSION = '1.5.0';
      process.env.MIN_SUPPORTED_APP_VERSION_IOS = '1.7.0';
      // No _ANDROID override
      const controller = await build();

      expect(controller.getMinVersion('ios').data.minSupportedVersion).toBe('1.7.0');
      expect(controller.getMinVersion('android').data.minSupportedVersion).toBe('1.5.0');
    });

    it('falls back to global when x-platform is missing or unknown', async () => {
      process.env.MIN_SUPPORTED_APP_VERSION = '1.5.0';
      process.env.MIN_SUPPORTED_APP_VERSION_IOS = '1.7.0';
      const controller = await build();

      // Old client (no header) — must not get the iOS-only floor.
      expect(controller.getMinVersion(undefined).data.minSupportedVersion).toBe('1.5.0');
      expect(controller.getMinVersion('').data.minSupportedVersion).toBe('1.5.0');
      expect(controller.getMinVersion('web').data.minSupportedVersion).toBe('1.5.0');
      expect(controller.getMinVersion('windows').data.minSupportedVersion).toBe('1.5.0');
    });

    it.each([
      ['MIN_SUPPORTED_APP_VERSION_IOS', 'foo'],
      ['MIN_SUPPORTED_APP_VERSION_ANDROID', '1.2'],
    ])('throws on a malformed %s override (fails loud)', async (envName, badValue) => {
      process.env[envName] = badValue;
      await expect(build()).rejects.toThrow(new RegExp(envName));
    });
  });
});
