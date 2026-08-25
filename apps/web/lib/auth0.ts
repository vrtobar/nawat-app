import { OAuth2Error } from '@auth0/nextjs-auth0/errors';
import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { NextResponse } from 'next/server';

import { ApiError, startSession } from './api/client';

// Codes that mean signing in again the same way will fail identically, so the
// UI must say something other than "try again". Kept as a set rather than a
// comparison chain because the list will grow with the users admin module.
const PERMANENT_SIGNIN_FAILURES = new Set(['EMAIL_ALREADY_REGISTERED', 'USER_DEACTIVATED']);

// Reads AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET,
// and APP_BASE_URL from the environment automatically (v4 SDK).
//
// The SDK auto-mounts its routes under /auth/* via proxy.ts:
//   /auth/login, /auth/callback, /auth/logout, /auth/profile,
//   /auth/access-token
// NOTE: v4 paths — the Auth0 dashboard callback/logout URLs must use
// /auth/callback, NOT the v3-era /api/auth/callback in the planning docs.
//
// The audience is required, not an optimisation. Without it Auth0 issues an
// OPAQUE access token — a reference string, not a JWT — and the API rejects
// every request before it reaches signature verification. The symptom looks
// like broken authentication rather than missing configuration, which makes it
// slow to diagnose backwards from a 401.
//
// Requesting it tells Auth0 the token is for the NestJS API, which is what
// makes it a JWT carrying `aud: https://api.nahuat.com` — the value
// JwtStrategy checks.
export const auth0 = new Auth0Client({
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
  },

  // The SDK's default renders `new NextResponse(error.message, { status: 500 })`
  // for any failed callback. Declining the consent screen is the ordinary way
  // to reach that, and it is not a server error — it is a user saying no. The
  // default leaves them on /auth/callback?error=… staring at one line of plain
  // text with no link back.
  //
  // Send them where they came from instead, with a code the UI can render.
  // `returnTo` is already carried through the login round trip, so it survives
  // as the locale-correct page they started on.
  onCallback: async (error, ctx, session) => {
    const base = process.env.APP_BASE_URL ?? 'http://localhost:3000';
    const destination = new URL(ctx.returnTo ?? '/', base);

    // Signing in creates the account, and a sign-in that cannot create one does
    // not stand. POST /auth/session is the only path that provisions; letting
    // the session survive its failure would leave the user holding a credential
    // the API refuses, with nothing to retry and no explanation.
    //
    // Failures route through /auth/session-failed rather than redirecting
    // straight to a page, because the SDK writes the session cookie after this
    // hook returns — see that route for the ordering. It cannot be cleared from
    // here.
    if (!error && session) {
      try {
        await startSession(session.tokenSet.accessToken);
      } catch (cause) {
        // LOGGED, always. The user gets a deliberately vague message — a
        // sign-in failure must not describe the system to whoever triggered it
        // — so this is the only place the actual reason exists. Without it a
        // failed sign-in is invisible to the operator too, which is the same
        // fault this whole change set out to fix.
        const detail =
          cause instanceof ApiError
            ? `${cause.code} (${cause.status})${cause.correlationId ? ` corr=${cause.correlationId}` : ''}`
            : String(cause);
        console.error(`[auth] POST /auth/session failed: ${detail}`);

        // A permanent refusal is worth naming: retrying the same connection
        // reproduces it exactly, so "try again" is the wrong advice. Everything
        // else — the API down, a timeout, /userinfo unreachable — is transient
        // and indistinguishable from the user's side.
        const code =
          cause instanceof ApiError && PERMANENT_SIGNIN_FAILURES.has(cause.code)
            ? cause.code
            : 'failed';

        const failed = new URL('/auth/session-failed', base);
        failed.searchParams.set('code', code);
        return NextResponse.redirect(failed.toString());
      }
    }

    if (error) {
      // The OAuth code is on `cause`, NOT on `error.code`. An AuthorizationError
      // hardcodes its own code to "authorization_error" and wraps the OAuth2Error
      // carrying "access_denied" underneath. Reading the top-level code would
      // have quietly classified every declined consent as a generic failure.
      const oauthCode = error.cause instanceof OAuth2Error ? error.cause.code : undefined;

      // Declined consent is the one case worth naming. Everything else — an
      // expired transaction, an invalid state parameter, a token exchange
      // failure — is indistinguishable from the user's side: try again.
      destination.searchParams.set(
        'auth_error',
        oauthCode === 'access_denied' ? 'denied' : 'failed',
      );
    }

    return NextResponse.redirect(destination.toString());
  },
});
