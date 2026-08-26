import Link from 'next/link';

import { getMe, listAdminEntries } from '../../../lib/api/admin';
import { PublishButton } from './publish-button';

// Drafts, newest edit first — the queue the panel exists to work through.
//
// The row actions are deliberately thin. Editing and creating live on their own
// routes rather than expanding inline here, because a row carries only what the
// list projection computes — `translationCount` and `hasEnglish`, not the
// translations themselves — so an inline editor would need a second request per
// row to have anything to edit.
export default async function AdminEntriesPage() {
  // Both are authenticated calls; the layout already established there is a
  // session, so a failure here is a genuine error rather than a signed-out user.
  const [me, drafts] = await Promise.all([getMe(), listAdminEntries({ status: 'draft' })]);

  const canPublish = me.role === 'ADMIN';

  return (
    <main className="p-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold">Drafts</h1>
        <div className="flex items-baseline gap-4">
          <span className="text-sm text-gray-500">
            {drafts.meta.total} {drafts.meta.total === 1 ? 'entry' : 'entries'}
          </span>
          <Link
            href="/admin/entries/new"
            className="rounded bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-800"
          >
            New entry
          </Link>
        </div>
      </div>

      {drafts.data.length === 0 ? (
        // Not an error state. An empty queue is the normal steady state, and
        // for a contributor it also means "none of yours" rather than "none at
        // all" — the API scopes the list to its caller.
        <p className="text-sm text-gray-600">
          No drafts.{' '}
          <Link href="/admin/entries/new" className="underline">
            Create an entry
          </Link>{' '}
          — it appears here until it is published.
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
              {drafts.data.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-medium">{entry.nawatContent}</td>
                  <td className="py-2 pr-4 text-gray-600">{entry.type}</td>
                  <td className="py-2 pr-4 text-gray-600">{entry.translationCount}</td>
                  {/* Informational, never a gate: ADR 0015 §2 exempts dictionary
                      entries from the English-to-publish rule, so an entry with
                      Spanish alone publishes fine. */}
                  <td className="py-2 pr-4 text-gray-600">
                    {entry.hasEnglish ? 'Complete' : 'Missing'}
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
                      {canPublish && (
                        <PublishButton id={entry.id} nawatContent={entry.nawatContent} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
