import { prisma } from '@nahuat/database';
import type { UserProfile } from '@nahuat/shared';
import { Injectable, UnauthorizedException } from '@nestjs/common';

import { LOCALE_TO_WIRE } from '../../common/locale';

@Injectable()
export class UsersService {
  async findProfile(userId: string): Promise<UserProfile> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      // Columns listed explicitly rather than returning the row. auth0Id and
      // deletedAt are not the client's business, and a select-all would start
      // leaking whatever the next migration adds.
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        locale: true,
        username: true,
        pictureUrl: true,
        xp: true,
        streak: true,
        lastActiveAt: true,
        createdAt: true,
        deletedAt: true,
        isActive: true,
      },
    });

    // 401 rather than 404, and the distinction is deliberate.
    //
    // The token asserts this user exists — /auth/role created the row and
    // minted the claims from it. So a missing row means it was hard-deleted
    // after the token was issued, and deletedAt means soft-deleted mid-session.
    // Either way the token is still signed, unexpired and valid; what it
    // describes is no longer true.
    //
    // 404 would read as "no such profile" and invite a retry. 401 tells the
    // client its credentials no longer represent a real user, which is what
    // happened, and prompts re-authentication — where /auth/role refuses a
    // deactivated account outright.
    //
    // This also closes the window where a soft-deleted user keeps working until
    // their token expires. Revoking the Auth0 session prevents a new login but
    // does nothing to a token already issued.
    if (!user || user.deletedAt !== null || !user.isActive) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Session is no longer valid',
      });
    }

    const { deletedAt: _deletedAt, isActive: _isActive, ...profile } = user;

    return {
      ...profile,
      locale: LOCALE_TO_WIRE[profile.locale],
      // Prisma returns Date; the schema declares ISO strings, and the frontend
      // parses them with the same schema it types against.
      lastActiveAt: profile.lastActiveAt?.toISOString() ?? null,
      createdAt: profile.createdAt.toISOString(),
    };
  }
}
