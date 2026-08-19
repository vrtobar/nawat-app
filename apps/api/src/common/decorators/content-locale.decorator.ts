import { DEFAULT_LOCALE, type JwtClaims, type Locale, LocaleSchema } from '@nahuat/shared';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

// The request as this file reads it: JwtStrategy attaches `user`, and it is
// absent on @Public() routes — which the dictionary largely is.
type LocaleRequest = Request & { user?: JwtClaims };

// Resolves which locale a content response is served in, in the order fixed by
// ADR 0015 §4:
//
//   1. explicit ?locale=   — an override, and it wins over everything. This is
//      what lets a user's locale change take effect instantly with no new
//      token: the frontend sends the new value while the token default catches
//      up on its next refresh (see JwtClaimsSchema in @nahuat/shared).
//   2. the stored preference — User.locale, carried on the token as
//      request.user.locale, so reading it costs no query. Absent on public
//      requests and on tokens minted before the claim existed.
//   3. Accept-Language     — the browser's preference, for anonymous dictionary
//      browsing that sent no explicit locale.
//   4. 'es'                — the default; the people who know Nawat read Spanish.
//
// Exported as a plain function, separate from the decorator, so the order can
// be unit-tested without building a NestJS execution context — the same split
// as resolveCorrelationId in correlation-id.middleware.
export function resolveContentLocale(req: LocaleRequest): Locale {
  // 1. Explicit ?locale=. safeParse rejects anything that is not 'es'/'en' —
  //    a stray ?locale=fr, or the array Express produces for a repeated param —
  //    which falls through rather than erroring. An unusable override is
  //    ignored, not fatal.
  const explicit = LocaleSchema.safeParse(req.query.locale);
  if (explicit.success) return explicit.data;

  // 2. The authenticated user's stored preference, off the token. Already
  //    validated by JwtStrategy; undefined when there is no user or the token
  //    predates the claim.
  const stored = req.user?.locale;
  if (stored) return stored;

  // 3. Accept-Language. Express negotiates against the languages we actually
  //    serve and returns the best match, or false when none matches.
  const negotiated = req.acceptsLanguages('es', 'en');
  if (negotiated === 'es' || negotiated === 'en') return negotiated;

  // 4. Default.
  return DEFAULT_LOCALE;
}

// @ContentLocale() — the resolved 'es' | 'en' for the current request.
//
//   @Get()
//   list(@ContentLocale() locale: Locale) {}
//
// Synchronous and DI-free: everything it needs is already on the request by the
// time param decorators run — the query string, the Accept-Language header, and
// request.user from JwtStrategy. No interceptor, no per-request database read.
export const ContentLocale = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Locale =>
    resolveContentLocale(context.switchToHttp().getRequest<LocaleRequest>()),
);
