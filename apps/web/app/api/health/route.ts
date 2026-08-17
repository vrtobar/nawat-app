import { NextResponse } from 'next/server';

// GET /api/health — liveness for the web target group.
//
// The ALB polled "/" until this existed, rendering the full React landing page
// on every probe. Wasteful, and worse than wasteful: it tied the health of the
// service to whatever that page happens to do. The first time the landing page
// requires a session or fetches data, every probe starts failing and ECS drains
// tasks that are working perfectly.
//
// Liveness only, deliberately. There is no dependency to check here — the web
// app holds no database or cache connection of its own; it calls the API over
// HTTP like any other client. A readiness endpoint would have nothing to
// report, and adding one that pinged the API would make a web task unhealthy
// because a *different* service was, which is the coupling the API-side split
// exists to prevent (ADR 13's reasoning, applied one layer out).
//
// force-dynamic so the handler actually executes. Without it Next can
// prerender this at build time and serve it as a static asset — still a 200
// from a live process, but the check is worth more when it proves the server
// ran something.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
