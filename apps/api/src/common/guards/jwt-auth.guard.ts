import { API_ERROR_CODES } from '@nahuat/shared';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthService } from '../../modules/auth/auth.service';
import { TokenService } from '../../modules/auth/token.service';
import { IS_PUBLIC } from '../decorators/public.decorator';

// Registered globally via APP_GUARD, so every route requires a valid access
// token unless it carries @Public(). Authentication is the default and
// exposure is the explicit act — the reverse default leaks endpoints silently,
// because nothing fails when a decorator is forgotten.
//
// NO PASSPORT. This extended AuthGuard('jwt') until the identity change, and
// dropping it removed the file's sharpest edge rather than adding one. Passport
// reports a verification failure on `info` and anything thrown by the strategy
// on `err`, with different rules about which is safe to show a caller — and
// collapsing the two once put a Prisma error, with its failing query and
// absolute source paths, into a client response. Below, the two sources are
// two statements, and which one may speak is visible in the code rather than
// in a convention.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // getAllAndOverride so @Public() works on a controller class as well as a
    // handler — the health controller marks the whole class.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();

    const token = bearerToken(request);
    if (token === undefined) {
      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required',
      });
    }

    // VERIFICATION. Signature against the key named by the token's `kid`,
    // algorithm, issuer, audience and expiry. Throws an UnauthorizedException
    // already carrying jose's own reason — 'signature verification failed',
    // '"exp" claim timestamp check failed' — which is safe to surface and is
    // exactly the diagnosis a caller needs: expired means refresh and retry,
    // bad signature means the client is wrong. Nothing in that path touches the
    // database or an external service, so there is no operator detail in it.
    const { userId } = await this.tokenService.verifyAccessToken(token);

    // THEN IDENTITY, and it is a separate statement because the rules differ.
    // This one reads the database, so an unexpected throw can carry a message
    // written for an operator — which is how a Prisma error once reached a
    // client. Only a deliberate refusal this codebase constructed, with a
    // payload it chose, is allowed through.
    try {
      request.user = await this.authService.resolveIdentity(userId);
    } catch (error) {
      if (error instanceof HttpException) {
        // ACCOUNT_NOT_PROVISIONED (401) and USER_DEACTIVATED (403). The status
        // matters: flattening the second into a 401 tells someone whose
        // account is disabled to sign in again, which is advice that cannot
        // work.
        throw error;
      }

      // Not surfaced to the caller, so log it here or the diagnosis is lost
      // entirely.
      this.logger.error(
        `identity resolution failed unexpectedly: ${
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        }`,
      );

      throw new UnauthorizedException({
        code: API_ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required',
      });
    }

    return true;
  }
}

// `Authorization: Bearer <token>`. The scheme is compared case-insensitively
// because RFC 7235 defines it that way and clients do vary; the token itself
// is not touched.
function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') {
    return undefined;
  }

  const [scheme, value, ...rest] = header.split(' ');

  // `rest` must be empty: a header with extra segments is malformed, and
  // taking the second one regardless would accept it.
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || rest.length > 0) {
    return undefined;
  }

  return value.length > 0 ? value : undefined;
}
