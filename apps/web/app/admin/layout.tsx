import '../globals.css';

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getMe } from '../../lib/api/admin';
import { ApiError } from '../../lib/api/client';
import { auth0 } from '../../lib/auth0';

// Not indexed, and not a mistake to state twice: the panel is behind a session
// anyway, but a crawler that somehow reaches it should not retain the URL.
export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

// The panel's shell, and its gate.
//
// Renders <html>/<body> itself because the root layout is a pass-through and
// app/[locale]/layout.tsx — which normally provides them — is a sibling, not an
// ancestor. /admin sits outside [locale] on purpose (see proxy.ts).
//
// THIS GATE IS UX, NOT SECURITY. Every admin route on the API enforces its own
// rank from the token's subject, so a determined caller gains nothing by
// reaching these pages; what the gate buys is a redirect to login instead of a
// wall of 401s, and an honest "not permitted" instead of an empty table.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession();

  // No session at all — send them to log in and come back here.
  if (!session) {
    redirect(`/auth/login?returnTo=${encodeURIComponent('/admin/entries')}`);
  }

  // One request to learn the role, from the same row the API authorizes
  // against. Having a valid session is not the same as the API recognising it,
  // and the difference is worth telling the user about — see Blocked below.
  let role: string;
  try {
    role = (await getMe()).role;
  } catch (error) {
    return <Blocked error={error} />;
  }

  // CONTRIBUTOR, not ADMIN. The API scopes a contributor to their own drafts
  // rather than refusing them, so the panel is usable by one and the individual
  // actions inside it gate themselves.
  if (role !== 'CONTRIBUTOR' && role !== 'ADMIN') {
    return (
      <html lang="en">
        <body className="p-8">
          <h1 className="text-xl font-semibold">Not permitted</h1>
          <p className="mt-2 text-sm text-gray-600">
            This area is for contributors and administrators.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm underline">
            Back to the dictionary
          </Link>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body>
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <div className="flex items-baseline gap-3">
            <Link href="/admin/entries" className="font-semibold">
              Nawat admin
            </Link>
            <span className="text-xs text-gray-500">{role}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="hover:underline">
              Dictionary
            </Link>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                see the note above: /auth/* is a middleware route, not a page. */}
            <a href="/auth/logout" className="font-medium hover:underline">
              Log out
            </a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}

// What to say when the session is valid but the API will not resolve it.
//
// The first version of this caught everything and said "try signing out and
// back in". For the two cases below that advice is actively wrong: signing in
// again the same way reproduces the same refusal, and following it wastes the
// one piece of information that would have helped.
//
// Note the state this describes is genuinely odd and worth naming for the
// person in it: they ARE signed in — the public header greets them by name,
// because that reads the Auth0 session and nothing else — while every
// authenticated call fails. Signed in everywhere, recognised nowhere.
function Blocked({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : undefined;

  const { heading, detail } =
    code === 'EMAIL_ALREADY_REGISTERED'
      ? {
          heading: 'This sign-in method is not the one on file',
          // Deliberately does not name the other connection — the API does not
          // say which, because confirming it would confirm the address is
          // registered at all.
          detail:
            'An account already exists for this email address under a different ' +
            'sign-in method. Sign out and sign in the way you did the first time.',
        }
      : code === 'USER_DEACTIVATED'
        ? {
            heading: 'This account has been deactivated',
            detail: 'Signing in again will not restore it. Contact an administrator.',
          }
        : {
            // The genuine stale-session case: the row was hard-deleted, or the
            // API could not be reached. Here re-authenticating is the right
            // advice, which is why it survives as the fallback rather than
            // being removed.
            heading: 'Session could not be verified',
            detail: 'Your account could not be read. Try signing out and back in.',
          };

  return (
    <html lang="en">
      <body className="p-8">
        <h1 className="text-xl font-semibold">{heading}</h1>
        <p className="mt-2 max-w-prose text-sm text-gray-600">{detail}</p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
            /auth/* is mounted by the Auth0 SDK in proxy.ts, not a page in app/.
            <Link> would attempt a client-side RSC navigation to a route that
            has no page payload. */}
        <a href="/auth/logout" className="mt-4 inline-block text-sm underline">
          Sign out
        </a>
      </body>
    </html>
  );
}
