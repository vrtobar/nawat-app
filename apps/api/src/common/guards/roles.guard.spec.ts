import type { JwtClaims, Role } from '@nahuat/shared';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { RolesGuard } from './roles.guard';

const check = (required: Role | undefined, role: Role | undefined) => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const user = role === undefined ? undefined : ({ role } as JwtClaims);

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;

  return () => new RolesGuard(reflector).canActivate(context);
};

describe('RolesGuard', () => {
  it('allows a route with no @Roles', () => {
    // Authentication alone is enough; JwtAuthGuard already ran.
    expect(check(undefined, 'USER')()).toBe(true);
  });

  it.each<[Role, Role]>([
    ['USER', 'USER'],
    ['USER', 'CONTRIBUTOR'],
    ['CONTRIBUTOR', 'CONTRIBUTOR'],
    ['CONTRIBUTOR', 'ADMIN'],
    ['ADMIN', 'ADMIN'],
  ])('admits %s-or-above when the user is %s', (required, role) => {
    expect(check(required, role)()).toBe(true);
  });

  it.each<[Role, Role]>([
    ['CONTRIBUTOR', 'USER'],
    ['ADMIN', 'USER'],
    ['ADMIN', 'CONTRIBUTOR'],
  ])('rejects %s-or-above when the user is only %s', (required, role) => {
    expect(check(required, role)).toThrow(ForbiddenException);
  });

  it('lets ADMIN through every check without listing it', () => {
    // The property the ladder exists for: no endpoint needs @Roles('ADMIN')
    // added alongside another role.
    const roles: Role[] = ['USER', 'CONTRIBUTOR', 'ADMIN'];
    for (const required of roles) {
      expect(check(required, 'ADMIN')()).toBe(true);
    }
  });

  it('fails closed when @Roles is combined with @Public', () => {
    // A contradiction — nobody unauthenticated holds a role. Without this the
    // guard would read .role off undefined and 500.
    expect(check('ADMIN', undefined)).toThrow(ForbiddenException);
  });

  it('does not disclose the required role', () => {
    // Telling a USER that an endpoint needs ADMIN maps the permission model
    // for them and gives the client nothing it can act on.
    try {
      check('ADMIN', 'USER')();
      expect.unreachable('should have thrown');
    } catch (error) {
      const payload = (error as ForbiddenException).getResponse();
      expect(payload).toEqual({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
      expect(JSON.stringify(payload)).not.toContain('ADMIN');
    }
  });
});
