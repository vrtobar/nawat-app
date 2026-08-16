import { API_ERROR_CODES, type ApiError, type ApiErrorDetail } from '@nahuat/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from '../middleware/correlation-id.middleware';

// Every error leaves the API in the envelope shape declared in @nahuat/shared:
//
//   { success: false, error: { code, message, correlationId, details? } }
//
// @Catch() with no argument takes everything, not just HttpException, so an
// unexpected throw anywhere in the request path still produces the documented
// shape rather than Express's default HTML error page.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Normally assigned by CorrelationIdMiddleware. It is not always: NestJS
    // registers body-parser ahead of configure() middleware, so a malformed
    // JSON body throws before the middleware runs. resolveCorrelationId falls
    // back to the client's header, or generates one — never a fixed sentinel,
    // which would make every such request share an id that traces nothing.
    const correlationId = resolveCorrelationId(req);

    // The middleware sets this header on responses it sees. For the requests
    // it never saw, this is the only place it can be set, and the id is no use
    // to a caller who cannot read it.
    if (!res.headersSent) {
      res.setHeader(CORRELATION_ID_HEADER, correlationId);
    }

    const { code, message, details } = describe(exception, status);

    // 5xx is either a bug or a dependency failure; both need the stack and the
    // correlation ID together, because the client only ever sees the ID.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${req.method} ${req.url} -> ${status} [${correlationId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiError = {
      success: false,
      error: { code, message, correlationId, ...(details ? { details } : {}) },
    };

    res.status(status).json(body);
  }
}

interface Described {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

function describe(exception: unknown, status: number): Described {
  if (exception instanceof HttpException) {
    const payload = exception.getResponse();

    // ZodValidationPipe and the domain services throw with a structured
    // payload, which is passed through as-is. This is the path that carries
    // ENTRY_NOT_FOUND, TRANSLATION_IN_USE and the rest of API_ERROR_CODES.
    if (isStructured(payload)) {
      return {
        code: payload.code,
        message: payload.message,
        details: payload.details,
      };
    }

    // Nest's own exceptions (UnauthorizedException from a guard, NotFoundException
    // from the router) carry a plain string or its default object shape. Their
    // message is safe to surface; only the code has to be derived.
    return { code: codeForStatus(status), message: messageFrom(payload, status) };
  }

  // Not an HttpException: an unhandled throw. The message may contain a
  // connection string, a query, or a stack fragment, so it is logged above and
  // never returned.
  return {
    code: API_ERROR_CODES.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
  };
}

function isStructured(payload: unknown): payload is Described {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'code' in payload &&
    typeof (payload as { code: unknown }).code === 'string' &&
    'message' in payload &&
    typeof (payload as { message: unknown }).message === 'string'
  );
}

function messageFrom(payload: unknown, status: number): string {
  if (typeof payload === 'string') return payload;

  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const { message } = payload as { message: unknown };
    if (typeof message === 'string') return message;
    // Nest's ValidationPipe-style array of strings.
    if (Array.isArray(message)) return message.join('; ');
  }

  return `Request failed with status ${status}`;
}

// Maps only the statuses this API actually produces. Anything else is a bug in
// the throwing code rather than a case to model, so it falls through to
// INTERNAL_ERROR rather than inventing a code the frontend cannot handle.
function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return API_ERROR_CODES.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return API_ERROR_CODES.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return API_ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return API_ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return API_ERROR_CODES.CONFLICT;
    default:
      return API_ERROR_CODES.INTERNAL_ERROR;
  }
}
