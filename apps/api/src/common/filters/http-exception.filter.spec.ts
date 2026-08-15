import { API_ERROR_CODES } from '@nahuat/shared';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter } from './http-exception.filter';

interface Captured {
  status: number;
  body: {
    success: false;
    error: { code: string; message: string; correlationId: string; details?: unknown[] };
  };
}

// `null` means middleware never assigned one. A default parameter cannot
// express that: JavaScript applies the default when the argument is
// `undefined`, so passing `undefined` explicitly would silently get the
// default back — which is exactly what this helper needs to distinguish.
const run = (exception: unknown, correlationId: string | null = 'req_abc123'): Captured => {
  const captured = {} as Captured;

  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Captured['body']) {
      captured.body = body;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        correlationId: correlationId ?? undefined,
        method: 'GET',
        url: '/api/v1/entries',
        header: () => undefined,
      }),
      getResponse: () => ({ ...res, headersSent: false, setHeader: () => undefined }),
    }),
  };

  new HttpExceptionFilter().catch(exception, host as never);
  return captured;
};

describe('HttpExceptionFilter', () => {
  beforeAll(() => {
    // 5xx cases log a stack; keep it out of the test output.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('passes through a structured payload from ZodValidationPipe', () => {
    const { status, body } = run(
      new BadRequestException({
        code: API_ERROR_CODES.VALIDATION_ERROR,
        message: 'Request validation failed',
        details: [{ field: 'body.name', message: 'Required' }],
      }),
    );

    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(body.error.code).toBe(API_ERROR_CODES.VALIDATION_ERROR);
    expect(body.error.details).toEqual([{ field: 'body.name', message: 'Required' }]);
  });

  it.each([
    [new UnauthorizedException(), HttpStatus.UNAUTHORIZED, API_ERROR_CODES.UNAUTHORIZED],
    [new ForbiddenException(), HttpStatus.FORBIDDEN, API_ERROR_CODES.FORBIDDEN],
    [new NotFoundException(), HttpStatus.NOT_FOUND, API_ERROR_CODES.NOT_FOUND],
  ])('derives a code for Nest exception %#', (exception, status, code) => {
    // Guards throw these directly — they never carry a structured payload, so
    // the code has to come from the status.
    const result = run(exception);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  });

  it('never leaks the message of an unhandled throw', () => {
    const { status, body } = run(new Error('connect ECONNREFUSED 10.0.3.14:5432'));

    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
    expect(body.error.message).toBe('An unexpected error occurred');
    expect(JSON.stringify(body)).not.toContain('10.0.3.14');
  });

  it('does not leak internals from a 500 HttpException either', () => {
    const { body } = run(
      new HttpException('Prisma error P2021 on table users', HttpStatus.INTERNAL_SERVER_ERROR),
    );

    // A thrown HttpException with a 500 status still carries an author-written
    // message, so it is surfaced — but the code stays INTERNAL_ERROR because no
    // frontend branch should key off it.
    expect(body.error.code).toBe(API_ERROR_CODES.INTERNAL_ERROR);
  });

  it('includes the correlation id from the request', () => {
    const { body } = run(new NotFoundException(), 'req_traced99');
    expect(body.error.correlationId).toBe('req_traced99');
  });

  it('generates a unique id when middleware did not run', () => {
    // Body-parser throws before configure() middleware, so this path is
    // reachable by any client sending malformed JSON. A fixed sentinel would
    // give every such request the same id — one that traces nothing while
    // looking real enough to quote in a support ticket.
    const first = run(new NotFoundException(), null).body.error.correlationId;
    const second = run(new NotFoundException(), null).body.error.correlationId;

    expect(first).toMatch(/^req_[A-Za-z0-9_-]+$/);
    expect(first).not.toBe(second);
  });

  it('omits details when there are none', () => {
    const { body } = run(new ForbiddenException());
    expect(body.error).not.toHaveProperty('details');
  });
});
