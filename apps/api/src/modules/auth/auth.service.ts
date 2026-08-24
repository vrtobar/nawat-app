import { prisma } from '@nahuat/database';
import type { JwtClaims } from '@nahuat/shared';
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { LOCALE_TO_WIRE } from '../../common/locale';
import type { Env } from '../../config/env.validation';

// Prisma's unique-constraint violation.
const UNIQUE_VIOLATION = 'P2002';

// The auth path must not hang on a slow Auth0. Only reached when provisioning
// a user seen for the first time, so the timeout costs nothing on the hot path.
const USERINFO_TIMEOUT_MS = 5000;

// Auth0's /userinfo response, narrowed to what a user row needs. Everything
// except `sub` is optional because it depends on the connection: email OTP
// supplies no name, and only some providers return a picture. Unknown fields
// are ignored rather than rejected — this is someone else's contract, and it
// grows without asking us.
const UserInfoSchema = z.object({
  sub: z.string(),
  email: z.email().optional(),
  name: z.string().optional(),
  picture: z.url().optional(),
});

// Resolves the identity behind a verified access token.
//
// Until 2026-08-24 this was a login-time sync: an Auth0 Post Login Action
// called POST /auth/role, which upserted the user and returned role/userId for
// the Action to stamp onto the token as custom claims. Authorization then cost
// no query. See docs/adr/0013 for why that was reversed — briefly: the Action
// was undeployable (a file pasted into a dashboard), it made login depend on
// the API being reachable, one Action could not serve local and staging, and a
// role or deactivation change did not take effect until the user signed in
// again.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  // Called once per authenticated request by JwtStrategy.validate(), after the
  // signature, issuer, audience and expiry have already passed. One indexed
  // read on users.auth0Id (unique btree); a request that gets this far is
  // about to query the database for its actual work anyway.
  async resolveIdentity(auth0Id: string, accessToken: string): Promise<JwtClaims> {
    const existing = await prisma.user.findUnique({
      where: { auth0Id },
      select: { id: true, role: true, locale: true, deletedAt: true, isActive: true },
    });

    if (!existing) {
      return this.provision(auth0Id, accessToken);
    }

    // The deactivation gate. It used to run at login, which left a deactivated
    // user holding a working token until it expired — up to an hour, which
    // ADR 0013 accepted as a tradeoff of not querying. Checking here closes
    // that: DELETE /users/:id takes effect on the victim's very next request.
    if (existing.deletedAt !== null || !existing.isActive) {
      throw new ForbiddenException({
        code: 'USER_DEACTIVATED',
        message: 'This account has been deactivated',
      });
    }

    return {
      sub: auth0Id,
      userId: existing.id,
      role: existing.role,
      locale: LOCALE_TO_WIRE[existing.locale],
    };
  }

  // First request from an account that has never been seen. The access token
  // carries `sub` and nothing else useful — email, name and picture live on the
  // ID token, which the browser holds and the API never receives — so the
  // profile is fetched from Auth0 rather than taken from the client. That
  // matters: a client-supplied profile would let a caller choose the email
  // attached to their own row, and email is a unique column.
  private async provision(auth0Id: string, accessToken: string): Promise<JwtClaims> {
    const profile = await this.fetchUserInfo(accessToken);

    // Auth0 returns the token's own subject. A mismatch means the token and the
    // profile describe different people, which should be impossible — refuse
    // rather than create a row under the wrong identity.
    if (profile.sub !== auth0Id) {
      this.logger.error(`userinfo sub "${profile.sub}" does not match token sub "${auth0Id}"`);
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Could not establish identity',
      });
    }

    // email is non-null and unique in the schema, so there is no row to create
    // without it. Every connection in use returns one; a connection that did
    // not would need a deliberate decision about what identifies the user, not
    // a synthesized placeholder that quietly occupies the unique index.
    if (!profile.email) {
      this.logger.error(`userinfo returned no email for "${auth0Id}"`);
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Could not establish identity',
      });
    }

    try {
      const created = await prisma.user.create({
        data: {
          auth0Id,
          email: profile.email,
          // name is non-nullable in the database and some connections omit it
          // (email OTP in particular); the email stands in, as it did in the
          // Action this replaced.
          name: profile.name ?? profile.email,
          pictureUrl: profile.picture ?? null,
        },
        select: { id: true, role: true, locale: true },
      });

      return {
        sub: auth0Id,
        userId: created.id,
        role: created.role,
        locale: LOCALE_TO_WIRE[created.locale],
      };
    } catch (error) {
      // Two concurrent first requests can both miss and both insert — more
      // likely now than at login time, since a page load fires several requests
      // at once. The loser gets P2002; re-reading is correct because the winner
      // wrote exactly what this call would have.
      if (isUniqueViolation(error)) {
        const raced = await prisma.user.findUniqueOrThrow({
          where: { auth0Id },
          select: { id: true, role: true, locale: true },
        });

        return {
          sub: auth0Id,
          userId: raced.id,
          role: raced.role,
          locale: LOCALE_TO_WIRE[raced.locale],
        };
      }

      throw error;
    }
  }

  private async fetchUserInfo(accessToken: string): Promise<z.infer<typeof UserInfoSchema>> {
    const domain = this.config.get('AUTH0_DOMAIN', { infer: true });

    let response: Response;
    try {
      response = await fetch(`https://${domain}/userinfo`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
      });
    } catch (error) {
      // Unreachable or timed out. 401 rather than 503: the caller's own next
      // request may well succeed, and this is the authentication path, so the
      // client should retry the request rather than treat the API as down.
      this.logger.error(`userinfo request failed: ${String(error)}`);
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Could not establish identity',
      });
    }

    if (!response.ok) {
      this.logger.error(`userinfo returned ${response.status}`);
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Could not establish identity',
      });
    }

    const parsed = UserInfoSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      this.logger.error(`userinfo response did not parse: ${parsed.error.message}`);
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Could not establish identity',
      });
    }

    return parsed.data;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
