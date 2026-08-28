import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleIdentityService } from './google-identity.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

// NO PassportModule, and no strategy. This API verifies its own access tokens
// with jose, in TokenService, and JwtAuthGuard calls it directly.
//
// What passport provided was a strategy/guard split forced by one of its own
// limitations: a strategy cannot see which route it is authenticating, which is
// why verification and identity resolution had to live in different classes.
// Without it the guard does both and can see the route while doing so — so the
// separation that split protected is no longer something to protect.
//
// TokenService imports the signing key set in onModuleInit, so a malformed
// JWT_SIGNING_KEYS fails the boot rather than the first login — the same
// contract env.validation.ts gives every other setting.
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, RefreshTokenService, GoogleIdentityService],
  // JwtAuthGuard is bound globally in AppModule and needs both: TokenService to
  // verify, AuthService to resolve.
  exports: [AuthService, TokenService, RefreshTokenService, GoogleIdentityService],
})
export class AuthModule {}
