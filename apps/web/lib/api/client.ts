import {
  ApiErrorSchema,
  type ApiPaginated,
  ApiPaginatedSchema,
  type ApiSuccess,
  ApiSuccessSchema,
  type PaginationMeta,
} from '@nahuat/shared';
import { z } from 'zod';

// The NestJS API base. Server-side only: the dictionary pages fetch in RSCs on
// the ECS origin, never the browser, so this reads API_URL (private) rather than
// NEXT_PUBLIC_API_URL. The API mounts everything under /api/v1 (global prefix +
// URI versioning), appended here so callers pass resource paths only.
function apiBase(): string {
  const url = process.env.API_URL;
  if (!url) throw new Error('API_URL is not set');
  return `${url.replace(/\/+$/, '')}/api/v1`;
}

// Thrown for any non-success response. Carries the envelope's machine-readable
// code and correlationId so a caller can branch (e.g. ENTRY_NOT_FOUND →
// notFound()) and a support report can quote the id.
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | undefined>;

async function requestJson(path: string, query: Query): Promise<unknown> {
  const url = new URL(`${apiBase()}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    // Prefer the API's own error envelope (code, message, correlationId); fall
    // back to a synthetic one for a gateway error or unparseable body.
    const parsed = ApiErrorSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, correlationId } = parsed.data.error;
      throw new ApiError(code, message, res.status, correlationId);
    }
    throw new ApiError('INTERNAL_ERROR', `API request failed (${res.status})`, res.status);
  }

  return body;
}

// A single-item / detail response: { success: true, data }. The body is parsed
// against the shared schema, so a drift between the API and this client fails
// here rather than surfacing as a malformed render.
export async function fetchItem<T extends z.ZodType>(
  path: string,
  schema: T,
  query: Query = {},
): Promise<z.infer<T>> {
  const body = await requestJson(path, query);
  // The runtime shape is guaranteed by the parse; the assertion only recovers
  // the clean { data } type, which Zod's generic builder does not infer through.
  const parsed = ApiSuccessSchema(schema).parse(body) as ApiSuccess<z.infer<T>>;
  return parsed.data;
}

// A paginated list response: { success: true, data: [], meta }.
export async function fetchPage<T extends z.ZodType>(
  path: string,
  schema: T,
  query: Query = {},
): Promise<{ data: z.infer<T>[]; meta: PaginationMeta }> {
  const body = await requestJson(path, query);
  const parsed = ApiPaginatedSchema(schema).parse(body) as ApiPaginated<z.infer<T>>;
  return { data: parsed.data, meta: parsed.meta };
}
