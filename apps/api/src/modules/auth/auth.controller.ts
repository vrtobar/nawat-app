import {
  type Logout,
  LogoutSchema,
  type RefreshResponse,
  type RefreshSession,
  RefreshSessionSchema,
  type SessionResponse,
  type StartSession,
  StartSessionSchema,
} from '@nahuat/shared';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { GoogleIdentityService } from './google-identity.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

// THIS IS NOT `POST /auth/role` RETURNING. That endpoint was deleted on
// 2026-08-24 and should stay deleted; every objection in docs/adr/0013 is about
// its trust model, and none of them apply here.
//
//   /auth/role                      /auth/session
//   called by Auth0's servers       called by this project's web app
//   authenticated by a shared       authenticated by an assertion Google
//     secret in a header              signed for this application
//   lived in a dashboard file       ships in this repository
//   denied login on any failure     denies login only when there is genuinely
//                                     no account to serve
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleIdentity: GoogleIdentityService,
    private readonly tokenService: TokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  // Establishes a session from a completed Google sign-in.
  //
  // ⚠️ @Public() BECAUSE THE CALLER HAS NO TOKEN FROM US YET — this endpoint is
  // where they get one. That is not an unauthenticated endpoint: it is
  // authenticated by a different credential, one the global guard cannot check,
  // so the handler checks it as its first act. Every token endpoint in OAuth
  // has this shape for the same reason.
  //
  // It replaces @AllowMissingAccount(), which existed to let a verified caller
  // with no account reach this route while the credential was an Auth0 access
  // token the guard could verify. There is no such token any more, so the
  // decorator has no consumer and was deleted with the strategy.
  //
  // Idempotent. The web callback calls it once per login; calling it again
  // re-syncs the profile, moves lastLoginAt, and opens a NEW session — which is
  // correct, since each sign-in is one.
  @Public()
  @Post('session')
  async startSession(
    @Body(new ZodValidationPipe(StartSessionSchema)) body: StartSession,
  ): Promise<SessionResponse> {
    // Verification first, and nothing before it. Everything below trusts
    // `identity` completely, so it must be the product of Google's signature
    // rather than of the request body.
    const identity = await this.googleIdentity.verify(body.idToken);

    // Creates the account if this subject has never been seen, refuses a
    // deactivated one, and re-syncs the profile otherwise.
    const user = await this.authService.startSession(identity);

    // Deliberately after startSession. Minting first would hand out a working
    // credential and then refuse the login for a deactivated account, leaving
    // a token in the caller's hands that names a user they cannot act as.
    const { accessToken, expiresIn } = await this.tokenService.signAccessToken(identity.sub);
    const refreshToken = await this.refreshTokens.issue(user.id);

    return { user, tokens: { accessToken, refreshToken, expiresIn } };
  }

  // Exchanges a refresh token for a new pair.
  //
  // @Public() for the same reason as the route above, and a sharper one: the
  // caller's access token has very likely expired — that is why they are here.
  // Requiring a valid one would make refresh fail in exactly the case it
  // exists to serve. The refresh token IS the credential, and rotate() is what
  // authenticates it.
  //
  // 200 rather than 201: nothing is created that the caller can address.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body(new ZodValidationPipe(RefreshSessionSchema)) body: RefreshSession,
  ): Promise<RefreshResponse> {
    // Single-use. The presented token is spent by this call, the successor is
    // returned below, and presenting the old one again revokes the session.
    const { subject, refreshToken } = await this.refreshTokens.rotate(body.refreshToken);

    const { accessToken, expiresIn } = await this.tokenService.signAccessToken(subject);

    return { tokens: { accessToken, refreshToken, expiresIn } };
  }

  // Ends this session, and only this one.
  //
  // Takes the refresh token rather than reading the caller's access token,
  // because the access token names a USER and this has to name a SESSION.
  // Signing someone out of every device is a different act and will be a
  // different endpoint; conflating them is how a Log out link ends a session on
  // a phone somebody else is holding.
  //
  // Deliberately succeeds for a token that does not exist. Logging out is not a
  // place to tell a caller whether a credential was real, and what they asked
  // for — that this token stops working — is true either way.
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body(new ZodValidationPipe(LogoutSchema)) body: Logout): Promise<void> {
    // No @HttpCode(204): TransformInterceptor wraps every success in the
    // envelope, and a 204 must carry no body. The same reasoning as the delete
    // routes in the dictionary module.
    await this.refreshTokens.revokeFamily(body.refreshToken);
  }
}
