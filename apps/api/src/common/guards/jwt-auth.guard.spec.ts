import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { JwtAuthGuard } from './jwt-auth.guard';

const guardWith = (isPublic: boolean) => {
  const getAllAndOverride = vi.fn().mockReturnValue(isPublic);
  const guard = new JwtAuthGuard({ getAllAndOverride } as unknown as Reflector);
  return { guard, getAllAndOverride };
};

const context = {
  getHandler: () => undefined,
  getClass: () => undefined,
} as never;

describe('JwtAuthGuard', () => {
  it('lets a @Public route through without authenticating', () => {
    // The ECS probe carries no credentials. If this regresses, the container
    // fails its own health check and the circuit breaker rolls back a working
    // deploy — with the application itself fine.
    const { guard } = guardWith(true);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('checks both handler and class metadata', () => {
    // The health controller marks the whole class, not the method.
    const { guard, getAllAndOverride } = guardWith(true);

    guard.canActivate(context);

    expect(getAllAndOverride).toHaveBeenCalledWith('isPublic', [undefined, undefined]);
  });

  it('rejects when passport produced no user', () => {
    const { guard } = guardWith(false);

    expect(() => guard.handleRequest(null, false, undefined)).toThrow(UnauthorizedException);
  });

  it('throws a structured payload the error envelope can carry', () => {
    // A bare UnauthorizedException serialises to Nest's default shape, which
    // is not the documented envelope. The filter passes a structured payload
    // through intact.
    const { guard } = guardWith(false);

    try {
      guard.handleRequest(null, false, undefined);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }
  });

  it('surfaces why the token failed', () => {
    // 'jwt expired' means refresh and retry; 'invalid signature' means the
    // client is wrong. Collapsing both to one message makes that
    // undiagnosable from the response alone.
    const { guard } = guardWith(false);

    try {
      guard.handleRequest(null, false, new Error('jwt expired'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        message: 'jwt expired',
      });
    }
  });

  it('surfaces a reason thrown by validate(), not just verification failures', () => {
    // The strategy rejects a token whose custom claims are missing. Passport
    // reports that through `err`, never `info`, so reading only `info`
    // collapsed it to "Authentication required" and threw away the diagnosis.
    const { guard } = guardWith(false);
    const thrown = new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: 'Token is missing required claims',
    });

    try {
      guard.handleRequest(thrown, false, undefined);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        message: 'Token is missing required claims',
      });
    }
  });

  it('prefers the verification failure when both are present', () => {
    // `info` describes why the token itself failed, which is more specific
    // than whatever wrapper `err` carries.
    const { guard } = guardWith(false);

    try {
      guard.handleRequest(new Error('wrapped'), false, new Error('jwt expired'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        message: 'jwt expired',
      });
    }
  });

  it('passes a verified user through', () => {
    const { guard } = guardWith(false);
    const user = { sub: 'auth0|1', userId: 'usr_1', role: 'USER' };

    expect(guard.handleRequest(null, user, undefined)).toBe(user);
  });
});
