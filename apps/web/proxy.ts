import type { NextRequest } from 'next/server';

import { auth0 } from './lib/auth0';

// Next.js 16: proxy.ts replaces middleware.ts (PLAN §22). The Auth0 SDK
// middleware manages the session cookie lifecycle and mounts /auth/*
// (login, callback, logout, profile, access-token) on every matched path.
//
// TODO(PLAN §13): protected routes — check the session here and redirect
// unauthenticated requests to /auth/login for:
//   /learn, /dashboard, /review, /flashcards, /admin
// Admin role enforcement stays in the (admin) layout — role lives in the
// session claims, but layout-level checks keep this file thin.
export async function proxy(request: NextRequest) {
  return auth0.middleware(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
};
