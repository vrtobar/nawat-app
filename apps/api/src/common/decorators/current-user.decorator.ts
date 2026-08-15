import type { JwtClaims } from '@nahuat/shared';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

// Pulls the verified claims JwtStrategy.validate() attached to the request.
//
//   @Get('me')
//   me(@CurrentUser() user: JwtClaims) {}
//
// Only valid on routes the global JwtAuthGuard protects. On a @Public() route
// there is no authenticated user and this yields undefined, which is why the
// return type is not optional — a handler wanting both cases should read the
// request directly and say so.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtClaims => {
    return context.switchToHttp().getRequest<{ user: JwtClaims }>().user;
  },
);
