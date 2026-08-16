import { API_ERROR_CODES, type ApiErrorDetail } from '@nahuat/shared';
import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodError, ZodType } from 'zod';

// Validates a request payload against a Zod schema from @nahuat/shared.
//
// There are deliberately no class-validator DTOs. The Zod schemas are already
// the contract the frontend imports, and a second definition of the same
// payload drifts from the first — which is the failure this whole arrangement
// exists to avoid.
//
// Used per-parameter rather than globally, because a global pipe has no way to
// know which schema a given handler expects:
//
//   @Post()
//   create(@Body(new ZodValidationPipe(CreateEntrySchema)) body: CreateEntry) {}
//
// The parsed value is returned, not the original, so defaults and coercions
// declared in the schema (PaginationParamsSchema's page/limit) reach the
// handler. Returning `value` here would silently discard them.
@Injectable()
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    throw new BadRequestException({
      code: API_ERROR_CODES.VALIDATION_ERROR,
      message: 'Request validation failed',
      details: toDetails(result.error, metadata),
    });
  }
}

// Shaped to ApiErrorDetail from @nahuat/shared, and thrown as the exception's
// payload rather than a finished response body: `correlationId` is required on
// the error envelope and only the exception filter can supply it, since a pipe
// has no request context. The filter completes the envelope.
function toDetails(error: ZodError, metadata: ArgumentMetadata): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    // e.g. "body.nahuatContent", "query.page", "body.translations.0.role".
    // metadata.type is prepended so a client can tell a bad query param from a
    // bad body field when a handler validates both. Array indices arrive as
    // numbers and are joined as-is.
    field: [metadata.type, ...issue.path].join('.'),
    message: issue.message,
  }));
}
