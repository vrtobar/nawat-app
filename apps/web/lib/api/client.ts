import {
  ApiErrorSchema,
  type ApiPaginated,
  ApiPaginatedSchema,
  type ApiSuccess,
  ApiSuccessSchema,
  type PaginationMeta,
  type RefreshResponse,
  RefreshResponseSchema,
  type SessionResponse,
  SessionResponseSchema,
  type TokenPair,
} from '@nahuat/shared';
import { z } from 'zod';

import { getApiToken } from './auth';

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

type Query = Record<string, string | number | boolean | undefined>;

type RequestOptions = {
  query?: Query;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  // A bearer token, when the route requires one. Passed in rather than fetched
  // here so this stays a plain HTTP helper: the public dictionary reads never
  // touch the session, and nothing in this function decides whether a caller
  // should be authenticated.
  token?: string;
};

async function requestJson(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { query = {}, method = 'GET', body, token } = options;

  const url = new URL(`${apiBase()}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // Authenticated responses vary by user and must never be cached; the public
    // reads are already uncached because Next does not cache fetches by default.
    cache: 'no-store',
  });

  const responseBody: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    // Prefer the API's own error envelope (code, message, correlationId); fall
    // back to a synthetic one for a gateway error or unparseable body.
    const parsed = ApiErrorSchema.safeParse(responseBody);
    if (parsed.success) {
      const { code, message, correlationId } = parsed.data.error;
      throw new ApiError(code, message, res.status, correlationId);
    }
    throw new ApiError('INTERNAL_ERROR', `API request failed (${res.status})`, res.status);
  }

  return responseBody;
}

// A single-item / detail response: { success: true, data }. The body is parsed
// against the shared schema, so a drift between the API and this client fails
// here rather than surfacing as a malformed render.
export async function fetchItem<T extends z.ZodType>(
  path: string,
  schema: T,
  query: Query = {},
): Promise<z.infer<T>> {
  const body = await requestJson(path, { query });
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
  const body = await requestJson(path, { query });
  const parsed = ApiPaginatedSchema(schema).parse(body) as ApiPaginated<z.infer<T>>;
  return { data: parsed.data, meta: parsed.meta };
}

// -----------------------------------------------------------------------------
// AUTHENTICATED VARIANTS
// The three above are the public dictionary's readers and stay anonymous. These
// acquire the session's access token and send it as a bearer credential.
//
// Separate functions rather than an `authed: true` flag, so a route that needs
// a token cannot be called without one by forgetting an argument — the choice is
// in the function name, at the call site, where it is reviewable.
// -----------------------------------------------------------------------------

// Records that a login just happened, creating the account if this is the
// first one. The API's POST /auth/session; see its controller for why that is
// not the deleted POST /auth/role.
//
// THE CREDENTIAL IS IN THE BODY, NOT A BEARER HEADER, and it is Google's ID
// token rather than anything this system issued. That is the whole shape of
// the exchange: the caller has no token from the API yet, which is what this
// endpoint exists to fix. Everything below it reads a token with
// getApiToken(); these two cannot, because they run before or after there is
// a session to read.
export async function startSession(idToken: string): Promise<SessionResponse> {
  const body = await requestJson('/auth/session', {
    method: 'POST',
    body: { idToken },
  });
  const parsed = ApiSuccessSchema(SessionResponseSchema).parse(body) as ApiSuccess<SessionResponse>;
  return parsed.data;
}

// Exchanges a refresh token for a new pair.
//
// SINGLE USE. The token sent here is dead when this returns, and presenting it
// again is treated as theft and revokes the whole session — so the caller must
// store what comes back, not keep what it sent.
export async function refreshSession(refreshToken: string): Promise<TokenPair> {
  const body = await requestJson('/auth/refresh', {
    method: 'POST',
    body: { refreshToken },
  });
  const parsed = ApiSuccessSchema(RefreshResponseSchema).parse(body) as ApiSuccess<RefreshResponse>;
  return parsed.data.tokens;
}

// Ends the session a refresh token belongs to, server-side.
//
// Failure is swallowed on purpose. This runs while signing out, and the local
// session is being destroyed either way — reporting an error would leave the
// user on a page telling them logout failed when, from their side, it did not.
// The token expires on its own if the call never lands.
export async function endSession(refreshToken: string): Promise<void> {
  try {
    await requestJson('/auth/logout', { method: 'POST', body: { refreshToken } });
  } catch (error) {
    console.error(`[auth] logout failed: ${String(error)}`);
  }
}

// A single authenticated item.
export async function authedItem<T extends z.ZodType>(
  path: string,
  schema: T,
  query: Query = {},
): Promise<z.infer<T>> {
  const body = await requestJson(path, { query, token: await getApiToken() });
  const parsed = ApiSuccessSchema(schema).parse(body) as ApiSuccess<z.infer<T>>;
  return parsed.data;
}

// An authenticated paginated list.
export async function authedPage<T extends z.ZodType>(
  path: string,
  schema: T,
  query: Query = {},
): Promise<{ data: z.infer<T>[]; meta: PaginationMeta }> {
  const body = await requestJson(path, { query, token: await getApiToken() });
  const parsed = ApiPaginatedSchema(schema).parse(body) as ApiPaginated<z.infer<T>>;
  return { data: parsed.data, meta: parsed.meta };
}

// A write. Call from a Server Action, not a Server Component: a Server Action
// can persist a refreshed access token and a Server Component cannot (see
// getApiToken), and React forbids side effects during render anyway.
//
// `schema` is optional because several write routes answer with
// `{ success: true, data: null }` — the API returns 200 with a null body rather
// than 204 so every response parses the same way (TransformInterceptor).
export async function mutate<T extends z.ZodType>(
  path: string,
  options: { method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown; schema?: T },
): Promise<z.infer<T> | null> {
  const responseBody = await requestJson(path, {
    method: options.method,
    body: options.body,
    token: await getApiToken(),
  });

  if (!options.schema) return null;

  const parsed = ApiSuccessSchema(options.schema).parse(responseBody) as ApiSuccess<z.infer<T>>;
  return parsed.data;
}
