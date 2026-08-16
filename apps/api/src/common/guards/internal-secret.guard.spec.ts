import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { InternalSecretGuard } from './internal-secret.guard';

const SECRET = 'sh-internal-9f2c4a1e';

const attempt = (supplied: string | undefined) => {
  const config = { get: () => SECRET } as unknown as ConfigService<never, true>;
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ header: () => supplied }) }),
  } as never;

  return () => new InternalSecretGuard(config).canActivate(context);
};

describe('InternalSecretGuard', () => {
  it('admits the correct secret', () => {
    expect(attempt(SECRET)()).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(attempt('wrong-secret-same-len')).toThrow(UnauthorizedException);
  });

  it('rejects a missing header', () => {
    expect(attempt(undefined)).toThrow(UnauthorizedException);
  });

  it('rejects a secret of a different length without throwing internally', () => {
    // timingSafeEqual throws on length mismatch, which is why both sides are
    // hashed to a fixed 32 bytes first. Without that, this case would surface
    // as a 500 and leak the expected length through the difference in
    // behaviour.
    expect(attempt('x')).toThrow(UnauthorizedException);
  });

  it('rejects a prefix of the real secret', () => {
    // The case a naive === would answer fastest, letting an attacker recover
    // the secret character by character from response timing.
    expect(attempt(SECRET.slice(0, -1))).toThrow(UnauthorizedException);
  });

  it('gives the same message whether the header is missing or wrong', () => {
    // Distinguishing them tells a prober the header name is correct.
    const message = (run: () => unknown) => {
      try {
        run();
        return 'no throw';
      } catch (error) {
        return (error as UnauthorizedException).getResponse();
      }
    };

    expect(message(attempt(undefined))).toEqual(message(attempt('nope')));
  });
});
