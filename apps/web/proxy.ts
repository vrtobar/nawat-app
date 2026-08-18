import type { NextRequest } from 'next/server';

import { auth0 } from './lib/auth0';

// Next.js 16: proxy.ts replaces middleware.ts. The Auth0 SDK
// middleware manages the session cookie lifecycle and mounts /auth/*
// (login, callback, logout, profile, access-token) on every matched path.
//
// TODO: protected routes — check the session here and redirect
// unauthenticated requests to /auth/login for:
//   /learn, /dashboard, /review, /flashcards, /admin
// Admin role enforcement stays in the (admin) layout — role lives in the
// session claims, but layout-level checks keep this file thin.
export async function proxy(request: NextRequest) {
  return auth0.middleware(request);
}

// /api/health is EXCLUDED from the matcher, not merely permitted by it.
//
// The ALB probe carries no credentials, and the TODO above will add a
// redirect-unauthenticated rule to this very function. Written the obvious way
// — redirect anything without a session — it would turn every health probe
// into a 307, fail every web task, and roll back a working deploy, with
// nothing in the application broken. Excluding the path makes that mistake
// impossible instead of something the next edit has to remember.
//
// This is the same reasoning as @Public() on the API's health controller
// (ADR 13), arrived at from the opposite direction: there the default is deny
// and the exemption is explicit; here the middleware is permissive today and
// becomes restrictive later, so the exemption is written while it costs
// nothing.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/health).*)'],
};
