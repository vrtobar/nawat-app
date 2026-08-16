import { type AuthRole, type SyncUser, SyncUserSchema } from '@nahuat/shared';
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { InternalSecretGuard } from '../../common/guards/internal-secret.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

// The only route Auth0 itself calls. Everything a signed-in client needs lives
// under /users — there is no /auth/me, because once this endpoint stopped
// upserting it would have been identical to GET /users/me.
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // @Public() so the global JwtAuthGuard stands aside — no token exists yet,
  // this call is what produces the claims one will carry. InternalSecretGuard
  // then applies, so the route is not actually public: route-level guards run
  // after the global ones.
  @Public()
  @UseGuards(InternalSecretGuard)
  @Post('role')
  // 200 rather than the POST default of 201: the caller receives a role, not a
  // location, and whether a row was created is an implementation detail of a
  // login it should not have to interpret.
  @HttpCode(HttpStatus.OK)
  syncRole(@Body(new ZodValidationPipe(SyncUserSchema)) body: SyncUser): Promise<AuthRole> {
    return this.authService.syncAndResolveRole(body);
  }
}
