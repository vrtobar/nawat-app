import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { JwtStrategy } from './jwt.strategy';

// Registers the JWT strategy so the globally-bound JwtAuthGuard can resolve
// it. No session support: the API is stateless and the Next.js app holds the
// session cookie, so Passport's session serialisation would be dead weight.
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt', session: false })],
  providers: [JwtStrategy],
})
export class AuthModule {}
