import type { JwtClaims, Role } from '@nahuat/shared';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';

// Rank, not set membership. Each role can do everything the one below it can:
//
//   USER         published content only
//   CONTRIBUTOR  + read, create and edit unpublished content
//   ADMIN        + publish, manage users, destructive operations
//
// So @Roles('CONTRIBUTOR') admits ADMIN without listing it, and ADMIN passes
// every check by construction rather than by special case.
//
// This holds only while the ladder does. A future role that is not a superset
// — someone who edits translations but not lesson structure — breaks ranking
// and needs capabilities instead. Three linear roles is well inside where ranks
// are the simpler answer.
const RANK: Record<Role, number> = {
  USER: 0,
  CONTRIBUTOR: 1,
  ADMIN: 2,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles means authentication alone is enough. JwtAuthGuard has already
    // run — this guard never decides whether someone is authenticated.
    if (required === undefined) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: JwtClaims }>().user;

    // A @Roles route with no user means @Public and @Roles were combined,
    // which is a contradiction: nobody unauthenticated can hold a role.
    // Failing closed turns that mistake into a 403 rather than a crash on
    // undefined.
    if (!user) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
    }

    if (RANK[user.role] < RANK[required]) {
      // The required role is deliberately not disclosed. It tells an
      // unprivileged caller how the permission model is shaped, and the client
      // cannot act on it — a USER learning an endpoint needs ADMIN gains
      // nothing but a map.
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
    }

    return true;
  }
}
