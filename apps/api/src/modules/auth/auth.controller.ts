import type { UserProfile } from '@nahuat/shared';
import { Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';

import { AllowMissingAccount } from '../../common/decorators/allow-missing-account.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';

// THIS IS NOT `POST /auth/role` RETURNING. That endpoint was deleted on
// 2026-08-24 and should stay deleted; every objection in docs/adr/0013 is about
// its trust model, and none of them apply here.
//
//   /auth/role                      /auth/session
//   called by Auth0's servers       called by this project's web app
//   before any token existed        after authentication, by the token holder
//   authenticated by a shared       authenticated by the caller's own JWT,
//     secret in a header              through the global guard
//   lived in a dashboard file       ships in this repository
//   denied login on any failure     denies login only when there is genuinely
//                                     no account to serve
//
// What it restores is the thing the Action was actually right about: an
// account exists because someone logged in, at the moment they logged in.
// Between the Action's deletion and this, accounts were created lazily by
// JwtStrategy on the first authenticated request, which was residue from that
// reversal rather than a decision — ADR 13 never argued for it. That left
// "logged in" and "has an account" as separable states, and let a hard-deleted
// user silently reappear.
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Idempotent. The web callback calls it once per login; calling it again
  // re-syncs the profile and moves lastLoginAt, which is harmless.
  //
  // Returns the same shape as GET /users/me so the caller needs no second
  // request to learn who they are, and no second schema to parse it with.
  @AllowMissingAccount()
  @Post('session')
  async startSession(
    @Req() req: Request,
    @CurrentUser() user: { sub: string },
  ): Promise<UserProfile> {
    // The subject comes from the verified token via the guard, never from the
    // body — a caller must not be able to name whose account to create.
    //
    // The raw token is read back off the request because /userinfo takes it as
    // the credential. Same extractor the strategy was configured with, so this
    // is the token that was actually verified rather than a re-derivation.
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (token === null) {
      // Unreachable — the guard extracted a token to get here — but typed as
      // nullable, and an empty string would send a credential-less request to
      // Auth0.
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    return this.authService.startSession(user.sub, token);
  }
}
