import { API_ERROR_CODES } from '@nahuat/shared';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  calculateJwkThumbprint,
  type CryptoKey,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  importJWK,
  type JWK,
  jwtVerify,
  SignJWT,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.validation';
import { TokenService } from './token.service';

const ISSUER = 'https://api.nahuat.test';
const AUDIENCE = 'https://api.nahuat.test';
const TTL = 3600;

async function makeKey(): Promise<JWK> {
  const { privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const jwk = await exportJWK(privateKey);
  return { ...jwk, kid: await calculateJwkThumbprint(jwk), alg: 'RS256', use: 'sig' };
}

function encode(keys: JWK[]): string {
  return Buffer.from(JSON.stringify({ keys })).toString('base64');
}

// The public half of a private JWK — what a published key set would carry.
function publicHalf(jwk: JWK): JWK {
  const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...rest } = jwk;
  return rest;
}

function build(signingKeys: string, ttl = TTL): TokenService {
  const values: Partial<Env> = {
    JWT_SIGNING_KEYS: signingKeys,
    JWT_ISSUER: ISSUER,
    JWT_AUDIENCE: AUDIENCE,
    ACCESS_TOKEN_TTL_SECONDS: ttl,
  };

  const config = {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;

  return new TokenService(config);
}

// Two independently generated keys, shared across the suite — RSA generation is
// the slow part of these tests and none of them need a fresh one.
let keyA: JWK;
let keyB: JWK;

beforeAll(async () => {
  [keyA, keyB] = await Promise.all([makeKey(), makeKey()]);
});

describe('TokenService', () => {
  describe('key set', () => {
    it('refuses a value that is not base64-encoded JSON', async () => {
      const service = build(Buffer.from('not json at all').toString('base64'));
      await expect(service.onModuleInit()).rejects.toThrow(/not valid base64-encoded JSON/);
    });

    it('refuses a set with no keys', async () => {
      const service = build(encode([]));
      await expect(service.onModuleInit()).rejects.toThrow(/not a usable private JWK Set/);
    });

    // A public-only set boots and then fails at the first login, which is the
    // worst time to discover it. `d` is what separates the two.
    it('refuses a set whose keys carry no private exponent', async () => {
      const { d: _discarded, ...publicOnly } = keyA;
      const service = build(encode([publicOnly as JWK]));
      await expect(service.onModuleInit()).rejects.toThrow(/not a usable private JWK Set/);
    });

    it('refuses two keys sharing one kid', async () => {
      const service = build(encode([keyA, { ...keyB, kid: keyA.kid }]));
      await expect(service.onModuleInit()).rejects.toThrow(/more than one key with kid/);
    });
  });

  describe('signing', () => {
    it('signs with the FIRST key in the set', async () => {
      const service = build(encode([keyA, keyB]));
      await service.onModuleInit();

      const { accessToken } = await service.signAccessToken('usr_1');
      const header = JSON.parse(
        Buffer.from(accessToken.split('.')[0] as string, 'base64url').toString('utf8'),
      ) as { alg: string; kid: string };

      expect(header.kid).toBe(keyA.kid);
      expect(header.alg).toBe('RS256');
    });

    it('mints a token carrying the subject, issuer, audience and expiry — and nothing else', async () => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      const { accessToken, expiresIn } = await service.signAccessToken('usr_1');
      expect(expiresIn).toBe(TTL);

      const publicKey = (await importJWK(publicHalf(keyA), 'RS256')) as CryptoKey;
      const { payload } = await jwtVerify(accessToken, publicKey);

      expect(payload.sub).toBe('usr_1');
      expect(payload.iss).toBe(ISSUER);
      expect(payload.aud).toBe(AUDIENCE);
      expect(payload.exp).toBeDefined();
      expect(payload.iat).toBeDefined();

      // Role, userId and locale are read from the database on every request and
      // must NOT ride along — see docs/adr/0013 for the reversal this protects.
      expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub']);
    });
  });

  describe('verification', () => {
    it('accepts a token it just signed', async () => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      const { accessToken } = await service.signAccessToken('usr_1');
      await expect(service.verifyAccessToken(accessToken)).resolves.toEqual({ userId: 'usr_1' });
    });

    // The rotation contract: the set signs with the first key and verifies
    // against all of them, so a token minted before a rotation survives it.
    it('accepts a token signed by a NON-signing key still in the set', async () => {
      const before = build(encode([keyB]));
      await before.onModuleInit();
      const { accessToken } = await before.signAccessToken('usr_1');

      const afterRotation = build(encode([keyA, keyB]));
      await afterRotation.onModuleInit();

      await expect(afterRotation.verifyAccessToken(accessToken)).resolves.toEqual({
        userId: 'usr_1',
      });
    });

    it('rejects a token whose key has been rotated out', async () => {
      const before = build(encode([keyB]));
      await before.onModuleInit();
      const { accessToken } = await before.signAccessToken('usr_1');

      const afterRemoval = build(encode([keyA]));
      await afterRemoval.onModuleInit();

      await expect(afterRemoval.verifyAccessToken(accessToken)).rejects.toThrow(
        /no verification key for kid/,
      );
    });

    it('rejects a token with no kid in its header', async () => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      const signingKey = (await importJWK(keyA, 'RS256')) as CryptoKey;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256' })
        .setSubject('usr_1')
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime('1h')
        .sign(signingKey);

      await expect(service.verifyAccessToken(token)).rejects.toThrow(/no kid/);
    });

    // THE ONE THAT MATTERS. The public key is published by design, so if HS256
    // were accepted anyone holding it could mint a token for any subject by
    // using it as the HMAC secret. `algorithms: ['RS256']` is what stops this,
    // and nothing else in the file would fail if it were removed.
    it('rejects an HS256 token signed with the public key as the HMAC secret', async () => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      // Derived here rather than asked of the service, which is truer to the
      // attack: the public key is PUBLISHED, so an attacker has it without any
      // help from this API.
      const pem = await exportSPKI((await importJWK(publicHalf(keyA), 'RS256')) as CryptoKey);
      const forged = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', kid: keyA.kid })
        .setSubject('usr_attacker')
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode(pem));

      await expect(service.verifyAccessToken(forged)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token signed by a key the set has never held', async () => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      const strangerKey = (await importJWK(keyB, 'RS256')) as CryptoKey;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: keyA.kid })
        .setSubject('usr_attacker')
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime('1h')
        .sign(strangerKey);

      await expect(service.verifyAccessToken(token)).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      ['issuer', { iss: 'https://evil.example', aud: AUDIENCE }],
      ['audience', { iss: ISSUER, aud: 'https://some-other-api.example' }],
    ])('rejects a token minted for a different %s', async (_label, claims) => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      const signingKey = (await importJWK(keyA, 'RS256')) as CryptoKey;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: keyA.kid })
        .setSubject('usr_1')
        .setIssuer(claims.iss)
        .setAudience(claims.aud)
        .setExpirationTime('1h')
        .sign(signingKey);

      await expect(service.verifyAccessToken(token)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token, beyond the clock tolerance', async () => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      const signingKey = (await importJWK(keyA, 'RS256')) as CryptoKey;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: keyA.kid })
        .setSubject('usr_1')
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(signingKey);

      await expect(service.verifyAccessToken(token)).rejects.toThrow(/exp/);
    });

    it('reports failures in the documented error envelope', async () => {
      const service = build(encode([keyA]));
      await service.onModuleInit();

      await expect(service.verifyAccessToken('not.a.token')).rejects.toMatchObject({
        response: { code: API_ERROR_CODES.UNAUTHORIZED },
      });
    });
  });
});
