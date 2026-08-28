import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TransformInterceptor } from '../../common/interceptors/transform.interceptor';
import { CorrelationIdMiddleware } from '../../common/middleware/correlation-id.middleware';
import { configureApp } from '../../configure-app';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleIdentityService } from './google-identity.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

// =============================================================================
// THE AUTH ROUTES, OVER HTTP.
//
// Everything else in this suite tests a class in isolation. This boots an
// application and makes real requests through it, because the faults worth
// catching here live BETWEEN the parts: a guard that runs on a route it should
// not, an @Public() that covers more than intended, an exception that escapes
// the envelope. Each component can be individually correct while the
// composition is wrong, and that is the shape of most of the auth bugs this
// project has actually had.
//
// The database is not involved. Every service is mocked, so this asserts
// wiring — routing, guards, pipes, interceptor, filter — and says nothing about
// SQL. The conditional-update semantics behind rotation still have no test that
// exercises Postgres; that is a separate, tracked gap.
//
// Routing comes from configureApp(), the same function main.ts calls. Restating
// the prefix and version here would let the test agree with itself while the
// real application 404ed.
// =============================================================================

const googleIdentity = { verify: vi.fn() };
const authService = { startSession: vi.fn(), resolveIdentity: vi.fn() };
const tokenService = { signAccessToken: vi.fn(), verifyAccessToken: vi.fn() };
const refreshTokens = { issue: vi.fn(), rotate: vi.fn(), revokeFamily: vi.fn() };
const usersService = { findProfile: vi.fn() };

const IDENTITY = { sub: '104829571094857109485', email: 'a@b.com', name: 'A Speaker' };
const PROFILE = { id: 'usr_1', email: 'a@b.com', name: 'A Speaker', role: 'USER', locale: 'es' };
const CLAIMS = { userId: 'usr_1', role: 'USER', locale: 'es' };

let app: INestApplication;
let base: string;

// `Headers` and `HeadersInit` are DOM types; this package compiles with
// lib: ["ES2023"] and types: ["node"], so fetch exists at runtime (Node 24)
// while the browser type names do not.
interface Reply {
  status: number;
  headers: Response['headers'];
  body: Record<string, unknown>;
}

async function post(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Reply> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Reply['body'] };
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, headers: res.headers, body: (await res.json()) as Reply['body'] };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    // UsersController is here as a CONTROL. Without a route that is not
    // @Public, nothing in this file would notice if @Public() started applying
    // globally — every assertion would still pass.
    controllers: [AuthController, UsersController],
    providers: [
      { provide: GoogleIdentityService, useValue: googleIdentity },
      { provide: AuthService, useValue: authService },
      { provide: TokenService, useValue: tokenService },
      { provide: RefreshTokenService, useValue: refreshTokens },
      { provide: UsersService, useValue: usersService },
      // The real ones, in the real order — RolesGuard reads what JwtAuthGuard
      // attaches, so registering them the other way round would 403 every
      // gated route. That ordering is asserted by AppModule, and repeated here
      // because a testing module has its own provider list.
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
      { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      { provide: APP_FILTER, useClass: HttpExceptionFilter },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use(new CorrelationIdMiddleware().use);
  configureApp(app);

  await app.listen(0);
  // getUrl() reports the IPv6 loopback as [::1], which undici resolves
  // inconsistently across environments.
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();

  googleIdentity.verify.mockResolvedValue(IDENTITY);
  authService.startSession.mockResolvedValue(PROFILE);
  authService.resolveIdentity.mockResolvedValue(CLAIMS);
  tokenService.signAccessToken.mockResolvedValue({ accessToken: 'access', expiresIn: 3600 });
  tokenService.verifyAccessToken.mockResolvedValue({ userId: 'usr_1' });
  refreshTokens.issue.mockResolvedValue('refresh');
  refreshTokens.rotate.mockResolvedValue({ userId: 'usr_1', refreshToken: 'refresh-2' });
  refreshTokens.revokeFamily.mockResolvedValue(undefined);
  usersService.findProfile.mockResolvedValue(PROFILE);
});

describe('auth routes over HTTP', () => {
  // ⚠️ THE PROPERTY THIS FILE EXISTS FOR. All three routes must be reachable
  // with no credential from this API, because getting one is what they are
  // for. Under the previous design the equivalent guarantee came from
  // @AllowMissingAccount, and it was broken once — the account-creating
  // endpoint sat behind the account check, and only a real sign-in with a new
  // address revealed it.
  describe('reachable without a token', () => {
    it.each([
      ['/api/v1/auth/session', { idToken: 'google-id-token' }],
      ['/api/v1/auth/refresh', { refreshToken: 'refresh' }],
      ['/api/v1/auth/logout', { refreshToken: 'refresh' }],
    ])('%s answers with no Authorization header', async (path, body) => {
      const { status } = await post(path, body);

      expect(status).toBe(200);
      // The global guard never consulted a token, rather than consulting one
      // and happening to allow it.
      expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
    });

    // The control. If this ever returns 200, @Public has escaped the three
    // routes above and every protected endpoint in the application is open.
    it('but /users/me does not', async () => {
      const { status, body } = await get('/api/v1/users/me');

      expect(status).toBe(401);
      expect(body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
      expect(usersService.findProfile).not.toHaveBeenCalled();
    });

    it('and /users/me answers for a caller who has one', async () => {
      const { status, body } = await get('/api/v1/users/me', {
        authorization: 'Bearer a.b.c',
      });

      expect(status).toBe(200);
      expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('a.b.c');
      // The id comes from the verified token, never from the request.
      expect(usersService.findProfile).toHaveBeenCalledWith('usr_1');
      expect(body).toMatchObject({ success: true, data: { id: 'usr_1' } });
    });
  });

  describe('POST /auth/session', () => {
    it('returns the profile and a token pair in the envelope', async () => {
      const { status, body } = await post('/api/v1/auth/session', { idToken: 'google-id-token' });

      expect(status).toBe(200);
      expect(body).toEqual({
        success: true,
        data: {
          user: PROFILE,
          tokens: { accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600 },
        },
      });
    });

    it('verifies the ID token before anything else happens', async () => {
      await post('/api/v1/auth/session', { idToken: 'google-id-token' });

      expect(googleIdentity.verify).toHaveBeenCalledWith('google-id-token');
      expect(googleIdentity.verify.mock.invocationCallOrder[0]).toBeLessThan(
        authService.startSession.mock.invocationCallOrder[0] as number,
      );
    });

    // ⚠️ ORDER MATTERS AND IS EASY TO GET WRONG. Minting before the account is
    // resolved hands a working credential to someone whose sign-in is then
    // refused — a token naming a user they cannot act as.
    it('mints nothing when the account is refused', async () => {
      authService.startSession.mockRejectedValue(
        Object.assign(new Error('deactivated'), {
          getStatus: () => 403,
          getResponse: () => ({ code: 'USER_DEACTIVATED', message: 'deactivated' }),
        }),
      );

      await post('/api/v1/auth/session', { idToken: 'google-id-token' });

      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('mints nothing when the ID token does not verify', async () => {
      const { UnauthorizedException } = await import('@nestjs/common');
      googleIdentity.verify.mockRejectedValue(
        new UnauthorizedException({ code: 'INVALID_GOOGLE_TOKEN', message: 'nope' }),
      );

      const { status, body } = await post('/api/v1/auth/session', { idToken: 'forged' });

      expect(status).toBe(401);
      expect(body).toMatchObject({ error: { code: 'INVALID_GOOGLE_TOKEN' } });
      expect(authService.startSession).not.toHaveBeenCalled();
      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a body with no idToken, naming the field', async () => {
      const { status, body } = await post('/api/v1/auth/session', {});

      expect(status).toBe(400);
      expect(body).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          details: [{ field: 'body.idToken' }],
        },
      });
      expect(googleIdentity.verify).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns a new pair, minted for the subject the store reports', async () => {
      const { status, body } = await post('/api/v1/auth/refresh', { refreshToken: 'refresh' });

      expect(status).toBe(200);
      expect(refreshTokens.rotate).toHaveBeenCalledWith('refresh');
      // Whose token to mint comes from the stored row, never from the request.
      expect(tokenService.signAccessToken).toHaveBeenCalledWith('usr_1');
      expect(body).toMatchObject({
        data: { tokens: { accessToken: 'access', refreshToken: 'refresh-2' } },
      });
    });

    it('surfaces a refused rotation in the envelope', async () => {
      const { UnauthorizedException } = await import('@nestjs/common');
      refreshTokens.rotate.mockRejectedValue(
        new UnauthorizedException({
          code: 'REFRESH_TOKEN_INVALID',
          message: 'This session has expired. Please sign in again.',
        }),
      );

      const { status, body } = await post('/api/v1/auth/refresh', { refreshToken: 'spent' });

      expect(status).toBe(401);
      expect(body).toMatchObject({ error: { code: 'REFRESH_TOKEN_INVALID' } });
      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the family and returns the empty envelope', async () => {
      const { status, body } = await post('/api/v1/auth/logout', { refreshToken: 'refresh' });

      expect(status).toBe(200);
      expect(refreshTokens.revokeFamily).toHaveBeenCalledWith('refresh');
      // Not 204: TransformInterceptor wraps every success, and a 204 must carry
      // no body.
      expect(body).toEqual({ success: true, data: null });
    });

    // The service is silent about an unknown token by design; this asserts the
    // route does not reintroduce the distinction the service removed.
    it('says nothing about a token that does not exist', async () => {
      const { status, body } = await post('/api/v1/auth/logout', { refreshToken: 'never-existed' });

      expect(status).toBe(200);
      expect(body).toEqual({ success: true, data: null });
    });
  });

  // A 401 is the response someone is most likely to be chasing through logs,
  // and it is thrown by a guard — before any interceptor runs. That is why the
  // correlation id is middleware.
  describe('the correlation id', () => {
    it('is on a success response header, and not in its body', async () => {
      const { headers, body } = await post('/api/v1/auth/logout', { refreshToken: 'refresh' });

      expect(headers.get('x-correlation-id')).toMatch(/^req_/);
      expect(body).not.toHaveProperty('correlationId');
    });

    it('is in the body of an error thrown by the guard', async () => {
      const { body } = await get('/api/v1/users/me');

      expect((body.error as { correlationId: string }).correlationId).toMatch(/^req_/);
    });

    it('echoes a usable id the client supplied', async () => {
      const { headers } = await get('/api/v1/users/me', { 'x-correlation-id': 'trace-abc123' });

      expect(headers.get('x-correlation-id')).toBe('trace-abc123');
    });
  });
});
