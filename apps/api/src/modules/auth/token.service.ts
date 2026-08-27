import { API_ERROR_CODES } from '@nahuat/shared';
import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type CryptoKey, importJWK, type JWK, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import type { Env } from '../../config/env.validation';

// =============================================================================
// THIS PROJECT'S OWN ACCESS TOKENS — signing and verification. See
// docs/adr/0018.
//
// ONE LIBRARY SIGNS AND VERIFIES. The alternative considered was leaving
// verification to passport-jwt's jsonwebtoken, which put the algorithm pin
// below — the most security-critical line in this file — in two places, in two
// syntaxes, where the second copy is the one that silently drifts. passport was
// removed instead. jose also models a key SET addressed by `kid` directly,
// which is what rotation needs.
//
// ⚠️ jose v6 IS ESM-ONLY AND THIS PACKAGE IS CommonJS. That combination works
// here, and is not an oversight to be "fixed" by pinning back to jose v5: the
// repository requires Node >= 24 (see the root package.json `engines`) and
// runs on node:24-alpine, where `require()` of an ES module is supported
// natively. Verified against a CommonJS build before this was written.
// =============================================================================

// -----------------------------------------------------------------------------
// KEY MATERIAL
//
// JWT_SIGNING_KEYS is a base64-encoded JWK Set holding PRIVATE RSA keys.
//
// **Base64 rather than raw JSON** because the value travels through a
// `.env.local` file, Terraform, a Secrets Manager JSON blob and an ECS task
// definition before it reaches this process. Raw JSON survives none of those
// reliably — embedded quotes and, for a PEM, newlines — and every failure it
// causes surfaces as a parse error at boot rather than where the mistake was
// made. A base64 blob is opaque to all four.
//
// **THE FIRST KEY SIGNS; EVERY KEY VERIFIES.** That ordering is the whole
// rotation mechanism, and it is one variable rather than two on purpose: a
// separate "which kid is active" setting can disagree with the set it points
// into, and the failure mode of that disagreement is an API that mints tokens
// nothing can verify. Rotation is therefore: PREPEND the new key and deploy —
// tokens signed by the old one keep verifying — then remove the old key once
// no token older than one access-token lifetime can still be in flight.
// -----------------------------------------------------------------------------

// Narrowed to what a signing key must have. Unknown members are kept, because
// this is a JWK and the spec allows more than is named here.
const PrivateJwkSchema = z.looseObject({
  kty: z.literal('RSA'),
  kid: z.string().min(1),
  // The private exponent. Its presence is what distinguishes a private JWK
  // from a public one, and a public-only set would boot fine and then fail to
  // sign a single token — at the first login, not at startup.
  d: z.string().min(1),
  n: z.string().min(1),
  e: z.string().min(1),
});

const SigningKeySetSchema = z.object({
  keys: z.array(PrivateJwkSchema).min(1),
});

// The private members of an RSA JWK, dropped to derive the public key. Named
// rather than inlined because getting this list wrong publishes a private key.
const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'] as const;

// A few seconds of slack on `exp` and `nbf`. Not a security concession worth
// arguing over: identity, role and deactivation are resolved from the database
// on every authenticated request, so a token surviving five seconds past its
// expiry grants nothing that the row behind it does not already grant. Without
// it, ordinary clock drift between two tasks produces intermittent 401s that
// reproduce on no developer's machine.
const CLOCK_TOLERANCE_SECONDS = 5;

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);

  private signingKey!: CryptoKey;
  private signingKid!: string;
  private readonly verificationKeys = new Map<string, CryptoKey>();

  private readonly issuer: string;
  private readonly audience: string;
  private readonly ttlSeconds: number;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.audience = config.get('JWT_AUDIENCE', { infer: true });
    this.ttlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  // Key import is async, so it cannot happen in the constructor. onModuleInit
  // runs before the application starts listening, which is the property that
  // matters: a malformed key set fails the boot rather than the first login.
  // That is the same contract env.validation.ts provides for everything else —
  // configuration faults surface at startup, where a deploy can catch them.
  async onModuleInit(): Promise<void> {
    const decoded = Buffer.from(
      this.config.get('JWT_SIGNING_KEYS', { infer: true }),
      'base64',
    ).toString('utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      // The value itself is never logged, here or anywhere below. It is a
      // private key.
      throw new Error('JWT_SIGNING_KEYS is not valid base64-encoded JSON');
    }

    const result = SigningKeySetSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `JWT_SIGNING_KEYS is not a usable private JWK Set: ${result.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    for (const jwk of result.data.keys) {
      if (this.verificationKeys.has(jwk.kid)) {
        // Two keys under one kid makes verification depend on map insertion
        // order, which is not a thing anyone should have to reason about.
        throw new Error(`JWT_SIGNING_KEYS contains more than one key with kid "${jwk.kid}"`);
      }

      const publicJwk = Object.fromEntries(
        Object.entries(jwk).filter(
          ([member]) =>
            !PRIVATE_JWK_MEMBERS.includes(member as (typeof PRIVATE_JWK_MEMBERS)[number]),
        ),
      ) as JWK;

      const publicKey = (await importJWK({ ...publicJwk, alg: 'RS256' }, 'RS256')) as CryptoKey;

      this.verificationKeys.set(jwk.kid, publicKey);

      // The first key in the set is the one that signs. See the header.
      if (this.signingKid === undefined) {
        this.signingKid = jwk.kid;
        this.signingKey = (await importJWK({ ...jwk, alg: 'RS256' }, 'RS256')) as CryptoKey;
      }
    }

    this.logger.log(
      `signing with kid "${this.signingKid}"; ` +
        `verifying against ${this.verificationKeys.size} key(s); ` +
        `access tokens live ${this.ttlSeconds}s`,
    );
  }

  // Mints an access token for a verified subject.
  //
  // `sub` is Google's subject and nothing else rides along. Role, userId and
  // locale are deliberately NOT claims: they were, under Auth0's Post Login
  // Action, and docs/adr/0013 records why that was reversed — a role change or
  // a deactivation could not take effect until the user signed in again. The
  // API reads all three from its own database on every request, so putting
  // them here would reintroduce a second, staler copy of the answer.
  async signAccessToken(sub: string): Promise<{ accessToken: string; expiresIn: number }> {
    const accessToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: this.signingKid })
      .setSubject(sub)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.signingKey);

    return { accessToken, expiresIn: this.ttlSeconds };
  }

  // Verifies a token this API issued, end to end: signature against the key
  // named by its `kid`, algorithm, issuer, audience and expiry.
  //
  // THE ONLY PLACE AN ACCESS TOKEN IS VERIFIED. Nothing calls it yet — the
  // request path still runs the Auth0-era JwtStrategy — but when the guard
  // takes this over there is one implementation of the check, exercised by the
  // tests as a whole rather than as parameters asserted in isolation.
  async verifyAccessToken(token: string): Promise<{ sub: string }> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const kid = header.kid;
          if (kid === undefined) throw new Error('token has no kid');

          const key = this.verificationKeys.get(kid);
          if (key === undefined) throw new Error(`no verification key for kid "${kid}"`);

          return key;
        },
        {
          // Pinned, and this is the check that matters most in the file. Left
          // open, a token signed with 'none' — or with HS256 using the public
          // key as the HMAC secret, which is published — would verify. The
          // same reasoning as the Auth0-era strategy it replaces.
          algorithms: ['RS256'],
          issuer: this.issuer,
          audience: this.audience,
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
        },
      );

      const { sub } = payload;
      if (typeof sub !== 'string' || sub.length === 0) {
        throw new Error('token has no subject');
      }

      return { sub };
    } catch (error) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        // jose's messages are a closed set written by that library —
        // 'signature verification failed', '"exp" claim timestamp check
        // failed' — and are exactly the diagnosis a caller needs. Nothing here
        // reaches the database or an external service, so there is no operator
        // detail to leak.
        message: error instanceof Error ? error.message : 'Authentication required',
      });
    }
  }
}
