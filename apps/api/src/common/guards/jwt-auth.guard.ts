import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
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
    if (err || !user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: describe(info) ?? 'Authentication required',
      });
    }

    return user;
  }
}

// passport-jwt reports the cause in `info` — a TokenExpiredError,
// JsonWebTokenError, or a plain string when no token was supplied at all.
function describe(info: unknown): string | undefined {
  if (typeof info === 'string') return info;
  if (info instanceof Error && info.message) return info.message;
  return undefined;
}
