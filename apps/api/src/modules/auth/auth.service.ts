import { prisma } from '@nahuat/database';
import { API_ERROR_CODES, type JwtClaims, type UserProfile } from '@nahuat/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { LOCALE_TO_WIRE } from '../../common/locale';
import { isPrismaError, PRISMA_ERROR, uniqueViolationFields } from '../../common/prisma-error';
import { toUserProfile, USER_PROFILE_SELECT } from '../../common/user-profile';
import type { Env } from '../../config/env.validation';

// The login path must not hang on a slow Auth0. Reached once per login rather
// than once per request, so it is nowhere near the hot path — but a login that
// hangs is worse than one that fails, because the user has nothing to retry.
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
  //
  // A PURE READ as of 2026-08-25. It used to provision a missing row here, and
  // that had two problems. It made "logged in" and "has an account" different
  // states, so a session could exist with no account and the discrepancy
  // surfaced later at an arbitrary request. And because a missing row was an
  // expected condition rather than a fault, **hard-deleting a user silently
  // re-created them** on their next request: the soft-delete gate below cannot
  // see a row that is gone. Accounts are now created at login by
  // startSession(), and a missing row here is a fault.
  async resolveIdentity(auth0Id: string): Promise<JwtClaims> {
    const existing = await prisma.user.findUnique({
      where: { auth0Id },
      select: { id: true, role: true, locale: true, deletedAt: true, isActive: true },
    });

    if (!existing) {
      // 401, not 404: the credential is valid and the caller is who they say
      // they are — there is simply no account behind the subject. Signing in
      // again fixes it, because that is the path that creates one.
      this.logger.warn(`no account for verified sub "${auth0Id}"`);
      throw new UnauthorizedException({
        code: API_ERROR_CODES.ACCOUNT_NOT_PROVISIONED,
        message: 'No account exists for this sign-in. Please sign in again.',
      });
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

  // A login just happened. Called by POST /auth/session, which the web
  // callback invokes once per sign-in with the token it just received.
  //
  // This is the ONLY path that creates an account. It also re-syncs the
  // profile, which nothing did between the Post Login Action's deletion on
  // 2026-08-24 and this: a name or avatar changed at the identity provider
  // never propagated, because the row was written once and never revisited.
  //
  // Deliberately refuses a deactivated account rather than stamping a login on
  // it. Telling someone at sign-in that their account is disabled is a better
  // answer than letting them in and failing every subsequent request.
  async startSession(auth0Id: string, accessToken: string): Promise<UserProfile> {
    const profile = await this.fetchUserInfo(accessToken);
    this.assertProfileUsable(auth0Id, profile);

    const existing = await prisma.user.findUnique({
      where: { auth0Id },
      select: { id: true, deletedAt: true, isActive: true },
    });

    if (existing) {
      if (existing.deletedAt !== null || !existing.isActive) {
        throw new ForbiddenException({
          code: API_ERROR_CODES.USER_DEACTIVATED,
          message: 'This account has been deactivated',
        });
      }

      // email is not re-synced — see the schema comment. It is the unique key,
      // so following a change upstream risks colliding with another row, and
      // the collision would surface as a failed login for someone who changed
      // nothing.
      const updated = await prisma.user.update({
        where: { auth0Id },
        data: {
          name: profile.name ?? profile.email,
          pictureUrl: profile.picture ?? null,
          lastLoginAt: new Date(),
        },
        select: USER_PROFILE_SELECT,
      });

      return toUserProfile(updated);
    }

    return this.provision(auth0Id, profile);
  }

  // Rejects a /userinfo response that cannot produce a row, before any write.
  private assertProfileUsable(
    auth0Id: string,
    profile: z.infer<typeof UserInfoSchema>,
  ): asserts profile is z.infer<typeof UserInfoSchema> & { email: string } {
    // Auth0 returns the token's own subject. A mismatch means the token and the
    // profile describe different people, which should be impossible — refuse
    // rather than create a row under the wrong identity.
    if (profile.sub !== auth0Id) {
      this.logger.error(`userinfo sub "${profile.sub}" does not match token sub "${auth0Id}"`);
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
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
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Could not establish identity',
      });
    }
  }

  // An account that has never been seen. The access token carries `sub` and
  // nothing else useful — email, name and picture live on the ID token, which
  // the browser holds and the API never receives — so the profile is fetched
  // from Auth0 rather than taken from the client. That matters: a
  // client-supplied profile would let a caller choose the email attached to
  // their own row, and email is a unique column.
  private async provision(
    auth0Id: string,
    profile: z.infer<typeof UserInfoSchema> & { email: string },
  ): Promise<UserProfile> {
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
          // Stamped on creation, not left null: the row exists because a login
          // happened, and this is that login.
          lastLoginAt: new Date(),
        },
        select: USER_PROFILE_SELECT,
      });

      return toUserProfile(created);
    } catch (error) {
      // WHICH unique constraint matters. `users` holds three — auth0_id, email
      // and username — and the original code assumed any P2002 here meant a
      // concurrent insert of the same subject. It does not.
      const fields = uniqueViolationFields(error);

      // A second Auth0 identity carrying an email that already belongs to
      // someone. Auth0 keys identity on connection + subject, so signing in
      // with Google and with an email code produce different `sub` values for
      // the same person, and the second one arrives here as a brand new user
      // whose email is taken.
      //
      // Refused, not merged. Linking the two would mean deciding that a
      // matching email proves the same person, which is only true when both
      // addresses are verified — and getting that wrong is an account
      // takeover, not an inconvenience. See the BACKLOG entry.
      //
      // The message deliberately does not name which connection owns the
      // address. Doing so would confirm to any caller that a given email is
      // registered here.
      if (fields.includes('email')) {
        this.logger.warn(`email already registered under a different auth0Id (sub "${auth0Id}")`);
        throw new ConflictException({
          code: API_ERROR_CODES.EMAIL_ALREADY_REGISTERED,
          message:
            'An account already exists for this email address. ' +
            'Sign in the way you did the first time.',
        });
      }

      // Any other P2002 is treated as the genuine race until proven otherwise:
      // two concurrent first requests both missed and both inserted. More
      // likely than it was at login time, since a page load fires several
      // requests at once. Re-reading is correct because the winner wrote
      // exactly what this call would have.
      //
      // This arm also catches a P2002 whose fields could not be read at all.
      // uniqueViolationFields reaches into an adapter-specific error shape and
      // returns [] if that shape ever moves, and the recovery must not depend
      // on it: a genuine race failing because Prisma reorganised an error would
      // be a worse bug than the one being fixed.
      if (isPrismaError(error, PRISMA_ERROR.UNIQUE_VIOLATION)) {
        const raced = await prisma.user.findUnique({
          where: { auth0Id },
          select: USER_PROFILE_SELECT,
        });

        // findUnique, not findUniqueOrThrow. A miss means this was not a race
        // at all — some other constraint collided, or the fields were
        // unreadable and the email case fell through to here — and the Prisma
        // NotFoundError that findUniqueOrThrow raises carries file paths and
        // source lines. That is exactly how a stack trace reached a client on
        // 2026-08-24.
        if (raced) {
          return toUserProfile(raced);
        }

        this.logger.error(
          `unique violation on user create for sub "${auth0Id}" ` +
            `(fields: ${fields.length > 0 ? fields.join(', ') : 'unreadable'}) ` +
            `and no row is readable under that auth0Id`,
        );
        throw new UnauthorizedException({
          code: API_ERROR_CODES.UNAUTHORIZED,
          message: 'Could not establish identity',
        });
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
