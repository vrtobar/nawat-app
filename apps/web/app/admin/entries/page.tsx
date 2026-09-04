import { type AdminEntryStatus, AdminEntryStatusSchema } from '@nahuat/shared';
import Link from 'next/link';

import { getMe, listAdminEntries } from '../../../lib/api/admin';
import { PublishButton } from './publish-button';
import { UnpublishButton } from './unpublish-button';

// The authoring queue, newest edit first.
//
// The row actions are deliberately thin. Editing and creating live on their own
// routes rather than expanding inline here, because a row carries only what the
// list projection computes — `translationCount` and `hasEnglish`, not the
// translations themselves — so an inline editor would need a second request per
// row to have anything to edit.

// "Mine" is not a status — it is the status-agnostic `?mine=true` filter, shown
// as a tab because that is the cheapest thing to remove if it turns out to be
// the wrong shape once the beta has contributors in it.
//
// Pending translations is ADMIN-only: only an ADMIN can publish, so for anyone
// else it is a work queue holding no work they can perform. The per-row "not
// live" indicator stays visible to everyone, because that is information rather
// than a task.
type View = {
  key: string;
  label: string;
  status: AdminEntryStatus;
  mine?: boolean;
  adminOnly?: boolean;
};

const VIEWS: View[] = [
  { key: 'mine', label: 'Mine', status: 'all', mine: true },
  { key: 'draft', label: 'Drafts', status: 'draft' },
  {
    key: 'pending-translations',
    label: 'Pending translations',
    status: 'pending-translations',
    adminOnly: true,
  },
  // The list a contributor takes to a recording session. NOT admin-only,
  // unlike the queue above: anyone who can attach a recording can act on it,
  // and attaching is CONTRIBUTOR.
  { key: 'missing-audio', label: 'Needs recording', status: 'missing-audio' },
  { key: 'published', label: 'Published', status: 'published' },
  { key: 'all', label: 'All', status: 'all' },
];

const EMPTY: Record<string, string> = {
  mine: 'Nothing of yours yet — entries you create, and dialects you add to other entries, appear here.',
  draft: 'No drafts.',
  'pending-translations': 'Nothing waiting — every published entry has all its translations live.',
  'missing-audio': 'Every translation has a recording attached. Nothing is waiting to be recorded.',
  published: 'Nothing published yet.',
  all: 'No entries.',
};

// Preserves the view when moving between pages, and drops `page` when moving
// between views — switching tabs should land on the first page of the new one,
// not page 4 of a list that may not have four pages.
function href(view: View, page?: number): string {
  const params = new URLSearchParams();
  if (view.status !== 'draft') params.set('status', view.status);
  if (view.mine) params.set('mine', 'true');
  if (page !== undefined && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query === '' ? '/admin/entries' : `/admin/entries?${query}`;
}

// The three cases the panel has to keep apart, which a single boolean could not:
// every translation carries English, some do, or none do. Only the last means
// the entry is absent from the English dictionary; the middle one means it
// appears there with fewer senses than a Spanish reader sees.
function EnglishStatus({
  englishCount,
  translationCount,
}: {
  englishCount: number;
  translationCount: number;
}) {
  // No translations at all: the entry is unreachable in either language, which
  // is a different problem and reported by the Translations column instead.
  if (translationCount === 0) return <span className="text-gray-400">—</span>;

  if (englishCount === translationCount) return <span className="text-gray-600">Complete</span>;

  if (englishCount === 0) {
    return (
      <span className="text-amber-700" title="Add an English gloss to make it appear">
        Not shown in English
      </span>
    );
  }

  return (
    <span className="text-gray-600" title="The rest are not shown to English readers">
      {englishCount} of {translationCount} in English
    </span>
  );
}

// A live entry can hold translations that are not live, which happens whenever
// a dialect is added after publishing. Those are excluded from the public reads
// in EVERY locale, so the dialect exists only in this panel — and nothing in
// the list said so: the entry sits under Published looking finished, and cannot
// appear under Drafts without making "draft" mean two different things.
//
// Only meaningful on a published entry. On a draft one every translation is
// unpublished because the entry is, which is the normal state and not worth a
// word.
function TranslationCount({
  translationCount,
  unpublishedTranslationCount,
  isPublished,
}: {
  translationCount: number;
  unpublishedTranslationCount: number;
  isPublished: boolean;
}) {
  const pending = isPublished ? unpublishedTranslationCount : 0;

  if (pending === 0) return <span className="text-gray-600">{translationCount}</span>;

  return (
    <span className="text-amber-700" title="Added after publishing — not in the dictionary yet">
      {translationCount} · {pending} not live
    </span>
  );
}

export default async function AdminEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; mine?: string }>;
}) {
  // Parsed against the shared enum rather than trusted: ?status= is user input,
  // and an unrecognised value falls back to the queue rather than 400ing a
  // screen someone reached from a stale link.
  const { status, page, mine } = await searchParams;
  const parsed = AdminEntryStatusSchema.safeParse(status);
  const activeStatus: AdminEntryStatus = parsed.success ? parsed.data : 'draft';
  const activeMine = mine === 'true';

  // `mine` wins the tab highlight because it is the narrower claim: a URL
  // carrying both is the Mine view, whatever status it names.
  const view =
    VIEWS.find((v) => (activeMine ? v.mine === true : !v.mine && v.status === activeStatus)) ??
    VIEWS[1]!;

  // The API pages at 20 by default. Nothing sent one, so every view showed the
  // first 20 rows while the header reported the true total — the count and the
  // table disagreed, and the rest of the dictionary was unreachable.
  const requestedPage = Number(page);
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  // Both are authenticated calls; the layout already established there is a
  // session, so a failure here is a genuine error rather than a signed-out user.
  const [me, entries] = await Promise.all([
    getMe(),
    listAdminEntries({ status: view.status, page: currentPage, mine: view.mine }),
  ]);

  const isAdmin = me.role === 'ADMIN';

  return (
    <main className="p-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">Entries</h1>
        <div className="flex items-baseline gap-4">
          <span className="text-sm text-gray-500">
            {entries.meta.total} {entries.meta.total === 1 ? 'entry' : 'entries'}
          </span>
          <Link
            href="/admin/entries/new"
            className="rounded bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-800"
          >
            New entry
          </Link>
        </div>
      </div>

      {/* Links rather than client-side state: the filter belongs in the URL so a
          view can be linked to and survives a reload. Without it a published
          entry was unreachable from the panel entirely — the list only ever
          asked for drafts, and nothing else linked to an editor. */}
      <nav className="mb-4 flex gap-4 border-b border-gray-200 text-sm">
        {VIEWS.filter((v) => !v.adminOnly || isAdmin).map((v) => (
          <Link
            key={v.key}
            href={href(v)}
            className={
              v.key === view.key
                ? '-mb-px border-b-2 border-gray-900 pb-2 font-medium text-gray-900'
                : 'pb-2 text-gray-500 hover:text-gray-900'
            }
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {entries.data.length === 0 ? (
        // Not an error state. An empty queue is the normal steady state, and
        // for a contributor it also means "none of yours" rather than "none at
        // all" — the API scopes the list to its caller.
        <p className="text-sm text-gray-600">
          {EMPTY[view.key]}{' '}
          <Link href="/admin/entries/new" className="underline">
            Create an entry
          </Link>
          .
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2 pr-4 font-medium">Headword</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Translations</th>
                <th className="py-2 pr-4 font-medium">English</th>
                <th className="py-2 pr-4 font-medium">Last edited</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {entries.data.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-medium">{entry.nawatContent}</td>
                  <td className="py-2 pr-4 text-gray-600">{entry.type}</td>
                  <td className="py-2 pr-4">
                    <TranslationCount
                      translationCount={entry.translationCount}
                      unpublishedTranslationCount={entry.unpublishedTranslationCount}
                      isPublished={entry.isPublished}
                    />
                  </td>
                  {/* Still never a gate — ADR 0015 §2 exempts dictionary entries
                      from the English-to-publish rule, so Spanish alone
                      publishes fine. But this column now reports the
                      CONSEQUENCE rather than the tidiness, because the two ADRs
                      combine into something neither says: §4 resolves content
                      to one locale, and the public browse requires contentEn in
                      its semi-join, so an entry with no English anywhere is
                      published and invisible to every English reader at once.
                      "Missing" read like a nicety and hid that entirely. */}
                  <td className="py-2 pr-4">
                    <EnglishStatus
                      englishCount={entry.englishCount}
                      translationCount={entry.translationCount}
                    />
                  </td>
                  <td className="py-2 pr-4 text-gray-600">
                    {new Date(entry.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/entries/${entry.id}/edit`}
                        className="text-sm text-gray-600 hover:underline"
                      >
                        Edit
                      </Link>
                      {/* Both lifecycle actions are ADMIN on the API, so neither
                          is offered otherwise. Which one shows follows the row,
                          not the view: `all` mixes both. */}
                      {isAdmin &&
                        (entry.isPublished ? (
                          <UnpublishButton id={entry.id} nawatContent={entry.nawatContent} />
                        ) : (
                          <PublishButton id={entry.id} nawatContent={entry.nawatContent} />
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Links, not buttons: the page belongs in the URL for the same reason the
          view does — it can be linked to, and the back button behaves. Rendered
          only when there is more than one page, so the common case stays quiet. */}
      {entries.meta.totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          {currentPage > 1 ? (
            <Link href={href(view, currentPage - 1)} className="text-gray-600 hover:underline">
              ← Previous
            </Link>
          ) : (
            <span className="text-gray-300">← Previous</span>
          )}

          <span className="text-gray-500">
            Page {entries.meta.page} of {entries.meta.totalPages}
          </span>

          {currentPage < entries.meta.totalPages ? (
            <Link href={href(view, currentPage + 1)} className="text-gray-600 hover:underline">
              Next →
            </Link>
          ) : (
            <span className="text-gray-300">Next →</span>
          )}
        </nav>
      )}
    </main>
  );
}
