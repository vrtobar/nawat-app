import { prisma } from '@nahuat/database';
import type { AuthRole, SyncUser } from '@nahuat/shared';
import { ForbiddenException, Injectable } from '@nestjs/common';

// Prisma's unique-constraint violation.
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class AuthService {
  // The single write path for User identity. Called once per login by the
  // Auth0 Post Login Action, which then embeds the returned values into the
  // access token as namespaced claims — which is what lets every later request
  // authorize without a database query.
  async syncAndResolveRole(input: SyncUser): Promise<AuthRole> {
    const existing = await prisma.user.findUnique({
      where: { auth0Id: input.auth0Id },
      select: { id: true, role: true, deletedAt: true, isActive: true },
    });

    // Checked before the upsert, so a deactivated account is not quietly
    // refreshed with new profile data on a login it is about to be denied.
    //
    // This closes a real gap: DELETE /users/:id sets deletedAt and revokes the
    // Auth0 session, but revoking a session does not prevent a NEW login.
    // Without this the user would sign in again and receive a working token.
    if (existing && (existing.deletedAt !== null || !existing.isActive)) {
      throw new ForbiddenException({
        code: 'USER_DEACTIVATED',
        message: 'This account has been deactivated',
      });
    }

    if (existing) {
      // Identity fields only. role is never written here — it is set by an
      // admin through the users module, and syncing it from Auth0 would let a
      // login reset someone's privileges.
      const updated = await prisma.user.update({
        where: { auth0Id: input.auth0Id },
        data: {
          email: input.email,
          name: input.name,
          pictureUrl: input.pictureUrl ?? null,
        },
        select: { id: true, role: true },
      });

      return { userId: updated.id, role: updated.role };
    }

    return this.create(input);
  }

  private async create(input: SyncUser): Promise<AuthRole> {
    try {
      const created = await prisma.user.create({
        data: {
          auth0Id: input.auth0Id,
          email: input.email,
          name: input.name,
          pictureUrl: input.pictureUrl ?? null,
        },
        select: { id: true, role: true },
      });

      return { userId: created.id, role: created.role };
    } catch (error) {
      // Two logins for the same new account can both find nothing and both
      // insert. The loser gets P2002; re-reading is correct because the winner
      // wrote exactly what this call would have.
      if (isUniqueViolation(error)) {
        const raced = await prisma.user.findUniqueOrThrow({
          where: { auth0Id: input.auth0Id },
          select: { id: true, role: true },
        });

        return { userId: raced.id, role: raced.role };
      }

      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
