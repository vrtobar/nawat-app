import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

// Registers the JWT strategy so the globally-bound JwtAuthGuard can resolve
// it. No session support: the API is stateless and the Next.js app holds the
// session cookie, so Passport's session serialisation would be dead weight.
//
// No controller. Auth0 called POST /auth/role here until 2026-08-24; identity
// is now resolved from the database on each request by JwtStrategy, so nothing
// external posts to this module and everything a signed-in client needs lives
// under /users.
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt', session: false })],
  providers: [JwtStrategy, AuthService],
})
export class AuthModule {}
