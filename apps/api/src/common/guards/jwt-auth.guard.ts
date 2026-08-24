import {
  type ExecutionContext,
  HttpException,
  Injectable,
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
        message: describe(info) ?? describe(err) ?? 'Authentication required',
      });
    }

    return user;
  }
}

// passport-jwt reports verification failures in `info` — a TokenExpiredError,
// JsonWebTokenError, or a plain string when no token was supplied. Errors
// thrown inside validate() arrive as `err`, wrapped in an HttpException whose
// payload holds the message.
function describe(reason: unknown): string | undefined {
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

  if (reason instanceof Error && reason.message) return reason.message;

  return undefined;
}
