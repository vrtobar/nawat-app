import { prisma, Provider } from '@nahuat/database';
import { API_ERROR_CODES, type JwtClaims, type UserProfile } from '@nahuat/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import { LOCALE_TO_WIRE } from '../../common/locale';
import { isPrismaError, PRISMA_ERROR, uniqueViolationFields } from '../../common/prisma-error';
import { toUserProfile, USER_PROFILE_SELECT } from '../../common/user-profile';
import type { GoogleIdentity } from './google-identity.service';

// Resolves the identity behind a verified access token, and creates the account
// at login.
//
// Until 2026-08-24 this was a login-time sync: an Auth0 Post Login Action
// called POST /auth/role, which upserted the user and returned role/userId for
// the Action to stamp onto the token as custom claims. Authorization then cost
// no query. See docs/adr/0013 for why that was reversed — briefly: the Action
// was undeployable (a file pasted into a dashboard), it made login depend on
// the API being reachable, one Action could not serve local and staging, and a
// role or deactivation change did not take effect until the user signed in
// again.
//
// THE PROFILE NOW ARRIVES WITH THE CREDENTIAL. This class used to call Auth0's
// /userinfo on every login, because an access token carries `sub` and nothing
// else useful. A Google ID token carries the profile in its own signed claims,
// so the fetch, its timeout and its four failure branches are gone — and with
// them the case where a login hung on a slow identity provider.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // Called once per authenticated request by JwtAuthGuard, after the signature,
  // issuer, audience and expiry have already passed. A primary-key read; a
  // request that gets this far is about to query the database for its actual
  // work anyway.
  //
  // TAKES User.id, NOT THE PROVIDER'S SUBJECT. The access token's `sub` is this
  // system's own user id — see token.service.ts — so identity resolution never
  // has to know which provider vouched for the person. That is what makes
  // adding a second provider a change to the login path alone.
  //
  // A PURE READ as of 2026-08-25. It used to provision a missing row here, and
  // that had two problems. It made "logged in" and "has an account" different
  // states, so a session could exist with no account and the discrepancy
  // surfaced later at an arbitrary request. And because a missing row was an
  // expected condition rather than a fault, **hard-deleting a user silently
  // re-created them** on their next request: the soft-delete gate below cannot
  // see a row that is gone. Accounts are now created at login by
  // startSession(), and a missing row here is a fault.
  async resolveIdentity(userId: string): Promise<JwtClaims> {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, locale: true, deletedAt: true, isActive: true },
    });

    if (!existing) {
      // 401, not 404: the credential is valid and the caller is who they say
      // they are — there is simply no account behind it any more, which means
      // the row was hard-deleted while the token was still live. Signing in
      // again fixes it, because that is the path that creates one.
      this.logger.warn(`no account for verified user id "${userId}"`);
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
  async startSession(identity: GoogleIdentity): Promise<UserProfile> {
    // The PAIR, not the subject alone. `subject` carries no unique constraint
    // of its own, because two providers may legitimately issue the same string.
    const where = { provider_subject: { provider: Provider.GOOGLE, subject: identity.sub } };

    const existing = await prisma.user.findUnique({
      where,
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
        where,
        data: {
          name: identity.name ?? identity.email,
          pictureUrl: identity.picture ?? null,
          lastLoginAt: new Date(),
        },
        select: USER_PROFILE_SELECT,
      });

      return toUserProfile(updated);
    }

    return this.provision(identity);
  }

  // An account that has never been seen.
  //
  // The profile comes from the ID TOKEN'S OWN CLAIMS, which Google signed, not
  // from anything the caller composed. That is the property that matters here
  // and it is easy to lose: a client-supplied profile would let a caller choose
  // the email attached to their row, and email is a unique column — so choosing
  // it is choosing whose row you collide with.
  private async provision(identity: GoogleIdentity): Promise<UserProfile> {
    try {
      const created = await prisma.user.create({
        data: {
          provider: Provider.GOOGLE,
          subject: identity.sub,
          email: identity.email,
          // name is non-nullable in the database and Google does not always
          // supply one; the email stands in.
          name: identity.name ?? identity.email,
          pictureUrl: identity.picture ?? null,
          // Stamped on creation, not left null: the row exists because a login
          // happened, and this is that login.
          lastLoginAt: new Date(),
        },
        select: USER_PROFILE_SELECT,
      });

      return toUserProfile(created);
    } catch (error) {
      // WHICH unique constraint matters. `users` holds three — the
      // (provider, subject) pair, email and username — and the original code assumed any P2002 here meant a
      // concurrent insert of the same subject. It does not.
      const fields = uniqueViolationFields(error);

      // A Google subject presenting an email that already belongs to another
      // row. Much rarer with one provider than it was with two — the Auth0-era
      // case was the same person signing in with Google and with an email
      // code, producing two subjects — but not impossible: a Workspace address
      // can be deleted and reissued to a new account, which carries a new
      // `sub`.
      //
      // Refused, not merged. Linking them would mean deciding that a matching
      // email proves the same person, and getting that wrong is an account
      // takeover rather than an inconvenience.
      //
      // The message deliberately does not say the address is registered.
      // Doing so would confirm to any caller which emails have accounts here.
      if (fields.includes('email')) {
        this.logger.warn(
          `email already registered under a different subject (sub "${identity.sub}")`,
        );
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
          where: {
            provider_subject: { provider: Provider.GOOGLE, subject: identity.sub },
          },
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
          `unique violation on user create for sub "${identity.sub}" ` +
            `(fields: ${fields.length > 0 ? fields.join(', ') : 'unreadable'}) ` +
            `and no row is readable under that subject`,
        );
        throw new UnauthorizedException({
          code: API_ERROR_CODES.UNAUTHORIZED,
          message: 'Could not establish identity',
        });
      }

      throw error;
    }
  }
}
