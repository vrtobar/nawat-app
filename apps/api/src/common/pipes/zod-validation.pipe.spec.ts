import { API_ERROR_CODES } from '@nahuat/shared';
import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

const meta = (type: ArgumentMetadata['type']): ArgumentMetadata => ({
  type,
  metatype: undefined,
  data: undefined,
});

describe('ZodValidationPipe', () => {
  it('returns the parsed value, not the input', () => {
    // The distinction matters: query params arrive as strings, and the handler
    // is typed as receiving numbers. Returning the input would typecheck and
    // fail at runtime.
    const pipe = new ZodValidationPipe(z.object({ page: z.coerce.number().int().default(1) }));

    expect(pipe.transform({ page: '3' }, meta('query'))).toEqual({ page: 3 });
  });

  it('applies schema defaults for absent fields', () => {
    const pipe = new ZodValidationPipe(z.object({ limit: z.coerce.number().default(20) }));

    expect(pipe.transform({}, meta('query'))).toEqual({ limit: 20 });
  });

  it('throws BadRequestException carrying VALIDATION_ERROR', () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }));

    try {
      pipe.transform({ name: 42 }, meta('body'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const payload = (error as BadRequestException).getResponse();
      expect(payload).toMatchObject({ code: API_ERROR_CODES.VALIDATION_ERROR });
    }
  });

  it('prefixes the field path with the argument type', () => {
    const pipe = new ZodValidationPipe(z.object({ nawatContent: z.string() }));

    try {
      pipe.transform({}, meta('body'));
      expect.unreachable('should have thrown');
    } catch (error) {
      const payload = (error as BadRequestException).getResponse() as {
        details: { field: string }[];
      };
      expect(payload.details).toEqual([expect.objectContaining({ field: 'body.nawatContent' })]);
    }
  });

  it('reports nested and array paths', () => {
    const pipe = new ZodValidationPipe(
      z.object({
        translations: z.array(z.object({ role: z.enum(['TARGET', 'DISTRACTOR']) })),
      }),
    );

    try {
      pipe.transform({ translations: [{ role: 'WRONG' }] }, meta('body'));
      expect.unreachable('should have thrown');
    } catch (error) {
      const payload = (error as BadRequestException).getResponse() as {
        details: { field: string }[];
      };
      expect(payload.details).toEqual([
        expect.objectContaining({ field: 'body.translations.0.role' }),
      ]);
    }
  });

  it('reports every issue, not just the first', () => {
    // A form that submits three bad fields should light up three fields, not
    // send the user round the loop once per field.
    const pipe = new ZodValidationPipe(z.object({ a: z.string(), b: z.string(), c: z.string() }));

    try {
      pipe.transform({}, meta('body'));
      expect.unreachable('should have thrown');
    } catch (error) {
      const payload = (error as BadRequestException).getResponse() as {
        details: unknown[];
      };
      expect(payload.details).toHaveLength(3);
    }
  });

  it('does not put correlationId in the payload', () => {
    // It is required on the error envelope but belongs to the exception
    // filter, which has the request. A pipe inventing one would produce an ID
    // that correlates with nothing in the logs.
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }));

    try {
      pipe.transform({}, meta('body'));
      expect.unreachable('should have thrown');
    } catch (error) {
      const payload = (error as BadRequestException).getResponse();
      expect(payload).not.toHaveProperty('correlationId');
    }
  });
});
