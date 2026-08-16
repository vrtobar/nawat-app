import { randomBytes } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

// Longer than any ID this service generates; anything larger is a client
// mistake or an attempt to bloat the logs.
const MAX_CLIENT_ID_LENGTH = 64;

// Conservative on purpose. A correlation ID is written into every log line for
// the request, so accepting arbitrary client text invites log forging — a
// newline in the value can fabricate a second log entry.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

declare module 'express' {
  interface Request {
    correlationId?: string;
  }
}

// Middleware, not an interceptor, and the distinction is load-bearing.
//
// NestJS runs middleware -> guards -> interceptors -> pipes -> handler. A guard
// rejecting a request throws before any interceptor executes, so an
// interceptor-assigned ID would be missing from precisely the 401s and 403s
// that someone is most likely to be chasing through the logs.
//
// The ID is attached to the request (read later by the exception filter and the
// response interceptor) and echoed as a header on every response, success or
// failure. It appears in the body only on errors — success responses carry it
// in the header alone, per the envelope contract in @nahuat/shared.
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(req);

    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}

// Exported because this middleware is not the first thing to run. NestJS
// registers body-parser ahead of configure() middleware, so a malformed JSON
// body throws before this executes — verified: such a request reaches the
// exception filter with req.correlationId unset.
//
// The filter calls this to recover, which is why the fallback must not be a
// constant. A fixed sentinel would give every malformed request the same id,
// and an id shared by everything identifies nothing — worse than none, because
// it looks real when a user quotes it in a support request.
export function resolveCorrelationId(req: Request): string {
  if (req.correlationId !== undefined) return req.correlationId;

  const supplied = req.header(CORRELATION_ID_HEADER);
  return isUsable(supplied) ? supplied : generate();
}

// A client may propagate its own ID so one trace spans services. Accepted only
// when it is plausibly an ID: no whitespace, no control characters, bounded
// length. Anything else is replaced rather than rejected — a malformed trace
// header is not worth failing a request over.
function isUsable(value: string | undefined): value is string {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= MAX_CLIENT_ID_LENGTH &&
    SAFE_ID.test(value)
  );
}

// `req_` prefix matches the documented shape and makes the value obvious in a
// log line. 8 random bytes is ample: these need to be unique among in-flight
// requests for debugging, not globally unique forever.
function generate(): string {
  return `req_${randomBytes(8).toString('base64url')}`;
}
