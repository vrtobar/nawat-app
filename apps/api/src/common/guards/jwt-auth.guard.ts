import {
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC } from '../decorators/public.decorator';

// Registered globally via APP_GUARD, so every route requires a valid Auth0
// token unless it carries @Public(). Authentication is the default and
// exposure is the explicit act — the reverse default leaks endpoints silently,
// because nothing fails when a decorator is forgotten.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    // getAllAndOverride so @Public() works on a controller class as well as a
    // handler — the health controller marks the whole class.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  // Passport's default throws a bare UnauthorizedException whose body does not
  // match the error envelope. Overridden so the reason survives into the
  // documented shape: the filter passes a structured payload through intact,
  // and 'jwt expired' versus 'invalid signature' is the difference between the
  // client refreshing and the client being wrong.
  override handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    // An HttpException from validate() is a deliberate, already-shaped refusal
    // — USER_DEACTIVATED being the one that exists — so it passes through
    // untouched. Without this it would be flattened into the generic 401 below
    // and the caller would be told to re-authenticate, which for a deactivated
    // account is advice that cannot work. Verification failures do not arrive
    // this way: passport reports those on `info`.
    if (err instanceof HttpException) {
      throw err;
    }

    if (err || !user) {
      // An unexpected error from validate() is not surfaced to the caller (see
      // describe), so log it here or the diagnosis is lost entirely. Guarded on
      // `err` being a non-HttpException, since the deliberate refusals already
      // returned above and passport's own verification failures on `info` are
      // ordinary traffic, not incidents.
      if (err instanceof Error) {
        this.logger.error(`authentication failed unexpectedly: ${err.stack ?? err.message}`);
      }

      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        // `info` first because it carries the verification failure — expired,
        // bad signature, no token. `err` covers anything the strategy's
        // validate() threw, which `info` does not report.
        //
        // Reading only `info` cost real time on 2026-08-16: a token rejected
        // for missing claims returned "Authentication required", the reason
        // was discarded, and the token had to be decoded by hand to find a
        // fault the API had already diagnosed.
        message: describeInfo(info) ?? describeThrown(err) ?? 'Authentication required',
      });
    }

    return user;
  }
}

// TWO SOURCES, TWO RULES. They were one function until 2026-08-24, and merging
// them is what let a Prisma error reach a client — message, failing query,
// absolute source path and surrounding lines.
//
// `info` is passport's own verification outcome: a TokenExpiredError or
// JsonWebTokenError from `jsonwebtoken`, or a plain string when no token was
// supplied. Its messages are a closed set written by that library — 'jwt
// expired', 'invalid signature', 'jwt malformed' — and they are exactly the
// diagnosis a caller needs, so an Error message is safe to surface here.
function describeInfo(reason: unknown): string | undefined {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return undefined;
}

// `err` is whatever `validate()` threw. Since 2026-08-24 that method queries
// the database and calls Auth0, so it can be a driver or HTTP client error
// whose message is written for an operator and may quote internals.
//
// Only an HttpException is returned — one this codebase constructed on purpose,
// with a payload it chose. Anything else degrades to `undefined` and the caller
// sees the generic 'Authentication required'. The diagnosis is not lost;
// handleRequest logs it.
function describeThrown(reason: unknown): string | undefined {
  if (typeof reason === 'string') return reason;

  if (reason instanceof HttpException) {
    const payload = reason.getResponse();
    if (typeof payload === 'string') return payload;
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const { message } = payload as { message: unknown };
      if (typeof message === 'string') return message;
    }
    return reason.message;
  }

  return undefined;
}
