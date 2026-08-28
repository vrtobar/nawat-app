import type { UserProfile } from '@nahuat/shared';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

import { ApiError, endSession, refreshSession, startSession } from './lib/api/client';

// =============================================================================
// AUTHENTICATION — Auth.js, with Google as the only provider. See
// docs/adr/0018.
//
// THE DIVISION OF LABOUR, which is the thing to understand before reading any
// of the callbacks:
//
//   Auth.js   the browser-facing OAuth dance — the redirect, `state`, PKCE,
//             the nonce, CSRF, and the encrypted session cookie. It holds
//             GOOGLE_CLIENT_SECRET and performs the code exchange.
//   the API   everything after that. It verifies Google's ID token, owns the
//             user row, and issues the access and refresh tokens that the rest
//             of this system understands.
//
// So Auth.js never learns who anyone is in this application's terms. It
// establishes that Google vouched for someone and hands the proof to the API,
// which decides what that means.
//
// ⚠️ next-auth is PINNED to an exact beta rather than a caret range. Auth.js v5
// has no stable release and betas have made breaking changes; a range would let
// one arrive through a routine `npm install` with nobody reading the changelog.
// Upgrading is a deliberate act with a sign-in to prove it afterwards.
// =============================================================================

// Refresh this far before the access token actually expires. Covers the round
// trip and any clock difference between this process and the API, so a request
// is never sent with a token that expires in flight.
const REFRESH_SKEW_MS = 60_000;

// Codes that mean signing in again the same way will fail identically, so the
// UI must say something other than "try again".
const PERMANENT_SIGNIN_FAILURES = new Set([
  'EMAIL_ALREADY_REGISTERED',
  'USER_DEACTIVATED',
  'EMAIL_NOT_VERIFIED',
]);

// What this application stores on the encrypted JWT, beyond Auth.js's own
// claims.
//
// ⚠️ `api` MUST NOT REACH THE SESSION CALLBACK. Whatever that callback returns
// is served to the browser by GET /auth/session, and these are bearer
// credentials for the entire API. They stay here, in the encrypted cookie, and
// are read server-side only — see lib/api/auth.ts.
declare module 'next-auth/jwt' {
  interface JWT {
    api?: {
      accessToken: string;
      refreshToken: string;
      // Absolute, in milliseconds, computed from the API's `expiresIn` at the
      // moment it answered — see the token contracts in @nahuat/shared for why
      // it reports a duration rather than a deadline.
      expiresAt: number;
    };
    profile?: UserProfile;
    // Set when a refresh fails. The session is finished and the user has to
    // sign in again; surfacing it lets the UI say so rather than failing every
    // subsequent request with an unexplained 401.
    error?: 'SessionExpired';
  }
}

declare module 'next-auth' {
  interface Session {
    profile?: UserProfile;
    error?: 'SessionExpired';
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // `/auth/*`, matching what this app already used and what proxy.ts routes.
  // next-auth defaults to `/api/auth` for backwards compatibility with v4;
  // every other Auth.js integration defaults to `/auth`.
  //
  // ⚠️ AUTH_URL MUST BE SET IN EVERY ENVIRONMENT, and nothing here enforces it.
  // Auth.js derives `trustHost` from `NODE_ENV !== "production"` among other
  // things, so a laptop trusts the host by default and a container does not —
  // the one variable that fails only where NODE_ENV is production, which is
  // exactly where no local test runs. It also pins the origin Auth.js builds
  // callback URLs from; inferred instead, behind a load balancer, that is the
  // container's own internal address.
  basePath: '/auth',

  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,

      // ⚠️ SPELLED OUT BECAUSE THE DEFAULT IS `["pkce"]` ALONE. Auth.js adds
      // `state` only when a redirect proxy is configured, and never adds
      // `nonce` — so accepting the default would leave two of the three
      // protections docs/adr/0018 names as the reason for using a library
      // simply absent, with nothing failing to indicate it.
      //
      // PKCE alone is defensible: the verifier lives in a per-browser cookie,
      // so a code injected into someone else's callback cannot be exchanged,
      // which is the CSRF property `state` is usually there for. The other two
      // are cheap and cover different things.
      //
      // NONCE MATTERS MORE HERE THAN IN A TYPICAL APP. The ID token is not
      // consumed and discarded — it is forwarded to the API as proof of
      // identity, and the API cannot check the nonce itself because it holds
      // none of this flow's state. Validating it here is therefore the only
      // place that binding can be established at all.
      checks: ['pkce', 'state', 'nonce'],

      authorization: {
        params: {
          // Google signs a single-account user straight through without showing
          // a chooser, which reads as a broken button to anyone who has just
          // signed out and wants a different account. The API cannot fix this:
          // it is decided before the redirect.
          prompt: 'select_account',
        },
      },
    }),
  ],

  session: {
    // No database adapter: the session lives entirely in an encrypted cookie.
    // A session table would be a second record of who is signed in, and this
    // system already has one that matters more — the refresh token family,
    // which is what revocation acts on.
    strategy: 'jwt',
    // Matched to the API's refresh token, so the cookie does not outlive the
    // credentials inside it. A cookie that survives its own tokens produces a
    // browser that believes it is signed in and an API that refuses every
    // request.
    maxAge: 30 * 24 * 60 * 60,
  },

  callbacks: {
    // Runs on sign-in and on every subsequent read of the session.
    async jwt({ token, account, trigger }) {
      // FIRST SIGN-IN. `account` carries the token set Auth.js just exchanged
      // the authorization code for; the ID token is the only part this system
      // wants, and the API verifies it rather than trusting anything here.
      if (trigger === 'signIn' && account?.id_token) {
        // NOT WRAPPED IN try/catch, deliberately. An error thrown here fails
        // the sign-in before any cookie is written, which is exactly the
        // behaviour wanted: a login that cannot create an account must not
        // leave a session behind. The Auth0 SDK could not do this — it wrote
        // the cookie after its callback hook returned, so refusing a login
        // needed a separate route to delete what had already been set.
        const { user, tokens } = await startSession(account.id_token);

        return {
          ...token,
          profile: user,
          api: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + tokens.expiresIn * 1000,
          },
        };
      }

      // A session that already failed to refresh. Nothing to retry: the
      // refresh token family was revoked, so every attempt would fail
      // identically.
      if (token.error) return token;

      // No api block at all. Should be unreachable — the branch above always
      // sets one — but a token from an older cookie format would land here, and
      // the honest answer is that this session is not usable.
      if (!token.api) return { ...token, error: 'SessionExpired' as const };

      if (Date.now() < token.api.expiresAt - REFRESH_SKEW_MS) return token;

      // SILENT REFRESH. The user is not redirected and loses nothing they have
      // typed — the case that made a short access token safe for the entry
      // editor, where a re-authentication redirect mid-edit would discard
      // whatever was in component state.
      try {
        const tokens = await refreshSession(token.api.refreshToken);

        return {
          ...token,
          api: {
            accessToken: tokens.accessToken,
            // ROTATED. The token just spent is dead; keeping the old one would
            // make the next refresh look like reuse and revoke the session.
            refreshToken: tokens.refreshToken,
            expiresAt: Date.now() + tokens.expiresIn * 1000,
          },
        };
      } catch (error) {
        // Logged here or nowhere: the user is shown a generic message, and a
        // refresh failing is worth an operator seeing.
        console.error(
          `[auth] refresh failed: ${
            error instanceof ApiError ? `${error.code} (${error.status})` : String(error)
          }`,
        );

        return { ...token, api: undefined, error: 'SessionExpired' as const };
      }
    },

    // What the browser is allowed to know. The profile the API returned, and
    // whether the session has ended — never the tokens.
    session({ session, token }) {
      session.profile = token.profile;
      session.error = token.error;
      return session;
    },
  },

  events: {
    // ⚠️ SIGNING OUT MUST REACH THE API, or it only clears a cookie. The
    // session is a refresh token FAMILY on the server, and that family lives
    // for thirty days regardless of what this browser has stopped holding —
    // so a local-only sign-out leaves a usable credential behind on any
    // machine that copied it, which is the precise thing "log out" is
    // understood to prevent.
    //
    // Auth.js hands this the decoded JWT for a jwt-strategy session, which is
    // the only place the refresh token still exists at this point: the cookie
    // is about to be discarded and the token was never in the session object.
    async signOut(message) {
      if ('token' in message && message.token?.api) {
        await endSession(message.token.api.refreshToken);
      }
    },
  },

  // Signals to the login UI. `error` receives whatever reason the sign-in
  // failed with, which for this application is the API's own code.
  pages: {
    error: '/auth/failed',
  },
});

// Whether a failed sign-in is worth naming to the user. A permanent refusal
// reproduces exactly on retry, so "try again" is the wrong advice; everything
// else — the API down, a timeout — is transient and indistinguishable from the
// outside.
export function signInFailureCode(error: unknown): string {
  return error instanceof ApiError && PERMANENT_SIGNIN_FAILURES.has(error.code)
    ? error.code
    : 'failed';
}
