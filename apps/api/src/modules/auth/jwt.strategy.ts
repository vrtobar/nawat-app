import { type JwtClaims, JwtClaimsSchema } from '@nahuat/shared';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { Env } from '../../config/env.validation';

// Auth0 requires custom claims to be namespaced, so role and userId arrive
// under these keys rather than as bare fields.
const CLAIM_NAMESPACE = 'https://nahuat.com';
const ROLE_CLAIM = `${CLAIM_NAMESPACE}/role`;
const USER_ID_CLAIM = `${CLAIM_NAMESPACE}/userId`;

// Verifies Auth0 access tokens.
//
// Auth0 signs with RS256, so verification uses its published public key from
// the JWKS endpoint — no shared secret exists in this application, and a leak
// of anything here would not let an attacker mint tokens.
//
// There is deliberately NO HS256 path. env.validation declares an optional
// TEST_JWT_SECRET for integration-test tokens; wiring it here would mean the
// running service accepts symmetric tokens whenever that variable is present,
// so anyone holding the secret could forge role: ADMIN. Gating on NODE_ENV
// only relocates the failure to a misconfigured environment. Integration tests
// override the guard through Nest's testing module instead, which leaves this
// path single-algorithm with no branch to get wrong.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    const domain = config.get('AUTH0_DOMAIN', { infer: true });

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,

      // Pinned to RS256. Left open, a token signed with 'none' — or with HS256
      // using the public key as the HMAC secret — would verify.
      algorithms: ['RS256'],

      // Both must be checked. Without `audience`, a token minted by the same
      // tenant for a different API would be accepted here.
      audience: config.get('AUTH0_AUDIENCE', { infer: true }),
      issuer: `https://${domain}/`,

      // jwks-rsa fetches and caches the signing keys, so key rotation needs no
      // deploy. rateLimit bounds requests to Auth0 if an attacker floods the
      // API with tokens carrying unknown key ids.
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${domain}/.well-known/jwks.json`,
      }),
    });
  }

  // Runs only after the signature, issuer, audience and expiry have passed.
  // Its job is to turn a verified payload into the shape the rest of the API
  // uses, and to reject anything that does not fit it.
  validate(payload: Record<string, unknown>): JwtClaims {
    const result = JwtClaimsSchema.safeParse({
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload[ROLE_CLAIM],
      userId: payload[USER_ID_CLAIM],
    });

    if (!result.success) {
      // A correctly signed token that lacks the custom claims is not a
      // malformed request — it is a token minted before the Post Login Action
      // ran, or by a flow that skips it. Treated as unauthenticated so the
      // client re-authenticates rather than seeing a 500.
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Token is missing required claims',
      });
    }

    // Becomes request.user. Deliberately not a database record: role and
    // userId come from the token, so authorization costs no query. The
    // tradeoff is that a role change only takes effect once the session is
    // revoked and the user signs in again.
    return result.data;
  }
}
