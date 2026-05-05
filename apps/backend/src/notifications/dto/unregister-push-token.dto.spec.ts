/* eslint-disable @typescript-eslint/no-unused-vars */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UnregisterPushTokenDto } from './unregister-push-token.dto';

const valid = { token: 'fcm-abc123' };

async function errors(raw: object) {
  return validate(plainToInstance(UnregisterPushTokenDto, raw));
}

describe('UnregisterPushTokenDto', () => {
  it('accepts a valid string token', async () => {
    expect(await errors(valid)).toHaveLength(0);
  });

  it('rejects a missing token', async () => {
    const { token: _, ...rest } = valid;
    const errs = await errors(rest);
    expect(errs.some((e) => e.property === 'token')).toBe(true);
  });

  it('rejects a non-string token', async () => {
    const errs = await errors({ token: 12345 });
    expect(errs.some((e) => e.property === 'token')).toBe(true);
  });
});
