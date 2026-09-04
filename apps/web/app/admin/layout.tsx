import '../globals.css';

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '../../auth';
import { getMe } from '../../lib/api/admin';
import { ApiError } from '../../lib/api/client';
import { AUTH_ROUTES, withCallback } from '../../lib/auth-routes';
import { AdminNav } from './admin-nav';

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
  const session = await auth();

  // No usable session — send them to log in and come back here. A lapsed one
  // counts: `error` means the refresh failed and the cookie no longer carries
  // tokens, which is the same thing to this gate as having no cookie at all.
  // Without it the request falls through to getMe(), which throws for want of a
  // token, and Blocked tells someone to sign out when signing in is the thing
  // that would fix them.
  if (!session || session.error) {
    redirect(withCallback(AUTH_ROUTES.signIn, '/admin/entries'));
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
        {/* Three groups, and the grouping is the point: who you are, where you
            can go INSIDE the panel, and the ways OUT of it. They were one row
            of identical links before, which put a section next to a sign-out.
            The wordmark points at /admin, which redirects — so the panel has a
            root rather than a brand that happens to link to one of its
            sections. */}
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <div className="flex items-center gap-6">
            <div className="flex items-baseline gap-3">
              <Link href="/admin" className="font-semibold">
                Nawat admin
              </Link>
              <span className="text-xs text-gray-500">{role}</span>
            </div>
            <AdminNav role={role} />
          </div>
          <div className="flex items-center gap-4 border-l border-gray-200 pl-4 text-sm">
            {/* /dictionary, not / — the label says Dictionary and pointed at
                the homepage. Locale-less on purpose: the panel is not
                localized, and proxy.ts prepends the reader's locale to any
                path that has none, so this resolves to /es/dictionary or
                /en/dictionary without the panel having to know which. */}
            <Link href="/dictionary" className="text-gray-500 hover:text-gray-900">
              Dictionary
            </Link>
            <a
              href={withCallback(AUTH_ROUTES.signOut, '/')}
              className="font-medium hover:underline"
            >
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
// person in it: their session is live and refreshing normally, so nothing in
// the browser suggests a problem, while every authenticated call fails. It is
// the API declining to resolve them, not the session lapsing — which is why the
// advice here is not simply "log in again".
//
// A LAPSED SESSION NO LONGER REACHES THIS. The gate above redirects it and the
// public header renders a login link rather than a name, so what is left here
// is the narrower case the branches below actually describe: a credential the
// browser still holds and the API refuses.
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
        <a
          href={withCallback(AUTH_ROUTES.signOut, '/')}
          className="mt-4 inline-block text-sm underline"
        >
          Sign out
        </a>
      </body>
    </html>
  );
}
