import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

// Registers the JWT strategy so the globally-bound JwtAuthGuard can resolve
// it. No session support: the API is stateless and the Next.js app holds the
// session cookie, so Passport's session serialisation would be dead weight.
//
// One controller, POST /auth/session, called by this project's own web app
// after a login completes. See auth.controller.ts for why that is not the
// deleted POST /auth/role returning under a new name.
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt', session: false })],
  controllers: [AuthController],
  // TokenService imports the signing key set in onModuleInit, so a malformed
  // JWT_SIGNING_KEYS fails the boot rather than the first login — the same
  // contract env.validation.ts gives every other setting.
  providers: [JwtStrategy, AuthService, TokenService, RefreshTokenService],
  // JwtAuthGuard is bound globally in AppModule and resolves identity, so it
  // needs this service.
  exports: [AuthService, TokenService, RefreshTokenService],
})
export class AuthModule {}
