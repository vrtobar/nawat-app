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
const LOCALE_CLAIM = `${CLAIM_NAMESPACE}/locale`;

// Verifies Auth0 access tokens.
//
// Auth0 signs with RS256, so verification uses its published public key from
// the JWKS endpoint — no shared secret exists in this application, and a leak
// of anything here would not let an attacker mint tokens.
//
// There is deliberately NO HS256 path and no NODE_ENV bypass. Accepting
// symmetric tokens whenever some variable happened to be present would let
// anyone holding that value forge role: ADMIN, and gating it on NODE_ENV only
// relocates the failure to a misconfigured environment — the branch itself is
// the vulnerability. See docs/adr/0013.
//
// What IS configurable is the issuer, not the strategy. AUTH0_ISSUER_URL and
// AUTH0_JWKS_URI both default to the Auth0 tenant, so deployed environments
// set neither; local development points them at a mock OIDC provider to mint
// tokens with arbitrary claims for hand-testing role-gated routes. Every
// verification parameter below still applies unconditionally, so there is no
// new branch here to get wrong — that is what makes this different in kind
// from the bypass above.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    const domain = config.get('AUTH0_DOMAIN', { infer: true });

    // Trailing slash matters: Auth0 stamps `iss` as https://<domain>/ and the
    // check below is a string comparison against it.
    const issuer = config.get('AUTH0_ISSUER_URL', { infer: true }) ?? `https://${domain}/`;
    const jwksUri =
      config.get('AUTH0_JWKS_URI', { infer: true }) ?? `https://${domain}/.well-known/jwks.json`;

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,

      // Pinned to RS256. Left open, a token signed with 'none' — or with HS256
      // using the public key as the HMAC secret — would verify.
      algorithms: ['RS256'],

      // Both must be checked. Without `audience`, a token minted by the same
      // tenant for a different API would be accepted here.
      audience: config.get('AUTH0_AUDIENCE', { infer: true }),
      issuer,

      // jwks-rsa fetches and caches the signing keys, so key rotation needs no
      // deploy. rateLimit bounds requests to Auth0 if an attacker floods the
      // API with tokens carrying unknown key ids.
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri,
      }),
    });
  }

  // Runs only after the signature, issuer, audience and expiry have passed.
  // Its job is to turn a verified payload into the shape the rest of the API
  // uses, and to reject anything that does not fit it.
  validate(payload: Record<string, unknown>): JwtClaims {
    const result = JwtClaimsSchema.safeParse({
      sub: payload.sub,
      role: payload[ROLE_CLAIM],
      userId: payload[USER_ID_CLAIM],
      // Optional in the schema, and .catch there means an older token that
      // predates this claim (or carries a malformed one) parses to undefined
      // rather than failing — a missing locale must not reject an otherwise
      // valid token. Resolution falls through to Accept-Language instead.
      locale: payload[LOCALE_CLAIM],
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
