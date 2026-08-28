import { API_ERROR_CODES } from '@nahuat/shared';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type CryptoKey, exportJWK, generateKeyPair, importJWK, type JWK, SignJWT } from 'jose';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config/env.validation';
import { GoogleIdentityService } from './google-identity.service';

// Only createRemoteJWKSet is replaced — everything else is the real jose, so
// these tests exercise actual signature, issuer, audience and expiry
// verification rather than a stub of it. The substitute resolves to a key
// generated here, which is what lets a test mint a token Google would not.
const { remoteKey } = vi.hoisted(() => ({ remoteKey: { current: undefined as unknown } }));

vi.mock('jose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jose')>()),
  createRemoteJWKSet: () => () => Promise.resolve(remoteKey.current),
}));

const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com';
const ISSUER = 'https://accounts.google.com';
const SUB = '104829571094857109485';

const config = {
  get: () => CLIENT_ID,
} as unknown as ConfigService<Env, true>;

let signingKey: CryptoKey;
let otherKey: CryptoKey;

// Google's own claim shape, as the smallest token that should succeed.
const claims = (overrides: Record<string, unknown> = {}) => ({
  email: 'speaker@example.com',
  email_verified: true,
  name: 'A Speaker',
  picture: 'https://lh3.googleusercontent.com/a/abc123',
  ...overrides,
});

async function mint(
  payload: Record<string, unknown>,
  options: { issuer?: string; audience?: string; key?: CryptoKey; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(SUB)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '1h')
    .sign(options.key ?? signingKey);
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    generateKeyPair('RS256', { extractable: true }),
    generateKeyPair('RS256', { extractable: true }),
  ]);

  signingKey = a.privateKey as CryptoKey;
  otherKey = b.privateKey as CryptoKey;

  // What the mocked remote key set resolves to: the public half of the key the
  // helper signs with, i.e. "Google's published key".
  const publicJwk = (await exportJWK(a.publicKey)) as JWK;
  remoteKey.current = await importJWK({ ...publicJwk, alg: 'RS256' }, 'RS256');
});

let service: GoogleIdentityService;

beforeEach(() => {
  service = new GoogleIdentityService(config);
});

describe('GoogleIdentityService', () => {
  it('returns the identity carried by a well-formed token', async () => {
    const identity = await service.verify(await mint(claims()));

    expect(identity).toEqual({
      sub: SUB,
      email: 'speaker@example.com',
      name: 'A Speaker',
      picture: 'https://lh3.googleusercontent.com/a/abc123',
    });
  });

  // The profile arrives with the credential — this is what deletes the
  // /userinfo round trip the Auth0 path made on every login.
  it('needs no network call to learn the profile', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await service.verify(await mint(claims()));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('accepts the bare-hostname issuer Google also uses', async () => {
    const identity = await service.verify(await mint(claims(), { issuer: 'accounts.google.com' }));

    expect(identity.sub).toBe(SUB);
  });

  it('carries optional claims through as absent rather than empty', async () => {
    const { name: _n, picture: _p, ...withoutProfile } = claims();

    const identity = await service.verify(await mint(withoutProfile));

    expect(identity.name).toBeUndefined();
    expect(identity.picture).toBeUndefined();
    expect(identity.email).toBe('speaker@example.com');
  });

  // ⚠️ THE ONE THAT MATTERS MOST. The signature is genuine and the issuer is
  // genuinely Google — this is a real token, minted by Google, for somebody
  // else's application. It names a real user, so without the audience check it
  // would pass every downstream step and create an account under their
  // identity.
  it('rejects a genuine Google token minted for a different application', async () => {
    const forAnotherApp = await mint(claims(), {
      audience: '9999-someone-else.apps.googleusercontent.com',
    });

    await expect(service.verify(forAnotherApp)).rejects.toMatchObject({
      response: { code: API_ERROR_CODES.INVALID_GOOGLE_TOKEN },
    });
  });

  it('rejects a token signed by a key Google does not publish', async () => {
    await expect(service.verify(await mint(claims(), { key: otherKey }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token from an issuer that is not Google', async () => {
    await expect(
      service.verify(await mint(claims(), { issuer: 'https://accounts.google.com.evil.test' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    await expect(service.verify(await mint(claims(), { expiresIn: '-1h' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a malformed token', async () => {
    await expect(service.verify('not.a.token')).rejects.toThrow(UnauthorizedException);
  });

  // Unverified addresses are how one person comes to hold another's row, and
  // users.email is unique.
  it('refuses an unverified email, and says so distinctly', async () => {
    await expect(
      service.verify(await mint(claims({ email_verified: false }))),
    ).rejects.toMatchObject({
      response: { code: API_ERROR_CODES.EMAIL_NOT_VERIFIED },
    });
  });

  // A token omitting the claim must not be read as verified by default.
  it('refuses a token that omits email_verified entirely', async () => {
    const { email_verified: _omitted, ...withoutFlag } = claims();

    await expect(service.verify(await mint(withoutFlag))).rejects.toMatchObject({
      response: { code: API_ERROR_CODES.INVALID_GOOGLE_TOKEN },
    });
  });

  it('refuses a verified token carrying no email at all', async () => {
    const { email: _omitted, ...withoutEmail } = claims();

    await expect(service.verify(await mint(withoutEmail))).rejects.toMatchObject({
      response: { code: API_ERROR_CODES.INVALID_GOOGLE_TOKEN },
    });
  });

  // Every verification failure looks the same from outside; which check failed
  // is logged, not returned.
  it('reports the same code for a bad signature and a wrong audience', async () => {
    const badSignature = await service
      .verify(await mint(claims(), { key: otherKey }))
      .catch((e: unknown) => (e as UnauthorizedException).getResponse());

    const wrongAudience = await service
      .verify(await mint(claims(), { audience: 'someone-else' }))
      .catch((e: unknown) => (e as UnauthorizedException).getResponse());

    expect(badSignature).toEqual(wrongAudience);
  });
});
