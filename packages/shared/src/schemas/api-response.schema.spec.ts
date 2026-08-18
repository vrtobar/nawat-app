import { describe, expect, it } from 'vitest';

import { ApiErrorSchema, PaginationParamsSchema } from './api-response.schema';

// These schemas sit on the boundary between the browser and the API, where
// every value arrives as a string. The coercion and defaults below are what
// make a raw query string usable, so they are worth pinning.
describe('PaginationParamsSchema', () => {
  it('applies defaults when the query string omits both params', () => {
    expect(PaginationParamsSchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces the string values a query string actually delivers', () => {
    expect(PaginationParamsSchema.parse({ page: '3', limit: '50' })).toEqual({
      page: 3,
      limit: 50,
    });
  });

  it('rejects a limit above the cap so a client cannot request the whole table', () => {
    expect(PaginationParamsSchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('rejects page 0, which would otherwise offset negatively', () => {
    expect(PaginationParamsSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects non-integer pages rather than silently truncating', () => {
    expect(PaginationParamsSchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('requires a correlationId, which is what makes an error reportable', () => {
    const withoutCorrelationId = {
      success: false,
      error: { code: 'NOT_FOUND', message: 'Entry not found' },
    };

    expect(ApiErrorSchema.safeParse(withoutCorrelationId).success).toBe(false);
  });

  it('accepts field-level details from the validation pipe', () => {
    const result = ApiErrorSchema.safeParse({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        correlationId: '01JD7Z2K',
        details: [{ field: 'body.nawatContent', message: 'Required' }],
      },
    });

    expect(result.success).toBe(true);
  });

  it('does not accept success: true, so the two envelopes stay discriminable', () => {
    const result = ApiErrorSchema.safeParse({
      success: true,
      error: { code: 'NOT_FOUND', message: 'x', correlationId: 'y' },
    });

    expect(result.success).toBe(false);
  });
});
