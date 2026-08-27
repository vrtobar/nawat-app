import { API_ERROR_CODES } from '@nahuat/shared';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

import type { Env } from '../../config/env.validation';

// =============================================================================
// GOOGLE ID TOKENS — the only identity assertion this API accepts. See
// docs/adr/0018.
//
// WHAT THIS REPLACES. Until the swap, establishing a session meant taking an
// Auth0 access token and calling Auth0's /userinfo with it to learn who the
// caller was — a network round trip on the login path, with a timeout and
// three failure branches. An ID token carries the same profile in its own
// signed claims, so the profile arrives with the credential and there is
// nothing to fetch.
// =============================================================================

// Google publishes both forms and its own documentation accepts either, so
// both are allowed here rather than picking one and discovering the other in
// production.
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

// The claims a user row needs. `email_verified` is required rather than
// optional: a token that omits it must not be read as verified by default.
//
// Unknown claims are ignored rather than rejected — this is Google's contract
// and it grows without asking us.
const IdTokenClaimsSchema = z.looseObject({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.url().optional(),
});

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

@Injectable()
export class GoogleIdentityService {
  private readonly logger = new Logger(GoogleIdentityService.name);

  private readonly clientId: string;

  // jose caches the fetched key set and rate-limits refetches on its own, so a
  // flood of tokens carrying unknown key ids cannot turn into a flood of
  // requests to Google. The same property jwks-rsa was configured for on the
  // Auth0 path.
  private readonly jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);

  constructor(config: ConfigService<Env, true>) {
    this.clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
  }

  // Verifies an ID token and returns the identity behind it.
  //
  // FOUR CHECKS, AND ALL FOUR MATTER. Signature against Google's published
  // keys; `iss` is Google; `aud` is THIS environment's client; and the email
  // is verified. Dropping the audience check is the subtle one — the signature
  // would still pass for a token Google minted for somebody else's
  // application entirely, and that token names a real Google user, so it would
  // sail through everything downstream and create an account under their
  // identity.
  //
  // ⚠️ THE NONCE IS NOT CHECKED HERE, and cannot be. Auth.js generates it and
  // validates it during the code exchange, against state this API does not
  // hold. What stands in its place is narrow but real: an ID token for this
  // client is only ever issued to a caller holding the client secret, which
  // lives solely in the web tier, and it is short-lived and audience-bound.
  // Stated plainly so that nobody later reads the absence as an oversight and
  // nobody assumes a protection that is not here.
  async verify(idToken: string): Promise<GoogleIdentity> {
    let claims: unknown;

    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        // Pinned. Google signs ID tokens with RS256, and left open a token
        // with `alg: none` would verify.
        algorithms: ['RS256'],
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
      });

      claims = payload;
    } catch (error) {
      // The reason is logged, not returned. Telling a caller which of the
      // checks failed helps whoever is probing this endpoint more than it
      // helps the one legitimate caller, which is this project's own web tier.
      this.logger.warn(
        `google id token failed verification: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw this.refuse();
    }

    const parsed = IdTokenClaimsSchema.safeParse(claims);
    if (!parsed.success) {
      // A signed token missing `email` or `sub` is Google's contract changing
      // under us, not an attack — so it is an error-level event even though
      // the caller sees the same refusal.
      this.logger.error(`google id token verified but did not parse: ${parsed.error.message}`);
      throw this.refuse();
    }

    // Refused rather than provisioned. `users.email` is unique, and an
    // unverified address is how one person comes to hold another's row.
    if (!parsed.data.email_verified) {
      this.logger.warn(`google id token for sub "${parsed.data.sub}" carries an unverified email`);
      throw new UnauthorizedException({
        code: API_ERROR_CODES.EMAIL_NOT_VERIFIED,
        message: 'This Google account has no verified email address.',
      });
    }

    return {
      sub: parsed.data.sub,
      email: parsed.data.email,
      name: parsed.data.name,
      picture: parsed.data.picture,
    };
  }

  private refuse(): UnauthorizedException {
    return new UnauthorizedException({
      code: API_ERROR_CODES.INVALID_GOOGLE_TOKEN,
      message: 'Could not establish identity',
    });
  }
}
