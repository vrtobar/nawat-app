import '../globals.css';

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getMe } from '../../lib/api/admin';
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
  // against. A stale session — the user was hard-deleted, or deactivated —
  // surfaces here as a failure to read the profile, and logging out is the only
  // thing that helps, so say that rather than looping back to login.
  let role: string;
  try {
    role = (await getMe()).role;
  } catch {
    return (
      <html lang="en">
        <body className="p-8">
          <h1 className="text-xl font-semibold">Session could not be verified</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your account could not be read. Try{' '}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                /auth/* is mounted by the Auth0 SDK in proxy.ts, not a page in
                app/. <Link> would attempt a client-side RSC navigation to a
                route that has no page payload. */}
            <a href="/auth/logout" className="underline">
              signing out
            </a>{' '}
            and back in.
          </p>
        </body>
      </html>
    );
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
