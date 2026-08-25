import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { AuthService } from '../../modules/auth/auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const guardWith = (isPublic: boolean) => {
  const getAllAndOverride = vi.fn().mockReturnValue(isPublic);
  const resolveIdentity = vi.fn();
  const guard = new JwtAuthGuard(
    { getAllAndOverride } as unknown as Reflector,
    {
      resolveIdentity,
    } as unknown as AuthService,
  );
  return { guard, getAllAndOverride, resolveIdentity };
};

const context = {
  getHandler: () => undefined,
  getClass: () => undefined,
} as never;

describe('JwtAuthGuard', () => {
  it('lets a @Public route through without authenticating', async () => {
    // The ECS probe carries no credentials. If this regresses, the container
    // fails its own health check and the circuit breaker rolls back a working
    // deploy — with the application itself fine.
    const { guard } = guardWith(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('checks both handler and class metadata', async () => {
    // The health controller marks the whole class, not the method.
    const { guard, getAllAndOverride } = guardWith(true);

    await guard.canActivate(context);

    expect(getAllAndOverride).toHaveBeenCalledWith('isPublic', [undefined, undefined]);
  });

  // THE COMPOSITION THIS FILE EXISTS TO PIN. Identity resolution lived in the
  // strategy until 2026-08-25, which made POST /auth/session unreachable by
  // anyone without an account — the endpoint that creates one. Nothing caught
  // it: the service and the strategy were each correct in isolation, and only a
  // real sign-in with a new address surfaced the deadlock.
  describe('account resolution', () => {
    const authenticated = (allowMissingAccount: boolean) => {
      const request: { user: unknown } = { user: { sub: 'google-oauth2|1' } };
      const ctx = {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => request }),
      } as never;

      const getAllAndOverride = vi
        .fn()
        .mockImplementation((key: string) => (key === 'isPublic' ? false : allowMissingAccount));
      const resolveIdentity = vi.fn().mockResolvedValue({
        sub: 'google-oauth2|1',
        userId: 'usr_1',
        role: 'USER',
        locale: 'es',
      });

      const guard = new JwtAuthGuard(
        { getAllAndOverride } as unknown as Reflector,
        {
          resolveIdentity,
        } as unknown as AuthService,
      );

      // The strategy attaches { sub }; passport's own verification is not under
      // test here, so AuthGuard's canActivate is stubbed on the prototype the
      // guard inherits from.
      const passportProto = Object.getPrototypeOf(Object.getPrototypeOf(guard)) as {
        canActivate: (ctx: unknown) => Promise<boolean>;
      };
      vi.spyOn(passportProto, 'canActivate').mockResolvedValue(true);

      return { guard, ctx, request, resolveIdentity };
    };

    it('replaces { sub } with the full claim set on an ordinary route', async () => {
      const { guard, ctx, request, resolveIdentity } = authenticated(false);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(resolveIdentity).toHaveBeenCalledWith('google-oauth2|1');
      expect(request.user).toMatchObject({ userId: 'usr_1', role: 'USER' });
    });

    it('skips resolution for @AllowMissingAccount, leaving { sub }', async () => {
      const { guard, ctx, request, resolveIdentity } = authenticated(true);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      // The whole point: POST /auth/session must run for a caller who has no
      // account, because it is what creates one.
      expect(resolveIdentity).not.toHaveBeenCalled();
      expect(request.user).toEqual({ sub: 'google-oauth2|1' });
    });
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

  // Added 2026-08-24 with the per-request identity lookup: validate() now
  // refuses a deactivated account with a 403, and flattening that into the
  // generic 401 below told the caller to re-authenticate — advice that cannot
  // work for an account that is disabled.
  it('rethrows a deliberate refusal from validate() with its own status', () => {
    const { guard } = guardWith(false);
    const thrown = new ForbiddenException({
      code: 'USER_DEACTIVATED',
      message: 'This account has been deactivated',
    });

    try {
      guard.handleRequest(thrown, false, undefined);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'USER_DEACTIVATED',
      });
    }
  });

  // Added 2026-08-24. validate() queries the database and calls Auth0, so an
  // unexpected throw there can carry an operator-facing message. One did: a
  // Prisma error reached a client with its failing query, the absolute source
  // path and the surrounding lines, because `err` used to be read with the same
  // rule as `info`.
  it('does not surface the message of an unexpected error from validate()', () => {
    const { guard } = guardWith(false);
    const leaky = new Error(
      'Invalid `prisma.user.findUniqueOrThrow()` invocation in /Users/x/apps/api/src/...',
    );

    try {
      guard.handleRequest(leaky, false, undefined);
      expect.unreachable('should have thrown');
    } catch (error) {
      const payload = (error as UnauthorizedException).getResponse() as { message: string };
      expect(payload.message).toBe('Authentication required');
      expect(payload.message).not.toContain('prisma');
      expect(payload.message).not.toContain('/Users/');
    }
  });

  // The rule differs by SOURCE, not by type. passport reports an expired or
  // malformed token as an Error on `info`, and those messages are a closed set
  // from jsonwebtoken — exactly the diagnosis a caller needs. Suppressing them
  // too would undo the 2026-08-16 fix above.
  it('still surfaces a passport verification failure delivered as an Error', () => {
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

  // The passthrough above must not swallow a plain Error, which is how a
  // verification failure arrives alongside `info`.
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
