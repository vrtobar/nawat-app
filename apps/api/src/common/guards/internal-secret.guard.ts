import { createHash, timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../../config/env.validation';

export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

// Guards the one endpoint a JWT cannot protect. POST /auth/role is called by
// the Auth0 Post Login Action mid-login, before any token exists, so the only
// thing available is a secret shared between Auth0's Action secrets and AWS
// Secrets Manager.
//
// Worth being clear that this is a different mechanism from JWT verification,
// which uses no shared secret at all — Auth0 signs with its private key and
// this service verifies with the public one. Compromise of the value here does
// not let anyone mint a token; it lets them call this endpoint.
@Injectable()
export class InternalSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const supplied = context.switchToHttp().getRequest<Request>().header(INTERNAL_SECRET_HEADER);
    const expected = this.config.get('INTERNAL_SECRET', { infer: true });

    if (supplied === undefined || !matches(supplied, expected)) {
      // Same message either way. Distinguishing "missing" from "wrong" tells a
      // prober whether the header name is right, which is the first thing they
      // would want to know.
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid internal credentials',
      });
    }

    return true;
  }
}

// Constant-time, and hashed first for two reasons. timingSafeEqual throws when
// its inputs differ in length, so comparing raw strings would leak the secret's
// length through an exception; and digests are always 32 bytes, which makes the
// comparison itself uniform.
//
// A plain === would return as soon as two bytes differ, letting an attacker
// recover the secret one character at a time from response timing.
function matches(supplied: string, expected: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();

  return timingSafeEqual(a, b);
}
