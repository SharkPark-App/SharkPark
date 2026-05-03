/* eslint-disable @typescript-eslint/no-unused-vars */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterPushTokenDto } from './register-push-token.dto';

const valid = { token: 'fcm-abc123', platform: 'ios' };

async function errors(raw: object) {
  return validate(plainToInstance(RegisterPushTokenDto, raw));
}

describe('RegisterPushTokenDto', () => {
  describe('token', () => {
    it('accepts a valid string token', async () => {
      expect(await errors(valid)).toHaveLength(0);
    });

    it('rejects a missing token', async () => {
      const { token: _, ...rest } = valid;
      const errs = await errors(rest);
      expect(errs.some((e) => e.property === 'token')).toBe(true);
    });

    it('rejects a non-string token', async () => {
      const errs = await errors({ ...valid, token: 12345 });
      expect(errs.some((e) => e.property === 'token')).toBe(true);
    });
  });

  describe('platform', () => {
    it('accepts "ios"', async () => {
      expect(await errors({ ...valid, platform: 'ios' })).toHaveLength(0);
    });

    it('accepts "android"', async () => {
      expect(await errors({ ...valid, platform: 'android' })).toHaveLength(0);
    });

    it('rejects an unknown platform', async () => {
      const errs = await errors({ ...valid, platform: 'web' });
      expect(errs.some((e) => e.property === 'platform')).toBe(true);
    });

    it('rejects a missing platform', async () => {
      const { platform: _, ...rest } = valid;
      const errs = await errors(rest);
      expect(errs.some((e) => e.property === 'platform')).toBe(true);
    });
  });
});
