import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { prisma } from '@nahuat/database';
import { API_ERROR_CODES } from '@nahuat/shared';
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.validation';

// =============================================================================
// REFRESH TOKENS — issuing, rotation, and reuse detection. See docs/adr/0018.
//
// A FAMILY IS A SESSION. Every token rotated out of one login carries the same
// `familyId`, and revocation acts on the family rather than on a token —
// because by the time revocation matters the token in hand is already spent.
// That is also what lets this system express "end this session" as something
// different from "disable this account", which per-request identity resolution
// cannot do on its own.
// =============================================================================

// 32 bytes of CSPRNG output. base64url so it survives a JSON body, a header
// and a URL without escaping; 43 characters.
const TOKEN_BYTES = 32;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  private readonly absoluteTtlMs: number;
  private readonly idleTtlMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.absoluteTtlMs =
      config.get('REFRESH_TOKEN_ABSOLUTE_TTL_DAYS', { infer: true }) * MS_PER_DAY;
    this.idleTtlMs = config.get('REFRESH_TOKEN_IDLE_TTL_DAYS', { infer: true }) * MS_PER_DAY;
  }

  // SHA-256, not bcrypt or argon2. Those are deliberately slow so that guessing
  // a human-chosen password is expensive; this value is 32 random bytes and
  // there is nothing to guess. The decisive reason is structural rather than
  // performance: a salted hash cannot be looked up, so every refresh would scan
  // the table and compare row by row, where a digest is a unique-index seek.
  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // A NEW session. Called once per login, by the endpoint that establishes one.
  async issue(userId: string): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const now = Date.now();

    await prisma.refreshToken.create({
      data: {
        // Generated here rather than derived from the row's own id, which would
        // need the insert to have happened first and so cost a second write —
        // and would leave the row briefly holding a family it is not in.
        familyId: randomUUID(),
        userId,
        tokenHash: RefreshTokenService.hash(token),
        familyExpiresAt: new Date(now + this.absoluteTtlMs),
        idleExpiresAt: new Date(now + this.idleTtlMs),
      },
    });

    return token;
  }

  // Spends a token and issues its successor.
  //
  // Every refusal below revokes the whole family rather than the single row.
  // An expired or abandoned session has no reason to keep its other tokens
  // alive, and a reused one must not.
  async rotate(presented: string): Promise<{ userId: string; refreshToken: string }> {
    const tokenHash = RefreshTokenService.hash(presented);

    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        familyId: true,
        userId: true,
        familyExpiresAt: true,
        idleExpiresAt: true,
        usedAt: true,
        revokedAt: true,
        // Free here — the row is being read anyway — and it closes a gap that
        // would otherwise let a deactivated account refresh indefinitely. Its
        // access tokens are refused on every request, so nothing is granted;
        // but the session would never end and its rows would accumulate.
        user: { select: { isActive: true, deletedAt: true } },
      },
    });

    if (!existing) {
      throw this.refuse('presented a refresh token that does not exist');
    }

    if (existing.revokedAt !== null) {
      throw this.refuse(`presented a revoked token from family ${existing.familyId}`);
    }

    // ⚠️ REUSE. A spent token presented again is either an attacker replaying a
    // stolen one or a client racing itself, and the OAuth 2.0 Security BCP
    // treats both as compromise: the family dies. The log line is the only
    // place the two can be told apart later, so it carries what that would
    // need.
    if (existing.usedAt !== null) {
      await this.revokeFamilyById(existing.familyId);
      this.logger.warn(
        `refresh token reuse detected — family ${existing.familyId} ` +
          `(user ${existing.userId}) revoked; token was first spent at ` +
          `${existing.usedAt.toISOString()}`,
      );
      throw this.refuse();
    }

    const now = new Date();

    if (existing.familyExpiresAt <= now) {
      await this.revokeFamilyById(existing.familyId);
      throw this.refuse(`family ${existing.familyId} reached its absolute expiry`);
    }

    if (existing.idleExpiresAt <= now) {
      await this.revokeFamilyById(existing.familyId);
      throw this.refuse(`family ${existing.familyId} was idle past its expiry`);
    }

    if (existing.user.deletedAt !== null || !existing.user.isActive) {
      await this.revokeFamilyById(existing.familyId);
      throw new ForbiddenException({
        code: API_ERROR_CODES.USER_DEACTIVATED,
        message: 'This account has been deactivated',
      });
    }

    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    // ONE TRANSACTION, and the conditional spend is the whole point of it.
    //
    // `usedAt: null` in the WHERE is what makes rotation single-use under
    // concurrency. Read-then-write would let two simultaneous refreshes both
    // observe null and both succeed — not merely issuing two successors, but
    // leaving neither marked as reused, so the detection above could never
    // fire. The same optimistic-lock shape the entry editor uses on
    // `updatedAt`.
    //
    // The insert shares the transaction so a failure between the two cannot
    // spend a token without producing its successor, which would end the
    // session silently and look to the user like a random logout.
    const [spent] = await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: { id: existing.id, usedAt: null },
        data: { usedAt: now },
      }),
      prisma.refreshToken.create({
        data: {
          familyId: existing.familyId,
          userId: existing.userId,
          tokenHash: RefreshTokenService.hash(token),
          // INHERITED, not recomputed. The absolute deadline belongs to the
          // family: reset on every rotation, a session refreshed hourly would
          // never end and the 30-day cap would mean nothing.
          familyExpiresAt: existing.familyExpiresAt,
          idleExpiresAt: new Date(now.getTime() + this.idleTtlMs),
        },
      }),
    ]);

    // Lost the race against a concurrent refresh of the same token. Indistinguishable
    // from reuse at this point, and treated as such — a client firing two
    // refreshes in parallel logs itself out, which is the behaviour the BCP
    // asks for and the reason a client should serialise them.
    if (spent.count !== 1) {
      await this.revokeFamilyById(existing.familyId);
      this.logger.warn(
        `refresh token spent concurrently — family ${existing.familyId} ` +
          `(user ${existing.userId}) revoked`,
      );
      throw this.refuse();
    }

    return { userId: existing.userId, refreshToken: token };
  }

  // Ends the session a token belongs to. Used by logout.
  //
  // Deliberately silent about an unknown token: logging out is not a place to
  // tell a caller whether a credential was real, and the outcome they wanted —
  // that this token no longer works — holds either way.
  async revokeFamily(presented: string): Promise<void> {
    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash: RefreshTokenService.hash(presented) },
      select: { familyId: true },
    });

    if (existing) {
      await this.revokeFamilyById(existing.familyId);
    }
  }

  private async revokeFamilyById(familyId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // One code for every refusal, so a caller cannot learn which of the
  // conditions it hit — see REFRESH_TOKEN_INVALID in packages/shared for why
  // reuse in particular is not reported distinctly. The reason is logged
  // instead, where it can answer a question later without answering one now.
  private refuse(reason?: string): UnauthorizedException {
    if (reason) {
      this.logger.warn(reason);
    }

    return new UnauthorizedException({
      code: API_ERROR_CODES.REFRESH_TOKEN_INVALID,
      message: 'This session has expired. Please sign in again.',
    });
  }
}
