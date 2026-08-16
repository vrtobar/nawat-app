import type { ApiPaginated, ApiSuccess, PaginationMeta } from '@nahuat/shared';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { NO_ENVELOPE } from '../decorators/no-envelope.decorator';

type Enveloped = ApiSuccess<unknown> | ApiPaginated<unknown>;

// Wraps every successful response in the envelope declared in @nahuat/shared,
// so handlers return domain objects and never assemble response shapes.
//
// correlationId is deliberately absent here. It travels on the X-Correlation-ID
// header for all responses and appears in the body only on errors — that split
// is the contract, and duplicating it into success bodies would break clients
// that type against ApiSuccessSchema.
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(NO_ENVELOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(map(toEnvelope));
  }
}

function toEnvelope(value: unknown): Enveloped {
  // A paginated result arrives as { data, meta } and must stay flat —
  // { success, data, meta } — rather than nesting into data.data. Handlers
  // return that shape from list endpoints; everything else is a single item.
  if (isPaginated(value)) {
    return { success: true, data: value.data, meta: value.meta };
  }

  // undefined becomes null so the field is always present. A handler that
  // returns nothing (a delete, say) would otherwise serialise to
  // {"success":true} with no data key, which fails ApiSuccessSchema.
  return { success: true, data: value === undefined ? null : value };
}

// Deliberately strict. Matching loosely on the presence of `data` would
// swallow any domain object that happens to have that field — an Exercise with
// a data column, for instance — and silently flatten it.
function isPaginated(value: unknown): value is { data: unknown[]; meta: PaginationMeta } {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as { data?: unknown; meta?: unknown };
  if (!Array.isArray(candidate.data)) return false;
  if (typeof candidate.meta !== 'object' || candidate.meta === null) return false;

  const meta = candidate.meta as Record<string, unknown>;
  return (
    typeof meta.total === 'number' &&
    typeof meta.page === 'number' &&
    typeof meta.limit === 'number' &&
    typeof meta.totalPages === 'number'
  );
}
