import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthService } from '../../modules/auth/auth.service';
import type { TokenService } from '../../modules/auth/token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const CLAIMS = { userId: 'usr_1', role: 'USER', locale: 'es' };

interface Harness {
  guard: JwtAuthGuard;
  context: never;
  request: { headers: Record<string, string>; user?: unknown };
  getAllAndOverride: ReturnType<typeof vi.fn>;
  verifyAccessToken: ReturnType<typeof vi.fn>;
  resolveIdentity: ReturnType<typeof vi.fn>;
}

// `authorization: null` means the header is absent. Not `undefined`, which a
// default parameter would silently replace with the default value — a trap
// this file walked into once already, turning three "no header" cases into
// assertions about the happy path.
const build = ({
  isPublic = false,
  authorization = 'Bearer a.b.c',
}: { isPublic?: boolean; authorization?: string | null } = {}): Harness => {
  const getAllAndOverride = vi.fn().mockReturnValue(isPublic);
  const verifyAccessToken = vi.fn().mockResolvedValue({ userId: 'usr_1' });
  const resolveIdentity = vi.fn().mockResolvedValue(CLAIMS);

  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: authorization === null ? {} : { authorization },
  };

  const guard = new JwtAuthGuard(
    { getAllAndOverride } as unknown as Reflector,
    { verifyAccessToken } as unknown as TokenService,
    { resolveIdentity } as unknown as AuthService,
  );

  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;

  return { guard, context, request, getAllAndOverride, verifyAccessToken, resolveIdentity };
};

const payloadOf = async (promise: Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await promise;
    throw new Error('expected a rejection, but it resolved');
  } catch (error) {
    return (error as UnauthorizedException).getResponse() as Record<string, unknown>;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JwtAuthGuard', () => {
  describe('@Public', () => {
    it('lets a public route through without authenticating', async () => {
      // The ECS probe carries no credentials. If this regresses, the container
      // fails its own health check and the circuit breaker rolls back a working
      // deploy — with the application itself fine.
      const { guard, context, verifyAccessToken } = build({ isPublic: true, authorization: null });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('checks both handler and class metadata', async () => {
      // The health controller marks the whole class, not the method.
      const { guard, context, getAllAndOverride } = build({ isPublic: true });

      await guard.canActivate(context);

      expect(getAllAndOverride).toHaveBeenCalledWith('isPublic', [undefined, undefined]);
    });
  });

  describe('the bearer header', () => {
    it('passes the token to verification and the verified subject to resolution', async () => {
      const { guard, context, request, verifyAccessToken, resolveIdentity } = build({
        authorization: 'Bearer the.access.token',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);

      expect(verifyAccessToken).toHaveBeenCalledWith('the.access.token');
      // The user id comes from the VERIFIED token, never from the request.
      expect(resolveIdentity).toHaveBeenCalledWith('usr_1');
      expect(request.user).toEqual(CLAIMS);
    });

    it('accepts the scheme in any case, as RFC 7235 defines it', async () => {
      const { guard, context, verifyAccessToken } = build({ authorization: 'bEaReR a.b.c' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(verifyAccessToken).toHaveBeenCalledWith('a.b.c');
    });

    it.each([
      ['absent', null],
      ['empty', ''],
      ['schemeless', 'a.b.c'],
      ['the wrong scheme', 'Basic a.b.c'],
      ['Bearer with no token', 'Bearer'],
      ['Bearer with an empty token', 'Bearer '],
      // Taking the second segment regardless would accept this.
      ['carrying extra segments', 'Bearer a.b.c and-something-else'],
    ])(
      'refuses a %s Authorization header without verifying anything',
      async (_l, authorization) => {
        const { guard, context, verifyAccessToken } = build({ authorization });

        await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
        expect(verifyAccessToken).not.toHaveBeenCalled();
      },
    );
  });

  // TWO SOURCES, TWO RULES — the distinction that used to live in passport's
  // err/info split and now lives in two statements. Verification failures are
  // safe to surface; anything thrown while reading the database is not.
  describe('what a caller is told', () => {
    it('surfaces why verification failed', async () => {
      // 'exp' means refresh and retry; a bad signature means the client is
      // wrong. Collapsing both to one message makes that undiagnosable from
      // the response alone.
      const { guard, context, verifyAccessToken } = build();
      verifyAccessToken.mockRejectedValue(
        new UnauthorizedException({
          code: 'UNAUTHORIZED',
          message: '"exp" claim timestamp check failed',
        }),
      );

      expect(await payloadOf(guard.canActivate(context))).toMatchObject({
        message: '"exp" claim timestamp check failed',
      });
    });

    it('throws a structured payload the error envelope can carry', async () => {
      // A bare UnauthorizedException serialises to Nest's default shape, which
      // is not the documented envelope.
      const { guard, context } = build({ authorization: null });

      expect(await payloadOf(guard.canActivate(context))).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    });

    it('passes a deliberate refusal through with its own status', async () => {
      // Flattening a deactivated account into a 401 tells the person to sign in
      // again, which is advice that cannot work.
      const { guard, context, resolveIdentity } = build();
      resolveIdentity.mockRejectedValue(
        new ForbiddenException({
          code: 'USER_DEACTIVATED',
          message: 'This account has been deactivated',
        }),
      );

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
      expect(await payloadOf(guard.canActivate(context))).toMatchObject({
        code: 'USER_DEACTIVATED',
      });
    });

    it('passes ACCOUNT_NOT_PROVISIONED through rather than reshaping it', async () => {
      const { guard, context, resolveIdentity } = build();
      resolveIdentity.mockRejectedValue(
        new UnauthorizedException({
          code: 'ACCOUNT_NOT_PROVISIONED',
          message: 'No account exists for this sign-in. Please sign in again.',
        }),
      );

      expect(await payloadOf(guard.canActivate(context))).toMatchObject({
        code: 'ACCOUNT_NOT_PROVISIONED',
      });
    });

    // ⚠️ THE ONE WITH A HISTORY. A Prisma error reached a client on 2026-08-24
    // carrying its message, the failing query, an absolute source path and the
    // surrounding lines — because the rule for thrown errors was the same as
    // the rule for verification failures. It is not.
    it('does not surface the message of an unexpected error from resolution', async () => {
      const { guard, context, resolveIdentity } = build();
      resolveIdentity.mockRejectedValue(
        new Error(
          'Invalid `prisma.user.findUnique()` invocation in /Users/x/apps/api/src/modules/...',
        ),
      );

      const payload = await payloadOf(guard.canActivate(context));

      expect(payload.message).toBe('Authentication required');
      expect(payload.message).not.toContain('prisma');
      expect(payload.message).not.toContain('/Users/');
    });

    it('leaves the request unauthenticated when resolution fails', async () => {
      const { guard, context, request, resolveIdentity } = build();
      resolveIdentity.mockRejectedValue(new Error('boom'));

      await expect(guard.canActivate(context)).rejects.toThrow();

      expect(request.user).toBeUndefined();
    });
  });

  // Verification must come before anything reads the database, or an unverified
  // token gets a query run on its behalf.
  it('does not resolve identity when verification fails', async () => {
    const { guard, context, verifyAccessToken, resolveIdentity } = build();
    verifyAccessToken.mockRejectedValue(new UnauthorizedException({ code: 'UNAUTHORIZED' }));

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(resolveIdentity).not.toHaveBeenCalled();
  });

  // NOTE ON WHAT IS NO LONGER HERE. This file used to pin @AllowMissingAccount,
  // which let a verified caller with no account reach POST /auth/session — the
  // endpoint that creates one. Identity resolution had lived in the passport
  // strategy, which cannot see which route it is authenticating, so the account
  // check ran before the handler and made that route unreachable by exactly the
  // people it served.
  //
  // The decorator is gone because the fault it worked around is: /auth/session
  // is now @Public and verifies a Google assertion itself, since the caller has
  // no token from this API yet. The guard is not in that path at all, so the
  // composition cannot recur in this shape.
});
