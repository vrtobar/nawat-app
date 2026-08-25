import { prisma } from '@nahuat/database';
import type { UserProfile } from '@nahuat/shared';
import { Injectable, UnauthorizedException } from '@nestjs/common';

import { toUserProfile, USER_PROFILE_SELECT } from '../../common/user-profile';

@Injectable()
export class UsersService {
  async findProfile(userId: string): Promise<UserProfile> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      // Columns listed explicitly rather than returning the row. auth0Id and
      // deletedAt are not the client's business, and a select-all would start
      // leaking whatever the next migration adds.
      select: { ...USER_PROFILE_SELECT, deletedAt: true, isActive: true },
    });

    // 401 rather than 404, and the distinction is deliberate.
    //
    // JwtStrategy resolved this user from the database moments ago, so a
    // missing row here means it was hard-deleted between the auth lookup and
    // this query, and deletedAt means soft-deleted in the same window. Either
    // way the token is still signed, unexpired and valid; what it describes is
    // no longer true. (Before 2026-08-24 the window was much wider: the claims
    // were minted at login and the row was not re-read on the way in.)
    //
    // 404 would read as "no such profile" and invite a retry. 401 tells the
    // client its credentials no longer represent a real user, which is what
    // happened, and prompts re-authentication.
    //
    // Since 2026-08-24 this is a second line rather than the mechanism:
    // AuthService.resolveIdentity() refuses a soft-deleted or inactive account
    // on every authenticated request, so the window this once closed on its own
    // is now closed globally. It is kept for the hard-delete case above, which
    // that check cannot see — a row that vanished has no isActive to read.
    if (!user || user.deletedAt !== null || !user.isActive) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Session is no longer valid',
      });
    }

    const { deletedAt: _deletedAt, isActive: _isActive, ...profile } = user;

    // Shared with POST /auth/session, which returns the same shape. The mapper
    // handles Date -> ISO and the database Locale enum -> its wire form.
    return toUserProfile(profile);
  }
}
