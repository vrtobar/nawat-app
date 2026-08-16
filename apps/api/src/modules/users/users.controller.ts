import type { JwtClaims, UserProfile } from '@nahuat/shared';
import { Controller, Get } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

// The first genuinely protected controller. No @Public(), so the global
// JwtAuthGuard applies — a request without a valid Auth0 token never reaches
// these handlers.
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // The profile the token cannot carry. A JWT holds role and userId, which are
  // stable for a session; xp, streak and lastActiveAt change after every lesson
  // and would be stale the moment they were minted.
  //
  // No @Roles: every authenticated user may read their own profile, and the id
  // comes from the token rather than the path, so there is nothing to
  // authorize beyond being signed in.
  @Get('me')
  me(@CurrentUser() user: JwtClaims): Promise<UserProfile> {
    return this.usersService.findProfile(user.userId);
  }
}
