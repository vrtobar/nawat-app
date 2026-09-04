'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The panel's section nav.
//
// WHAT IT REPLACES, because the shape it fixes is easy to reintroduce: the
// header used to carry one link, "Media", in the same group as "Dictionary"
// and "Log out" — a section of the panel styled identically to a way out of it
// and a session action. "Entries" was not a nav item at all; it was the
// wordmark. So from /admin/media there was no link back to Entries, and the
// only item shown was the page you were already on.
//
// The rule now: THIS holds sections of the panel, and the right-hand group
// holds only things that leave it.
//
// A client component solely for `usePathname`. The layout stays a Server
// Component and passes `role` down, so the role is still read from the same
// row the API authorizes against rather than from anything in the browser.

type Section = {
  href: string;
  label: string;
  // A section is active for its whole subtree: /admin/entries/x/edit is still
  // Entries. Matching on equality would leave the nav unmarked on every page
  // that is actually worked in.
  prefix: string;
  adminOnly?: boolean;
};

const SECTIONS: Section[] = [
  { href: '/admin/entries', label: 'Entries', prefix: '/admin/entries' },
  // CONTRIBUTOR+ since the Problems tab landed. The section now holds views for
  // both ranks and gates PER TAB, so the link leads somewhere usable for
  // everyone who can see it — which is what makes offering it honest.
  { href: '/admin/media', label: 'Media', prefix: '/admin/media' },
];

export function AdminNav({ role }: { role: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-4 text-sm">
      {SECTIONS.filter((section) => !section.adminOnly || role === 'ADMIN').map((section) => {
        const active = pathname.startsWith(section.prefix);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'font-medium text-gray-900 underline underline-offset-8'
                : 'text-gray-500 hover:text-gray-900'
            }
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
