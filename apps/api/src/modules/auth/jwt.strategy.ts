import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

import type { Env } from '../../config/env.validation';

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
// set neither, and every verification parameter below still applies
// unconditionally — no new branch to get wrong, which is what made this
// different in kind from the bypass above.
//
// They were added so a local mock issuer could mint tokens carrying arbitrary
// role claims. Those claims are no longer read (see validate below), so that
// use is gone and these have no remaining consumer; they are slated for
// removal along with the mock issuer scripts.
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
  // Its job is to turn a verified `sub` into the identity the rest of the API
  // uses, which means one indexed read per authenticated request.
  //
  // THIS USED TO COST NO QUERY. Role and userId rode on the token as custom
  // claims stamped by an Auth0 Post Login Action. That is gone as of
  // 2026-08-24 (docs/adr/0013 records why), and the query is the deliberate
  // price of it: a role change or a deactivation now takes effect on the very
  // next request instead of waiting for the user to sign in again.
  //
  // IT NO LONGER TOUCHES THE DATABASE AT ALL. Until 2026-08-25 this provisioned
  // a missing row; the first attempt at moving that out had it read one
  // instead. Both were wrong here, for the same underlying reason: a strategy
  // cannot see which route it is authenticating, and one route — POST
  // /auth/session — must be reachable by a caller who has no account, because
  // it is what creates one. Resolving identity here made that endpoint
  // unreachable by exactly the people it exists for, and only a real sign-in
  // with a new address surfaced it.
  //
  // So this verifies, and JwtAuthGuard resolves. See @AllowMissingAccount.
  validate(payload: Record<string, unknown>): { sub: string } {
    // `sub` is a registered claim that Auth0 always sets and the signature
    // covers. Everything else about the caller is looked up from it.
    const { sub } = payload;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Token is missing a subject',
      });
    }

    // The guard replaces this with full JwtClaims for every route that requires
    // an account, which is all of them but one.
    return { sub };
  }
}
